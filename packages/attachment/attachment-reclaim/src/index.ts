/**
 * Session attachment reference ledger (`ctx.attachmentReferences`) and the sweep
 * that reclaims an object once no Session references it any more.
 *
 * Attachment storage is content-addressed, so the same bytes uploaded by two
 * Sessions occupy one object, and one Session deletion must not cost the other
 * its image. This package owns the answer to whether any Session still names an
 * object: a durable `attachment_refs` domain recording each object's holders,
 * rebuilt from stored Session logs whenever the ledger is missing or suspect.
 *
 * The ledger is a claim about the logs, never a second authority. References
 * enter only from committed events, so a rejected message or an abandoned upload
 * leaves nothing behind, and losing the last reference queues the object for a
 * later pass. A failed write therefore costs disk space, never bytes a Session
 * still needs.
 * @module @deepseek-ai/dsh-attachment-reclaim
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import pLimit from 'p-limit'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { AttachmentDiscardResult } from '@deepseek-ai/dsh-attachment'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { isUserMessageEdit, isVoidedByMessageEdit, messageEditWindows } from '@deepseek-ai/dsh-session/surface'
// Type-only: pulls the SessionPersistence service merge (ctx.sessionPersistence).
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { SessionDeletedNotice } from '@deepseek-ai/dsh-workspace'
import type { DomainGlobal, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { attachmentRefsDomainSpec } from './spec.ts'
import type { AttachmentRefsDomainState, ReclaimRecord, ReferrerRecord } from './spec.ts'
import { collectAttachmentIds } from './refs.ts'

export { collectAttachmentIds } from './refs.ts'
export {
  attachmentRefsDomainSpec, attachmentRefsDomainState, reclaimRecord, referrerRecord,
} from './spec.ts'
export type { AttachmentRefsDomainState, ReclaimRecord, ReferrerRecord } from './spec.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    attachmentReferences: AttachmentReferences
  }
}

/** Prefix one stored digest into the identifier callers pass around. */
function attachmentId(digest: string): AttachmentId {
  return AttachmentId(`sha256:${digest}`)
}

/** Storage key for one identifier: the bare digest, which the medium can name. */
function digestOf(id: AttachmentId): string {
  return String(id).slice('sha256:'.length)
}

/**
 * Plugin config. Each field trades how eagerly disk is reclaimed against how
 * much is kept, so the composition states them in `cordis.yml`; the rules that
 * decide whether one object may go are policy, not tunables.
 */
export interface Config {
  /** Interval between reclaim passes. */
  reclaimIntervalMs: number
  /** Shortest age an object reaches before a pass may remove it, and the lifetime of one in-process claim. */
  minAgeMs: number
  /** Most queued objects one reclaim pass handles. */
  batchSize: number
  /** Most attachment-store calls one reclaim pass keeps in flight. */
  concurrency: number
}

export const Config: z<Config> = z.object({
  reclaimIntervalMs: z.natural().min(1).required(),
  /** Zero lets a pass reclaim an object as soon as its last reference left. */
  minAgeMs: z.natural().required(),
  batchSize: z.natural().min(1).required(),
  concurrency: z.natural().min(1).required(),
})

/** Outcome of one reclaim pass. */
export interface ReclaimOutcome {
  /** Queued objects the backend removed or had already lost. */
  removed: number
  /** Queue entries dropped because a Session references that object again. */
  revived: number
  /** Queue entries kept for a later pass. */
  retried: number
}

/**
 * Which Sessions reference which content-addressed object, and the queue of
 * objects that lost their last reference. The ledger opens its domain at init,
 * records a reference when an event commits, drops references when a Session log
 * is removed, and reclaims a queued object that stayed unreferenced long enough.
 *
 * Reclaim is gated on trust: until a pass has read every stored Session log
 * without error, the ledger cannot prove that nobody references an object, and it
 * removes none.
 */
export class AttachmentReferences extends Service {
  static inject = ['storageDomain', 'sessionPersistence', 'attachments']

  static Config: z<Config> = Config

  private refs?: KvTable<string, ReferrerRecord>
  private reclaim?: KvTable<string, ReclaimRecord>
  private global?: DomainGlobal<AttachmentRefsDomainState>
  /** Objects this process committed that no event has referenced yet, by digest. */
  private readonly claims = new Map<string, number>()
  /** Whether the durable records were last rebuilt from every stored Session log. */
  private built = false
  /** Reclaim passes run one after another; a tick during a pass waits its turn. */
  private passChain: Promise<void> = Promise.resolve()

  constructor(ctx: Context, public config: Config) {
    super(ctx, 'attachmentReferences')
  }

  /** Open the domain, install the reference path, and arm the reclaim timer. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(attachmentRefsDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'attachmentReclaim.domainClose')
    this.refs = domain.table('refs')
    this.reclaim = domain.table('reclaim')
    this.global = domain.global
    this.built = this.global.get().builtAt !== undefined
    this.installReferencePath()
    this.installReclaimTimer()
    // Claims died with whichever process wrote them, and only a rebuilt ledger
    // may remove an object. The pass owns no cleanup of its own: the timer's
    // disposer stops scheduling further passes, and this one settles on its own.
    void this.startup()
  }

  /** Whether the records describe every stored Session log. */
  get trustworthy(): boolean {
    return this.built
  }

  /**
   * Which Sessions the records name as holders of one object. A caller that
   * needs to know whether an object is still referenced reads this instead of
   * the domain.
   * @param id - content address to look up.
   * @returns the holder Session ids in the order the ledger recorded them.
   */
  holdersOf(id: AttachmentId): readonly SessionId[] {
    return this.requireRefs().get(digestOf(id))?.sessionIds ?? []
  }

  /**
   * Record that one Session references these objects, because a committed event
   * named them. A duplicate reference leaves the order untouched, and a new
   * reference revives a queued removal, so the object survives the pass that was
   * about to take it.
   * @param sessionId - the Session whose log named the objects.
   * @param ids - content addresses the committed event carries.
   * @returns resolution after every affected record is durable.
   */
  async reference(sessionId: SessionId, ids: readonly AttachmentId[]): Promise<void> {
    for (const id of ids) {
      const digest = digestOf(id)
      this.claims.delete(digest)
      const table = this.requireRefs()
      const current = table.get(digest)
      if (current !== undefined && current.sessionIds.includes(sessionId)) continue
      await table.put(digest, { sessionIds: [...(current?.sessionIds ?? []), sessionId] })
      await this.requireReclaim().delete(digest)
    }
  }

  /**
   * Claim one object this process just committed, before any event references it.
   * A claim keeps a pass from removing an object whose reference has not landed
   * yet, and it expires after {@link Config.minAgeMs}.
   * @param id - content address of the object the backend published.
   * @returns nothing; the claim lives in this process's memory.
   */
  noteSaved(id: AttachmentId): void {
    this.claims.set(digestOf(id), Date.now())
  }

  /**
   * Objects waiting in the queue for a reclaim pass. A caller that removed a
   * reference can use this to see the queue rather than guess at it.
   * @returns the content addresses queued for removal, in no promised order.
   */
  queuedForRemoval(): readonly AttachmentId[] {
    return [...this.requireReclaim().keys()].map(attachmentId)
  }

  /**
   * Drop every reference one Session holds, as when its log is removed. Each
   * object that loses its last reference is queued for reclaim; one another
   * Session still references keeps its record and its bytes.
   * @param sessionId - the Session whose references are gone.
   * @returns how many objects were queued for removal.
   */
  async detachSession(sessionId: SessionId): Promise<number> {
    const table = this.requireRefs()
    let queued = 0
    for (const [digest, record] of table.entries()) {
      if (!record.sessionIds.includes(sessionId)) continue
      const holders = record.sessionIds.filter(holder => holder !== sessionId)
      if (holders.length > 0) {
        await table.put(digest, { sessionIds: holders })
        continue
      }
      await table.delete(digest)
      await this.enqueue(digest)
      queued += 1
    }
    return queued
  }

  /**
   * Rebuild the reference records from every stored Session log. A log that
   * cannot be read leaves the ledger untrusted rather than partially rebuilt: a
   * missing reference would let a pass remove an object some Session still needs.
   * Records the rebuilt logs do not name lost their last reference and are queued
   * the way a Session removal queues them.
   * @returns resolution once every record is durable and the ledger is marked built.
   */
  async buildFromLogs(): Promise<void> {
    const holders = new Map<string, Set<SessionId>>()
    for (const snapshot of await this.ctx.sessionPersistence.list()) {
      const handle = await this.ctx.sessionPersistence.open(snapshot.header.id, 'read')
      try {
        const { events } = await handle.read()
        // An edit voids its message and everything after it, so a rewritten-away
        // attachment is no longer held by this Session even though its event stays
        // readable by position.
        const edits = messageEditWindows(events)
        for (const event of events) {
          if (isVoidedByMessageEdit(edits, event.seq)) continue
          for (const id of collectAttachmentIds(event)) {
            const digest = digestOf(id)
            const owners = holders.get(digest) ?? new Set<SessionId>()
            owners.add(snapshot.header.id)
            holders.set(digest, owners)
          }
        }
      } finally {
        await handle.close()
      }
    }
    const table = this.requireRefs()
    for (const [digest, owners] of holders) {
      await table.put(digest, { sessionIds: [...owners] })
    }
    for (const digest of [...table.keys()]) {
      if (holders.has(digest)) continue
      await table.delete(digest)
      await this.enqueue(digest)
    }
    await (this.global as DomainGlobal<AttachmentRefsDomainState>).set({ builtAt: new Date().toISOString() })
    this.built = true
  }

  /**
   * Handle the queued objects that have waited long enough. An entry is dropped
   * when a Session references the object again, kept when a fresh in-process claim
   * or the backend's own age guard protects it, and counted as removed when the
   * backend reports the object gone or already absent.
   * @returns this pass's counts.
   */
  async sweepOnce(): Promise<ReclaimOutcome> {
    const outcome: ReclaimOutcome = { removed: 0, revived: 0, retried: 0 }
    if (!this.built) return outcome
    const now = Date.now()
    const queue = [...this.requireReclaim().entries()]
      .filter(([, record]) => now - record.enqueuedAt >= this.config.minAgeMs)
      .sort((left, right) => left[1].enqueuedAt - right[1].enqueuedAt)
      .slice(0, this.config.batchSize)
    const limit = pLimit(this.config.concurrency)
    await Promise.all(queue.map(([digest, record]) => limit(async () => {
      if (this.requireRefs().get(digest) !== undefined) {
        await this.requireReclaim().delete(digest)
        outcome.revived += 1
        return
      }
      const claim = this.claims.get(digest)
      if (claim !== undefined && now - claim < this.config.minAgeMs) {
        outcome.retried += 1
        return
      }
      let result: AttachmentDiscardResult
      try {
        result = await this.ctx.attachments.discard(attachmentId(digest), { minAgeMs: this.config.minAgeMs })
      } catch (error: unknown) {
        await this.bumpAttempt(digest, record, this.describe(error))
        outcome.retried += 1
        return
      }
      if (result === 'held') {
        await this.bumpAttempt(digest, record, `held: younger than ${this.config.minAgeMs}ms`)
        outcome.retried += 1
        return
      }
      await this.requireReclaim().delete(digest)
      outcome.removed += 1
    })))
    return outcome
  }

  /** Rebuild when the ledger is untrusted, then reclaim; passes never overlap. */
  private runPass(): Promise<void> {
    const next = this.passChain.then(() => this.sweepPass())
    this.passChain = next
    return next
  }

  /** One pass, contained: a rebuild or removal failure is logged, never thrown upward. */
  private async sweepPass(): Promise<void> {
    if (!this.built) {
      try {
        await this.buildFromLogs()
      } catch (error: unknown) {
        this.built = false
        this.ctx.logger.warn(`attachment-reclaim: reference rebuild failed: ${this.describe(error)}`)
        return
      }
    }
    try {
      await this.sweepOnce()
    } catch (error: unknown) {
      this.ctx.logger.warn(`attachment-reclaim: reclaim pass failed: ${this.describe(error)}`)
    }
  }

  /** Queue one object that no Session references any more, once. */
  private async enqueue(digest: string): Promise<void> {
    /* v8 ignore next -- a queue entry outlives the reference record that would re-queue it */
    if (this.requireReclaim().get(digest) !== undefined) return
    await this.requireReclaim().put(digest, { enqueuedAt: Date.now(), attempts: 0 })
  }

  /** Keep one queue entry for a later pass and record why it stayed. */
  private async bumpAttempt(digest: string, record: ReclaimRecord, reason: string): Promise<void> {
    await this.requireReclaim().put(digest, {
      enqueuedAt: record.enqueuedAt,
      attempts: record.attempts + 1,
      lastError: reason,
    })
  }

  /** One-line failure description for a queue record and the log. */
  private describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  /** Observe freshly committed objects, committed references, and deletions. */
  private installReferencePath(): void {
    this.ctx.effect(() => this.ctx.on('attachments/saved', (id: AttachmentId) => {
      this.noteSaved(id)
    }), 'attachmentReclaim.claims')
    this.ctx.effect(() => this.ctx.on('session/event', (session: Session, event: SessionEvent) => {
      if (isUserMessageEdit(event)) {
        // A rewrite can drop an attachment. Only a rebuild over the surviving
        // ranges can compute the exact reference set, so mark the ledger
        // untrusted; the next pass rebuilds before it removes anything.
        this.built = false
      }
      const ids = collectAttachmentIds(event)
      if (ids.length === 0) return
      // The event is already committed, so a lost record cannot cost a Session
      // its image: it only makes the ledger untrusted until the next rebuild.
      /* v8 ignore start -- a durable write fault needs a storage failure this suite cannot inject */
      void this.reference(session.id, ids).catch((error: unknown) => {
        this.built = false
        this.ctx.logger.warn(`attachment-reclaim: reference write failed: ${this.describe(error)}`)
      })
      /* v8 ignore stop */
    }), 'attachmentReclaim.references')
    // The Workspace registry owns the deletion; this package only reacts.
    this.ctx.effect(() => this.ctx.on('workspace/session-deleted', (notice: SessionDeletedNotice) => {
      /* v8 ignore start -- a durable write fault needs a storage failure this suite cannot inject */
      void this.detachSession(notice.sessionId).catch((error: unknown) => {
        this.built = false
        this.ctx.logger.warn(
          `attachment-reclaim: detaching session ${String(notice.sessionId)} failed: ${this.describe(error)}`,
        )
      })
      /* v8 ignore stop */
    }), 'attachmentReclaim.detach')
  }

  /** Arm the reclaim timer for the whole life of the plugin fiber. */
  private installReclaimTimer(): void {
    let stopped = false
    const tick = (): void => {
      /* v8 ignore next -- the disposer clears the armed timer, so no pass starts after a stop */
      if (stopped) return
      void this.runPass().finally(() => {
        if (!stopped) timer = setTimeout(tick, this.config.reclaimIntervalMs)
      })
    }
    let timer = setTimeout(tick, this.config.reclaimIntervalMs)
    this.ctx.effect(() => () => {
      stopped = true
      clearTimeout(timer)
    }, 'attachmentReclaim.timer')
  }

  /** Clear the dead process's claims, then rebuild and reclaim once. */
  private async startup(): Promise<void> {
    this.claims.clear()
    await this.runPass()
  }

  private requireRefs(): KvTable<string, ReferrerRecord> {
    if (this.refs === undefined) throw new Error('attachment reference ledger is not started yet')
    return this.refs
  }

  private requireReclaim(): KvTable<string, ReclaimRecord> {
    if (this.reclaim === undefined) throw new Error('attachment reference ledger is not started yet')
    return this.reclaim
  }
}

export default AttachmentReferences

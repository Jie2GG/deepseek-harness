/**
 * Reference-ledger behaviour: what may be reclaimed, what must wait, and the
 * trust a sweep needs before it removes anything.
 * @module @deepseek-ai/dsh-attachment-reclaim/tests/ledger
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { MessageId, freezeMessage } from '@deepseek-ai/dsh-llm'
import AttachmentStore, { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type {
  AttachmentDiscardOptions, AttachmentDiscardResult, ImageAttachmentRef, SaveImageAttachment,
  StoredImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import type { AttachmentId as AttachmentIdType } from '@deepseek-ai/dsh-attachment'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId, SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import type { SessionHandleReadResult } from '@deepseek-ai/dsh-session-persistence'
import Storage from '@deepseek-ai/dsh-storage'
import {
  apply as domainApply, Config as domainConfig, inject as domainInject, name as domainName,
} from '@deepseek-ai/dsh-storage-domain'
import {
  apply as jsonApply, Config as jsonConfig, inject as jsonInject, name as jsonName,
} from '@deepseek-ai/dsh-storage-json'
import SessionPersistence, {
  SessionPersistenceNotFoundError, SessionPersistenceRevision,
} from '@deepseek-ai/dsh-session-persistence'
import type { SessionHandle, SessionPersistenceSnapshot } from '@deepseek-ai/dsh-session-persistence'
import AttachmentReferences from '../src/index.ts'
import { collectAttachmentIds } from '../src/refs.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'reclaim/mark': { attachment?: { attachmentId: string } }
  }

  interface OutOfBandSessionEventMap {
    'reclaim/mark': true
  }
}

/** One 64-hex digest, from a short label. */
function digest(label: string): string {
  return label.padEnd(64, '0').slice(0, 64)
}

const A = digest('a')
const B = digest('b')
const C = digest('c')

/** In-memory persistence double whose listing drives the ledger rebuild. */
class TestPersistence extends SessionPersistence {
  readonly stored = new Map<SessionId, { header: SessionHeader; events: SessionEvent[] }>()
  /** Recorded removals, newest last. */
  readonly deleteCalls: SessionId[] = []
  listFailure: unknown
  openFailure: unknown
  deleteFailure: unknown
  listCalls = 0

  create(header: SessionHeader): Promise<SessionHandle> {
    const entry = { header, events: [] as SessionEvent[] }
    this.stored.set(header.id, entry)
    return Promise.resolve(this.handle(header, entry, 'write'))
  }

  open(id: SessionId, access: 'read' | 'write'): Promise<SessionHandle> {
    if (this.openFailure !== undefined) throw this.openFailure
    const entry = this.stored.get(id)
    if (entry === undefined) return Promise.reject(new SessionPersistenceNotFoundError(id))
    return Promise.resolve(this.handle(entry.header, entry, access))
  }

  flush(): Promise<void> {
    return Promise.resolve()
  }

  stat(id: SessionId): Promise<SessionPersistenceSnapshot | undefined> {
    const entry = this.stored.get(id)
    if (entry === undefined) return Promise.resolve(undefined)
    return Promise.resolve({ header: entry.header, revision: this.revision(entry) })
  }

  list(): Promise<readonly SessionPersistenceSnapshot[]> {
    this.listCalls += 1
    if (this.listFailure !== undefined) throw this.listFailure
    return Promise.resolve([...this.stored.values()].map(entry => ({
      header: entry.header,
      revision: this.revision(entry),
    })))
  }

  delete(id: SessionId): Promise<boolean> {
    this.deleteCalls.push(id)
    if (this.deleteFailure !== undefined) throw this.deleteFailure
    return Promise.resolve(this.stored.delete(id))
  }

  /** Seed one stored log without going through a handle. */
  seed(id: SessionId, events: readonly SessionEvent[]): void {
    this.stored.set(id, { header: headerOf(id), events: [...events] })
  }

  private revision(entry: { events: SessionEvent[] }): SessionPersistenceRevision {
    return SessionPersistenceRevision(`memory:${entry.events.length}`)
  }

  private handle(header: SessionHeader, entry: { events: SessionEvent[] }, access: 'read' | 'write'): SessionHandle {
    let closed = false
    return {
      id: header.id,
      header,
      inheritedEventCount: SessionLogOffset(0),
      access,
      read: async (): Promise<SessionHandleReadResult> => {
        if (closed) throw new Error('closed')
        return { eventState: 'shared-frozen', events: [...entry.events] }
      },
      append: async (events: readonly SessionEvent[]) => { entry.events.push(...events) },
      flush: async () => {},
      close: async () => { closed = true },
      [Symbol.asyncDispose]: async () => { closed = true },
    }
  }
}

/** Attachment double recording removals and answering with a selectable outcome. */
class TestAttachments extends AttachmentStore {
  readonly imageLimits = {
    maxImageBytes: 10, maxImagesPerMessage: 1, maxMessageImageBytes: 10,
    maxImagePixels: 10, maxImageDimension: 4, mediaTypes: ['image/png'] as const,
  }

  readonly discardCalls: Array<{ id: AttachmentIdType; options: AttachmentDiscardOptions | undefined }> = []
  outcome: AttachmentDiscardResult = 'removed'
  discardFailure: unknown

  saveImage(): Promise<ImageAttachmentRef> {
    return Promise.reject(new Error('not used'))
  }

  readImage(): Promise<StoredImageAttachment> {
    return Promise.reject(new Error('not used'))
  }

  validateImage(_input: SaveImageAttachment): Promise<void> {
    return Promise.resolve()
  }

  override discard(
    id: AttachmentIdType,
    options?: AttachmentDiscardOptions,
  ): Promise<AttachmentDiscardResult> {
    this.discardCalls.push({ id, options })
    if (this.discardFailure !== undefined) throw this.discardFailure
    return Promise.resolve(this.outcome)
  }
}

const headerOf = (id: SessionId, cwd = '/work'): SessionHeader => ({
  version: SESSION_FORMAT_VERSION,
  id,
  createdAt: 1000,
  cwd,
  isSeeded: false,
  delegationDepth: 0,
})

const markEvent = (value: string): SessionEvent => ({
  type: 'reclaim/mark',
  seq: SessionSeq(0),
  time: 1,
  data: { attachment: { attachmentId: value } },
})

const userMessage = (value: string): SessionEvent => ({
  type: 'user/message',
  seq: SessionSeq(0),
  time: 1,
  data: freezeMessage({
    id: MessageId(`mark-${value.slice(0, 8)}`),
    role: 'user',
    content: [{ type: 'text', text: value }],
    source: { kind: 'user' },
  }),
  surfaceOp: 'append',
})

const roots: string[] = []
const contexts: Context[] = []

/**
 * Mount one composition over the current test's root, with the ledger's
 * reclaim timer armed. Each test gets its own storage directory, so a durable
 * record one test wrote never answers another test's question.
 */
async function harness(
  config = { reclaimIntervalMs: 60_000, minAgeMs: 1000, batchSize: 10, concurrency: 2 },
  root = roots[roots.length - 1] as string,
  prepare?: (persistence: TestPersistence) => void,
): Promise<{ ctx: Context; persistence: TestPersistence; attachments: TestAttachments }> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin({ name: jsonName, inject: jsonInject, apply: jsonApply, Config: jsonConfig }, { root })
  await ctx.plugin({ name: domainName, inject: domainInject, apply: domainApply, Config: domainConfig }, { backend: 'json' })
  await ctx.plugin(SessionStore)
  await ctx.plugin(TestPersistence)
  await ctx.plugin(TestAttachments)
  prepare?.(ctx.sessionPersistence as TestPersistence)
  await ctx.plugin(AttachmentReferences, config)
  return {
    ctx,
    persistence: ctx.sessionPersistence as TestPersistence,
    attachments: ctx.attachments as TestAttachments,
  }
}

beforeEach(async () => {
  vi.useFakeTimers()
  roots.push(await mkdtemp(join(tmpdir(), 'dsh-attachment-reclaim-')))
})

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  vi.useRealTimers()
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})

describe('collectAttachmentIds', () => {
  it('finds content addresses at any depth and collapses repeats', () => {
    const ids = collectAttachmentIds({
      data: {
        message: { content: [{ type: 'image', attachment: { attachmentId: `sha256:${A}` } }] },
        trailer: { attachmentId: `sha256:${B}` },
      },
      // A text field that merely spells a digest like an id is not a reference.
      note: `sha256:${C}`,
      nestedNull: null,
      nestedNumber: 7,
    })
    expect(ids.map(String).sort()).toEqual([`sha256:${A}`, `sha256:${B}`].sort())
  })

  it('ignores identifiers that are not content addresses', () => {
    expect(collectAttachmentIds({ attachmentId: 'opaque-id' })).toEqual([])
    expect(collectAttachmentIds('sha256:text')).toEqual([])
  })
})


describe('AttachmentReferences rebuild', () => {
  it('rebuilds every holder set from the stored logs', async () => {
    const { ctx, persistence } = await harness()
    persistence.seed(SessionId('holder-a'), [markEvent(`sha256:${A}`)])
    persistence.seed(SessionId('holder-b'), [userMessage('no attachments')])
    const ledger = ctx.attachmentReferences
    await ledger.buildFromLogs()

    expect(ledger.trustworthy).toBe(true)
    expect(persistence.listCalls).toBeGreaterThan(0)
    // Only the log that named an object holds one.
    expect(await ledger.detachSession(SessionId('holder-b'))).toBe(0)
    expect(await ledger.detachSession(SessionId('holder-a'))).toBe(1)
  })

  it('queues a record that a rebuilt log no longer names', async () => {
    const { ctx, attachments } = await harness()
    const ledger = ctx.attachmentReferences
    await ledger.buildFromLogs()
    await ledger.reference(SessionId('gone'), [AttachmentId(`sha256:${A}`)])

    // The rebuild sees no log naming that object, so it retires the record and
    // queues it exactly once.
    await ledger.buildFromLogs()
    expect(ledger.queuedForRemoval()).toEqual([AttachmentId(`sha256:${A}`)])
    await vi.advanceTimersByTimeAsync(1_000)
    expect(await ledger.sweepOnce()).toMatchObject({ removed: 1 })
    expect(String(attachments.discardCalls[0]?.id)).toBe(`sha256:${A}`)
  })

  it('stays untrusted after a listing or log failure and reclaims nothing', async () => {
    const { ctx, persistence, attachments } = await harness()
    persistence.seed(SessionId('holder-a'), [markEvent(`sha256:${A}`)])
    persistence.listFailure = new Error('store unavailable')
    await expect(ctx.attachmentReferences.buildFromLogs()).rejects.toThrow('store unavailable')
    expect(ctx.attachmentReferences.trustworthy).toBe(false)

    persistence.listFailure = undefined
    persistence.openFailure = new Error('log unreadable')
    await expect(ctx.attachmentReferences.buildFromLogs()).rejects.toThrow('log unreadable')
    expect(ctx.attachmentReferences.trustworthy).toBe(false)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(await ctx.attachmentReferences.sweepOnce()).toEqual({ removed: 0, revived: 0, retried: 0 })
    expect(attachments.discardCalls).toEqual([])
  })

  it('carries the built marker to a fresh composition over the same storage', async () => {
    const { ctx, persistence } = await harness()
    persistence.seed(SessionId('holder-a'), [markEvent(`sha256:${A}`)])
    await ctx.attachmentReferences.buildFromLogs()
    await ctx.fiber.dispose()

    const again = await harness()
    expect(again.ctx.attachmentReferences.trustworthy).toBe(true)
  })
})

describe('AttachmentReferences recording', () => {
  it('records one holder per Session and reclaims after the last one leaves', async () => {
    const { ctx, attachments } = await harness()
    const ledger = ctx.attachmentReferences
    await ledger.buildFromLogs()
    const id = AttachmentId(`sha256:${A}`)

    await ledger.reference(SessionId('one'), [id])
    // A repeat reference from the same Session changes nothing.
    await ledger.reference(SessionId('one'), [id])
    await ledger.reference(SessionId('two'), [id])
    expect(await ledger.detachSession(SessionId('one'))).toBe(0)
    expect(ledger.holdersOf(id)).toEqual([SessionId('two')])

    await vi.advanceTimersByTimeAsync(1_000)
    expect(await ledger.sweepOnce()).toMatchObject({ retried: 0, removed: 0 })
    expect(await ledger.detachSession(SessionId('two'))).toBe(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(await ledger.sweepOnce()).toMatchObject({ removed: 1 })
    expect(attachments.discardCalls.map(call => String(call.id))).toEqual([String(id)])
    expect(attachments.discardCalls[0]?.options?.minAgeMs).toBe(1_000)
  })

  it('revives a queued object when a rebuilt log names it again', async () => {
    const { ctx, persistence, attachments } = await harness()
    const ledger = ctx.attachmentReferences
    persistence.seed(SessionId('holder-a'), [markEvent(`sha256:${A}`)])
    await ledger.buildFromLogs()
    expect(await ledger.detachSession(SessionId('holder-a'))).toBe(1)

    persistence.stored.delete(SessionId('holder-a'))
    persistence.seed(SessionId('holder-b'), [markEvent(`sha256:${A}`)])
    await ledger.buildFromLogs()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(await ledger.sweepOnce()).toMatchObject({ revived: 1, removed: 0 })
    expect(attachments.discardCalls).toEqual([])
    // The revived reference is real: the object survives this Session leaving.
    expect(await ledger.detachSession(SessionId('holder-b'))).toBe(1)
  })

  it('keeps an object another Session in this process has just saved', async () => {
    const { ctx, attachments } = await harness()
    const ledger = ctx.attachmentReferences
    await ledger.buildFromLogs()
    const id = AttachmentId(`sha256:${B}`)
    await ledger.reference(SessionId('one'), [id])
    expect(await ledger.detachSession(SessionId('one'))).toBe(1)

    await vi.advanceTimersByTimeAsync(1_000)
    // The same bytes are being uploaded right now: its object must survive.
    ctx.emit('attachments/saved', id)
    expect(await ledger.sweepOnce()).toMatchObject({ retried: 1, removed: 0 })
    expect(attachments.discardCalls).toEqual([])

    await ledger.reference(SessionId('two'), [id])
    expect(await ledger.sweepOnce()).toMatchObject({ removed: 0, revived: 0, retried: 0 })
    expect(await ledger.detachSession(SessionId('two'))).toBe(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(await ledger.sweepOnce()).toMatchObject({ removed: 1 })
  })

  it('records a reference when a Session event commits', async () => {
    const { ctx } = await harness()
    const ledger = ctx.attachmentReferences
    await ledger.buildFromLogs()
    const session = ctx.sessions.create(SessionId('live'))
    const id = AttachmentId(`sha256:${C}`)
    session.append('reclaim/mark', { attachment: { attachmentId: String(id) } })

    await vi.waitFor(async () => { expect(ledger.holdersOf(id)).toEqual([SessionId('live')]) })
    expect(await ledger.detachSession(SessionId('live'))).toBe(1)
  })

  it('ignores an event that names no object', async () => {
    const { ctx } = await harness()
    const ledger = ctx.attachmentReferences
    await ledger.buildFromLogs()
    const session = ctx.sessions.create(SessionId('plain'))
    session.append('reclaim/mark', {})
    await vi.advanceTimersByTimeAsync(0)

    expect(await ledger.detachSession(SessionId('plain'))).toBe(0)
  })

  it('detaches every reference when the Workspace announces a deletion', async () => {
    // The interval is longer than the advance below, so only the explicit pass
    // removes: the test observes the listener's effect, not a timer race.
    const { ctx, attachments } = await harness({
      reclaimIntervalMs: 60_000, minAgeMs: 10, batchSize: 10, concurrency: 2,
    })
    const ledger = ctx.attachmentReferences
    await ledger.buildFromLogs()
    const id = AttachmentId(`sha256:${C}`)

    await ledger.reference(SessionId('gone'), [id])
    expect(ledger.holdersOf(id)).toEqual([SessionId('gone')])

    ctx.emit('workspace/session-deleted', { sessionId: SessionId('gone') })
    // The notice lands on the listener: the holder record goes, and the object
    // enters the removal queue.
    await vi.waitFor(async () => {
      expect(ledger.holdersOf(id)).toEqual([])
      expect(ledger.queuedForRemoval()).toEqual([id])
    })
    await vi.advanceTimersByTimeAsync(100)
    expect(await ledger.sweepOnce()).toEqual({ removed: 1, revived: 0, retried: 0 })
    expect(attachments.discardCalls.map(call => String(call.id))).toEqual([String(id)])
    expect(await ledger.sweepOnce()).toMatchObject({ removed: 0, revived: 0, retried: 0 })
  })
})

describe('AttachmentReferences reclaim pass', () => {
  it('keeps a queued object whose removal reports it too young, then reclaims it', async () => {
    const { ctx, attachments } = await harness()
    const ledger = ctx.attachmentReferences
    await ledger.buildFromLogs()
    const id = AttachmentId(`sha256:${A}`)
    await ledger.reference(SessionId('one'), [id])
    expect(await ledger.detachSession(SessionId('one'))).toBe(1)

    attachments.outcome = 'held'
    await vi.advanceTimersByTimeAsync(1_000)
    expect(await ledger.sweepOnce()).toMatchObject({ retried: 1 })
    expect(await ledger.sweepOnce()).toMatchObject({ retried: 1 })
    attachments.outcome = 'removed'
    expect(await ledger.sweepOnce()).toMatchObject({ removed: 1 })
    expect(await ledger.sweepOnce()).toMatchObject({ removed: 0, retried: 0, revived: 0 })
  })

  it('counts an object the backend already lost as removed', async () => {
    const { ctx, attachments } = await harness()
    const ledger = ctx.attachmentReferences
    await ledger.buildFromLogs()
    await ledger.reference(SessionId('one'), [AttachmentId(`sha256:${B}`)])
    await ledger.detachSession(SessionId('one'))
    attachments.outcome = 'absent'

    await vi.advanceTimersByTimeAsync(1_000)
    expect(await ledger.sweepOnce()).toMatchObject({ removed: 1 })
  })

  it('retries a failed removal, recording the reason, and clears it on success', async () => {
    const { ctx, attachments } = await harness()
    const ledger = ctx.attachmentReferences
    await ledger.buildFromLogs()
    const id = AttachmentId(`sha256:${C}`)
    await ledger.reference(SessionId('one'), [id])
    await ledger.detachSession(SessionId('one'))

    attachments.discardFailure = new Error('device busy')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(await ledger.sweepOnce()).toMatchObject({ retried: 1 })
    attachments.discardFailure = 'a bare string'
    expect(await ledger.sweepOnce()).toMatchObject({ retried: 1 })
    attachments.discardFailure = undefined
    expect(await ledger.sweepOnce()).toMatchObject({ removed: 1 })
  })

  it('reclaims at once when the configured minimum age is zero', async () => {
    const { ctx, attachments } = await harness({
      reclaimIntervalMs: 60_000, minAgeMs: 0, batchSize: 10, concurrency: 2,
    })
    const ledger = ctx.attachmentReferences
    await ledger.buildFromLogs()
    await ledger.reference(SessionId('one'), [AttachmentId(`sha256:${A}`)])
    expect(await ledger.detachSession(SessionId('one'))).toBe(1)

    expect(await ledger.sweepOnce()).toMatchObject({ removed: 1 })
    expect(attachments.discardCalls[0]?.options?.minAgeMs).toBe(0)
  })

  it('drains several queued objects in one pass, oldest first', async () => {
    const { ctx, attachments } = await harness()
    const ledger = ctx.attachmentReferences
    await ledger.buildFromLogs()
    const first = AttachmentId(`sha256:${A}`)
    const second = AttachmentId(`sha256:${B}`)
    await ledger.reference(SessionId('one'), [first, second])
    expect(await ledger.detachSession(SessionId('one'))).toBe(2)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(await ledger.sweepOnce()).toMatchObject({ removed: 2 })
    expect(attachments.discardCalls.map(call => String(call.id))).toEqual([String(first), String(second)])
  })

  it('keeps the ledger untrusted when its first rebuild fails, and recovers on a later pass', async () => {
    const { ctx, persistence } = await harness(
      { reclaimIntervalMs: 50, minAgeMs: 10, batchSize: 4, concurrency: 1 },
      undefined,
      (peer) => { peer.listFailure = new Error('store unavailable') },
    )
    const warn = vi.spyOn(ctx.logger, 'warn')
    await vi.advanceTimersByTimeAsync(120)
    expect(ctx.attachmentReferences.trustworthy).toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('reference rebuild failed'))

    // A later rebuild from readable logs restores trust, and the sweep resumes.
    persistence.listFailure = undefined
    persistence.seed(SessionId('holder-a'), [markEvent(`sha256:${A}`)])
    await ctx.attachmentReferences.buildFromLogs()
    expect(ctx.attachmentReferences.trustworthy).toBe(true)
    await vi.advanceTimersByTimeAsync(120)
    expect(ctx.attachmentReferences.trustworthy).toBe(true)
  })

  it('rebuilds and reclaims from the reclaim timer', async () => {
    const { persistence } = await harness({
      reclaimIntervalMs: 50, minAgeMs: 10, batchSize: 10, concurrency: 2,
    })
    persistence.seed(SessionId('holder-a'), [markEvent(`sha256:${A}`)])
    persistence.seed(SessionId('holder-b'), [markEvent(`sha256:${B}`)])
    await vi.advanceTimersByTimeAsync(60)

    // The startup pass rebuilt, and the next pass finds nothing due yet.
    expect(persistence.stored.size).toBe(2)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(persistence.stored.size).toBe(2)
  })

  it('refuses a record write before the ledger has started', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const ledger = new AttachmentReferences(ctx, {
      reclaimIntervalMs: 1_000, minAgeMs: 0, batchSize: 4, concurrency: 1,
    })
    await expect(ledger.detachSession(SessionId('unstarted'))).rejects.toThrow('not started')
    expect(() => ledger.queuedForRemoval()).toThrow('not started')
    expect(() => ledger.holdersOf(AttachmentId(`sha256:${A}`))).toThrow('not started')
    expect(await ledger.sweepOnce()).toEqual({ removed: 0, revived: 0, retried: 0 })
  })
})

describe('AttachmentReferences configuration', () => {
  it('refuses a zero interval, batch, or concurrency before the domain opens', async () => {
    for (const config of [
      { reclaimIntervalMs: 0, minAgeMs: 1, batchSize: 1, concurrency: 1 },
      { reclaimIntervalMs: 1, minAgeMs: 1, batchSize: 0, concurrency: 1 },
      { reclaimIntervalMs: 1, minAgeMs: 1, batchSize: 1, concurrency: 0 },
    ]) {
      await expect(harness(config)).rejects.toThrow()
    }
  })
})

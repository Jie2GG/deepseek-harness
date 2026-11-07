/**
 * The `attachment_refs` domain declaration: which Sessions reference one
 * content-addressed object, and the queue of objects that lost their last
 * reference and await removal. The spec object is the single source of the
 * domain's identity, layout, and record schemas.
 *
 * Both tables are keyed by attachment id, and a per-record layout keeps one
 * attachment's bookkeeping in its own document: a Home with many stored images
 * then writes only what changed, and a record this sweep no longer needs is
 * dropped without touching its neighbours.
 * @module @deepseek-ai/dsh-attachment-reclaim/src/spec
 */

import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'


/** Session id at the durable boundary. */
const sessionId = z.string().transform(value => brandString<SessionId>(value))

/**
 * Durable shape of one object's reference record. `sessionIds` holds every
 * Session whose committed log names the object, in the order the ledger first
 * observed them. Duplicate references leave the order unchanged, so a Session
 * that uploads the same bytes twice still holds exactly one entry.
 */
export const referrerRecord = z.object({
  sessionIds: z.array(sessionId),
})

/** One stored reference record, inferred from {@link referrerRecord}. */
export type ReferrerRecord = z.infer<typeof referrerRecord>

/**
 * Durable shape of one queued removal. `enqueuedAt` starts the minimum-age
 * clock, and `attempts` plus `lastError` carry why a previous sweep could not
 * remove the object, so a stuck queue is diagnosable without a log search.
 */
export const reclaimRecord = z.object({
  enqueuedAt: z.number().int().nonnegative(),
  attempts: z.number().int().nonnegative().default(0),
  lastError: z.string().optional(),
})

/** One stored queue record, inferred from {@link reclaimRecord}. */
export type ReclaimRecord = z.infer<typeof reclaimRecord>

/**
 * Registry-global slot. `builtAt` marks a ledger whose reference records were
 * last rebuilt from every stored Session log: without it the ledger cannot
 * prove that no Session references an object, so the sweep reclaims nothing.
 */
export const attachmentRefsDomainState = z.object({
  builtAt: z.string().optional(),
})

/** Domain singleton shape, inferred from {@link attachmentRefsDomainState}. */
export type AttachmentRefsDomainState = z.infer<typeof attachmentRefsDomainState>

/**
 * The reference-ledger domain: a `refs` table of who still references one
 * object and a `reclaim` table of objects awaiting removal, plus the build
 * marker. The ledger opens this through `ctx.storage.domain`.
 *
 * Both tables are keyed by the bare 64-hex digest rather than the full
 * `sha256:<digest>` spelling an `AttachmentId` carries: the per-record layout
 * names one document per key, so its keys stay path-safe. The ledger converts
 * at its own boundary and never exposes a digest to its callers.
 */
export const attachmentRefsDomainSpec = defineDomain({
  name: 'attachment_refs',
  version: 1,
  layout: 'per-record',
  invalidRecords: 'backup-and-skip',
  global: { schema: attachmentRefsDomainState, initial: {} },
  tables: {
    refs: domainTable<string, ReferrerRecord>(referrerRecord),
    reclaim: domainTable<string, ReclaimRecord>(reclaimRecord),
  },
})

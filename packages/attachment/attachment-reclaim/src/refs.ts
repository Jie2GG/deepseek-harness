/**
 * Extracting the objects one committed Session event names.
 * @module @deepseek-ai/dsh-attachment-reclaim/src/refs
 */

import { AttachmentId } from '@deepseek-ai/dsh-attachment'

/** A content address as attachment backends spell it. */
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/

/**
 * Collect every content address one value carries, at any depth.
 *
 * Event payloads are frozen JSON, so a structural walk sees each
 * `attachment` block reference wherever a current or future event shape puts
 * it, and a reference that is not a content address is never mistaken for one.
 * Repeated occurrences collapse: the result is the set of objects the event
 * names, in first-seen order.
 * @param value - committed event data, or any nested JSON value.
 * @returns the distinct content addresses the value names.
 */
export function collectAttachmentIds(value: unknown): AttachmentId[] {
  const found = new Set<string>()
  const queue: unknown[] = [value]
  while (queue.length > 0) {
    const current = queue.shift()
    if (Array.isArray(current)) {
      for (const item of current) queue.push(item)
      continue
    }
    if (typeof current !== 'object' || current === null) continue
    for (const [key, nested] of Object.entries(current)) {
      if (key === 'attachmentId' && typeof nested === 'string' && DIGEST_PATTERN.test(nested)) {
        found.add(nested)
        continue
      }
      if (typeof nested === 'object' && nested !== null) queue.push(nested)
    }
  }
  return [...found].map(value => AttachmentId(value))
}

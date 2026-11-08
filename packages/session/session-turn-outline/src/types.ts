/**
 * Pure types of the turn-outline domain: the ONE home of the `turnOutline`
 * projection-key declaration, free of this package's host-side value imports
 * (zod, the projection definition). Host consumers import `./types`; client
 * aggregates import `./client`, which re-exports this module.
 *
 * @module @deepseek-ai/dsh-session-turn-outline/types
 */

import type { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { SessionProjectionSummaryExcluded } from '@deepseek-ai/dsh-session-projection/types'

export {}

/** One started turn's outline facts, independent of what a client has paged in. */
export interface TurnOutlineEntry {
  /** Host-assigned turn number (the `turn/start` payload). */
  readonly turn: number
  /** The turn's `turn/start` event seq — paging a window back through this seq loads the whole turn. */
  readonly seq: SessionSeq
  /** Bounded first-human-prompt preview (one rail-card line); `''` for a turn opened without one. */
  readonly prompt: string
  /** Bounded final-response preview (up to three rail-card lines); `''` until the turn ends with assistant text. */
  readonly response: string
}

/**
 * Fold state: the served entries, the open turn's response draft, and the
 * boundary awaiting its opening input. The draft buffers the newest
 * text-bearing assistant message until `turn/end` commits it, and the wire view
 * projects only `turns` — draft-only applies keep that array's identity, so the
 * change feed stays quiet between turn boundaries.
 */
export interface TurnOutlineState {
  /** Turns whose opening input contributed, in ascending turn order. */
  readonly turns: readonly TurnOutlineEntry[]
  /** Newest text-bearing assistant preview of the open turn; `''` outside one. */
  readonly draft: string
  /**
   * A `turn/start` whose opening human input has not contributed yet, or `null`
   * once it has or the turn closed. An entry exists only for a turn whose
   * opening survived, so a human-message edit removes that turn's row.
   */
  readonly pending: { readonly turn: number; readonly seq: SessionSeq } | null
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /**
     * Every turn whose opening human input contributed, with its `turn/start`
     * seq and bounded previews, strictly increasing by turn; see
     * {@link TurnOutlineEntry}. Excluded from
     * Session summary payloads: the outline grows with the whole log and no
     * list row renders it.
     */
    turnOutline: SessionProjectionSummaryExcluded<readonly TurnOutlineEntry[]>
  }
}

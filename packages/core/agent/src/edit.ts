/**
 * Request, result, and failure vocabulary for rewriting one sent human message.
 *
 * @module @deepseek-ai/dsh-agent/edit
 */

import type { ContentBlock, MessageId } from '@deepseek-ai/dsh-llm'
import type { SessionSeq } from '@deepseek-ai/dsh-session/types'

/** One in-place rewrite of a human message that was already sent. */
export interface MessageEditRequest {
  /** Seq of the current surface node holding the message the user rewrites. */
  readonly targetSeq: SessionSeq
  /** Rewritten model-facing blocks: text plus any attachments the message keeps. */
  readonly content: readonly ContentBlock[]
}

/** Durable facts of one accepted edit, reported before the rewrite enters a turn. */
export interface MessageEditResult {
  /** Identity of the rewritten message, preserved across the edit. */
  readonly messageId: MessageId
  /** Current surface nodes the rewrite shadows: the edited message and everything after it. */
  readonly shadowedNodeCount: number
  /** Pending inbox items removed because they followed the rewritten message. */
  readonly clearedQueueCount: number
}

/** Why one human-message edit was refused. */
export type MessageEditErrorCode =
  /** A turn is executing; the caller stops it before editing sent history. */
  | 'MESSAGE_EDIT_TURN_RUNNING'
  /** The target is not a current surface node: it is already shadowed or never entered model history. */
  | 'MESSAGE_EDIT_TARGET_NOT_ON_SURFACE'
  /** The target is not a human-authored message: model answers, tool results, and injected context stay uneditable. */
  | 'MESSAGE_EDIT_TARGET_NOT_USER'
  /** The rewritten content has neither non-whitespace text nor an attachment. */
  | 'MESSAGE_EDIT_CONTENT_EMPTY'
  /** The rewritten content adds an attachment the original message never carried: an edit rewrites sentences, not uploads. */
  | 'MESSAGE_EDIT_ATTACHMENT_NEW'

/** Refusal of one human-message edit, carrying its stable code. */
export class MessageEditError extends Error {
  /**
   * @param message - human-readable detail naming the Session and target.
   * @param code - stable code a Client switches on.
   * @param options - standard error options, including a cause.
   */
  constructor(
    message: string,
    public readonly code: MessageEditErrorCode,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'MessageEditError'
  }
}

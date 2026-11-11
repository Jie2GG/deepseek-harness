/**
 * Human-facing `/compact` command over the backend-independent compaction seam.
 * The command answers once the compaction is reserved, and the durable attempt
 * then runs without this request: a Client that closes the page while the
 * summary model is still answering cannot discard work already paid for. The
 * outcome stays readable from the session's `compaction/start` ...
 * `compaction/end` marker pair, which the conversation renders.
 * @module @deepseek-ai/dsh-command-compact
 */

import type { Context } from '@deepseek-ai/cordis'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'
import { ManualCompactionError } from '@deepseek-ai/dsh-compaction'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'

export const name = 'command-compact'
export const inject = ['commands', 'compaction']

const USAGE = 'Usage: /compact (no arguments)'
const CANCELLED = 'Compaction cancelled.'
const NOTHING = 'No compactable history yet.'
const STARTED = 'Compaction started. It keeps running even if you close this page; the result appears in this conversation. Press Stop to cancel it.'

/** Fail loudly if a locally closed union gains an unhandled member. */
/* v8 ignore start -- closed-union backstop is unreachable without violating the TypeScript contract */
function assertNever(value: never): never {
  throw new TypeError(`unknown manual compaction error code: ${String(value)}`)
}
/* v8 ignore stop */

/** State one expected capability failure as the text a human reads. */
function expectedFailureText(error: ManualCompactionError): string {
  switch (error.code) {
    case 'busy':
      return 'Compaction is unavailable because this process has an active compaction, or the agent is not idle.'
    case 'cancelled':
      return CANCELLED
    case 'changed':
      return 'The history selected for compaction changed before it could be replaced. The attempt is recorded in the session log.'
    case 'summary':
      return 'Compaction could not produce a useful summary. The attempt is recorded in the session log.'
    case 'commit':
      return 'Compaction did not finish cleanly; some session history may have changed. Inspect the current session state before retrying.'
    case 'persistence':
      return 'Compaction finished, but the session could not be saved.'
    /* v8 ignore next 2 -- ManualCompactionErrorCode is closed and every member is handled above */
    default: return assertNever(error.code)
  }
}

/**
 * Start one argument-free manual compaction and answer from its reservation.
 * @param ctx - context carrying the compaction seam and the logger that retains
 *   a detached attempt's failure.
 * @param invocation - request whose own cancellation never bounds the attempt,
 *   because the operation outlives this command.
 * @param active - settles once the detached attempt finishes, so teardown quiesces.
 * @returns the reservation outcome; the started attempt is reported by session events.
 */
function executeCompact(
  ctx: Context,
  invocation: CommandInvocation,
  active: Set<Promise<unknown>>,
): CommandResult {
  if (invocation.rawInput.trim().length > 0) return { kind: 'error', text: USAGE }
  // A detached controller carries the attempt: the agent's own Stop and process
  // teardown still cancel it through the seam's maintenance signal, while this
  // request ending does not.
  const detached = new AbortController()
  try {
    const started = ctx.compaction.compactNow(invocation.agent, detached.signal, invocation.commandId)
    if (started.kind === 'nothing') return { kind: 'success', text: NOTHING }
    const operation = started.done.catch((error: unknown): void => {
      const text = error instanceof ManualCompactionError
        ? expectedFailureText(error)
        : `Compaction attempt failed: ${String(error)}`
      ctx.logger.warn(`command-compact: ${text}`)
    })
    active.add(operation)
    void operation.then(() => { active.delete(operation) })
    return { kind: 'success', text: STARTED }
  } catch (error: unknown) {
    if (error instanceof ManualCompactionError) return { kind: 'error', text: expectedFailureText(error) }
    throw error
  }
}

/**
 * Register `/compact` for every composed human-command adapter.
 * @param ctx - context carrying the command registry and the compaction seam.
 */
export function apply(ctx: Context): void {
  const active = new Set<Promise<unknown>>()
  const handler = (invocation: CommandInvocation): Promise<CommandResult> =>
    Promise.resolve(executeCompact(ctx, invocation, active))

  ctx.effect(function* () {
    // Yield drain before registration: composite teardown is LIFO, so no new
    // invocation can enter while a detached attempt still holds its reservation.
    yield async () => { await Promise.allSettled(active) }
    yield ctx.commands.register({
      definitionId: CommandDefinitionId('@deepseek-ai/dsh-command-compact'),
      name: 'compact',
      description: 'Compact older conversation history',
      handler,
    })
  }, 'command-compact lifecycle')
}

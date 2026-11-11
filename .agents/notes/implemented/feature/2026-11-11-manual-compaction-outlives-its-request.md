# Agent Note: Manual compaction outlives the request that asked for it

Status: implemented

English | [中文](2026-11-11-manual-compaction-outlives-its-request.zh.md)

## Problem

A manual `/compact` held the browser`s request open until the summary model finished, so the `compaction/basic` seam received the dispatching UI request`s cancellation signal. The Web host aborts a request signal without a reason when its connection closes, and the command executor races the handler result against that same signal. Closing or reloading the page therefore cancelled a compaction whose prefill was already paid for: the durable attempt died mid-summary, the session recorded the bare `This operation was aborted`, and each retry prefilled again. A manual attempt on a long context costs minutes of model time, so the loss was not a cosmetic cancellation.

## Decision

- `CompactionEngine.compactNow(agent, signal, sourceCommandId)` answers its reservation synchronously and returns `ManualCompactionStart`: `{ kind: `"running`", done }` once the agent idle task is reserved and a useful range is selected, or `{ kind: `"nothing`" }` when no useful range exists. `done` settles when the durable `compaction/start` ... `compaction/end` bracket closes, and rejects with the same `ManualCompactionError` a caller that awaited the whole attempt would have seen.
- The command answers from that reservation and does not await `done`. It carries the attempt through its own `AbortController` instead of the request signal, so the only cancellations the operation honors are the agent`s Stop, which aborts the maintenance task, and process teardown. `dsh-command-compact` logs the detached attempt`s failure; the durable bracket already reports it.
- The conversation reads the attempt from the bracket: a `compaction/start` without a landed checkpoint renders as running, and a `compaction/end` carrying `error` renders as failed with that recorded reason. The manual command settlement no longer names a `sourceEventSeq`; correlation stays in the `sourceCommandId` that every `compaction/*` event already carries.
- Nothing durable changed: no new session event, no new field, no format-version step, and a no-op attempt still writes no bracket. Only the recorded `command/done` text and its position moved, so `snapshots/sdk/manual-compact` was resequenced by hand and must be confirmed by a re-record with a key.
- `/export` keeps its old binding. Its settlement is the artifact itself, so the request that asked for it owns its lifetime.

## Alternatives considered

**Attach a reason to the request-signal aborts and show `Compaction cancelled.`.** Cheapest fix and it improves diagnosability, but it still discards an attempt that had already paid for a long prefill. The reason-carrying aborts remain worth doing on their own.

**Keep the request bound and let the Client re-attach to a running attempt.** That needs a request-independent job identity plus progress and cancel endpoints, duplicating what the durable bracket and the agent`s Stop already provide.

**Answer immediately only for the Web path.** The SDK and CLI callers already receive the full accounting from `done`. Splitting behavior by caller would give one command two lifecycles and two failure surfaces for no gain.

**Wait for the reservation asynchronously instead of doing it synchronously.** Any await before `runMaintenance` reintroduces a window in which the command cannot tell `busy` from a started attempt, which is the answer the command must give before it returns.

## Consequences

A manual compaction can now keep spending model time after the page that asked for it is gone, and stopping it is an explicit Stop rather than a navigation. The success accounting (replaced items and estimated tokens) appears on the landed checkpoint row instead of the command line. The `compactNow` signature is a pre-stable host seam change: its one consumer, the command, and the three test engines were updated together, and the generated `api-catalog` and `docs/subsystems/compaction` signature blocks were regenerated. Detached attempts still quiesce at teardown because `dsh-command-compact` keeps tracking operation promises and drains them before disposal completes.

## Testing

`packages/compaction/compaction-basic/tests/manual-compaction.spec.ts` proves the reservation is answered while the summary is still open, that the operation stays unsettled until the bracket closes, that a no-op answers `nothing` without writing, and that cancellation and failure classification still arrive. `packages/compaction/command-compact/tests/command-compact.spec.ts` proves the command answers at the reservation, passes a signal that is not the request`s and never aborts when the request goes away, reports busy and no-history outcomes directly, logs a detached failure, and drains a detached attempt before disposal. `packages/client/ui-chat/tests/compaction-command-card.client.spec.ts` and the `conversation-node-definitions` cases prove the row reads running, failed, and landed states from the bracket events.

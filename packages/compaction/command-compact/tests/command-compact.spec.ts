import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime, { type CommandResult } from '@deepseek-ai/dsh-commands'
import {
  CompactionId,
  CompactionEngine,
  ManualCompactionError,
  type CompactionAgentContext,
  type CompactionResult,
  type CompactionTrigger,
  type ManualCompactAgentContext,
  type ManualCompactionStart,
} from '@deepseek-ai/dsh-compaction'
import { Session, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import * as commandCompact from '@deepseek-ai/dsh-command-compact'

const COMPACTION_ID = CompactionId('command-compact-test')
const STARTED = 'Compaction started. It keeps running even if you close this page; the result appears in this conversation. Press Stop to cancel it.'

const RESULT: CompactionResult = {
  compactionId: COMPACTION_ID,
  startSeq: SessionSeq(1),
  summarySeq: SessionSeq(2),
  endSeq: SessionSeq(3),
  summary: [{ type: 'text', text: 'summary' }],
  shadowedRange: { start: SessionSeq(1), end: SessionSeq(7) },
  shadowedSeqs: [SessionSeq(1), SessionSeq(3), SessionSeq(7)],
  shadowedTokenCount: 42,
}

/** Compaction seam stand-in that answers from its reservation like the real engine. */
class StubCompactionEngine extends CompactionEngine {
  result: CompactionResult | null = RESULT
  /** Failure raised while reserving, which the command still answers directly. */
  failure: unknown
  /** Failure of the reserved operation, which arrives after the command answered. */
  lateFailure: Error | undefined
  /** Complete override of the reservation answer. */
  start: (() => ManualCompactionStart) | undefined
  calls: { agent: ManualCompactAgentContext; signal: AbortSignal }[] = []

  override compactIfNeeded(
    _agent: CompactionAgentContext,
    _trigger: CompactionTrigger,
    _signal: AbortSignal,
  ): Promise<CompactionResult | null> {
    return Promise.resolve(null)
  }

  override compactRegion(): Promise<CompactionResult> {
    return Promise.resolve(RESULT)
  }

  override compactNow(
    agent: ManualCompactAgentContext,
    signal: AbortSignal,
    sourceCommandId?: Parameters<CompactionEngine['compactNow']>[2],
  ): ManualCompactionStart {
    this.calls.push({ agent, signal })
    if (this.start !== undefined) return this.start()
    /* v8 ignore next 1 -- exercise arbitrary reservation failures, typed as unknown here. */
    if (this.failure !== undefined) throw this.failure
    if (this.result === null) return { kind: 'nothing' }
    const result = this.result
    const operationIds = {
      compactionId: result.compactionId,
      ...sourceCommandId === undefined ? {} : { sourceCommandId },
    }
    const done = (async (): Promise<CompactionResult | null> => {
      agent.session.append('compaction/start', { ...operationIds, turn: null })
      agent.session.append('compaction/summary', {
        ...operationIds,
        summary: result.summary,
        shadowedRange: result.shadowedRange,
        shadowedSeqs: result.shadowedSeqs,
        shadowedTokenCount: result.shadowedTokenCount,
        provider: 'command-test',
        model: 'command-test',
      })
      const late = this.lateFailure
      if (late !== undefined) {
        agent.session.append('compaction/end', { ...operationIds, turn: null, error: late.message })
        throw late
      }
      agent.session.append('compaction/end', { ...operationIds, turn: null })
      return { ...result, ...operationIds }
    })()
    return { kind: 'running', done }
  }
}

interface Harness {
  readonly ctx: Context
  readonly compact: StubCompactionEngine
  readonly agent: Agent
  readonly plugin: Awaited<ReturnType<Context['plugin']>>
}

async function harness(): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(CommandRuntime)
  const compact = new StubCompactionEngine(ctx)
  const plugin = await ctx.plugin(commandCompact)
  const session = Session.create(SessionId('command-compact'))
  const agent = {
    session,
    status: 'idle',
    options: {},
    reserveTurnAdmission: () => () => undefined,
  } as unknown as Agent
  return { ctx, compact, agent, plugin }
}

async function run(
  test: Harness,
  suffix = '',
  controller = new AbortController(),
): Promise<NonNullable<Awaited<ReturnType<CommandRuntime['execute']>>>> {
  const execution = await test.ctx.commands.execute(test.agent, `/compact${suffix}`, [], controller.signal)
  if (execution === undefined) throw new Error('compact command was not registered')
  return execution
}

/** Yield until the detached attempt has settled. */
async function quiesce(): Promise<void> {
  await new Promise((resolve) => { setTimeout(resolve, 0) })
}

/** Types the session event list without repeating the narrowing at every read. */
function sessionTypes(test: Harness): string[] {
  return test.agent.session.snapshotEvents().map(event => event.type)
}

/** Assert the executor-owned lifecycle pair and absence from model history. */
function expectLastLifecycle(
  test: Harness,
  args: string,
  outcome: CommandResult,
): string {
  const lifecycle = test.agent.session.snapshotEvents()
    .filter(event => event.type === 'command/run' || event.type === 'command/done')
    .slice(-2)
  const runEvent = lifecycle[0]
  const doneEvent = lifecycle[1]
  if (runEvent?.type !== 'command/run' || doneEvent?.type !== 'command/done') {
    throw new Error(`expected command lifecycle pair, got ${lifecycle.map(event => event.type).join(',')}`)
  }
  expect(lifecycle.map(event => ({ type: event.type, data: event.data }))).toEqual([
    {
      type: 'command/run',
      data: {
        commandId: runEvent.data.commandId,
        name: 'compact',
        args,
        source: { kind: 'user' },
      },
    },
    {
      type: 'command/done',
      data: {
        commandId: runEvent.data.commandId,
        ...outcome,
      },
    },
  ])
  expect(doneEvent.data.commandId).toBe(runEvent.data.commandId)
  expect(test.agent.session.surface.nodes).toEqual([])
  expect(test.agent.session.deriveMessages()).toEqual([])
  return runEvent.data.commandId
}

describe('@deepseek-ai/dsh-command-compact registration', () => {
  it('registers one argument-free command with Loader-safe exports and disposes it', async () => {
    const test = await harness()
    expect(commandCompact.name).toBe('command-compact')
    expect(commandCompact.inject).toEqual(['commands', 'compaction'])
    expect('default' in commandCompact).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    expect(loader.unwrapExports(commandCompact)).toBe(commandCompact)
    expect(test.ctx.commands.list(test.agent)).toContainEqual({
      definitionId: '@deepseek-ai/dsh-command-compact',
      name: 'compact',
      description: 'Compact older conversation history',
    })

    await test.plugin.dispose()
    expect(test.ctx.commands.find(test.agent, 'compact')).toBeUndefined()
  })
})

describe('/compact human command', () => {
  it('answers from the reservation and leaves the durable attempt to the log', async () => {
    const test = await harness()
    const controller = new AbortController()
    const execution = await run(test, '', controller)
    expect(execution.result).toEqual({ kind: 'success', text: STARTED })
    expect(execution.commandId).toBe(expectLastLifecycle(test, '', execution.result))

    // The operation deliberately does not carry this request's signal: a Client
    // that goes away mid-summary must not discard work already paid for.
    expect(test.compact.calls).toHaveLength(1)
    expect(test.compact.calls[0]?.signal).not.toBe(controller.signal)
    controller.abort(new Error('client closed'))
    await quiesce()
    // The request is gone, yet the carried signal never was.
    expect(test.compact.calls[0]?.signal.aborted).toBe(false)
    const attempt = test.agent.session.snapshotEvents().filter(event => event.type.startsWith('compaction/'))
    expect(attempt.map(event => event.type)).toEqual([
      'compaction/start',
      'compaction/summary',
      'compaction/end',
    ])
    const summary = attempt.find(event => event.type === 'compaction/summary')
    expect(summary?.data).toMatchObject({ shadowedTokenCount: 42, shadowedSeqs: [1, 3, 7] })
  })

  it('returns direct no-history and argument-rejection results', async () => {
    const test = await harness()
    test.compact.result = null
    const empty = await run(test)
    expect(empty.result).toEqual({
      kind: 'success',
      text: 'No compactable history yet.',
    })
    expect(empty.commandId).toBe(expectLastLifecycle(test, '', empty.result))
    expect(sessionTypes(test)).not.toContain('compaction/start')

    const rejected = await run(test, ' now')
    expect(rejected.result).toEqual({
      kind: 'error',
      text: 'Usage: /compact (no arguments)',
    })
    expect(rejected.commandId).toBe(expectLastLifecycle(test, ' now', rejected.result))
    expect(test.compact.calls).toHaveLength(1)
  })

  it.each([
    ['busy', 'Compaction is unavailable because this process has an active compaction, or the agent is not idle.'],
    ['cancelled', 'Compaction cancelled.'],
    ['changed', 'The history selected for compaction changed before it could be replaced. The attempt is recorded in the session log.'],
    ['summary', 'Compaction could not produce a useful summary. The attempt is recorded in the session log.'],
    ['commit', 'Compaction did not finish cleanly; some session history may have changed. Inspect the current session state before retrying.'],
    ['persistence', 'Compaction finished, but the session could not be saved.'],
  ] as const)('maps an expected %s reservation failure to a direct error', async (code, text) => {
    const test = await harness()
    test.compact.failure = new ManualCompactionError(code, 'backend detail')
    const execution = await run(test)
    expect(execution.result).toEqual({ kind: 'error', text })
    expect(execution.commandId).toBe(expectLastLifecycle(test, '', execution.result))
  })

  it('keeps the answered command and logs the failure of a detached attempt', async () => {
    const test = await harness()
    const warn = vi.spyOn(test.ctx.logger, 'warn')
    test.compact.lateFailure = new ManualCompactionError('summary', 'late failure')
    const execution = await run(test)
    expect(execution.result).toEqual({ kind: 'success', text: STARTED })
    await quiesce()
    expect(warn).toHaveBeenCalledWith(
      'command-compact: Compaction could not produce a useful summary. The attempt is recorded in the session log.',
    )
    expect(sessionTypes(test)).toContain('compaction/end')
  })

  it('preserves an unexpected reservation failure as an executor error', async () => {
    const test = await harness()
    const bug = new Error('unexpected backend bug')
    test.compact.failure = bug
    await expect(run(test)).rejects.toBe(bug)
    expectLastLifecycle(test, '', { kind: 'error', text: bug.message })
  })

  it('awaits a detached attempt before plugin disposal settles', async () => {
    const test = await harness()
    const settle = Promise.withResolvers<CompactionResult | null>()
    test.compact.start = () => ({ kind: 'running', done: settle.promise })
    const execution = await run(test)
    expect(execution.result).toEqual({ kind: 'success', text: STARTED })

    let disposed = false
    const disposal = test.plugin.dispose()
    void disposal.then(() => { disposed = true })
    await quiesce()
    expect(test.ctx.commands.find(test.agent, 'compact')).toBeUndefined()
    expect(disposed).toBe(false)

    settle.resolve(null)
    await disposal
    expect(disposed).toBe(true)
  })
})

/**
 * Human-message edit through the driver: an idle-only rewrite that shadows the
 * edited prompt and its tail, clears queued work that followed it, and re-asks
 * with the corrected text.
 */
import { describe, expect, it, onTestFinished } from 'vitest'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry, { MessageEditError, type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { MockAdapter, textResponse } from './mock-adapter.ts'

async function harness(adapter: MockAdapter): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, { personaPrefix: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  onTestFinished(async () => { await ctx.fiber.dispose() })
  return ctx
}

async function createdAgent(ctx: Context, id: SessionId): Promise<Agent> {
  return ctx.agentLoop.create(id, { provider: 'mock', model: 'mock' })
}

/** Wait for the agent's next transition to idle after a waking send. */
function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

function send(agent: Agent, text: string): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

/** Seq of the first human prompt the log records. */
function firstPromptSeq(agent: Agent): number {
  const event = agent.session.snapshotEvents().find(entry => entry.type === 'user/message')
  if (event === undefined) throw new Error('fixture recorded no human prompt')
  return event.seq
}

function textOf(agent: Agent): string[] {
  return agent.session.deriveMessages()
    .flatMap(message => message.role === 'user' || message.role === 'assistant' ? [message.content] : [])
    .flatMap(blocks => blocks.filter(block => block.type === 'text').map(block => block.text))
}

describe('editMessage', () => {
  it('rewrites a sent prompt so history continues from the corrected text', async () => {
    const ctx = await harness(new MockAdapter([textResponse('first answer'), textResponse('second answer')]))
    const agent = await createdAgent(ctx, SessionId('edit-run'))
    send(agent, 'original ask')
    await waitForIdle(ctx, agent)
    const targetSeq = firstPromptSeq(agent)

    const accepted = agent.editMessage({
      targetSeq: SessionSeq(targetSeq),
      content: [{ type: 'text', text: 'corrected ask' }],
    })
    expect(accepted.clearedQueueCount).toBe(0)
    expect(accepted.shadowedNodeCount).toBeGreaterThanOrEqual(2)

    await waitForIdle(ctx, agent)
    const texts = textOf(agent)
    expect(texts).toContain('corrected ask')
    expect(texts).toContain('second answer')
    expect(texts).not.toContain('original ask')
    expect(texts).not.toContain('first answer')
  })

  it('refuses to rewrite history while a turn is executing', async () => {
    const ctx = await harness(new MockAdapter([textResponse('running')]))
    const agent = await createdAgent(ctx, SessionId('edit-running'))
    send(agent, 'first ask')
    expect(agent.status).toBe('running')
    let refusal: unknown
    try {
      agent.editMessage({
        targetSeq: SessionSeq(0),
        content: [{ type: 'text', text: 'corrected ask' }],
      })
    } catch (error: unknown) {
      refusal = error
    }
    expect(refusal).toBeInstanceOf(MessageEditError)
    expect((refusal as MessageEditError).code).toBe('MESSAGE_EDIT_TURN_RUNNING')
    await waitForIdle(ctx, agent)
  })

  it('removes queued work that followed the rewritten message', async () => {
    const ctx = await harness(new MockAdapter([
      textResponse('first answer'),
      textResponse('second answer'),
    ]))
    const agent = await createdAgent(ctx, SessionId('edit-queue'))
    send(agent, 'original ask')
    await waitForIdle(ctx, agent)
    const targetSeq = firstPromptSeq(agent)
    agent.send(
      createUserMessage({ content: [{ type: 'text', text: 'queued follow-up' }], source: { kind: 'user' } }),
      'next-turn',
      false,
    )
    expect(agent.inbox.nextTurn).toHaveLength(1)

    const accepted = agent.editMessage({
      targetSeq: SessionSeq(targetSeq),
      content: [{ type: 'text', text: 'corrected ask' }],
    })
    expect(accepted.clearedQueueCount).toBe(1)
    await waitForIdle(ctx, agent)
    const texts = textOf(agent)
    expect(texts).toContain('corrected ask')
    expect(texts).not.toContain('queued follow-up')
  })
  it("keeps the queued rewrite's splice pair replayable across the edit boundary", async () => {
    const ctx = await harness(new MockAdapter([textResponse('first answer'), textResponse('second answer')]))
    const agent = await createdAgent(ctx, SessionId('edit-splice-pair'))
    send(agent, 'original ask')
    await waitForIdle(ctx, agent)
    const targetSeq = firstPromptSeq(agent)

    agent.editMessage({
      targetSeq: SessionSeq(targetSeq),
      content: [{ type: 'text', text: 'corrected ask' }],
    })
    await waitForIdle(ctx, agent)

    // The edit voids the prompt and its answer, so the rewrite is queued inside that range and
    // claimed after it opens. A rewind that skipped the queueing splice would leave the claim
    // removing from an empty list, reject the fold, and end the rerun Turn in error.
    const endings = agent.session.snapshotEvents()
      .filter(event => event.type === 'turn/end')
      .map(event => event.type === 'turn/end' ? event.data.reason.kind : '')
    expect(endings).toEqual(['completed', 'completed'])
    const projections = ctx.sessionProjections.snapshot(agent.session)
    expect(projections.values.inbox).toEqual({ 'next-turn': [], 'next-step': [] })
    expect(textOf(agent)).toContain('corrected ask')
  })
})

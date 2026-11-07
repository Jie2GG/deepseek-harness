/**
 * The Session Remote message-edit command: request validation, the accepted
 * edit's facts, and the mapping from an Agent refusal to a business error.
 */
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { MessageEditError } from '@deepseek-ai/dsh-agent'
import type { Agent, MessageEditRequest, MessageEditResult } from '@deepseek-ai/dsh-agent'
import { createUserMessage, MessageId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { ApiSessionAgentController } from '../src/agent.ts'
import { SessionCommandController } from '../src/commands.ts'
import { createInboxStub, unsupportedModel } from '@deepseek-ai/dsh-agent-loop-testkit'
import { installSessionReadTestServices } from './test-remote.ts'

/** One Session whose only human prompt sits at surface seq 1. */
async function editHarness(outcome: () => MessageEditResult) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(TypertRegistry)
  installSessionReadTestServices(ctx)
  const session: Session = ctx.sessions.create(SessionId('edit-command'))
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'original ask' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

  const editMessage = vi.fn<(request: MessageEditRequest) => MessageEditResult>(outcome)
  const agent = {
    id: session.id,
    session,
    options: { provider: 'fixture', model: 'fixture-model' },
    model: unsupportedModel(),
    inbox: createInboxStub(),
    status: 'idle',
    ctx,
    send: vi.fn(),
    followup: vi.fn(),
    steer: vi.fn(),
    inject: vi.fn(),
    cancel: vi.fn(),
    runMaintenance: async () => { throw new Error('unexpected maintenance') },
    whenIdle: () => Promise.resolve(),
    editMessage,
  } satisfies Agent
  await ctx.agents.register(agent)
  ctx.provide('workspaceRegistry', { get: () => undefined, list: () => [] } as never)
  ctx.provide('agentDefaultModel', {
    currentSelection: () => ({ provider: 'fixture', model: 'fixture-model' }),
    saveSelection: () => Promise.resolve(),
  } as never)
  const agents = new ApiSessionAgentController(ctx)
  vi.spyOn(agents, 'resolveAgent').mockImplementation(id => Promise.resolve(id === agent.id
    ? { agent }
    : { error: new RemoteError('session/not-found', 'missing', { sessionId: id }) }))
  return {
    session,
    controller: new SessionCommandController(ctx, agents, '/workspace'),
    editMessage,
  }
}

const REWRITE: readonly ContentBlock[] = [{ type: 'text', text: 'corrected ask' }]

describe('Session command: editMessage', () => {
  it('hands the Agent the branded target and returns the accepted edit facts', async () => {
    const accepted: MessageEditResult = {
      messageId: MessageId('ask-1'),
      shadowedNodeCount: 1,
      clearedQueueCount: 2,
    }
    const h = await editHarness(() => accepted)
    await expect(h.controller.editMessage({
      sessionId: h.session.id,
      targetSeq: 1,
      content: REWRITE,
    })).resolves.toEqual(accepted)
    const request = h.editMessage.mock.calls[0]?.[0]
    if (request === undefined) throw new Error('the Agent received no edit request')
    expect(request.targetSeq).toBe(1)
    expect(request.content).toEqual(REWRITE)
  })

  it('maps an Agent refusal to session/edit-rejected with its stable code', async () => {
    const h = await editHarness(() => {
      throw new MessageEditError('a turn is still running', 'MESSAGE_EDIT_TURN_RUNNING')
    })
    const failure = await h.controller.editMessage({
      sessionId: h.session.id,
      targetSeq: 1,
      content: REWRITE,
    }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(RemoteError)
    const rejection = failure as InstanceType<typeof RemoteError>
    expect(rejection.code).toBe('session/edit-rejected')
    expect(rejection.details).toEqual({
      sessionId: h.session.id,
      targetSeq: 1,
      code: 'MESSAGE_EDIT_TURN_RUNNING',
    })
  })

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])('refuses targetSeq %s before touching the Agent', async (targetSeq) => {
    const h = await editHarness(() => ({
      messageId: MessageId('ask-1'),
      shadowedNodeCount: 1,
      clearedQueueCount: 0,
    }))
    const failure = await h.controller.editMessage({
      sessionId: h.session.id,
      targetSeq,
      content: REWRITE,
    }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(RemoteError)
    expect((failure as InstanceType<typeof RemoteError>).code).toBe('gateway/bad-request')
    expect(h.editMessage).not.toHaveBeenCalled()
  })
})

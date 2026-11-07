import { describe, expect, it } from 'vitest'
import type { SessionEvent, SurfaceIntent } from '@deepseek-ai/dsh-session'
import {
  Session,
  SessionId,
  SessionSeq,
  foldSurface,
  isUserMessageEdit,
  isVoidedByMessageEdit,
  messageEditWindows,
} from '@deepseek-ai/dsh-session'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'

/** One human rewrite of message `editedSeq`. */
function editMessage(text: string, editedSeq: number, editCount = 1): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user-edit', editedSeq: SessionSeq(editedSeq), editCount },
  })
}

function humanMessage(text: string): UserMessage {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

function answer(text: string) {
  return {
    turn: 1,
    step: 1,
    stream: [],
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'text', text }],
      source: { kind: 'model', provider: 'mock', model: 'mock' },
    }),
  }
}

/** Positional replacement over the surface nodes `seqs`, as a producer supplies it. */
function replacing(seqs: readonly number[]): SurfaceIntent<'user/message'> {
  const start = SessionSeq(seqs[0] as number)
  return {
    surfaceOp: { op: 'replace', startSeq: start, endSeq: SessionSeq(seqs.at(-1) as number) },
    sourceEventSeqs: seqs.map(SessionSeq),
  }
}

/** Detached copy of a small log: prompt, answer, closing boundary, and a new turn opening. */
function editLog(): SessionEvent[] {
  return [
    { type: 'turn/start', seq: SessionSeq(0), time: 0, data: { turn: 1 } },
    { type: 'user/message', seq: SessionSeq(1), time: 1, data: humanMessage('first ask'), surfaceOp: 'append' },
    { type: 'assistant/message', seq: SessionSeq(2), time: 2, data: answer('first answer'), surfaceOp: 'append' },
    { type: 'turn/end', seq: SessionSeq(3), time: 3, data: { turn: 1, reason: { kind: 'completed' } } },
    { type: 'turn/start', seq: SessionSeq(4), time: 4, data: { turn: 2 } },
    {
      type: 'user/message',
      seq: SessionSeq(5),
      time: 5,
      data: editMessage('corrected ask', 1),
      ...replacing([1, 2]),
    },
  ] as unknown as SessionEvent[]
}

describe('human-message edit surface fold', () => {
  it('shadows the edited message and its tail while the carrying turn stays current', () => {
    const folded = foldSurface(editLog())
    expect(folded.nodes).toEqual([SessionSeq(5)])
    expect(folded.edits).toEqual([{
      editSeq: SessionSeq(5),
      editedSeq: SessionSeq(1),
      startSeq: SessionSeq(1),
      endSeqExclusive: SessionSeq(4),
    }])
  })

  it('reports the edit from the event that carries it and derives its voided range', () => {
    const events = editLog()
    expect(events.slice(0, 5).map(isUserMessageEdit)).toEqual([false, false, false, false, false])
    expect(isUserMessageEdit(events[5] as SessionEvent)).toBe(true)
    const windows = messageEditWindows(events)
    expect(windows).toEqual([{
      editSeq: SessionSeq(5),
      editedSeq: SessionSeq(1),
      startSeq: SessionSeq(1),
      endSeqExclusive: SessionSeq(4),
    }])
    expect(isVoidedByMessageEdit(windows, 1)).toBe(true)
    expect(isVoidedByMessageEdit(windows, 3)).toBe(true)
    expect(isVoidedByMessageEdit(windows, 4)).toBe(false)
    expect(isVoidedByMessageEdit(windows, 5)).toBe(false)
  })

  it('rejects an edit range that stops short of the surface tail', () => {
    const session = Session.create(SessionId('edit-tail'))
    session.append('turn/start', { turn: 1 })
    session.append('user/message', humanMessage('first ask'), { surfaceOp: 'append' })
    session.append('assistant/message', answer('first answer'), { surfaceOp: 'append' })
    expect(() => session.append('user/message', editMessage('corrected ask', 1), replacing([1])))
      .toThrow(/must be the last surface node/)
  })

  it('rejects an edit whose recorded message is not the replacement start', () => {
    const session = Session.create(SessionId('edit-start'))
    session.append('user/message', humanMessage('first ask'), { surfaceOp: 'append' })
    expect(() => session.append('user/message', editMessage('corrected ask', 9), replacing([0])))
      .toThrow(/editedSeq 9 must equal the replacement start seq 0/)
  })

  it('rewrites an edited message again without losing the newest text', () => {
    const session = Session.create(SessionId('edit-twice'))
    session.append('user/message', humanMessage('first ask'), { surfaceOp: 'append' })
    const first = session.append('user/message', editMessage('second ask', 0), replacing([0]))
    const second = session.append('user/message', editMessage('third ask', first.seq, 2), replacing([first.seq]))
    expect(session.surface.nodes).toEqual([second.seq])
    expect(session.surface.edits).toEqual([
      { editSeq: first.seq, editedSeq: SessionSeq(0), startSeq: SessionSeq(0), endSeqExclusive: first.seq },
      { editSeq: second.seq, editedSeq: first.seq, startSeq: first.seq, endSeqExclusive: second.seq },
    ])
  })
})

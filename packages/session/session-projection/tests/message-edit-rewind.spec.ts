/**
 * Human-message edit barrier over the projection drive: a rewound unit stops
 * folding events an edit voided, a plain unit keeps its settings, and the
 * persisted checkpoint row detects a state that predates the edit.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import SessionStore, {
  SESSION_FORMAT_VERSION,
  SessionId,
  SessionLogOffset,
  SessionSeq,
} from '@deepseek-ai/dsh-session'
import type { Session, SessionHeader } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { ProjectionCheckpoint, ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    'test/rewound-marks': { marks: string[] }
    'test/kept-marks': { marks: string[] }
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'test/rewind-mark': { marks: string[] }
  }
}

interface MarksState { marks: string[] }
const marksSchema = z.object({ marks: z.array(z.string()) })
const EMPTY: MarksState = { marks: [] }

/** Accumulating unit, declared rewound or kept. */
function marksUnit(key: 'test/rewound-marks' | 'test/kept-marks', rewindable: boolean) {
  return {
    key,
    stateSchema: marksSchema,
    init: () => EMPTY,
    apply: (state: MarksState, event: Parameters<ProjectionDefinition<string, MarksState>['apply']>[1]) => (
      event.type === 'test/rewind-mark'
        ? { marks: [...state.marks, ...event.data.marks] }
        : state
    ),
    ...(rewindable ? { rewindable: true } : {}),
    wire: { viewSchema: marksSchema, view: (state: MarksState) => state },
    stateVersion: 1,
  } satisfies ProjectionDefinition<typeof key, MarksState>
}

async function harness() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  const session = ctx.sessions.create(SessionId('edit-barrier'))
  return { ctx, session }
}

/** One turn whose prompt is later rewritten: mark at seq 2 lands in the voided range. */
function editedConversation(session: Session): void {
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'original ask' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('test/rewind-mark', { marks: ['discarded'] })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  session.append('turn/start', { turn: 2 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'corrected ask' }],
    source: { kind: 'user-edit', editedSeq: SessionSeq(1), editCount: 1 },
  }), {
    surfaceOp: { op: 'replace', startSeq: SessionSeq(1), endSeq: SessionSeq(1) },
    sourceEventSeqs: [SessionSeq(1)],
  })
}

const RESTORE_HEADER: SessionHeader = {
  version: SESSION_FORMAT_VERSION,
  id: SessionId('edit-barrier'),
  createdAt: 0,
  isSeeded: false,
}

describe('projection edit barrier', () => {
  it('rewinds a conversation-produced unit and leaves a settings unit alone', async () => {
    const { ctx, session } = await harness()
    const rewound = await ctx.sessionProjections.register(marksUnit('test/rewound-marks', true))
    const kept = await ctx.sessionProjections.register(marksUnit('test/kept-marks', false))
    editedConversation(session)
    expect(rewound.stateOf(session)).toEqual(EMPTY)
    expect(kept.stateOf(session)).toEqual({ marks: ['discarded'] })
    session.append('test/rewind-mark', { marks: ['after-edit'] })
    expect(rewound.stateOf(session)).toEqual({ marks: ['after-edit'] })
    expect(kept.stateOf(session)).toEqual({ marks: ['discarded', 'after-edit'] })
  })

  it('builds a late-registered rewound unit from the surviving prefix', async () => {
    const { ctx, session } = await harness()
    editedConversation(session)
    session.append('test/rewind-mark', { marks: ['after-edit'] })
    const late = await ctx.sessionProjections.register(marksUnit('test/rewound-marks', true))
    expect(late.stateOf(session)).toEqual({ marks: ['after-edit'] })
  })

  it('stamps a rewound checkpoint row and discards one that predates the edit', async () => {
    const { ctx, session } = await harness()
    const rewound = await ctx.sessionProjections.register(marksUnit('test/rewound-marks', true))
    await ctx.sessionProjections.register(marksUnit('test/kept-marks', false))
    editedConversation(session)
    session.append('test/rewind-mark', { marks: ['after-edit'] })
    const registry = ctx.sessionProjections
    const rows = registry.checkpoint(session)
    expect(rows['test/rewound-marks']?.edits).toBe(1)
    expect(rows['test/kept-marks']?.edits).toBeUndefined()
    const events = [...session.ownEvents()]
    const cold = registry.restore(rows, events, SessionLogOffset(0), RESTORE_HEADER, SessionLogOffset(0))
    expect(cold.snapshot.values['test/rewound-marks']).toEqual({ marks: ['after-edit'] })
    expect(cold.snapshot.values['test/kept-marks']).toEqual({ marks: ['discarded', 'after-edit'] })
    // A row folded before the edit cannot seed a post-edit value.
    const rewoundRow = rows['test/rewound-marks']
    if (rewoundRow === undefined) throw new Error('fixture lost the rewound checkpoint row')
    const stale: ProjectionCheckpoint = { ...rows, 'test/rewound-marks': { ...rewoundRow, edits: 0 } }
    const refolded = registry.restore(stale, events, SessionLogOffset(0), RESTORE_HEADER, SessionLogOffset(0))
    expect(refolded.snapshot.values['test/rewound-marks']).toEqual({ marks: ['after-edit'] })
    expect(rewound.stateOf(session)).toEqual({ marks: ['after-edit'] })
  })
})

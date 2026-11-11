// @vitest-environment jsdom
/** Manual compaction rows read their state from the durable bracket, not the settlement. */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { CompactionCommandCard } from '../src/client/chat/CompactionCommandCard.tsx'
import { en } from '../src/client/locale.ts'
import type { CommandNode, CompactionSummaryNode } from '@deepseek-ai/dsh-client-ui-chat/client'

afterEach(cleanup)

const t = makeTranslate(en, commonEn)

const COMMAND: CommandNode = {
  kind: 'command',
  seq: 5,
  time: 5_000,
  commandId: 'cmd-1' as CommandNode['commandId'],
  name: 'compact',
  args: '',
  outcome: { kind: 'success', text: 'Compaction started.' },
}

const MARKER: CompactionSummaryNode = {
  kind: 'compaction',
  seq: 9,
  time: 9_000,
  summary: 'the summary',
  summaryEventSeq: 8,
  shadowedItemCount: 3,
  shadowedTokenCount: 120,
}

describe('manual compaction row', () => {
  it('shows a still-open bracket as running after its command answered', () => {
    render(<CompactionCommandCard node={COMMAND} attempt="running" t={t} />)
    expect(screen.getByText(en['message.compaction.running'])).toBeTruthy()
  })

  it('names the failure a closed bracket recorded', () => {
    render(<CompactionCommandCard node={COMMAND} attempt="failed" attemptError="stream ended early" t={t} />)
    expect(screen.getByText(`${en['message.compaction.failed']}: stream ended early`)).toBeTruthy()
  })

  it('shows a closed bracket without a recorded reason as failed', () => {
    render(<CompactionCommandCard node={COMMAND} attempt="failed" t={t} />)
    expect(screen.getByText(en['message.compaction.failed'])).toBeTruthy()
  })

  it('prefers the landed checkpoint over the bracket state', () => {
    render(<CompactionCommandCard node={COMMAND} compaction={MARKER} attempt="running" t={t} />)
    expect(screen.getByText(/120/)).toBeTruthy()
  })

  it('keeps the running row while no bracket has opened', () => {
    render(<CompactionCommandCard node={{ ...COMMAND, outcome: null }} t={t} />)
    expect(screen.getByText(en['message.compaction.running'])).toBeTruthy()
  })

  it('renders the settled command text once no compaction evidence exists', () => {
    render(<CompactionCommandCard node={COMMAND} t={t} />)
    expect(screen.getByText('Compaction started.')).toBeTruthy()
  })
})

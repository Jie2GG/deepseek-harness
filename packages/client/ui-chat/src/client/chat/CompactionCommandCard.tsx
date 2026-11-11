// A structured checkpoint, or the still-open bracket of a manual attempt, uses the
// compaction marker; every other outcome keeps the command's settlement text.

import type { CompactionSummaryNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatViewSlotProps, CommandRowOwnerProps } from '../contract/slots.ts'
import { CompactionItem } from './CompactionItem.tsx'
import { GenericCommandCard } from './GenericCommandCard.tsx'

interface CompactionCommandCardProps extends CommandRowOwnerProps {
  t: ChatViewSlotProps['t']
}

/** Render one manual compaction lifecycle without duplicating its checkpoint marker. */
export function CompactionCommandCard({ node, compaction, attempt, attemptError, t }: CompactionCommandCardProps) {
  if (attempt !== undefined && compaction === undefined) {
    // The command answered at its reservation, so this row reads the durable
    // bracket instead of the settlement: the attempt is still running, or it
    // closed on a failure the log recorded.
    const marker: CompactionSummaryNode = {
      kind: 'compaction',
      seq: node.seq,
      time: node.time,
      summary: null,
      summaryEventSeq: null,
      shadowedItemCount: null,
      shadowedTokenCount: null,
    }
    return (
      <CompactionItem
        node={marker}
        title={t('message.compaction.commandTitle')}
        fallbackSummary={attempt === 'running'
          ? t('message.compaction.running')
          : attemptError === undefined
            ? t('message.compaction.failed')
            : `${t('message.compaction.failed')}: ${attemptError}`}
        t={t}
      />
    )
  }
  if (compaction !== undefined) {
    return (
      <CompactionItem
        node={compaction}
        title={t('message.compaction.commandTitle')}
        fallbackSummary={node.outcome?.text ?? null}
        t={t}
      />
    )
  }
  if (node.outcome !== null) return <GenericCommandCard node={node} t={t} />
  return <GenericCommandCard node={node} t={t} runningSummary={t('message.compaction.running')} />
}

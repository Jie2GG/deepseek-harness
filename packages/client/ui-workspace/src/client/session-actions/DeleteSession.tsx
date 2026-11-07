/**
 * Delete hover button and the confirmation that guards an irreversible removal.
 */
import { useState } from 'react'
// Type-only: the family keys each provider merges; a key this program did not
// compile falls through to the generic line.
import type {} from '@deepseek-ai/dsh-agent/types'
import type {} from '@deepseek-ai/dsh-jobs/view'
import type {} from '@deepseek-ai/dsh-schedule/client'
import type {} from '@deepseek-ai/dsh-subagent/client'
import { Button, IconTrashOutlineRegular, Modal, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  DeleteSessionInjected, SessionDeleteConfirmInjected, SessionDeleteConfirmProps,
  SessionDeleteConfirmRequest, SessionRowActionProps,
} from '../contract/slots.ts'
import { sessionActivityLine } from './ArchiveSession.tsx'
import css from '../rows/Rows.module.css'
import browserCss from '../rows/WorkspaceBrowser.module.css'

/**
 * Hover button: delete this Session and its log. Absent while the Session's
 * access snapshot excludes the delete endpoint.
 * @param props - owner share, the access Hook, and the delete share.
 * @returns the button, or nothing when this caller may not delete the Session.
 */
export function DeleteSessionRowButton({
  sessionId, useSessionAccess, requestSessionDelete, t,
}: SessionRowActionProps<DeleteSessionInjected>) {
  const allowed = useSessionAccess(sessionId, 'workspace/deleteSession')
  if (!allowed) return null
  return (
    <Tooltip label={t('actions.delete')} side="bottom" align="end" delayMs={500} portal>
      <button
        type="button"
        className={css.iconButton}
        aria-label={t('menu.deleteSession')}
        onClick={() => { requestSessionDelete(sessionId) }}
      >
        <IconTrashOutlineRegular size={14} />
      </button>
    </Tooltip>
  )
}

/**
 * The `shell.overlay` entry: nothing while no confirmation is pending,
 * otherwise one dialog per request. Deleting costs the log, so the dialog asks
 * for an explicit acknowledgement even when nothing runs; a Session the Host
 * refused because work is still running shows that work and its confirm button
 * stops it first.
 * @param props - the request hook, its settlement, the delete hop, and the locale seat.
 * @returns the open dialog, or null.
 */
export function SessionDeleteConfirmDialog({
  useDeleteRequest, settleSessionDelete, deleteSessionNow, t,
}: SessionDeleteConfirmProps) {
  const request = useDeleteRequest(pending => pending)
  if (request === null) return null
  return (
    <DeleteConfirmForm
      key={request.sessionId}
      request={request}
      deleteSessionNow={deleteSessionNow}
      onSettle={settleSessionDelete}
      t={t}
    />
  )
}

/** One request's dialog: in-flight, acknowledgement, and error state die with it. */
function DeleteConfirmForm({ request, deleteSessionNow, onSettle, t }: {
  request: SessionDeleteConfirmRequest
  deleteSessionNow: SessionDeleteConfirmInjected['deleteSessionNow']
  onSettle: () => void
  t: SessionDeleteConfirmProps['t']
}) {
  const stopping = request.activity.length > 0
  const [deleting, setDeleting] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const close = (): void => {
    if (deleting) return
    onSettle()
  }
  const confirm = (): void => {
    setDeleting(true)
    setError(null)
    void deleteSessionNow(request.sessionId, stopping ? { stopActivity: true } : {})
      .then(() => {
        setDeleting(false)
        onSettle()
      })
      .catch((reason: unknown) => {
        setDeleting(false)
        setError(reason instanceof Error ? reason.message : String(reason))
      })
  }
  return (
    <Modal
      open
      onClose={close}
      closeLabel={t('close')}
      title={t('delete.confirm.title')}
      description={t('delete.confirm.desc', { title: request.displayTitle })}
      footer={(
        <>
          <Button variant="outline" disabled={deleting} onClick={close}>{t('cancel')}</Button>
          <Button
            variant="outline"
            className={browserCss.deleteAction}
            disabled={deleting || !acknowledged}
            onClick={confirm}
          >
            {t(stopping ? 'delete.confirm.stopAction' : 'delete.confirm.action')}
          </Button>
        </>
      )}
    >
      {stopping && (
        <ul className={browserCss.archiveActivity} aria-label={t('delete.confirm.activity')}>
          {request.activity.map((entry, index) => (
            <li key={`${entry.kind}-${String(index)}`}>{sessionActivityLine(entry, t)}</li>
          ))}
        </ul>
      )}
      <label className={browserCss.deleteAck}>
        <input
          type="checkbox"
          checked={acknowledged}
          disabled={deleting}
          onChange={() => { setAcknowledged(value => !value) }}
        />
        <span>{t('delete.confirm.acknowledge')}</span>
      </label>
      {deleting && <div className={browserCss.deleteStatus} role="status">{t('delete.confirm.pending')}</div>}
      {error !== null && <div className={browserCss.renameError} role="alert">{error}</div>}
    </Modal>
  )
}

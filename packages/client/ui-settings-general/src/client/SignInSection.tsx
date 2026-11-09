/** Settings section that owns the browser sign-in secret of the serving Host. */

import { useCallback, useEffect, useState, type ChangeEvent, type ReactNode } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { signinRequest } from './signin-session.ts'
import css from './SignInSection.module.css'

/** Registrant-owned dependency of {@link SignInSection}. */
export interface SignInSectionInjected {
  /**
   * Ends this browser's Host session and reloads the page. Offered when the sign-in
   * behind these edits expired, which only a fresh sign-in can replace.
   */
  signOut: () => Promise<void>
}

/** Section owner share, localized copy, and the registrant's command face. */
export type SignInSectionProps =
  PropsRuntime<'settings.section'> & PropsLocale<'settings'> & InjectFace<SignInSectionInjected>

/** What the Host reported about the browser reading this page. */
interface AccountState {
  /** Account name the Host accepts. */
  username: string
  /** Whether a password exists, which selects an edit over a first setup. */
  hasPassword: boolean
}

/** Result line under the form. */
type Notice = { kind: 'error' | 'ok'; text: string }

/**
 * Edit the account name and password this Host accepts from a browser, and sign
 * out the other browsers that share it.
 * @param props - section share, localized copy, and the sign-out command.
 * @returns the sign-in section.
 */
export function SignInSection({ signOut, t }: SignInSectionProps): ReactNode {
  const [account, setAccount] = useState<AccountState | undefined>(undefined)
  const [expired, setExpired] = useState(false)
  const [unreachable, setUnreachable] = useState(false)
  const [username, setUsername] = useState('')
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | undefined>(undefined)
  const [armedRevoke, setArmedRevoke] = useState(false)
  const read = useCallback(async (): Promise<void> => {
    const outcome = await signinRequest('auth/state', {})
    if (outcome.status === 200 && outcome.reply?.username !== undefined) {
      setAccount({ username: outcome.reply.username, hasPassword: outcome.reply.hasPassword === true })
      setUsername(outcome.reply.username)
      setExpired(false)
      setUnreachable(false)
      return
    }
    if (outcome.status === 401) setExpired(true)
    else setUnreachable(true)
  }, [])
  useEffect(() => {
    void read()
  }, [read])
  const typing = (write: (value: string) => void) =>
    (event: ChangeEvent<HTMLInputElement>): void => {
      setNotice(undefined)
      write(event.target.value)
    }
  const save = async (): Promise<void> => {
    const editing = account?.hasPassword === true
    setBusy(true)
    setNotice(undefined)
    const outcome = await signinRequest(editing ? 'auth/change' : 'auth/setup', editing
      ? { username, currentPassword: current, password: next, confirmPassword: again }
      : { username, password: next, confirmPassword: again })
    setBusy(false)
    setCurrent('')
    setNext('')
    setAgain('')
    if (outcome.status === 200 && outcome.reply?.username !== undefined) {
      setAccount({ username: outcome.reply.username, hasPassword: true })
      setUsername(outcome.reply.username)
      setNotice({ kind: 'ok', text: outcome.reply.message ?? t('signin.saved') })
      return
    }
    if (outcome.status === 401) setExpired(true)
    setNotice({
      kind: 'error',
      text: outcome.status === 401 ? t('signin.expired') : outcome.reply?.message ?? t('signin.failed'),
    })
  }
  const revoke = async (): Promise<void> => {
    if (!armedRevoke) {
      setArmedRevoke(true)
      return
    }
    setArmedRevoke(false)
    setBusy(true)
    const outcome = await signinRequest('auth/revoke', {})
    setBusy(false)
    if (outcome.status === 401) setExpired(true)
    setNotice(outcome.status === 200
      ? { kind: 'ok', text: outcome.reply?.message ?? t('signin.revoke') }
      : { kind: 'error', text: outcome.status === 401
        ? t('signin.expired')
        : outcome.reply?.message ?? t('signin.failed') })
  }
  if (expired) {
    return (
      <div className={css.section}>
        <div className={css.row}>
          <div className={css.title}>{t('signin.nav')}</div>
          <div className={css.description} role="status">{t('signin.expired')}</div>
          <div className={css.actions}>
            <Button variant="outline" size="sm" onClick={() => { void signOut() }}>
              {t('signOut')}
            </Button>
          </div>
        </div>
      </div>
    )
  }
  const secretType = revealed ? 'text' : 'password'
  const blocked = busy
    || next.length < 8
    || next !== again
    || (account?.hasPassword === true && current.length === 0)
  return (
    <div className={css.section}>
      <div className={css.row}>
        <div className={css.title}>{t('signin.nav')}</div>
        <div className={css.description}>{t('signin.description')}</div>
      </div>
      {account === undefined ? (
        <div className={css.row}>
          <div className={css.description} role="status">
            {unreachable ? t('signin.unavailable') : t('signin.loading')}
          </div>
        </div>
      ) : (
        <>
          {account.hasPassword ? null : (
            <div className={css.row}>
              <div className={css.description} role="status">{t('signin.setFirst')}</div>
            </div>
          )}
          <div className={css.row}>
            <label className={css.label} htmlFor="signin-account">{t('signin.account')}</label>
            <Input
              id="signin-account"
              name="account"
              value={username}
              autoComplete="username"
              spellCheck={false}
              onChange={typing(setUsername)}
            />
          </div>
          <div className={css.row}>
            <div className={css.fields}>
              {account.hasPassword ? (
                <div className={css.field}>
                  <label className={css.label} htmlFor="signin-current">{t('signin.currentPassword')}</label>
                  <Input
                    id="signin-current"
                    name="currentPassword"
                    type={secretType}
                    value={current}
                    autoComplete="current-password"
                    onChange={typing(setCurrent)}
                  />
                </div>
              ) : null}
              <div className={css.field}>
                <label className={css.label} htmlFor="signin-new">{t('signin.newPassword')}</label>
                <Input
                  id="signin-new"
                  name="newPassword"
                  type={secretType}
                  value={next}
                  minLength={8}
                  maxLength={256}
                  autoComplete="new-password"
                  onChange={typing(setNext)}
                />
              </div>
              <div className={css.field}>
                <label className={css.label} htmlFor="signin-again">{t('signin.confirmPassword')}</label>
                <Input
                  id="signin-again"
                  name="confirmPassword"
                  type={secretType}
                  value={again}
                  minLength={8}
                  maxLength={256}
                  autoComplete="new-password"
                  onChange={typing(setAgain)}
                />
              </div>
            </div>
            <div className={css.actions}>
              <Button
                variant="outline"
                size="sm"
                aria-pressed={revealed}
                onClick={() => { setRevealed(!revealed) }}
              >
                {t('signin.reveal')}
              </Button>
              <Button variant="primary" size="sm" disabled={blocked} onClick={() => { void save() }}>
                {busy ? t('signin.saving') : t('signin.save')}
              </Button>
            </div>
            {notice === undefined ? null : (
              <div className={notice.kind === 'error' ? css.error : css.saved} role="status">{notice.text}</div>
            )}
          </div>
          <div className={css.row}>
            <div className={css.title}>{t('signin.revoke')}</div>
            <div className={css.description}>{t('signin.revokeHint')}</div>
            <div className={css.actions}>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => { void revoke() }}>
                {armedRevoke ? t('signin.revokeConfirm') : t('signin.revoke')}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

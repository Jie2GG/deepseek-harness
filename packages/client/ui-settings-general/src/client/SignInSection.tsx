/**
 * Settings section for the browser sign-in the serving Host owns: the signed-in account
 * comes first, its account and password edit sits behind that row, and the ways to leave
 * the session sit underneath.
 */

import { useCallback, useEffect, useState, type ChangeEvent, type ReactNode } from 'react'
import { Button, FishLogo, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { signinRequest } from './signin-session.ts'
import css from './SignInSection.module.css'

/** Registrant-owned dependency of {@link SignInSection}. */
export interface SignInSectionInjected {
  /**
   * Ends this browser's Host session and reloads the page. The section exists only for a
   * page whose Host owns that session.
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
  /** Whether this session came from a password or from the startup link. */
  sessionKind: 'launch' | 'password'
  /** When the session stops working, or zero when the Host reported no expiry. */
  expiresAt: number
}

/** Where the panel is: reading the account, showing it, or editing it. */
type Phase =
  | { step: 'loading' }
  | { step: 'unavailable' }
  | { step: 'expired' }
  | { step: 'summary' | 'edit'; account: AccountState }

/** Result line under the controls. */
type Notice = { kind: 'error' | 'ok'; text: string }

/** One secret entry with its label, so the three password fields stay identical. */
function SecretEntry({ id, label, value, revealed, autoComplete, onInput }: {
  id: string
  label: string
  value: string
  revealed: boolean
  autoComplete: string
  onInput: (event: ChangeEvent<HTMLInputElement>) => void
}): ReactNode {
  return (
    <div className={css.field}>
      <label className={css.label} htmlFor={id}>{label}</label>
      <Input
        id={id}
        name={id}
        type={revealed ? 'text' : 'password'}
        value={value}
        autoComplete={autoComplete}
        minLength={8}
        maxLength={256}
        onChange={onInput}
      />
    </div>
  )
}

/** One settings row: its text on the left, the control that acts on it on the right. */
function Row({ title, hint, children }: { title: string; hint: string; children: ReactNode }): ReactNode {
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{title}</div>
        <div className={css.description}>{hint}</div>
      </div>
      <div className={css.rowAction}>{children}</div>
    </div>
  )
}

/**
 * Show the signed-in account, edit its name and password behind that row, sign out the
 * other password-signed browsers, and end this browser's own session.
 * @param props - section share, localized copy, and the sign-out command.
 * @returns the account panel for this Host's browser sign-in.
 */
export function SignInSection({ signOut, t }: SignInSectionProps): ReactNode {
  const [phase, setPhase] = useState<Phase>({ step: 'loading' })
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
    const reply = outcome.reply
    if (outcome.status === 200 && reply?.username !== undefined) {
      const account: AccountState = {
        username: reply.username,
        hasPassword: reply.hasPassword === true,
        sessionKind: reply.sessionKind === 'launch' ? 'launch' : 'password',
        expiresAt: reply.expiresAt ?? 0,
      }
      setPhase({ step: 'summary', account })
      setUsername(account.username)
      return
    }
    setPhase(outcome.status === 401 ? { step: 'expired' } : { step: 'unavailable' })
  }, [])
  useEffect(() => {
    void read()
  }, [read])
  const typed = (write: (value: string) => void) =>
    (event: ChangeEvent<HTMLInputElement>): void => {
      setNotice(undefined)
      write(event.target.value)
    }
  const clearSecrets = (): void => {
    setCurrent('')
    setNext('')
    setAgain('')
    setRevealed(false)
  }
  const save = async (account: AccountState): Promise<void> => {
    const editing = account.hasPassword
    setBusy(true)
    setNotice(undefined)
    const outcome = await signinRequest(editing ? 'auth/change' : 'auth/setup', editing
      ? { username, currentPassword: current, password: next, confirmPassword: again }
      : { username, password: next, confirmPassword: again })
    setBusy(false)
    clearSecrets()
    if (outcome.status === 200 && outcome.reply?.username !== undefined) {
      const updated: AccountState = { ...account, username: outcome.reply.username, hasPassword: true }
      setPhase({ step: 'summary', account: updated })
      setUsername(updated.username)
      setNotice({ kind: 'ok', text: outcome.reply.message ?? t('signin.saved') })
      return
    }
    if (outcome.status === 401) setPhase({ step: 'expired' })
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
    if (outcome.status === 401) setPhase({ step: 'expired' })
    setNotice(outcome.status === 200
      ? { kind: 'ok', text: outcome.reply?.message ?? t('signin.revoke') }
      : { kind: 'error', text: outcome.status === 401
        ? t('signin.expired')
        : outcome.reply?.message ?? t('signin.failed') })
  }
  if (phase.step === 'loading' || phase.step === 'unavailable') {
    return (
      <div className={css.section}>
        <p className={css.description} role="status">
          {phase.step === 'loading' ? t('signin.loading') : t('signin.unavailable')}
        </p>
      </div>
    )
  }
  if (phase.step === 'expired') {
    return (
      <div className={css.section}>
        <Row title={t('signin.nav')} hint={t('signin.expired')}>
          <Button variant="outline" size="sm" onClick={() => { void signOut() }}>{t('signOut')}</Button>
        </Row>
      </div>
    )
  }
  const { account } = phase
  const session = account.sessionKind === 'launch' ? t('signin.sessionToken') : t('signin.sessionPassword')
  const until = account.expiresAt > 0
    ? ' · ' + t('signin.expires', { date: new Date(account.expiresAt).toLocaleDateString() })
    : ''
  const blocked = busy
    || next.length < 8
    || next !== again
    || (account.hasPassword && current.length === 0)
  return (
    <div className={css.section}>
      {notice === undefined ? null : (
        <p className={notice.kind === 'error' ? css.error : css.saved} role="status">{notice.text}</p>
      )}
      {phase.step === 'edit' ? (
        <>
          <div className={css.editHead}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setPhase({ step: 'summary', account })
                setNotice(undefined)
                clearSecrets()
              }}
            >
              {t('signin.back')}
            </Button>
            <div className={css.title}>{t('signin.editTitle')}</div>
          </div>
          <div className={css.fields}>
            <div className={css.field}>
              <label className={css.label} htmlFor="signin-account">{t('signin.account')}</label>
              <Input
                id="signin-account"
                name="signin-account"
                value={username}
                autoComplete="username"
                spellCheck={false}
                onChange={typed(setUsername)}
              />
            </div>
            {account.hasPassword ? (
              <SecretEntry
                id="signin-current"
                label={t('signin.currentPassword')}
                value={current}
                revealed={revealed}
                autoComplete="current-password"
                onInput={typed(setCurrent)}
              />
            ) : null}
            <SecretEntry
              id="signin-new"
              label={t('signin.newPassword')}
              value={next}
              revealed={revealed}
              autoComplete="new-password"
              onInput={typed(setNext)}
            />
            <SecretEntry
              id="signin-again"
              label={t('signin.confirmPassword')}
              value={again}
              revealed={revealed}
              autoComplete="new-password"
              onInput={typed(setAgain)}
            />
          </div>
          {account.hasPassword ? null : <p className={css.description}>{t('signin.setFirst')}</p>}
          <div className={css.actions}>
            <Button
              variant="outline"
              size="sm"
              aria-pressed={revealed}
              onClick={() => { setRevealed(!revealed) }}
            >
              {t('signin.reveal')}
            </Button>
            <Button variant="primary" size="sm" disabled={blocked} onClick={() => { void save(account) }}>
              {busy ? t('signin.saving') : t('signin.save')}
            </Button>
          </div>
        </>
      ) : (
        <>
          <button
            type="button"
            className={css.account}
            onClick={() => {
              setPhase({ step: 'edit', account })
              setNotice(undefined)
            }}
          >
            <span className={css.avatar} aria-hidden="true"><FishLogo size={20} /></span>
            <span className={css.identity}>
              <span className={css.name}>{account.username}</span>
              <span className={css.description}>{session + until}</span>
            </span>
            <span className={css.editHint}>
              {t('signin.edit')}
              <svg className={css.chevron} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M6 3.8 10.2 8 6 12.2"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </button>
          <p className={css.description}>{t('signin.description')}</p>
          <Row title={t('signOut')} hint={t('signin.signOutHint')}>
            <Button variant="outline" size="sm" onClick={() => { void signOut() }}>{t('signOut')}</Button>
          </Row>
          <Row title={t('signin.revoke')} hint={t('signin.revokeHint')}>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => { void revoke() }}>
              {armedRevoke ? t('signin.revokeConfirm') : t('signin.revoke')}
            </Button>
          </Row>
        </>
      )}
    </div>
  )
}

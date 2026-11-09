/** Settings-header action that ends this browser's Host session. */

import type { ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './SettingsDocumentAction.module.css'

/** Registrant-owned dependency of {@link SignOutAction}. */
export interface SignOutActionInjected {
  /**
   * Ends this browser's Host session and reloads the page. Undefined for a carrier
   * that owns its transport, which has no browser session to end.
   */
  signOut: (() => Promise<void>) | undefined
}

/** Header-action owner share, localized copy, and the registrant's command face. */
export type SignOutActionProps =
  PropsRuntime<'settings.action'> & PropsLocale<'settings'> & InjectFace<SignOutActionInjected>

/**
 * Render the sign-out action for a page whose Host owns the browser session.
 * @param props - header owner props, localized copy, and the session command.
 * @returns the sign-out button, or null when this carrier has no browser session.
 */
export function SignOutAction({ signOut, t }: SignOutActionProps): ReactNode {
  if (signOut === undefined) return null
  return (
    <div className={css.action}>
      <Button variant="outline" size="sm" onClick={() => { void signOut() }}>
        {t('signOut')}
      </Button>
    </div>
  )
}

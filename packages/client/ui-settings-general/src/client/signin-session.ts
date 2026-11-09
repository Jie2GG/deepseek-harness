/** Browser transport for the Host endpoints that own this page's sign-in. */

/** One answer from an `auth/*` endpoint. */
export interface SigninReply {
  /** Whether the Host accepted the request. */
  ok: boolean
  /** Copy explaining a refusal, or a success the Host asks to confirm. */
  message?: string
  /** Account name the Host accepts after this answer. */
  username?: string
  /** Whether this Host holds a password yet. */
  hasPassword?: boolean
  /** Which session the caller presents: a password sign-in or a launch token. */
  sessionKind?: 'launch' | 'password'
}

/** Outcome of one request: the HTTP status, or zero when it never answered. */
export interface SigninOutcome {
  /** HTTP status the endpoint answered with, or zero when the request failed. */
  status: number
  /** Decoded reply, absent when the answer carried no JSON. */
  reply: SigninReply | undefined
}

/**
 * Ask one authentication endpoint of the Host that served this page.
 * @param endpoint - path below the served root, such as `auth/state`.
 * @param body - JSON payload; an empty object asks the Host for nothing new.
 * @returns the status and decoded reply, or a zero status when the request failed.
 */
export async function signinRequest(endpoint: string, body: object): Promise<SigninOutcome> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'same-origin',
  }).catch((error: unknown) => {
    // The Host cannot be reached, so the form reports that instead of guessing a state.
    console.warn(`[signin] the ${endpoint} request failed: ${String(error)}`)
    return undefined
  })
  if (response === undefined) return { status: 0, reply: undefined }
  const reply = await response.json().catch(() => undefined) as SigninReply | undefined
  return { status: response.status, reply }
}

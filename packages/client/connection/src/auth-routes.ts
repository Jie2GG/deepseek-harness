/** POST handlers for browser sign-in, password setup, sign-out, and account edits. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { authMessagesFor, withCount, withSeconds, type AuthMessages } from './auth-locale.ts'
import { pageCopy, type AuthPageMode } from './auth-page.ts'
import { requestAudience, type BrowserAuth } from './browser-auth.ts'
import { isUsablePassword, isUsableUsername, type PasswordStore } from './password-record.ts'
import type { LoginThrottle } from './login-throttle.ts'
import type { ConnectionRequestRejection, ConnectionTrustRequest } from './rpc.ts'

/** Largest accepted sign-in body: one form pair plus JSON framing. */
export const MAX_AUTH_REQUEST_BODY_BYTES = 64 * 1024

/**
 * One browser authentication endpoint this plugin owns. `login`, `setup`, and
 * `logout` answer an unsigned browser; `state`, `change`, and `revoke` act inside
 * a live sign-in.
 */
export type AuthRouteKind = 'login' | 'setup' | 'logout' | 'state' | 'change' | 'revoke'

/** Endpoints a signed-in browser must present before its request is read. */
const SIGNED_IN_ENDPOINTS: ReadonlySet<AuthRouteKind> = new Set(['state', 'change', 'revoke'])

/** Collaborators one authentication route needs. */
export interface AuthRouteDeps {
  /** Cookie minting and the signing secret behind it. */
  readonly auth: BrowserAuth
  /** Durable login secret and its session generation. */
  readonly passwords: PasswordStore
  /** In-memory wait applied to repeated sign-in failures. */
  readonly throttle: LoginThrottle
  /** Host/Origin fence shared with every other route this plugin serves. */
  reject(request: ConnectionTrustRequest): ConnectionRequestRejection
  /** Whether the answering listener serves TLS; it selects the `Secure` attribute. */
  secure(): boolean
  /**
   * Record one authentication outcome for the operator log. The routes name the
   * account and the peer address there and never a plaintext password.
   * @param level - importance of the line: an accepted action or a refusal.
   * @param message - the line to log.
   */
  audit(level: 'info' | 'warn', message: string): void
}

/** What a sign-in or setup form submits. */
const credentialsSchema = z.object({
  username: z.string(),
  password: z.string(),
  confirmPassword: z.string().optional(),
  remember: z.boolean().optional(),
}).strict()

/** What a signed-in account edit submits. */
const changeSchema = z.object({
  username: z.string().optional(),
  currentPassword: z.string(),
  password: z.string(),
  confirmPassword: z.string(),
  remember: z.boolean().optional(),
}).strict()

/** JSON answer one authentication route sends. */
interface AuthReply {
  ok: boolean
  /** Copy shown in place of a bare success. */
  message?: string
  /** Consecutive-failure notice, present once a sign-in was refused more than once. */
  attemptsMessage?: string
  /** Labels of the form the page should show instead. */
  copy?: ReturnType<typeof pageCopy>
  /** Account name this Host accepts after the answer. */
  username?: string
  /** Whether a password record exists. */
  hasPassword?: boolean
  /** Which kind of browser session the caller presents. */
  sessionKind?: 'launch' | 'password'
}

function headerOf(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name]
  return typeof value === 'string' ? value : undefined
}

/**
 * Send one authentication answer.
 * @param res - response the route owns.
 * @param status - HTTP status to send.
 * @param body - JSON reply, optionally carrying the copy a page should switch to.
 * @param extraHeaders - additional response headers, such as `set-cookie`.
 */
function replyJson(
  res: ServerResponse,
  status: number,
  body: AuthReply,
  extraHeaders: Readonly<Record<string, string>> = {},
): void {
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    ...extraHeaders,
  })
  res.end(JSON.stringify(body))
}

/**
 * Refuse one attempt and hand the page the labels of the form to show instead.
 * @param res - response the route owns.
 * @param messages - copy in the browser language.
 * @param mode - form the page should switch to.
 * @param status - HTTP status that names the refusal.
 * @param message - localized reason to display.
 */
function replySwitched(
  res: ServerResponse,
  messages: AuthMessages,
  mode: AuthPageMode,
  status: number,
  message: string,
): void {
  replyJson(res, status, { ok: false, message, copy: pageCopy(messages, mode) })
}

/**
 * Collect one small JSON request body without interpreting it.
 * @param req - request whose body is read.
 * @returns the decoded value, or the status that refuses the request.
 */
async function readJson(
  req: IncomingMessage,
): Promise<{ value: unknown } | { rejected: 400 | 413 | 415 }> {
  const mediaType = headerOf(req, 'content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (mediaType !== 'application/json') return { rejected: 415 }
  const declared = headerOf(req, 'content-length')
  if (declared !== undefined && Number(declared) > MAX_AUTH_REQUEST_BODY_BYTES) return { rejected: 413 }
  const chunks: Buffer[] = []
  let received = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    received += buffer.byteLength
    if (received > MAX_AUTH_REQUEST_BODY_BYTES) return { rejected: 413 }
    chunks.push(buffer)
  }
  try {
    return { value: JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  } catch {
    return { rejected: 400 }
  }
}
/**
 * Build the handler for one authentication route.
 * @param deps - collaborators the route needs.
 * @param kind - endpoint being served.
 * @returns a webserver handler that owns its full response.
 */
export function createAuthHandler(
  deps: AuthRouteDeps,
  kind: AuthRouteKind,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    const rejection = deps.reject(req)
    if (rejection !== undefined) {
      res.writeHead(rejection, { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' })
      res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { 'cache-control': 'no-store', allow: 'POST' })
      res.end()
      return
    }
    const secure = deps.secure()
    const authority = requestAudience(req.headers, secure)
    const messages = authMessagesFor(headerOf(req, 'accept-language'))
    if (authority === undefined) {
      replyJson(res, 400, { ok: false, message: messages.requestFailed })
      return
    }
    const address = req.socket.remoteAddress ?? 'unknown'
    const signIn = (remember: boolean): Readonly<Record<string, string>> => ({
      'set-cookie': deps.auth.issueBrowserCookie(authority, deps.passwords.epoch, secure, remember),
    })
    if (SIGNED_IN_ENDPOINTS.has(kind) && !deps.auth.isAuthenticated(req, secure)) {
      deps.audit('warn', `${kind} refused: the browser on ${address} is not signed in`)
      replyJson(res, 401, { ok: false, message: messages.sessionExpired })
      return
    }
    if (kind === 'logout') {
      deps.audit('info', `signed out: account ${deps.passwords.accountName} (${address})`)
      replyJson(res, 200, { ok: true }, { 'set-cookie': deps.auth.expiredBrowserCookie(authority, secure) })
      return
    }
    if (kind === 'state') {
      replyJson(res, 200, {
        ok: true,
        username: deps.passwords.accountName,
        hasPassword: deps.passwords.isSet,
        sessionKind: deps.auth.browserSessionKind(req, secure),
      })
      return
    }
    if (kind === 'revoke') {
      if (!await deps.passwords.rotateSession()) {
        replySwitched(res, messages, 'set-password', 409, messages.needSetup)
        return
      }
      deps.audit('info', `signed out other devices: account ${deps.passwords.accountName} (${address})`)
      replyJson(res, 200, { ok: true, message: messages.revokedOthers }, signIn(true))
      return
    }
    const read = await readJson(req)
    if ('rejected' in read) {
      replyJson(res, read.rejected, { ok: false, message: messages.requestFailed })
      return
    }
    if (kind === 'change') {
      const submitted = changeSchema.safeParse(read.value)
      if (!submitted.success) {
        replyJson(res, 400, { ok: false, message: messages.requestFailed })
        return
      }
      const account = (submitted.data.username ?? deps.passwords.accountName).trim()
      if (!isUsableUsername(account)) {
        replyJson(res, 400, { ok: false, message: messages.requestFailed })
        return
      }
      if (submitted.data.password !== submitted.data.confirmPassword) {
        replyJson(res, 400, { ok: false, message: messages.passwordMismatch })
        return
      }
      if (!isUsablePassword(submitted.data.password)) {
        replyJson(res, 400, { ok: false, message: messages.passwordTooShort })
        return
      }
      const outcome = await deps.passwords.change(
        submitted.data.currentPassword,
        account,
        submitted.data.password,
      )
      if (outcome === 'wrong-password') {
        deps.audit('warn', `password change refused for account ${deps.passwords.accountName} (${address})`)
        replyJson(res, 403, { ok: false, message: messages.wrongPassword })
        return
      }
      if (outcome === 'unavailable') {
        replySwitched(res, messages, 'set-password', 409, messages.needSetup)
        return
      }
      deps.audit('info', `password changed for account ${account} (${address})`)
      replyJson(res, 200, {
        ok: true,
        username: account,
        message: messages.changedPassword,
      }, signIn(submitted.data.remember ?? true))
      return
    }
    const parsed = credentialsSchema.safeParse(read.value)
    if (!parsed.success) {
      replyJson(res, 400, { ok: false, message: messages.requestFailed })
      return
    }
    const submitted = parsed.data
    const username = submitted.username.trim()
    const remember = submitted.remember ?? true
    if (!isUsableUsername(username) || !isUsablePassword(submitted.password)) {
      replyJson(res, 400, { ok: false, message: messages.passwordTooShort })
      return
    }
    if (kind === 'setup') {
      if (submitted.confirmPassword !== undefined && submitted.confirmPassword !== submitted.password) {
        replyJson(res, 400, { ok: false, message: messages.passwordMismatch })
        return
      }
      const outcome = deps.passwords.isSet
        ? 'already-set'
        : await deps.passwords.setup(username, submitted.password)
      if (outcome === 'already-set') {
        deps.audit('warn', `password setup refused, a record already exists: account ${username} (${address})`)
        replySwitched(res, messages, 'sign-in', 409, messages.alreadySet)
        return
      }
      deps.audit('info', `password set for account ${username} (${address})`)
      replyJson(res, 200, { ok: true, username }, signIn(remember))
      return
    }
    if (!deps.passwords.isSet) {
      replySwitched(res, messages, 'set-password', 409, messages.needSetup)
      return
    }
    const throttleKey = `${address}|${username}`
    const wait = deps.throttle.retryAfterMs(throttleKey, Date.now())
    if (wait > 0) {
      const seconds = Math.ceil(wait / 1000)
      deps.audit('warn', `sign-in throttled for account ${username} (${address}), retry in ${String(seconds)}s`)
      replyJson(res, 429, {
        ok: false,
        message: withSeconds(messages.tooManyAttempts, seconds),
        copy: pageCopy(messages, 'sign-in'),
      })
      return
    }
    if (!await deps.passwords.verify(username, submitted.password)) {
      deps.throttle.recordFailure(throttleKey, Date.now())
      const attempts = deps.throttle.failures(throttleKey)
      deps.audit('warn', `sign-in refused for account ${username} (${address}), attempt ${String(attempts)}`)
      replyJson(res, 401, {
        ok: false,
        message: messages.wrongCredentials,
        ...(attempts > 1 ? { attemptsMessage: withCount(messages.failedAttempts, attempts) } : {}),
        copy: pageCopy(messages, 'sign-in'),
      })
      return
    }
    deps.throttle.recordSuccess(throttleKey)
    deps.audit('info', `signed in: account ${username} (${address})`)
    replyJson(res, 200, { ok: true, username }, signIn(remember))
  }
}

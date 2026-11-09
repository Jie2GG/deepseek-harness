/** POST handlers for browser sign-in, first password setup, and sign-out. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { authMessagesFor, withSeconds, type AuthMessages } from './auth-locale.ts'
import { pageCopy, type AuthPageMode } from './auth-page.ts'
import { requestAudience, type BrowserAuth } from './browser-auth.ts'
import { isUsablePassword, isUsableUsername, type PasswordStore } from './password-record.ts'
import type { LoginThrottle } from './login-throttle.ts'
import type { ConnectionRequestRejection, ConnectionTrustRequest } from './rpc.ts'

/** Largest accepted sign-in body: one form pair plus JSON framing. */
export const MAX_AUTH_REQUEST_BODY_BYTES = 64 * 1024

/** One of the three browser authentication endpoints this plugin owns. */
export type AuthRouteKind = 'login' | 'setup' | 'logout'

/** Collaborators one authentication route needs. */
export interface AuthRouteDeps {
  /** Cookie minting and the signing secret behind it. */
  readonly auth: BrowserAuth
  /** Durable login secret and its generation. */
  readonly passwords: PasswordStore
  /** In-memory wait applied to repeated sign-in failures. */
  readonly throttle: LoginThrottle
  /** Host/Origin fence shared with every other route this plugin serves. */
  reject(request: ConnectionTrustRequest): ConnectionRequestRejection
  /** Whether the answering listener serves TLS; it selects the `Secure` attribute. */
  secure(): boolean
}

const credentialsSchema = z.object({
  username: z.string(),
  password: z.string(),
}).strict()

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
  body: { ok: boolean; message?: string; copy?: ReturnType<typeof pageCopy> },
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
 * Collect one small JSON request body.
 * @param req - request whose body is read.
 * @returns the submitted pair, or the status that refuses the request.
 */
async function readCredentials(
  req: IncomingMessage,
): Promise<{ username: string; password: string } | { rejected: 400 | 413 | 415 }> {
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
  let decoded: unknown
  try {
    decoded = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return { rejected: 400 }
  }
  const parsed = credentialsSchema.safeParse(decoded)
  return parsed.success ? parsed.data : { rejected: 400 }
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
    if (kind === 'logout') {
      replyJson(res, 200, { ok: true }, { 'set-cookie': deps.auth.expiredBrowserCookie(authority, secure) })
      return
    }
    const submitted = await readCredentials(req)
    if ('rejected' in submitted) {
      replyJson(res, submitted.rejected, { ok: false, message: messages.requestFailed })
      return
    }
    const username = submitted.username.trim()
    const password = submitted.password
    if (!isUsableUsername(username) || !isUsablePassword(password)) {
      replyJson(res, 400, { ok: false, message: messages.passwordTooShort })
      return
    }
    const signIn = (): Readonly<Record<string, string>> => ({
      'set-cookie': deps.auth.issueBrowserCookie(authority, deps.passwords.epoch, secure),
    })
    if (kind === 'setup') {
      const outcome = deps.passwords.isSet
        ? 'already-set'
        : await deps.passwords.setup(username, password)
      if (outcome === 'already-set') {
        replySwitched(res, messages, 'sign-in', 409, messages.alreadySet)
        return
      }
      replyJson(res, 200, { ok: true }, signIn())
      return
    }
    if (!deps.passwords.isSet) {
      replySwitched(res, messages, 'set-password', 409, messages.needSetup)
      return
    }
    const throttleKey = `${req.socket.remoteAddress ?? 'unknown'}|${username}`
    const wait = deps.throttle.retryAfterMs(throttleKey, Date.now())
    if (wait > 0) {
      replyJson(res, 429, {
        ok: false,
        message: withSeconds(messages.tooManyAttempts, Math.ceil(wait / 1000)),
        copy: pageCopy(messages, 'sign-in'),
      })
      return
    }
    if (!await deps.passwords.verify(username, password)) {
      deps.throttle.recordFailure(throttleKey, Date.now())
      replySwitched(res, messages, 'sign-in', 401, messages.wrongCredentials)
      return
    }
    deps.throttle.recordSuccess(throttleKey)
    replyJson(res, 200, { ok: true }, signIn())
  }
}

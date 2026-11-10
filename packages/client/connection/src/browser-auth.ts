/** Browser-session authentication for the Host Connection carrier. */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { PeerId } from '@deepseek-ai/dsh-typert-protocol'
import { CONNECT_PATH, type ConnectionInteractions } from './connect-protocol.ts'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { authMessagesFor } from './auth-locale.ts'
import { renderAuthPage, type AuthPageMode } from './auth-page.ts'
import type { PasswordStore } from './password-record.ts'
import type {
  ConnectionIndexRequest,
  ConnectionIndexResponse,
  ConnectionTrustRequest,
} from './rpc.ts'

const AUTH_RECORD_KEY = credentialKey('client-connection', 'browser-session')
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000
const SECRET_BYTES = 32
const TOKEN_QUERY = 'token'
const COOKIE_PREFIX = 'dsh-auth-'
const COOKIE_PAYLOAD_VERSION = 3
const API_COOKIE_PAYLOAD_VERSION = 2
const STORED_SECRET_VERSION = 1
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]*$/
const PROCESS_LAUNCH_TOKENS = new WeakMap<object, string>()

/**
 * Generation an index token exchange pins into its cookie, kept independent of
 * the password record so a machine keeps its session across a password change.
 */
export const LAUNCH_EPOCH = 'launch'

interface StoredSecretPayload {
  readonly version: typeof STORED_SECRET_VERSION
  readonly secret: string
}

interface BrowserCookiePayload {
  readonly version: typeof COOKIE_PAYLOAD_VERSION
  readonly authority: string
  readonly issuedAt: number
  readonly expiresAt: number
  /** Password generation this session belongs to. */
  readonly epoch: string
}

interface ApiCookiePayload {
  readonly version: typeof API_COOKIE_PAYLOAD_VERSION
  readonly authority: string
  readonly issuedAt: number
  readonly expiresAt: number
  readonly id: PeerId
}

type CookiePayload = BrowserCookiePayload | ApiCookiePayload

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function encodeBase64Url(value: Uint8Array): string {
  return Buffer.from(value).toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')
}

function decodeBase64Url(value: string): Buffer | undefined {
  if (!BASE64URL_PATTERN.test(value) || value.length % 4 === 1) return undefined
  const padding = '='.repeat((4 - value.length % 4) % 4)
  const decoded = Buffer.from(value.replaceAll('-', '+').replaceAll('_', '/') + padding, 'base64')
  return encodeBase64Url(decoded) === value ? decoded : undefined
}

function processLaunchToken(owner: object): string {
  const existing = PROCESS_LAUNCH_TOKENS.get(owner)
  if (existing !== undefined) return existing
  const created = encodeBase64Url(randomBytes(SECRET_BYTES))
  PROCESS_LAUNCH_TOKENS.set(owner, created)
  return created
}

function header(
  headers: ConnectionTrustRequest['headers'],
  name: string,
): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

/**
 * Protocol-scoped cookie audience a request was addressed to.
 * HTTP keeps the existing authority-only spelling.
 * @param headers - request headers from either transport representation.
 * @param secure - whether the receiving listener serves TLS.
 * @returns the audience text, or undefined when the request names no Host.
 */
export function requestAudience(
  headers: ConnectionTrustRequest['headers'],
  secure: boolean,
): string | undefined {
  const host = header(headers, 'host')
  if (host === undefined) return undefined
  try {
    const url = new URL(`${secure ? 'https:' : 'http:'}//${host}`)
    return secure ? url.origin : url.host
  } catch {
    return undefined
  }
}

function canonicalSecret(value: unknown): Buffer | undefined {
  if (typeof value !== 'string') return undefined
  const decoded = decodeBase64Url(value)
  if (decoded === undefined || decoded.byteLength !== SECRET_BYTES) return undefined
  return decoded
}

function storedSecret(record: CredentialRecord | undefined): Buffer | undefined {
  if (record === undefined) return undefined
  if (record.kind !== 'grant' || !isRecord(record.payload)
    || record.payload.version !== STORED_SECRET_VERSION) {
    throw new Error('client-connection: browser-session credential record has an unsupported format')
  }
  const secret = canonicalSecret(record.payload.secret)
  if (secret === undefined) {
    throw new Error('client-connection: browser-session credential record has an invalid secret')
  }
  return secret
}

function tokenMatches(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual, 'utf8')
  const expectedBytes = Buffer.from(expected, 'utf8')
  return actualBytes.byteLength === expectedBytes.byteLength && timingSafeEqual(actualBytes, expectedBytes)
}

function cookieName(authority: string): string {
  return COOKIE_PREFIX + encodeBase64Url(createHash('sha256').update(authority).digest())
}

/** Read the exact generated cookie without implementing general Cookie decoding. */
function cookieValue(headerValue: string, name: string): string | undefined {
  for (const segment of headerValue.split(';')) {
    const at = segment.indexOf('=')
    if (at === -1 || segment.slice(0, at).trim() !== name) continue
    return segment.slice(at + 1).trim()
  }
  return undefined
}

/** Serialize the fixed browser-session attributes; generated names and values are cookie-safe base64url. */
function sessionCookie(
  name: string,
  value: string,
  expiresAt: number,
  maxAgeSeconds: number | undefined,
  secure: boolean,
): string {
  // An undefined lifetime omits both dated attributes, so the browser drops the
  // cookie when it closes: the sign-in lasts that session and no longer.
  const dated = maxAgeSeconds === undefined
    ? ''
    : `Max-Age=${String(maxAgeSeconds)}; Expires=${new Date(expiresAt).toUTCString()}; `
  const attributes = `${name}=${value}; ${dated}Path=/; HttpOnly; SameSite=Strict`
  return secure ? `${attributes}; Secure` : attributes
}

function signature(secret: Buffer, body: string): Buffer {
  return createHmac('sha256', secret).update(body).digest()
}

function encodeCookie(payload: CookiePayload, secret: Buffer): string {
  const body = encodeBase64Url(Buffer.from(JSON.stringify(payload), 'utf8'))
  return `v${String(payload.version)}.${body}.${encodeBase64Url(signature(secret, body))}`
}

function decodeCookie(value: string, secret: Buffer): CookiePayload | undefined {
  const parts = value.split('.')
  const [version, body, encodedSignature] = parts
  const versions: readonly string[] = [`v${String(COOKIE_PAYLOAD_VERSION)}`, `v${String(API_COOKIE_PAYLOAD_VERSION)}`]
  if (parts.length !== 3 || !versions.includes(version ?? '') || body === undefined || encodedSignature === undefined) {
    return undefined
  }
  const actualSignature = decodeBase64Url(encodedSignature)
  if (actualSignature === undefined) return undefined
  const expectedSignature = signature(secret, body)
  if (actualSignature.byteLength !== expectedSignature.byteLength
    || !timingSafeEqual(actualSignature, expectedSignature)) {
    return undefined
  }
  let decoded: unknown
  try {
    const bodyBytes = decodeBase64Url(body)
    if (bodyBytes === undefined) return undefined
    decoded = JSON.parse(bodyBytes.toString('utf8'))
  } catch {
    return undefined
  }
  if (!isRecord(decoded)
    || (decoded.version !== COOKIE_PAYLOAD_VERSION && decoded.version !== API_COOKIE_PAYLOAD_VERSION)
    || version !== `v${String(decoded.version)}`
    || typeof decoded.authority !== 'string'
    || typeof decoded.issuedAt !== 'number' || !Number.isSafeInteger(decoded.issuedAt)
    || typeof decoded.expiresAt !== 'number' || !Number.isSafeInteger(decoded.expiresAt)) {
    return undefined
  }
  const payload = { authority: decoded.authority, issuedAt: decoded.issuedAt, expiresAt: decoded.expiresAt }
  if (decoded.version === API_COOKIE_PAYLOAD_VERSION) {
    if (typeof decoded.id !== 'string' || decoded.id.length === 0) return undefined
    return { version: API_COOKIE_PAYLOAD_VERSION, ...payload, id: decoded.id as PeerId }
  }
  if (typeof decoded.epoch !== 'string' || decoded.epoch.length === 0) return undefined
  return { version: COOKIE_PAYLOAD_VERSION, ...payload, epoch: decoded.epoch }
}

async function initializeSecret(credentials: CredentialProvider): Promise<Buffer> {
  const generated: StoredSecretPayload = {
    version: STORED_SECRET_VERSION,
    secret: encodeBase64Url(randomBytes(SECRET_BYTES)),
  }
  const record = await credentials.modifyRecord(AUTH_RECORD_KEY, (current) => {
    if (current !== undefined) {
      storedSecret(current)
      return Promise.resolve(undefined)
    }
    return Promise.resolve({ kind: 'grant', payload: generated })
  })
  const secret = storedSecret(record)
  if (secret === undefined) {
    throw new Error('client-connection: browser-session credential record was not created')
  }
  return secret
}

/**
 * Process launch-token exchange, password sign-in sessions, and persistent
 * signed-cookie verification. Connection loads the credential provider's signing
 * secret during activation and retains it for synchronous request authentication.
 */
export class BrowserAuth {
  private readonly launchToken: string
  private readonly maxAgeMilliseconds: number

  private constructor(
    processOwner: object,
    private readonly secret: Buffer,
    maxAgeDays: number,
    private readonly passwords: PasswordStore,
  ) {
    this.launchToken = processLaunchToken(processOwner)
    this.maxAgeMilliseconds = maxAgeDays * DAY_MILLISECONDS
    if (!Number.isSafeInteger(this.maxAgeMilliseconds)
      || !Number.isSafeInteger(Date.now() + this.maxAgeMilliseconds)) {
      throw new Error('client-connection: cookieMaxAgeDays exceeds the safe timestamp range')
    }
  }

  /**
   * Initialize browser authentication and create its durable signing secret
   * when this Harness home has none.
   * @param processOwner - root application context retaining one token across Connection reloads.
   * @param credentials - persistent credential provider for the Web profile.
   * @param maxAgeDays - positive absolute browser-cookie lifetime in days.
   * @param passwords - loaded login secret store that signs browser sessions out on change.
   * @returns initialized authentication owner with the process owner's launch token.
   */
  static async create(
    processOwner: object,
    credentials: CredentialProvider,
    maxAgeDays: number,
    passwords: PasswordStore,
  ): Promise<BrowserAuth> {
    return new BrowserAuth(processOwner, await initializeSecret(credentials), maxAgeDays, passwords)
  }

  /**
   * Add this process's launch token to the caller's application URL.
   * @param baseUrl - clean browser URL whose authority and mount are preserved.
   * @returns the same URL carrying the process token as its sole authentication input.
   */
  authenticatedUrl(baseUrl: string): string {
    const url = new URL(baseUrl)
    url.searchParams.set(TOKEN_QUERY, this.launchToken)
    return url.href
  }

  /**
   * Serialize a signed browser-session cookie for one session generation.
   * @param authority - cookie audience the request was addressed to.
   * @param epoch - password session generation, or {@link LAUNCH_EPOCH} for a token exchange.
   * @param secure - whether the receiving listener serves TLS.
   * @param remember - true writes the dated attributes so the sign-in survives a
   * browser restart; false leaves a browser-session cookie. Either way the signed
   * payload still expires at the configured absolute ceiling.
   * @returns the full `Set-Cookie` value.
   */
  issueBrowserCookie(
    authority: string,
    epoch: string,
    secure: boolean,
    remember = true,
  ): string {
    const issuedAt = Date.now()
    const expiresAt = issuedAt + this.maxAgeMilliseconds
    const value = encodeCookie({ version: COOKIE_PAYLOAD_VERSION, authority, issuedAt, expiresAt, epoch }, this.secret)
    return sessionCookie(
      cookieName(authority),
      value,
      expiresAt,
      remember ? Math.floor(this.maxAgeMilliseconds / 1000) : undefined,
      secure,
    )
  }

  /**
   * Serialize the cookie that signs a browser out without touching any other session.
   * @param authority - cookie audience the request was addressed to.
   * @param secure - whether the receiving listener serves TLS.
   * @returns the full `Set-Cookie` value with an immediate expiry.
   */
  expiredBrowserCookie(authority: string, secure: boolean): string {
    const now = Date.now()
    const value = encodeCookie(
      { version: COOKIE_PAYLOAD_VERSION, authority, issuedAt: now, expiresAt: now, epoch: LAUNCH_EPOCH },
      this.secret,
    )
    return sessionCookie(cookieName(authority), value, now, 0, secure)
  }

  /**
   * Authenticate an index request. A valid root query token mints the cookie and
   * redirects to the directory-relative clean `./`; a valid cookie lets the caller
   * serve the application; every other request receives the sign-in or setup page.
   * @param req - incoming root or configured-index request.
   * @param res - response owned when this method returns false.
   * @param secure - whether the listener receiving this request serves TLS; the
   * minted cookie carries `Secure` when it does. Only that listener's own protocol
   * decides, never a `publicUrl` announcement or a forwarded header: those describe
   * a hop this process does not terminate.
   * @returns true only when the caller may serve the application index.
   */
  authorizeIndex(req: ConnectionIndexRequest, res: ConnectionIndexResponse, secure = false): boolean {
    /* v8 ignore next -- node:http always supplies url on server requests. */
    const url = new URL(req.url ?? '/', 'http://dsh.invalid')
    const tokens = url.searchParams.getAll(TOKEN_QUERY)
    if (tokens.length > 0) {
      const authority = requestAudience(req.headers, secure)
      if (req.method === 'GET' && url.pathname === '/' && tokens.length === 1
        && authority !== undefined && tokenMatches(tokens.join(''), this.launchToken)) {
        res.writeHead(303, {
          'cache-control': 'no-store',
          'location': './',
          'referrer-policy': 'no-referrer',
          'set-cookie': this.issueBrowserCookie(authority, LAUNCH_EPOCH, secure),
        })
        res.end()
        return false
      }
      if (req.method === 'GET' && url.pathname === '/' && this.isAuthenticated(req, secure)) {
        res.writeHead(303, {
          'cache-control': 'no-store',
          'location': './',
          'referrer-policy': 'no-referrer',
        })
        res.end()
        return false
      }
      this.writeUnauthorized(req, res)
      return false
    }
    if (this.isAuthenticated(req, secure)) return true
    this.writeSignInPage(req, res, secure)
    return false
  }

  /**
   * Answer an unauthenticated index request with the sign-in page, or the setup
   * page while this Harness home has no password record.
   * @param req - index request the page is rendered for.
   * @param res - response owned by the caller after this method returns false.
   * @param secure - whether the answering listener serves TLS.
   */
  private writeSignInPage(req: ConnectionIndexRequest, res: ConnectionIndexResponse, secure: boolean): void {
    const messages = authMessagesFor(header(req.headers, 'accept-language'))
    const mode: AuthPageMode = this.passwords.isSet ? 'sign-in' : 'set-password'
    res.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': 'text/html; charset=utf-8',
      'referrer-policy': 'no-referrer',
    })
    res.end(renderAuthPage(messages, mode, this.passwords.accountName, secure))
  }

  /**
   * Exchange the launch token for an independent API operator; omitted interactions default to none.
   * @param req - trusted GET request on /connect with at most one interactions declaration.
   * @param res - response owned to completion, redirecting to the API mux on success.
   * @param secure - whether the receiving listener serves TLS.
   * @param publish - synchronously create the operator before exposing its signed credential.
   */
  authorizeConnect(
    req: ConnectionIndexRequest,
    res: ConnectionIndexResponse,
    secure: boolean,
    publish: (interactions: ConnectionInteractions) => PeerId,
  ): void {
    const url = new URL(req.url ?? '/', 'http://dsh.invalid')
    const declarations = url.searchParams.getAll('interactions')
    const interactions = declarations[0] ?? 'none'
    if (declarations.length > 1 || (interactions !== 'answer' && interactions !== 'none')) {
      res.writeHead(400, { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' })
      res.end('interactions must be declared once as answer or none\n')
      return
    }
    const tokens = url.searchParams.getAll(TOKEN_QUERY)
    const authority = requestAudience(req.headers, secure)
    if (req.method !== 'GET' || url.pathname !== CONNECT_PATH || tokens.length !== 1
      || authority === undefined || !tokenMatches(tokens.join(''), this.launchToken)) {
      this.writeUnauthorized(req, res)
      return
    }
    const issuedAt = Date.now()
    const id = publish(interactions)
    res.writeHead(302, {
      'cache-control': 'no-store',
      'location': './api/remote.mux',
      'referrer-policy': 'no-referrer',
      'set-cookie': this.issueApiCookie(authority, issuedAt, id, secure),
    })
    res.end()
  }

  private issueApiCookie(authority: string, issuedAt: number, id: PeerId, secure: boolean): string {
    const expiresAt = issuedAt + this.maxAgeMilliseconds
    const value = encodeCookie({ version: API_COOKIE_PAYLOAD_VERSION, authority, issuedAt, expiresAt, id }, this.secret)
    return sessionCookie(cookieName(authority), value, expiresAt, Math.floor(this.maxAgeMilliseconds / 1000), secure)
  }

  /**
   * Verify the authority-bound browser cookie on a Host request.
   * @param request - request headers carrying Host and Cookie.
   * @param secure - whether the receiving listener uses TLS, including its default port.
   * @returns true only for an unexpired cookie signed by this activation's loaded
   * secret whose generation is the current launch exchange or the live password record.
   */
  isAuthenticated(request: ConnectionTrustRequest, secure = false): boolean {
    const payload = this.authenticate(request, secure)
    if (payload === undefined || payload.version !== COOKIE_PAYLOAD_VERSION) return false
    return payload.epoch === LAUNCH_EPOCH || payload.epoch === this.passwords.epoch
  }

  /**
   * Describe the browser session one request presents, for the account panel.
   * @param request - request headers carrying Host and Cookie.
   * @param secure - whether the receiving listener serves TLS.
   * @returns whether the session came from a launch token or from the live password
   * generation, plus the signed expiry the cookie carries; the expiry is zero for a
   * request whose browser cookie this activation does not accept.
   */
  browserSession(
    request: ConnectionTrustRequest,
    secure = false,
  ): { kind: 'launch' | 'password'; expiresAt: number } {
    const payload = this.authenticate(request, secure)
    const signed = payload?.version === COOKIE_PAYLOAD_VERSION ? payload : undefined
    return {
      kind: signed?.epoch === LAUNCH_EPOCH ? 'launch' : 'password',
      expiresAt: signed?.expiresAt ?? 0,
    }
  }

  /**
   * Verify an API credential without creating or reviving its operator.
   * @param request - request headers carrying Host and Cookie.
   * @param secure - whether the receiving listener serves TLS.
   * @returns the signed operator id, or undefined for invalid, expired, or browser cookies.
   */
  authenticateApi(request: ConnectionTrustRequest, secure = false): PeerId | undefined {
    const payload = this.authenticate(request, secure)
    return payload?.version === API_COOKIE_PAYLOAD_VERSION ? payload.id : undefined
  }

  private authenticate(request: ConnectionTrustRequest, secure: boolean): CookiePayload | undefined {
    const authority = requestAudience(request.headers, secure)
    const rawCookie = header(request.headers, 'cookie')
    if (authority === undefined || rawCookie === undefined) return undefined
    const value = cookieValue(rawCookie, cookieName(authority))
    if (value === undefined) return undefined
    const payload = decodeCookie(value, this.secret)
    if (payload === undefined || payload.authority !== authority) return undefined
    const now = Date.now()
    if (payload.issuedAt > now || payload.expiresAt <= now || payload.expiresAt <= payload.issuedAt
      || payload.expiresAt - payload.issuedAt > this.maxAgeMilliseconds) {
      return undefined
    }
    return payload
  }

  private writeUnauthorized(req: ConnectionIndexRequest, res: ConnectionIndexResponse): void {
    res.writeHead(401, {
      'cache-control': 'no-store',
      'content-type': 'text/plain; charset=utf-8',
    })
    res.end(req.method === 'HEAD'
      ? undefined
      : 'dsh web authentication required; open the sign-in page.\n')
  }
}

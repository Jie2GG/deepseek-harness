/** Browser password endpoints: /auth/login, /auth/setup, and /auth/logout. */

import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { createAuthHandler, MAX_AUTH_REQUEST_BODY_BYTES, type AuthRouteDeps, type AuthRouteKind } from '../src/auth-routes.ts'
import { BrowserAuth } from '../src/browser-auth.ts'
import { LoginThrottle } from '../src/login-throttle.ts'
import { PasswordStore } from '../src/password-record.ts'
import { authEn, authMessagesFor, withSeconds } from '../src/auth-locale.ts'
import { pageCopy, renderAuthPage } from '../src/auth-page.ts'
import { PASSWORD_KEY, RecordCredentials } from './browser-credentials.ts'

const AUTHORITY = '127.0.0.1:3080'
const PASSWORD = 'correct-horse-battery'

interface Sent { status?: number; headers?: Record<string, string>; body?: string }

/** Recorder compatible with the plain writeHead/end calls the routes make. */
function response(): { value: ServerResponse; sent: Sent } {
  const sent: Sent = {}
  const value = Object.assign(new EventEmitter(), {
    headersSent: false,
    writeHead(status: number, headers?: Record<string, string>) {
      sent.status = status
      if (headers !== undefined) sent.headers = headers
      this.headersSent = true
      return this
    },
    end(text?: unknown) {
      if (typeof text === 'string') sent.body = text
      return this
    },
  }) as never
  return { value, sent }
}

function request(options: {
  method?: string
  body?: string | object
  contentType?: string
  cookie?: string
  address?: string
  headers?: Record<string, string | undefined>
}): IncomingMessage {
  const payload = options.body === undefined
    ? []
    : [Buffer.from(typeof options.body === 'string' ? options.body : JSON.stringify(options.body))]
  const stream = Readable.from(payload) as IncomingMessage
  Object.assign(stream, {
    method: options.method ?? 'POST',
    url: '/auth',
    socket: { remoteAddress: options.address },
    headers: {
      host: AUTHORITY,
      ...options.contentType === undefined ? {} : { 'content-type': options.contentType },
      ...options.cookie === undefined ? {} : { cookie: options.cookie },
      ...options.headers,
    },
  })
  return stream
}

interface Harness {
  deps: AuthRouteDeps
  auth: BrowserAuth
  passwords: PasswordStore
  store: RecordCredentials
  serve(kind: AuthRouteKind, req: IncomingMessage): Promise<Sent>
}

/**
 * Build one authentication surface over a fresh or shared credential store.
 * @param options - stored password, TLS posture, and fence verdict.
 * @returns the handlers plus the collaborators a test may inspect.
 */
async function harness(options: {
  store?: RecordCredentials
  password?: string
  secure?: boolean
  rejection?: 401 | 403
} = {}): Promise<Harness> {
  const store = options.store ?? new RecordCredentials()
  const credentials = store as never
  const passwords = new PasswordStore(credentials, 'dsh')
  if (options.password === undefined) await passwords.load()
  else await passwords.setup('dsh', options.password)
  const auth = await BrowserAuth.create({}, credentials, 30, passwords)
  const deps: AuthRouteDeps = {
    auth,
    passwords,
    throttle: new LoginThrottle(),
    reject: () => options.rejection,
    secure: () => options.secure ?? false,
  }
  return {
    deps,
    auth,
    passwords,
    store,
    serve: async (kind, req) => {
      const sink = response()
      await createAuthHandler(deps, kind)(req, sink.value)
      return sink.sent
    },
  }
}

/** The name and value pair of one Set-Cookie header, without its attributes. */
function pair(setCookie: string): string {
  return setCookie.split(';', 1)[0]!
}

function cookieOf(sent: Sent): string {
  const setCookie = sent.headers?.['set-cookie']
  if (setCookie === undefined) throw new Error('route reply carried no cookie')
  return pair(setCookie)
}

function reply(sent: Sent): Record<string, unknown> {
  return JSON.parse(String(sent.body)) as Record<string, unknown>
}

function login(username: string, password: string): IncomingMessage {
  return request({ body: { username, password }, contentType: 'application/json' })
}

describe('first password setup', () => {
  it('stores the winning password and signs the browser in', async () => {
    const host = await harness()
    const sent = await host.serve('setup', request({
      body: { username: ' dsh ', password: PASSWORD },
      contentType: 'application/json; charset=utf-8',
    }))
    expect(sent.status).toBe(200)
    expect(reply(sent)).toEqual({ ok: true })
    expect(host.passwords.isSet).toBe(true)
    expect(host.passwords.accountName).toBe('dsh')
    expect(host.auth.isAuthenticated({ headers: { host: AUTHORITY, cookie: cookieOf(sent) } })).toBe(true)
  })

  it('refuses a second setup and hands the page the sign-in copy', async () => {
    const store = new RecordCredentials()
    const host = await harness({ store })
    await host.serve('setup', login('dsh', PASSWORD))
    const again = await host.serve('setup', request({
      body: { username: 'dsh', password: 'other-password' },
      contentType: 'application/json',
    }))
    expect(again.status).toBe(409)
    expect(reply(again)).toEqual({ ok: false, message: authEn.alreadySet, copy: pageCopy(authEn, 'sign-in') })
    const loser = await harness({ store })
    expect(loser.passwords.accountName).toBe('dsh')
    expect((await loser.serve('setup', login('dsh', PASSWORD))).status).toBe(409)
  })

  it('rejects a name or password it cannot store', async () => {
    const host = await harness()
    for (const body of [{ username: '   ', password: PASSWORD }, { username: 'dsh', password: 'short' }]) {
      const sent = await host.serve('setup', request({ body, contentType: 'application/json' }))
      expect(sent.status).toBe(400)
      expect(reply(sent).message).toBe(authEn.passwordTooShort)
    }
  })

  it('keeps the write it intended when the provider discards it', async () => {
    const store = new RecordCredentials()
    const passwords = new PasswordStore(store as never, 'dsh')
    await passwords.setup('dsh', PASSWORD)
    store.discardWrites = true
    expect(await passwords.setup('dsh', 'second-password-12')).toBe('created')
    expect(passwords.accountName).toBe('dsh')
    expect((store.passwordRecord as { payload: { username: string } }).payload.username).toBe('dsh')
  })
})

describe('sign-in', () => {
  it('asks for setup until a password exists', async () => {
    const host = await harness()
    const sent = await host.serve('login', login('dsh', PASSWORD))
    expect(sent.status).toBe(409)
    expect(reply(sent)).toEqual({ ok: false, message: authEn.needSetup, copy: pageCopy(authEn, 'set-password') })
  })

  it('accepts the stored pair and rejects a wrong name or password', async () => {
    const host = await harness({ password: PASSWORD })
    expect(await host.passwords.verify('dsh', PASSWORD)).toBe(true)
    const accepted = await host.serve('login', login('dsh', PASSWORD))
    expect(accepted.status).toBe(200)
    expect(cookieOf(accepted)).toContain('v3.')
    for (const probe of [login('someone', PASSWORD), login('dsh', 'not-the-password')]) {
      const refused = await host.serve('login', probe)
      expect(refused.status).toBe(401)
      expect(reply(refused)).toEqual({ ok: false, message: authEn.wrongCredentials, copy: pageCopy(authEn, 'sign-in') })
    }
  })

  it('grows the wait per client and account and clears it on success', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-09T00:00:00.000Z'))
    try {
      const host = await harness({ password: PASSWORD })
      for (const seconds of [1, 2]) {
        expect((await host.serve('login', login('dsh', 'wrong-password'))).status).toBe(401)
        const cooled = await host.serve('login', login('dsh', PASSWORD))
        expect(cooled.status).toBe(429)
        expect(reply(cooled).message).toBe(withSeconds(authEn.tooManyAttempts, seconds))
        // A different client address, and a different account, each keep their own wait.
        const elsewhere = await host.serve('login', request({
          body: { username: 'dsh', password: PASSWORD },
          contentType: 'application/json',
          address: '10.0.0.8',
        }))
        expect(elsewhere.status).toBe(200)
        expect((await host.serve('login', login('other', PASSWORD))).status).toBe(401)
        expect((await host.serve('login', login('dsh', PASSWORD))).status).toBe(429)
        await host.serve('login', login('dsh', 'wrong-password'))
        await vi.advanceTimersByTimeAsync(seconds * 1000)
      }
      const recovered = await host.serve('login', login('dsh', PASSWORD))
      expect(recovered.status).toBe(200)
      expect(reply(recovered)).toEqual({ ok: true })
    } finally {
      vi.useRealTimers()
    }
  })

  it('caps the wait at the longest step and clears it on success', () => {
    const throttle = new LoginThrottle()
    const now = Date.UTC(2026, 10, 9)
    const delays: number[] = []
    for (let attempt = 0; attempt < 8; attempt += 1) {
      delays.push(throttle.recordFailure('dsh', now))
      expect(throttle.retryAfterMs('dsh', now)).toBe(delays[attempt])
    }
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000])
    expect(throttle.retryAfterMs('other', now)).toBe(0)
    expect(throttle.retryAfterMs('dsh', now + 29_000)).toBe(1_000)
    throttle.recordSuccess('dsh')
    expect(throttle.retryAfterMs('dsh', now)).toBe(0)
  })
})

describe('sign-out and session loss', () => {
  it('expires only the browser cookie of the addressed authority', async () => {
    const host = await harness({ password: PASSWORD, secure: true })
    const signed = await host.serve('login', login('dsh', PASSWORD))
    const cookie = cookieOf(signed)
    expect(host.auth.isAuthenticated({ headers: { host: AUTHORITY, cookie } }, true)).toBe(true)
    const out = await host.serve('logout', request({ cookie }))
    expect(out.status).toBe(200)
    expect(out.headers?.['set-cookie']).toContain('Max-Age=0')
    expect(out.headers?.['set-cookie']).toContain('; Secure')
    expect(host.auth.isAuthenticated({ headers: { host: AUTHORITY, cookie } }, true)).toBe(true)
    expect(host.auth.isAuthenticated({ headers: { host: AUTHORITY, cookie: cookieOf(out) } }, true)).toBe(false)
  })

  it('drops sessions signed before the password changed', async () => {
    const store = new RecordCredentials()
    const host = await harness({ store })
    const cookie = cookieOf(await host.serve('setup', login('dsh', PASSWORD)))
    expect(host.auth.isAuthenticated({ headers: { host: AUTHORITY, cookie } })).toBe(true)
    // A reset clears the record before the new secret is stored.
    await store.deleteRecord(PASSWORD_KEY)
    const changed = new PasswordStore(store as never, 'dsh')
    expect(await changed.setup('dsh', 'replacement-password-1')).toBe('created')
    const restarted = await BrowserAuth.create({}, store as never, 30, changed)
    expect(restarted.isAuthenticated({ headers: { host: AUTHORITY, cookie } })).toBe(false)
    expect(restarted.isAuthenticated({
      headers: { host: AUTHORITY, cookie: pair(restarted.issueBrowserCookie(AUTHORITY, changed.epoch, false)) },
    })).toBe(true)
  })
})

describe('request shape and the shared fence', () => {
  it('refuses a request that names no authority', async () => {
    const host = await harness({ password: PASSWORD })
    const sent = await host.serve('logout', request({ headers: { host: undefined } }))
    expect(sent.status).toBe(400)
    expect(reply(sent).message).toBe(authEn.requestFailed)
  })

  it('refuses the fence verdict before reading anything else', async () => {
    for (const rejection of [401, 403] as const) {
      const host = await harness({ password: PASSWORD, rejection })
      const sent = await host.serve('login', login('dsh', PASSWORD))
      expect([sent.status, sent.body]).toEqual([rejection, rejection === 401 ? 'unauthorized' : 'forbidden'])
    }
  })

  it('answers only POST with a small JSON body', async () => {
    const host = await harness({ password: PASSWORD })
    expect(await host.serve('login', request({ method: 'GET' }))).toMatchObject({
      status: 405,
      headers: { allow: 'POST' },
    })
    expect((await host.serve('login', request({ body: 'x{', contentType: 'application/json' }))).status).toBe(400)
    expect((await host.serve('login', request({ body: { username: 'dsh' }, contentType: 'application/json' }))).status).toBe(400)
    expect((await host.serve('login', request({ body: { address: 'x', username: 'dsh', password: PASSWORD }, contentType: 'application/json' }))).status).toBe(400)
    expect((await host.serve('login', request({ body: 'unused', contentType: 'text/plain' }))).status).toBe(415)
    expect((await host.serve('login', request({ body: 'unused' }))).status).toBe(415)
  })

  it('refuses bodies larger than the sign-in budget', async () => {
    const declared = await harness({ password: PASSWORD })
    expect((await declared.serve('login', request({
      body: '',
      contentType: 'application/json',
      headers: { 'content-length': String(MAX_AUTH_REQUEST_BODY_BYTES + 1) },
    }))).status).toBe(413)
    const streamed = await harness({ password: PASSWORD })
    expect((await streamed.serve('login', request({
      body: JSON.stringify({ username: 'dsh', password: 'x'.repeat(MAX_AUTH_REQUEST_BODY_BYTES) }),
      contentType: 'application/json',
    }))).status).toBe(413)
  })
})

describe('page copy and rendering', () => {
  it('selects a supported language and falls back to English', () => {
    expect(authMessagesFor(undefined)).toBe(authEn)
    expect(authMessagesFor('*')).toBe(authEn)
    expect(authMessagesFor('zh-CN,zh;q=0.9')).toBe(authMessagesFor('zh'))
    expect(authMessagesFor('  ja ').language).toBe('ja')
    expect(authMessagesFor('sw, ha').language).toBe('en')
    expect(Object.keys(authMessagesFor('ru')).sort()).toEqual(Object.keys(authEn).sort())
  })

  it('escapes copy into the document and marks a plain listener', () => {
    const plain = renderAuthPage({ ...authEn, title: 'A & B <c> "d"' }, 'sign-in', '"user" <1>', false)
    expect(plain).toContain('A &amp; B &lt;c&gt; &quot;d&quot;')
    expect(plain).toContain('value="&quot;user&quot; &lt;1&gt;"')
    expect(plain).toContain(authEn.insecureNotice)
    expect(plain).toContain('autocomplete="current-password"')
    const tls = renderAuthPage(authEn, 'set-password', 'dsh', true)
    expect(tls).not.toContain(authEn.insecureNotice)
    expect(tls).toContain('autocomplete="new-password"')
  })
})

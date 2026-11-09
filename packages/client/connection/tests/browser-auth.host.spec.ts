/** Browser launch-token and persistent-cookie behavior. */

import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { PeerId } from '@deepseek-ai/dsh-typert-protocol'
import { BrowserAuth, LAUNCH_EPOCH } from '../src/browser-auth.ts'
import { PasswordStore } from '../src/password-record.ts'
import type { ConnectionIndexRequest, ConnectionIndexResponse } from '../src/rpc.ts'
import { BROWSER_SESSION_KEY, RecordCredentials } from './browser-credentials.ts'

function signedCookie(store: RecordCredentials, name: string, payload: unknown, version = 3): string {
  const body = typeof payload === 'string'
    ? Buffer.from(payload, 'utf8').toString('base64url')
    : Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return signedBodyCookie(store, name, body, version)
}

function signedBodyCookie(store: RecordCredentials, name: string, body: string, version = 3): string {
  const record = store.record
  if (record?.kind !== 'grant' || typeof record.payload !== 'object' || record.payload === null) {
    throw new Error('test credential store has no signing secret')
  }
  const secret: unknown = Reflect.get(record.payload, 'secret')
  if (typeof secret !== 'string') throw new Error('test credential record has no string secret')
  const signature = createHmac('sha256', Buffer.from(secret, 'base64url')).update(body).digest('base64url')
  return `${name}=v${String(version)}.${body}.${signature}`
}

interface ResponseState {
  status?: number
  headers?: Readonly<Record<string, string>>
  body?: string
}

function response(): { value: ConnectionIndexResponse; state: ResponseState } {
  const state: ResponseState = {}
  return {
    value: {
      writeHead(status, headers) {
        state.status = status
        if (headers !== undefined) state.headers = headers
      },
      end(body) {
        if (body !== undefined) state.body = body
      },
    },
    state,
  }
}

function credentials(store: RecordCredentials): CredentialProvider {
  return store as unknown as CredentialProvider
}

async function createAuth(
  store: RecordCredentials,
  maxAgeDays = 30,
  processOwner: object = {},
  password?: { username: string; password: string },
): Promise<BrowserAuth> {
  const provider = credentials(store)
  const passwords = new PasswordStore(provider, 'dsh')
  if (password === undefined) await passwords.load()
  else await passwords.setup(password.username, password.password)
  return BrowserAuth.create(processOwner, provider, maxAgeDays, passwords)
}

function request(url: string, authority = '127.0.0.1:3080', init?: {
  cookie?: string
  method?: string
}): ConnectionIndexRequest {
  return {
    method: init?.method ?? 'GET',
    url,
    headers: {
      host: authority,
      ...init?.cookie === undefined ? {} : { cookie: init.cookie },
    },
  }
}

function exchange(
  auth: BrowserAuth,
  authority = '127.0.0.1:3080',
  secure = false,
): { cookie: string; launchUrl: string; state: ResponseState } {
  const launchUrl = auth.authenticatedUrl(`http://${authority}`)
  const target = new URL(launchUrl)
  const res = response()
  expect(auth.authorizeIndex(request(`${target.pathname}${target.search}`, authority), res.value, secure)).toBe(false)
  const setCookie = res.state.headers?.['set-cookie']
  if (setCookie === undefined) throw new Error('token exchange did not set a cookie')
  return { cookie: setCookie.split(';', 1)[0]!, launchUrl, state: res.state }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('API credentials', () => {
  it('refuses a request without a URL before publishing an API operator', async () => {
    const auth = await createAuth(new RecordCredentials())
    const publish = vi.fn(() => 'api-operator' as PeerId)
    const res = response()

    auth.authorizeConnect({ method: 'GET', headers: { host: 'localhost' } }, res.value, false, publish)

    expect(res.state).toEqual({
      status: 401,
      headers: { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' },
      body: 'dsh web authentication required; open the sign-in page.\n',
    })
    expect(publish).not.toHaveBeenCalled()
  })

  it('signs the published id and rejects browser confusion, tampering, audience mismatch, and expiry', async () => {
    vi.useFakeTimers()
    const store = new RecordCredentials()
    const auth = await createAuth(store)
    const authority = '127.0.0.1:3080'
    const id = 'api-operator' as PeerId
    const issuedAt = Date.now()
    const publish = vi.fn(() => id)
    const res = response()
    auth.authorizeConnect(request(auth.authenticatedUrl(`http://${authority}/connect`)), {
      ...res.value,
      writeHead(status, headers) {
        expect(publish).toHaveBeenCalledExactlyOnceWith('none')
        return res.value.writeHead(status, headers)
      },
    }, false, publish)
    const cookie = res.state.headers?.['set-cookie']?.split(';', 1)[0]
    if (cookie === undefined) throw new Error('API connect did not set a cookie')
    const [name, value] = cookie.split('=') as [string, string]
    const payload = { version: 2, authority, id, issuedAt, expiresAt: issuedAt + 30 * 86_400_000 }
    expect(JSON.parse(Buffer.from(value.split('.')[1]!, 'base64url').toString('utf8'))).toEqual(payload)
    expect(auth.authenticateApi(request('/', authority, { cookie }))).toBe(id)
    expect(auth.isAuthenticated(request('/', authority, { cookie }))).toBe(false)
    expect(auth.authenticateApi(request('/', authority, { cookie: exchange(auth).cookie }))).toBeUndefined()
    expect(auth.isAuthenticated(request('/', authority, { cookie: cookie.replace('=v2.', '=v1.') }))).toBe(false)
    expect(auth.authenticateApi(request('/', authority, { cookie: `${cookie.slice(0, -1)}!` }))).toBeUndefined()
    expect(auth.authenticateApi(request('/', 'localhost:3080', { cookie }))).toBeUndefined()
    expect(auth.authenticateApi(request('/', '127.0.0.1:3081', { cookie }))).toBeUndefined()
    expect(auth.authenticateApi(request('/', authority, { cookie }), true)).toBeUndefined()
    for (const invalid of [
      { ...payload, version: 3 },
      { ...payload, authority: 'localhost:3080' },
      { ...payload, id: '' },
      { ...payload, id: 42 },
      { ...payload, id: undefined },
      { ...payload, issuedAt: issuedAt + 1 },
      { ...payload, issuedAt: 0.5 },
      { ...payload, expiresAt: 'later' },
      { ...payload, expiresAt: issuedAt - 1 },
    ]) {
      const invalidCookie = signedCookie(store, name, invalid, 2)
      expect(auth.authenticateApi(request('/', authority, { cookie: invalidCookie }))).toBeUndefined()
      expect(auth.isAuthenticated(request('/', authority, { cookie: invalidCookie }))).toBe(false)
    }
    // A pre-password v1 browser cookie carries no generation and is refused.
    const v1Parts = value.split('.')
    expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', {
      cookie: `${name}=v1.${v1Parts[1]}.${v1Parts[2]}`,
    }))).toBe(false)

    const shorter = await createAuth(store, 1)
    expect(shorter.authenticateApi(request('/', authority, { cookie }))).toBeUndefined()
    vi.setSystemTime(payload.expiresAt)
    expect(auth.authenticateApi(request('/', authority, { cookie }))).toBeUndefined()
  })
})

describe('BrowserAuth', () => {
  it('mints one process token and a persistent authority-bound cookie', async () => {
    const store = new RecordCredentials()
    const processOwner = {}
    const first = await createAuth(store, 30, processOwner)
    const login = exchange(first)

    expect(login.state).toMatchObject({
      status: 303,
      headers: {
        'cache-control': 'no-store',
        'location': './',
        'referrer-policy': 'no-referrer',
      },
    })
    expect(login.state.headers?.['set-cookie']).toMatch(/; Max-Age=2592000; Expires=.*; Path=\/; HttpOnly; SameSite=Strict$/u)
    expect(login.state.headers?.['set-cookie']).not.toContain('Secure')
    expect(first.isAuthenticated(request('/', '127.0.0.1:3080', { cookie: login.cookie }))).toBe(true)
    expect(first.isAuthenticated({
      headers: new Headers({ host: '127.0.0.1:3080', cookie: login.cookie }),
    })).toBe(true)
    expect(first.isAuthenticated({ headers: new Headers() })).toBe(false)
    expect(first.isAuthenticated(request('/', 'localhost:3080', { cookie: login.cookie }))).toBe(false)
    expect(first.isAuthenticated(request('/', '127.0.0.1:3081', { cookie: login.cookie }))).toBe(false)

    const reloaded = await createAuth(store, 30, processOwner)
    expect(reloaded.authenticatedUrl('http://127.0.0.1:3080')).toBe(login.launchUrl)
    expect(reloaded.isAuthenticated(request('/', '127.0.0.1:3080', { cookie: login.cookie }))).toBe(true)

    const restarted = await createAuth(store)
    expect(new URL(restarted.authenticatedUrl('http://127.0.0.1:3080')).searchParams.get('token'))
      .not.toBe(new URL(login.launchUrl).searchParams.get('token'))
    expect(restarted.isAuthenticated(request('/', '127.0.0.1:3080', { cookie: login.cookie }))).toBe(true)
    const staleUrl = new URL(login.launchUrl)
    const redirected = response()
    expect(restarted.authorizeIndex(request(
      `${staleUrl.pathname}${staleUrl.search}`,
      '127.0.0.1:3080',
      { cookie: login.cookie },
    ), redirected.value)).toBe(false)
    expect(redirected.state).toEqual({
      status: 303,
      headers: {
        'cache-control': 'no-store',
        'location': './',
        'referrer-policy': 'no-referrer',
      },
    })
  })

  it('keeps HTTPS port 443 distinct from HTTP port 80 with one signing secret', async () => {
    const auth = await createAuth(new RecordCredentials())
    const plain = exchange(auth, 'harness.example')
    const tls = exchange(auth, 'harness.example', true)
    expect(auth.isAuthenticated(request('/', 'harness.example', { cookie: plain.cookie }), true)).toBe(false)
    expect(auth.isAuthenticated(request('/', 'harness.example', { cookie: tls.cookie }), true)).toBe(true)
    expect(auth.isAuthenticated(request('/', 'harness.example:443', { cookie: tls.cookie }), true)).toBe(true)
    expect(auth.isAuthenticated(request('/', 'harness.example', { cookie: tls.cookie }))).toBe(false)
  })

  it('rejects HTTP cookie replay after enabling TLS on the same authority', async () => {
    const store = new RecordCredentials()
    const authority = 'harness.example:3080'
    const plain = exchange(await createAuth(store), authority)
    const restarted = await createAuth(store)
    const denied = response()
    expect(restarted.authorizeIndex(request('/', authority, { cookie: plain.cookie }), denied.value, true)).toBe(false)
    // An audience-mismatched cookie is not authentication: the index answers with the page.
    expect(denied.state.status).toBe(200)

    const tls = exchange(restarted, authority, true)
    expect(tls.state.headers?.['set-cookie']).toContain('; Secure')
    expect(restarted.isAuthenticated(request('/', authority, { cookie: tls.cookie }), true)).toBe(true)
    expect(restarted.isAuthenticated(request('/', authority, { cookie: tls.cookie }))).toBe(false)
    const tlsName = tls.cookie.slice(0, tls.cookie.indexOf('='))
    const plainValue = plain.cookie.slice(plain.cookie.indexOf('=') + 1)
    expect(restarted.isAuthenticated(request('/', authority, { cookie: `${tlsName}=${plainValue}` }), true)).toBe(false)
  })

  it('preserves the caller authority and mount while adding only this process token', async () => {
    const auth = await createAuth(new RecordCredentials())
    const mounted = new URL(auth.authenticatedUrl('https://gateway.example/tools/dsh/'))
    expect(mounted.origin).toBe('https://gateway.example')
    expect(mounted.pathname).toBe('/tools/dsh/')
    expect([...mounted.searchParams.keys()]).toEqual(['token'])

    const loopback = new URL(auth.authenticatedUrl('http://127.0.0.1:3080/'))
    expect(loopback.origin).toBe('http://127.0.0.1:3080')
    expect(loopback.pathname).toBe('/')
    expect(loopback.searchParams.get('token')).toBe(mounted.searchParams.get('token'))

    // The proxy preserves the browser-facing Host and strips the mount.
    const token = mounted.searchParams.get('token')
    const exchanged = response()
    expect(auth.authorizeIndex(request(`/?token=${String(token)}`, 'gateway.example'), exchanged.value)).toBe(false)
    const setCookie = exchanged.state.headers?.['set-cookie']
    if (setCookie === undefined) throw new Error('mount exchange did not set a cookie')
    expect(auth.isAuthenticated(request(
      '/', 'gateway.example', { cookie: setCookie.split(';', 1)[0]! },
    ))).toBe(true)
  })

  it('answers an unauthenticated index request with the sign-in or setup page', async () => {
    const store = new RecordCredentials()
    const guest = await createAuth(store)
    const setUp = response()
    expect(guest.authorizeIndex(request('/'), setUp.value)).toBe(false)
    expect(setUp.state.status).toBe(200)
    expect(setUp.state.headers).toEqual({
      'cache-control': 'no-store',
      'content-type': 'text/html; charset=utf-8',
      'referrer-policy': 'no-referrer',
    })
    expect(String(setUp.state.body)).toContain('<!doctype html>')
    expect(String(setUp.state.body)).toContain('action="auth/setup"')

    const member = await createAuth(store, 30, {}, { username: 'dsh', password: 'long-enough-password' })
    const signIn = response()
    expect(member.authorizeIndex(request('/'), signIn.value)).toBe(false)
    expect(String(signIn.state.body)).toContain('action="auth/login"')
    expect(String(signIn.state.body)).not.toContain('action="auth/setup"')

    const german = response()
    expect(member.authorizeIndex({
      method: 'GET',
      url: '/',
      headers: { host: '127.0.0.1:3080', 'accept-language': 'de-DE,de;q=0.9' },
    }, german.value)).toBe(false)
    expect(String(german.state.body)).toContain('lang="de"')

    const tlsPage = response()
    expect(member.authorizeIndex(request('/'), tlsPage.value, true)).toBe(false)
    expect(String(tlsPage.state.body)).not.toContain('is not encrypted')
    expect(String(setUp.state.body)).toContain('not encrypted')
  })

  it('accepts the cookie for index serving and gives every unauthenticated request one response', async () => {
    const auth = await createAuth(new RecordCredentials())
    const { cookie } = exchange(auth)
    const allowed = response()
    expect(auth.authorizeIndex(request('/index.html', '127.0.0.1:3080', { cookie }), allowed.value)).toBe(true)
    expect(allowed.state).toEqual({})

    for (const candidate of [
      request('/?token=wrong'),
      request('/?token=wrong&token=again'),
      request('/index.html?token=wrong'),
      request(auth.authenticatedUrl('http://127.0.0.1:3080'), '127.0.0.1:3080', { method: 'HEAD' }),
    ]) {
      const denied = response()
      expect(auth.authorizeIndex(candidate, denied.value)).toBe(false)
      expect(denied.state.status).toBe(401)
      expect(denied.state.headers).toEqual({
        'cache-control': 'no-store',
        'content-type': 'text/plain; charset=utf-8',
      })
      expect(denied.state.body).toBe(candidate.method === 'HEAD'
        ? undefined
        : 'dsh web authentication required; open the sign-in page.\n')
    }
  })

  it('rejects tampering, expiry, future issuance, and a longer lifetime than configured', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-24T00:00:00.000Z'))
    const store = new RecordCredentials()
    const auth = await createAuth(store)
    const { cookie } = exchange(auth)
    const [name, value] = cookie.split('=') as [string, string]

    expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', { cookie: `${name}=broken` }))).toBe(false)
    expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', { cookie: `${name}=${value.slice(0, -1)}x` }))).toBe(false)
    expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', { cookie: `${name}=%` }))).toBe(false)
    expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', {
      cookie: signedBodyCookie(store, name, 'a'),
    }))).toBe(false)
    expect(auth.isAuthenticated({ headers: {} })).toBe(false)
    expect(auth.isAuthenticated({ headers: { host: 'bad host', cookie } })).toBe(false)
    expect(auth.isAuthenticated({ headers: { host: '127.0.0.1:3080' } })).toBe(false)

    const invalidPayloads: unknown[] = [
      'not json',
      null,
      // A browser cookie without the password generation is unreadable.
      { version: 3, authority: '127.0.0.1:3080', issuedAt: Date.now(), expiresAt: Date.now() + 1000 },
      { version: 3, authority: 42, issuedAt: Date.now(), expiresAt: Date.now() + 1000, epoch: 'launch' },
      { version: 3, authority: '127.0.0.1:3080', issuedAt: 'now', expiresAt: Date.now() + 1000, epoch: 'launch' },
      { version: 3, authority: '127.0.0.1:3080', issuedAt: Date.now(), expiresAt: 'later', epoch: 'launch' },
      { version: 3, authority: '127.0.0.1:3080', issuedAt: Date.now(), expiresAt: Date.now() + 1000, epoch: '' },
      { version: 3, authority: '127.0.0.1:3080', issuedAt: Date.now(), expiresAt: Date.now() + 1000, epoch: 42 },
    ]
    for (const payload of invalidPayloads) {
      expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', {
        cookie: signedCookie(store, name, payload),
      }))).toBe(false)
    }

    const shorter = await createAuth(store, 1)
    expect(shorter.isAuthenticated(request('/', '127.0.0.1:3080', { cookie }))).toBe(false)
    vi.setSystemTime(new Date('2026-09-24T00:00:00.000Z'))
    expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', { cookie }))).toBe(false)
    vi.setSystemTime(new Date('2026-08-23T00:00:00.000Z'))
    expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', { cookie }))).toBe(false)
  })

  it('loads one secret per activation and replaces it after deletion on the next activation', async () => {
    const store = new RecordCredentials()
    const auth = await createAuth(store)
    const first = exchange(auth)
    expect(store).toMatchObject({ reads: 0, modifies: 1 })

    await store.deleteRecord(BROWSER_SESSION_KEY)
    expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', { cookie: first.cookie }))).toBe(true)
    const sameActivation = exchange(auth)
    expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', { cookie: sameActivation.cookie }))).toBe(true)
    expect(store).toMatchObject({ reads: 0, modifies: 1 })

    const reactivated = await createAuth(store)
    const second = exchange(reactivated)
    expect(second.cookie).not.toBe(first.cookie)
    expect(reactivated.isAuthenticated(request('/', '127.0.0.1:3080', { cookie: first.cookie }))).toBe(false)
    expect(reactivated.isAuthenticated(request('/', '127.0.0.1:3080', { cookie: second.cookie }))).toBe(true)
    expect(store).toMatchObject({ reads: 0, modifies: 2 })
  })

  it('fails loud on an invalid owner record instead of replacing it', async () => {
    const unsupported = new RecordCredentials()
    unsupported.record = { kind: 'api-key', key: 'not-a-cookie-secret' }
    await expect(createAuth(unsupported)).rejects.toThrow(/unsupported format/u)

    const malformed = new RecordCredentials()
    malformed.record = { kind: 'grant', payload: { version: 1, secret: 'short' } }
    await expect(createAuth(malformed)).rejects.toThrow(/invalid secret/u)

    const nonString = new RecordCredentials()
    nonString.record = { kind: 'grant', payload: { version: 1, secret: 42 } }
    await expect(createAuth(nonString)).rejects.toThrow(/invalid secret/u)

    const discarded = new RecordCredentials()
    discarded.discardWrites = true
    await expect(createAuth(discarded)).rejects.toThrow(/was not created/u)

    await expect(createAuth(new RecordCredentials(), Number.MAX_SAFE_INTEGER))
      .rejects.toThrow(/safe timestamp range/u)
  })
})
const ACCOUNT_PASSWORD = 'correct-horse-battery'

/** The name and value pair of one Set-Cookie string, without its attributes. */
function cookiePair(setCookie: string): string {
  return setCookie.split(';', 1)[0]!
}

describe('password session generations', () => {
  it('drops password cookies on a rotation and keeps launch cookies', async () => {
    const store = new RecordCredentials()
    const provider = credentials(store)
    const passwords = new PasswordStore(provider, 'dsh')
    await passwords.setup('dsh', ACCOUNT_PASSWORD)
    const auth = await BrowserAuth.create({}, provider, 30, passwords)
    const signed = cookiePair(auth.issueBrowserCookie('127.0.0.1:3080', passwords.epoch, false))
    const launched = cookiePair(auth.issueBrowserCookie('127.0.0.1:3080', LAUNCH_EPOCH, false))
    expect(auth.browserSession(request('/', '127.0.0.1:3080', { cookie: signed })).kind).toBe('password')
    expect(auth.browserSession(request('/', '127.0.0.1:3080', { cookie: launched })).kind).toBe('launch')
    // A request with no accepted cookie reports no expiry rather than a false date.
    expect(auth.browserSession(request('/', '127.0.0.1:3080', { cookie: 'other=value' })))
      .toEqual({ kind: 'password', expiresAt: 0 })
    const before = passwords.epoch
    expect(await passwords.rotateSession()).toBe(true)
    expect(passwords.epoch).not.toBe(before)
    expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', { cookie: signed }))).toBe(false)
    // A desktop host or machine client that traded the launch token keeps its session.
    expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', { cookie: launched }))).toBe(true)
    const renewed = cookiePair(auth.issueBrowserCookie('127.0.0.1:3080', passwords.epoch, false))
    expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', { cookie: renewed }))).toBe(true)
  })

  it('dates a remembered sign-in and leaves the other to the browser', async () => {
    const store = new RecordCredentials()
    const passwords = new PasswordStore(credentials(store), 'dsh')
    await passwords.setup('dsh', ACCOUNT_PASSWORD)
    const auth = await BrowserAuth.create({}, credentials(store), 30, passwords)
    const dated = auth.issueBrowserCookie('127.0.0.1:3080', passwords.epoch, true)
    expect(dated).toContain('Max-Age=2592000')
    expect(dated).toContain('; Secure')
    const brief = auth.issueBrowserCookie('127.0.0.1:3080', passwords.epoch, false, false)
    expect(brief).not.toContain('Max-Age')
    expect(brief).not.toContain('Expires')
    expect(brief).toContain('Path=/; HttpOnly; SameSite=Strict')
    expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', {
      cookie: cookiePair(brief),
    }))).toBe(true)
  })
})

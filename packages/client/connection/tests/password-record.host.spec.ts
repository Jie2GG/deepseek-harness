/** Durable browser login secret: digests, record parsing, and session rotation. */

import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { CredentialProvider, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { isUsablePassword, isUsableUsername, PasswordStore } from '../src/password-record.ts'
import { RecordCredentials } from './browser-credentials.ts'

const PASSWORD = 'correct-horse-battery'
const GOOD_PREFIX = 'scrypt$16384$8$1$'

/** The record view the local provider keeps for the password key. */
function provider(store: RecordCredentials): CredentialProvider {
  return store as never
}

function digestOf(record: CredentialRecord | undefined): string {
  if (record === undefined || record.kind !== 'grant') throw new Error('no password record stored')
  const payload = record.payload as { digest: string }
  return payload.digest
}

/** A store holding one password record with the given payload. */
function storedAs(payload: unknown): RecordCredentials {
  const store = new RecordCredentials()
  store.passwordRecord = { kind: 'grant', payload }
  return store
}

describe('account names and passwords', () => {
  it('refuses names the record cannot hold and passwords outside the length range', () => {
    expect(isUsableUsername('dsh')).toBe(true)
    expect(isUsableUsername('  padded  ')).toBe(true)
    expect(isUsableUsername('')).toBe(false)
    expect(isUsableUsername('    ')).toBe(false)
    expect(isUsableUsername('x'.repeat(129))).toBe(false)
    expect(isUsableUsername('line\nbreak')).toBe(false)
    expect(isUsableUsername('bell\u0007name')).toBe(false)
  })

  it('bounds the password length it will store', () => {
    expect(isUsablePassword(PASSWORD)).toBe(true)
    expect(isUsablePassword('7chars!')).toBe(false)
    expect(isUsablePassword('x'.repeat(257))).toBe(false)
  })
})

describe('stored secret', () => {
  it('loads the record and answers with its generation', async () => {
    const store = new RecordCredentials()
    const passwords = new PasswordStore(provider(store), 'dsh')
    await passwords.load()
    expect(passwords.isSet).toBe(false)
    expect(passwords.epoch).toBe('')
    expect(passwords.accountName).toBe('dsh')
    expect(await passwords.verify('dsh', PASSWORD)).toBe(false)

    expect(await passwords.setup('dsh', PASSWORD)).toBe('created')
    expect(digestOf(store.passwordRecord).startsWith(GOOD_PREFIX)).toBe(true)
    const stored = new PasswordStore(provider(store), 'configured-but-not-reported')
    await stored.load()
    expect(stored.epoch).toBe(passwords.epoch)
    expect(stored.accountName).toBe('dsh')
    expect(await stored.verify('dsh', PASSWORD)).toBe(true)
    expect(await stored.verify(' someone', PASSWORD)).toBe(false)
    expect(await stored.verify('dsh', 'wrong-but-long-enough')).toBe(false)
    expect(await passwords.setup('dsh', 'second-password-here')).toBe('already-set')
    expect(await passwords.verify('dsh', PASSWORD)).toBe(true)
  })

  it('rejects a record it cannot interpret', async () => {
    const apiKeys = new RecordCredentials()
    apiKeys.passwordRecord = { kind: 'api-key', key: 'x' }
    await expect(new PasswordStore(provider(apiKeys), 'dsh').load()).rejects.toThrow(/unsupported format/u)

    for (const payload of [
      'not-an-object',
      { version: 2, username: 'dsh', digest: 'scrypt$16384$8$1$abc$def' },
      { version: 1, username: 7, digest: 'scrypt$16384$8$1$abc$def' },
      { version: 1, username: 'dsh', digest: 'plain$16384$8$1$abc$def' },
      { version: 1, username: 'dsh', digest: 'sha256$16384$8$1$abc$def' },
      { version: 1, username: '   ', digest: 'scrypt$16384$8$1$abc$def' },
      { version: 3, username: 'dsh', digest: 'scrypt$16384$8$1$abc$def', sessionEpoch: 'x' },
    ]) {
      await expect(new PasswordStore(provider(storedAs(payload)), 'dsh').load())
        .rejects.toThrow(/password credential record/u)
    }
  })

  it('refuses digests whose recorded parameters or bytes are unusable', async () => {
    const store = new RecordCredentials()
    const passwords = new PasswordStore(provider(store), 'dsh')
    await passwords.setup('dsh', PASSWORD)
    const parts = digestOf(store.passwordRecord).split('$')
    const tampered: readonly string[] = [
      'scrypt$',
      ['scrypt', '2048', '8', '1', parts[4]!, parts[5]!].join('$'),
      ['scrypt', '16384', '9', '1', parts[4]!, parts[5]!].join('$'),
      ['scrypt', '16384', '8', '2', parts[4]!, parts[5]!].join('$'),
      ['scrypt', '16384', '8', '1', 'ab', parts[5]!].join('$'),
      ['scrypt', '16384', '8', '1', parts[4]!, 'ab'].join('$'),
    ]
    for (const digest of tampered) {
      const probed = new PasswordStore(provider(storedAs({ version: 1, username: 'dsh', digest })), 'dsh')
      await probed.load()
      expect(await probed.verify('dsh', PASSWORD)).toBe(false)
    }
  })
})
/** Generation a version-1 record pins: the digest of that record exactly as stored. */
function legacyEpoch(digest: string): string {
  const payload = { version: 1, username: 'dsh', digest }
  return createHash('sha256').update(JSON.stringify(payload)).digest().subarray(0, 8).toString('base64url')
}

/** The stored payload behind one credential record. */
function payloadOf(record: CredentialRecord | undefined): Record<string, unknown> {
  if (record === undefined || record.kind !== 'grant') throw new Error('no password record stored')
  return record.payload as Record<string, unknown>
}

describe('session generations', () => {
  it('keeps a version-1 record usable and upgrades it only when the session rotates', async () => {
    const written = new RecordCredentials()
    const author = new PasswordStore(provider(written), 'dsh')
    await author.setup('dsh', PASSWORD)
    const store = storedAs({ version: 1, username: 'dsh', digest: digestOf(written.passwordRecord) })
    const passwords = new PasswordStore(provider(store), 'dsh')
    await passwords.load()
    expect(passwords.isSet).toBe(true)
    expect(await passwords.verify('dsh', PASSWORD)).toBe(true)
    // An upgrade signs nobody out: the generation still comes from the stored record.
    expect(passwords.epoch).toBe(legacyEpoch(digestOf(store.passwordRecord)))
    expect(await passwords.rotateSession()).toBe(true)
    const upgraded = payloadOf(store.passwordRecord)
    expect(upgraded.version).toBe(2)
    expect(typeof upgraded.sessionEpoch).toBe('string')
    expect(upgraded.digest).toBe(digestOf(written.passwordRecord))
    expect(passwords.epoch).not.toBe(legacyEpoch(digestOf(store.passwordRecord)))
    expect(await passwords.verify('dsh', PASSWORD)).toBe(true)
  })

  it('refuses a second session rotation once the record is gone', async () => {
    const store = new RecordCredentials()
    const passwords = new PasswordStore(provider(store), 'dsh')
    await passwords.load()
    expect(await passwords.rotateSession()).toBe(false)
    await passwords.setup('dsh', PASSWORD)
    store.discardWrites = true
    expect(await passwords.rotateSession()).toBe(false)
    expect(passwords.isSet).toBe(false)
  })
})

describe('changing the secret', () => {
  it('refuses a change whose current password does not match, and rewrites it otherwise', async () => {
    const store = new RecordCredentials()
    const passwords = new PasswordStore(provider(store), 'dsh')
    await passwords.setup('dsh', PASSWORD)
    const generation = passwords.epoch
    const before = store.passwordRecord
    expect(await passwords.change('not-the-password-1', 'dsh', 'fresh-horse-battery')).toBe('wrong-password')
    expect(store.passwordRecord).toBe(before)
    expect(passwords.epoch).toBe(generation)
    expect(await passwords.verify('dsh', PASSWORD)).toBe(true)
    const digest = digestOf(store.passwordRecord)
    expect(await passwords.change(PASSWORD, 'operator', 'fresh-horse-battery')).toBe('changed')
    expect(store.passwordRecord).not.toBe(before)
    expect(passwords.epoch).not.toBe(generation)
    expect(passwords.accountName).toBe('operator')
    expect(payloadOf(store.passwordRecord).version).toBe(2)
    expect(digestOf(store.passwordRecord)).not.toBe(digest)
    expect(await passwords.verify('dsh', PASSWORD)).toBe(false)
    expect(await passwords.verify('operator', 'fresh-horse-battery')).toBe(true)
  })

  it('reports no secret before one exists, and after the record vanished', async () => {
    const store = new RecordCredentials()
    const passwords = new PasswordStore(provider(store), 'dsh')
    expect(await passwords.change(PASSWORD, 'dsh', 'fresh-horse-battery')).toBe('unavailable')
    await passwords.setup('dsh', PASSWORD)
    // A rotation or change that races a deleted record leaves nothing pinned.
    store.passwordRecord = undefined
    expect(await passwords.rotateSession()).toBe(false)
    expect(passwords.isSet).toBe(false)
    await passwords.setup('dsh', PASSWORD)
    store.passwordRecord = undefined
    expect(await passwords.change(PASSWORD, 'dsh', 'fresh-horse-battery')).toBe('unavailable')
    expect(passwords.isSet).toBe(false)
    expect(await passwords.verify('dsh', PASSWORD)).toBe(false)
  })
})

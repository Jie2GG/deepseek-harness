/** Durable browser login secret: digests, record parsing, and the setup race. */

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

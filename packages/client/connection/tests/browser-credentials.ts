import type { Context } from '@deepseek-ai/cordis'
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'

/** Credential key the browser-session signing secret is stored under. */
export const BROWSER_SESSION_KEY = 'client-connection/browser-session'
/** Credential key the browser login secret is stored under. */
export const PASSWORD_KEY = 'client-connection/password'

/** Mutable credential-record doubles for Connection authentication tests. */
export class RecordCredentials {
  readonly records = new Map<string, CredentialRecord>()
  discardWrites = false
  reads = 0
  passwordReads = 0
  modifies = 0

  /** The browser-session record, the slot most of these tests manipulate. */
  get record(): CredentialRecord | undefined {
    return this.records.get(BROWSER_SESSION_KEY)
  }

  set record(next: CredentialRecord | undefined) {
    if (next === undefined) this.records.delete(BROWSER_SESSION_KEY)
    else this.records.set(BROWSER_SESSION_KEY, next)
  }

  /** The password record for the sign-in tests. */
  get passwordRecord(): CredentialRecord | undefined {
    return this.records.get(PASSWORD_KEY)
  }

  set passwordRecord(next: CredentialRecord | undefined) {
    if (next === undefined) this.records.delete(PASSWORD_KEY)
    else this.records.set(PASSWORD_KEY, next)
  }

  readRecord(key: unknown): Promise<CredentialRecord | undefined> {
    if (String(key) === BROWSER_SESSION_KEY) this.reads += 1
    else this.passwordReads += 1
    return Promise.resolve(this.records.get(String(key)))
  }

  async modifyRecord(
    key: unknown,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    this.modifies += 1
    const stored = String(key)
    const next = await mutate(this.records.get(stored))
    if (this.discardWrites) return undefined
    if (next !== undefined) this.records.set(stored, next)
    return this.records.get(stored)
  }

  deleteRecord(key: unknown): Promise<void> {
    this.records.delete(String(key))
    return Promise.resolve()
  }
}

/** Provide the record operations Connection needs during authentication setup. */
export function provideBrowserCredentials(ctx: Context): void {
  ctx.provide('credentials', new RecordCredentials() as never)
}

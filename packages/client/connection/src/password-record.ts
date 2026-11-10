/** Durable browser login secret: the scrypt digest, its record, and its generation. */

import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { credentialKey, type CredentialProvider, type CredentialRecord } from '@deepseek-ai/dsh-credentials'

/** Record that owns the single browser login secret for this Harness home. */
const PASSWORD_RECORD_KEY = credentialKey('client-connection', 'password')

/** Payload version this Harness build writes. */
const PASSWORD_RECORD_VERSION = 2
/** Payload version earlier builds wrote; it stays readable and cannot rotate sessions. */
const LEGACY_PASSWORD_RECORD_VERSION = 1
/** Protocol-fixed scrypt parameters; changing them invalidates every stored digest. */
const SCRYPT_COST = 16_384
const SCRYPT_BLOCK_SIZE = 8
const SCRYPT_PARALLELISM = 1
const SCRYPT_SALT_BYTES = 32
const SCRYPT_KEY_BYTES = 64
/** scrypt memory ceiling for one derivation, above the default Node applies. */
const SCRYPT_MAX_MEMORY_BYTES = 256 * 1024 * 1024
const SCRYPT_OPTIONS = {
  N: SCRYPT_COST,
  r: SCRYPT_BLOCK_SIZE,
  p: SCRYPT_PARALLELISM,
  maxmem: SCRYPT_MAX_MEMORY_BYTES,
} as const
/** Separator inside one stored digest; never part of a password or name. */
const DIGEST_SEPARATOR = '$'
/** Bytes of the stored record digest that seed the cookie generation. */
const EPOCH_BYTES = 8
/** Random bytes behind one session rotation. */
const SESSION_EPOCH_BYTES = 32
const MINIMUM_PASSWORD_CHARACTERS = 8
const MAXIMUM_PASSWORD_CHARACTERS = 256
const MAXIMUM_USERNAME_CHARACTERS = 128

/**
 * Derive one scrypt key with the protocol-fixed parameters.
 * @param password - plaintext bytes to stretch.
 * @param salt - per-record salt bytes.
 * @returns the derived key bytes.
 */
function scryptDerive(password: Buffer, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEY_BYTES, SCRYPT_OPTIONS, (error, derived) => {
      /* v8 ignore next 4 -- the fixed parameters always derive a key. */
      if (error !== null) {
        reject(error)
        return
      }
      resolve(Buffer.from(derived))
    })
  })
}

/** Owner-defined JSON inside the stored grant record. */
type PasswordPayload =
  | {
    /** Discriminant of a record an earlier build wrote. */
    readonly version: typeof LEGACY_PASSWORD_RECORD_VERSION
    /** Account name paired with the digest at the time it was set. */
    readonly username: string
    /** `scrypt$<cost>$<blockSize>$<parallelism>$<salt>$<digest>`, all base64url. */
    readonly digest: string
  }
  | {
    /** Discriminant the provider preserves for the owner. */
    readonly version: typeof PASSWORD_RECORD_VERSION
    /** Account name paired with the digest at the time it was set. */
    readonly username: string
    /** `scrypt$<cost>$<blockSize>$<parallelism>$<salt>$<digest>`, all base64url. */
    readonly digest: string
    /** Replaced whenever this Host must reject every password-signed browser session. */
    readonly sessionEpoch: string
  }

/** One parsed login secret together with the generation its readers pin. */
interface StoredPassword {
  readonly payload: PasswordPayload
  /** Cookie generation: changes whenever the record changes. */
  readonly epoch: string
}

/**
 * Reject account names that cannot round-trip through the signed record.
 * @param username - verbatim configured or submitted name.
 * @returns true when the name is non-empty after trimming and holds no control character.
 */
export function isUsableUsername(username: string): boolean {
  const trimmed = username.trim()
  if (trimmed.length === 0 || trimmed.length > MAXIMUM_USERNAME_CHARACTERS) return false
  for (const character of trimmed) {
    const code = character.charCodeAt(0)
    if (code < 0x20 || code === 0x7f) return false
  }
  return true
}

/**
 * Reject passwords this deployment will not store.
 * @param password - verbatim input from the login form.
 * @returns true when the length is inside the accepted range.
 */
export function isUsablePassword(password: string): boolean {
  return password.length >= MINIMUM_PASSWORD_CHARACTERS && password.length <= MAXIMUM_PASSWORD_CHARACTERS
}

/**
 * Digest one password with the protocol-fixed scrypt parameters.
 * @param password - verbatim input from the login form.
 * @returns the self-describing stored digest.
 */
async function deriveDigest(password: string): Promise<string> {
  const salt = randomBytes(SCRYPT_SALT_BYTES)
  const derived = await scryptDerive(Buffer.from(password, 'utf8'), salt)
  const fields = [
    'scrypt',
    String(SCRYPT_COST),
    String(SCRYPT_BLOCK_SIZE),
    String(SCRYPT_PARALLELISM),
    salt.toString('base64url'),
    derived.toString('base64url'),
  ]
  return fields.join(DIGEST_SEPARATOR)
}

/**
 * Compare one submitted password with a stored digest.
 * @param password - verbatim input from the login form.
 * @param digest - stored self-describing digest.
 * @returns true when the recorded parameters and the derived bytes both match.
 */
async function digestMatches(password: string, digest: string): Promise<boolean> {
  const fields = digest.split(DIGEST_SEPARATOR)
  if (fields.length !== 6 || fields[0] !== 'scrypt') return false
  const [, cost, blockSize, parallelism, encodedSalt, encodedDerived] = fields as [
    string, string, string, string, string, string,
  ]
  if (cost !== String(SCRYPT_COST) || blockSize !== String(SCRYPT_BLOCK_SIZE)
    || parallelism !== String(SCRYPT_PARALLELISM)) {
    return false
  }
  const salt = Buffer.from(encodedSalt, 'base64url')
  const expected = Buffer.from(encodedDerived, 'base64url')
  if (salt.byteLength !== SCRYPT_SALT_BYTES || expected.byteLength !== SCRYPT_KEY_BYTES) return false
  const derived = await scryptDerive(Buffer.from(password, 'utf8'), salt)
  return timingSafeEqual(expected, derived)
}

/**
 * Derive the cookie generation from one stored payload.
 * @param payload - the record payload exactly as stored.
 * @returns a short base64url digest prefix.
 */
function epochOf(payload: PasswordPayload): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest().subarray(0, EPOCH_BYTES).toString('base64url')
}

/**
 * Draw a fresh session generation.
 * @returns random bytes that make every earlier password-signed cookie fail to match.
 */
function newSessionEpoch(): string {
  return randomBytes(SESSION_EPOCH_BYTES).toString('base64url')
}

/** Whether one stored payload is a JSON object this parser can read. */
function isPayload(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read one credential record as a login secret.
 * @param record - stored record, or undefined when no password exists.
 * @returns the parsed secret, or undefined when no record exists.
 */
function parseRecord(record: CredentialRecord | undefined): StoredPassword | undefined {
  if (record === undefined) return undefined
  if (record.kind !== 'grant' || !isPayload(record.payload)) {
    throw new Error('client-connection: password credential record has an unsupported format')
  }
  const payload = record.payload
  if (payload.version !== PASSWORD_RECORD_VERSION && payload.version !== LEGACY_PASSWORD_RECORD_VERSION) {
    throw new Error('client-connection: password credential record has an unsupported format')
  }
  const { username, digest } = payload
  if (typeof username !== 'string' || typeof digest !== 'string'
    || !isUsableUsername(username) || !digest.startsWith(`scrypt${DIGEST_SEPARATOR}`)) {
    throw new Error('client-connection: password credential record has an invalid secret')
  }
  if (payload.version === LEGACY_PASSWORD_RECORD_VERSION) {
    // A version-1 record hashes to the generation its live cookies already carry,
    // so upgrading this build signs nobody out before the password or session changes.
    const legacy: PasswordPayload = { version: LEGACY_PASSWORD_RECORD_VERSION, username, digest }
    return { payload: legacy, epoch: epochOf(legacy) }
  }
  const sessionEpoch = payload.sessionEpoch
  if (typeof sessionEpoch !== 'string' || sessionEpoch.length === 0) {
    throw new Error('client-connection: password credential record has an invalid secret')
  }
  const parsed: PasswordPayload = { version: PASSWORD_RECORD_VERSION, username, digest, sessionEpoch }
  return { payload: parsed, epoch: epochOf(parsed) }
}

/**
 * The one login secret this Host accepts from a browser, when it exists.
 * The record loads during plugin activation so every request-time check stays
 * synchronous except for the scrypt derivation one submitted password needs.
 */
export class PasswordStore {
  private current: StoredPassword | undefined

  /**
   * @param credentials - provider owning the durable login record.
   * @param username - account name offered to a browser that has no record yet.
   */
  constructor(
    private readonly credentials: CredentialProvider,
    readonly username: string,
  ) {}

  /** Whether a login secret exists, which selects the setup form over the sign-in form. */
  get isSet(): boolean {
    return this.current !== undefined
  }

  /** Generation a password-signed cookie must carry. */
  get epoch(): string {
    return this.current?.epoch ?? ''
  }

  /** Account name of the stored record, or the configured name before setup. */
  get accountName(): string {
    return this.current?.payload.username ?? this.username
  }

  /**
   * Read the stored login secret, creating nothing.
   * @returns when the record has been loaded.
   */
  async load(): Promise<void> {
    this.current = parseRecord(await this.credentials.readRecord(PASSWORD_RECORD_KEY))
  }

  /**
   * Store the first login secret. Only the caller that wins the record race creates it.
   * @param username - account name to store.
   * @param password - plaintext to digest.
   * @returns `created` for the winner and `already-set` for every later caller.
   */
  async setup(username: string, password: string): Promise<'created' | 'already-set'> {
    const payload: PasswordPayload = {
      version: PASSWORD_RECORD_VERSION,
      username,
      digest: await deriveDigest(password),
      sessionEpoch: newSessionEpoch(),
    }
    const written = await this.credentials.modifyRecord(PASSWORD_RECORD_KEY, current =>
      current === undefined
        ? Promise.resolve({ kind: 'grant', payload } satisfies CredentialRecord)
        : Promise.resolve(undefined))
    const stored = parseRecord(written) ?? { payload, epoch: epochOf(payload) }
    this.current = stored
    return stored.payload.digest === payload.digest ? 'created' : 'already-set'
  }

  /**
   * Replace the login secret once the current one proves the caller's right.
   * The account name changes in the same write when the caller supplied a new one,
   * and the fresh session generation signs out every other password-signed browser.
   * @param currentPassword - plaintext as submitted, checked against the stored digest.
   * @param username - account name to store from now on.
   * @param password - plaintext to digest.
   * @returns `changed`, `wrong-password` when the current secret did not match, or
   * `unavailable` when this Host holds no secret to replace.
   */
  async change(
    currentPassword: string,
    username: string,
    password: string,
  ): Promise<'changed' | 'wrong-password' | 'unavailable'> {
    const stored = this.current
    if (stored === undefined) return 'unavailable'
    if (!await digestMatches(currentPassword, stored.payload.digest)) return 'wrong-password'
    const written = await this.writeRotated(username, await deriveDigest(password))
    this.current = written === undefined ? undefined : parseRecord(written)
    return written === undefined ? 'unavailable' : 'changed'
  }

  /**
   * Replace the session generation while leaving the password itself usable.
   * @returns true when a record existed to rotate; every earlier password-signed
   * cookie fails afterwards, and a launch-token or API cookie keeps working.
   */
  async rotateSession(): Promise<boolean> {
    const stored = this.current
    if (stored === undefined) return false
    const written = await this.writeRotated(stored.payload.username, stored.payload.digest)
    this.current = written === undefined ? undefined : parseRecord(written)
    return written !== undefined
  }
  /**
   * Replace the stored secret with a fresh session generation, which retires every
   * earlier password-signed cookie while leaving the digest usable.
   * @param username - account name to store.
   * @param digest - self-describing digest to store.
   * @returns the stored record, or undefined when no record was left to replace.
   */
  private async writeRotated(username: string, digest: string): Promise<CredentialRecord | undefined> {
    const payload: PasswordPayload = {
      version: PASSWORD_RECORD_VERSION,
      username,
      digest,
      sessionEpoch: newSessionEpoch(),
    }
    return this.credentials.modifyRecord(PASSWORD_RECORD_KEY, current =>
      current === undefined
        ? Promise.resolve(undefined)
        : Promise.resolve({ kind: 'grant', payload } satisfies CredentialRecord))
  }

  /**
   * Check one submitted pair against the stored secret.
   * @param username - account name, already trimmed by the caller.
   * @param password - plaintext as submitted.
   * @returns true only when the name and the derived bytes both match.
   */
  async verify(username: string, password: string): Promise<boolean> {
    const stored = this.current
    if (stored === undefined) return false
    if (stored.payload.username !== username.trim()) return false
    return digestMatches(password, stored.payload.digest)
  }
}

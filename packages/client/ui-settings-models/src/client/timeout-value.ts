/**
 * Read and render the Models cards' provider-timeout field. The field's unit is
 * seconds while the profile keys it writes are milliseconds, so both cards
 * convert through these functions rather than each spelling the arithmetic.
 * @module @deepseek-ai/dsh-client-ui-settings-models/timeout-value
 */

/**
 * Largest timeout this field accepts, in milliseconds. It is the ceiling both
 * adapters validate their timeout fields against (the `MAX_TIMER_DELAY_MS`
 * `@deepseek-ai/dsh-timeout` exports), restated here because the Client bundle
 * keeps cross-plugin value imports out; `tests/timeout-value.client.spec.ts`
 * fails if the two constants drift.
 */
export const MAX_TIMEOUT_MS = 2_147_483_647

/** Decimal seconds with at most millisecond precision, and no unit suffix. */
const SECONDS_PATTERN = /^(\d+)(?:\.(\d{1,3}))?$/

/** Milliseconds one second contributes to a stored timeout. */
const MS_PER_SECOND = 1000

/**
 * Read one typed timeout as the whole number of milliseconds to store.
 * @param text - typed seconds; surrounding whitespace is ignored, a unit suffix is not.
 * @returns the milliseconds to store, `undefined` for a blank field, or `Number.NaN` for text this field cannot mean.
 */
export function parseSecondsToMs(text: string): number | undefined {
  const trimmed = text.trim()
  if (trimmed.length === 0) return undefined
  const match = SECONDS_PATTERN.exec(trimmed)
  if (match === null) return Number.NaN
  const wholeMs = Number(match[1]) * MS_PER_SECOND
  const fractionMs = match[2] === undefined ? 0 : Number(match[2].padEnd(3, '0'))
  const ms = wholeMs + fractionMs
  if (!Number.isSafeInteger(ms) || ms <= 0 || ms > MAX_TIMEOUT_MS) return Number.NaN
  return ms
}

/**
 * Spell one stored timeout back as the field's seconds.
 * @param ms - a timeout held in either of the profile's millisecond keys.
 * @returns the seconds without trailing zeros, or `ms` unchanged when it is not a usable timeout.
 */
export function formatMsToSeconds(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return String(ms)
  if (ms % MS_PER_SECOND === 0) return String(ms / MS_PER_SECOND)
  return (ms / MS_PER_SECOND).toFixed(3).replace(/0+$/u, '')
}

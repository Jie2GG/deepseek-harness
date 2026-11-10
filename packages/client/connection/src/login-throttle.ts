/** In-memory throttling for browser sign-in attempts. */

/** First delay applied after one failed attempt, in milliseconds. */
const THROTTLE_BASE_MS = 1_000
/** Ceiling for the doubling delay, in milliseconds. */
const THROTTLE_MAX_MS = 30_000

interface AttemptState {
  failures: number
  blockedUntil: number
}

/**
 * Growing wait per client and account, held only in memory.
 * A restart clears every wait, which is acceptable because the wait exists to
 * slow online guessing rather than to punish an operator.
 */
export class LoginThrottle {
  private readonly states = new Map<string, AttemptState>()

  /**
   * Report the wait one key must serve before its next attempt.
   * @param key - caller-composed client and account identity.
   * @param now - current epoch time in milliseconds.
   * @returns milliseconds still blocked, or zero when the attempt may run.
   */
  retryAfterMs(key: string, now: number): number {
    const state = this.states.get(key)
    if (state === undefined) return 0
    return state.blockedUntil > now ? state.blockedUntil - now : 0
  }

  /**
   * Count one failed attempt and extend the wait for that key.
   * @param key - caller-composed client and account identity.
   * @param now - current epoch time in milliseconds.
   * @returns the wait just applied, in milliseconds.
   */
  recordFailure(key: string, now: number): number {
    const state = this.states.get(key) ?? { failures: 0, blockedUntil: 0 }
    state.failures += 1
    const delay = Math.min(THROTTLE_BASE_MS * 2 ** (state.failures - 1), THROTTLE_MAX_MS)
    state.blockedUntil = now + delay
    this.states.set(key, state)
    return delay
  }

  /**
   * Count the failed attempts one key has accumulated since its last success.
   * @param key - caller-composed client and account identity.
   * @returns failures held in memory, zero for a key that never failed.
   */
  failures(key: string): number {
    return this.states.get(key)?.failures ?? 0
  }

  /**
   * Clear the wait after an accepted attempt.
   * @param key - caller-composed client and account identity.
   */
  recordSuccess(key: string): void {
    this.states.delete(key)
  }
}

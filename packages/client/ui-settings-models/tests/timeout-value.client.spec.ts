/** Pure reading and rendering of the Models cards' provider-timeout field. */
import { describe, expect, it } from 'vitest'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { MAX_TIMEOUT_MS, formatMsToSeconds, parseSecondsToMs } from '../src/client/timeout-value.ts'

describe('MAX_TIMEOUT_MS', () => {
  it('stays equal to the ceiling both adapters validate against', () => {
    // The Client bundle restates the ceiling rather than importing it, so the
    // two only agree if a change lands in both places.
    expect(MAX_TIMEOUT_MS).toBe(MAX_TIMER_DELAY_MS)
  })
})

describe('parseSecondsToMs', () => {
  it.each([
    ['1800', 1_800_000],
    ['90', 90_000],
    ['1.5', 1_500],
    [' 1800 ', 1_800_000],
    ['0.5', 500],
    ['2147483', MAX_TIMER_DELAY_MS - 647],
    ['2147483.647', MAX_TIMER_DELAY_MS],
  ])('reads %s as %d milliseconds', (text, ms) => {
    expect(parseSecondsToMs(text)).toBe(ms)
  })

  it.each([[''], ['   ']])('treats the blank field %j as no key written', (text) => {
    expect(parseSecondsToMs(text)).toBeUndefined()
  })

  it.each([
    ['0'],
    ['-5'],
    ['abc'],
    ['30m'],
    ['1800s'],
    ['500ms'],
    ['1h'],
    ['0.0005'],
    ['1.'],
    ['.5'],
    ['1e3'],
    ['2147484'],
    ['2147483.648'],
    ['999999999999999999999'],
  ])('rejects %s', (text) => {
    expect(parseSecondsToMs(text)).toBeNaN()
  })

  it('never stores a fractional millisecond', () => {
    for (const text of ['0.001', '1.999', '2147483.001']) {
      const ms = parseSecondsToMs(text)
      expect(Number.isInteger(ms)).toBe(true)
    }
  })
})

describe('formatMsToSeconds', () => {
  it.each([
    [1_800_000, '1800'],
    [90_000, '90'],
    [1_000, '1'],
    [1_800_500, '1800.5'],
    [1_234, '1.234'],
    [500, '0.5'],
    [MAX_TIMER_DELAY_MS, '2147483.647'],
  ])('renders %d milliseconds as %s', (ms, text) => {
    expect(formatMsToSeconds(ms)).toBe(text)
  })

  it.each([[0, '0'], [-5, '-5'], [Number.NaN, 'NaN'], [Number.POSITIVE_INFINITY, 'Infinity']])(
    'leaves the unusable value %d spelled as %s', (ms, text) => {
      expect(formatMsToSeconds(ms)).toBe(text)
    },
  )

  it('round-trips every value the parser accepts', () => {
    for (const text of ['1800', '90', '1.5', '0.5', '2147483.647']) {
      const ms = parseSecondsToMs(text)
      expect(typeof ms === 'number' && formatMsToSeconds(ms)).toBe(text)
    }
  })
})

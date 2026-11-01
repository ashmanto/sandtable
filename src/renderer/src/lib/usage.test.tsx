import { describe, expect, it } from 'vitest'
import { tokenCount } from '../../../shared/pricing'
import type { MergedTicket, ModelUsage } from '../../../shared/types'
import {
  cardUsage,
  compact,
  duration,
  hasPrice,
  hasUnpriced,
  money,
  percent,
  pricedTotal,
  throughputByWeek,
  totalTokens,
  weekLabel
} from './usage'

const u = (over: Partial<ModelUsage> = {}): ModelUsage => ({
  model: 'claude-opus-5-5',
  name: 'Opus 5.5',
  input: 1,
  output: 2,
  cacheWrite: 3,
  cacheRead: 4,
  price: 1,
  ...over
})

describe('usage helpers', () => {
  it('adds up tokens per model and across models', () => {
    expect(tokenCount(u())).toBe(10)
    expect(totalTokens([u(), u({ cacheRead: 1_000 })])).toBe(1_016)
    expect(totalTokens([])).toBe(0)
  })

  it('formats counts compactly', () => {
    expect(compact(32_123_456)).toBe('32.1M')
    expect(compact(950)).toBe('950')
  })

  it('formats money, with <$0.01 for a positive amount under a cent', () => {
    expect(money(18.876)).toBe('$18.88')
    expect(money(0.004)).toBe('<$0.01')
    expect(money(0)).toBe('$0.00')
  })

  it('shows a share as a whole percent, and <1% for a small share above 0', () => {
    expect(percent(96, 100)).toBe('96%')
    expect(percent(1, 1_000)).toBe('<1%')
    expect(percent(0, 100)).toBe('0%')
  })

  it('adds up the priced models only', () => {
    expect(pricedTotal([u({ price: 2.5 }), u({ price: null }), u({ price: 1 })])).toBe(3.5)
  })

  it('tells whether any model has a price, and whether any has none', () => {
    expect([hasPrice([u()]), hasUnpriced([u()])]).toEqual([true, false])
    expect([hasPrice([u(), u({ price: null })]), hasUnpriced([u(), u({ price: null })])]).toEqual([
      true,
      true
    ])
    expect([hasPrice([u({ price: null })]), hasUnpriced([u({ price: null })])]).toEqual([
      false,
      true
    ])
  })

  it('reads tokens and the API estimate, marked with * when it leaves out a model with no price', () => {
    const big = u({ cacheRead: 32_000_000, price: 18.876 })
    expect(cardUsage([big])).toBe('32M tokens · $18.88 API estimate')
    expect(cardUsage([big, u({ price: null })])).toBe('32M tokens · $18.88* API estimate')
    expect(cardUsage([u({ cacheRead: 32_000_000, price: null })])).toBe('32M tokens')
    expect(cardUsage([])).toBeNull()
    expect(cardUsage([u({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0 })])).toBeNull()
  })

  it('names a week as this week, last week, or its Monday to Sunday', () => {
    const now = new Date(2026, 9, 28, 12)
    expect(weekLabel('2026-10-26', now)).toBe('This week')
    expect(weekLabel('2026-10-19', now)).toBe('Last week')
    expect(weekLabel('2026-10-12', now)).toBe('Oct 12 – Oct 18')
    expect(weekLabel('2026-09-28', now)).toBe('Sep 28 – Oct 4')
  })

  it('adds the year to a week outside the current year, on both ends across New Year', () => {
    const now = new Date(2026, 9, 28, 12)
    expect(weekLabel('2025-10-13', now)).toBe('Oct 13 – Oct 19, 2025')
    expect(weekLabel('2025-12-29', now)).toBe('Dec 29, 2025 – Jan 4, 2026')
    expect(weekLabel('2026-01-05', now)).toBe('Jan 5 – Jan 11')
  })

  it('shows a duration in minutes, hours, or days and hours', () => {
    const m = 60_000
    expect(
      [0, 44 * m, 90 * m, 23 * 60 * m, 26 * 60 * m, 48 * 60 * m].map((ms) => duration(ms))
    ).toEqual(['under 1m', '44m', '2h', '23h', '1d 2h', '2d'])
    expect(duration(-5_000)).toBe('under 1m')
    expect(duration(59_000, true)).toBe('under 1 minute')
    expect([60_000, 44 * m, 25 * 60 * m, 48 * 60 * m].map((ms) => duration(ms, true))).toEqual([
      '1 minute',
      '44 minutes',
      '1 day 1 hour',
      '2 days'
    ])
  })

  it('groups merged tickets by the week they merged, newest first', () => {
    const h = 3_600_000
    const merged = (
      start: string,
      hours: number,
      needsYou: number,
      input: number
    ): MergedTicket => ({
      projectIds: ['p1'],
      ticketKey: `o/r#${input}`,
      startedAt: start,
      mergedAt: new Date(Date.parse(start) + hours * h).toISOString(),
      needsYou,
      usage: [u({ input, output: 0, cacheWrite: 0, cacheRead: 0, price: input / 100 })]
    })
    const weeks = throughputByWeek([
      merged('2026-01-07T12:00:00Z', 5, 0, 300),
      merged('2026-10-27T12:00:00Z', 2, 1, 100),
      merged('2026-10-27T12:00:00Z', 26, 4, 200),
      merged('2026-10-27T12:00:00Z', 30, 1, 400)
    ])
    expect(weeks.map(({ usage, ...w }) => ({ ...w, input: totalTokens(usage) }))).toEqual([
      { week: '2026-10-26', merged: 3, median: 26 * h, slowest: 30 * h, needsYou: 2, input: 700 },
      { week: '2026-01-05', merged: 1, median: 5 * h, slowest: 5 * h, needsYou: 0, input: 300 }
    ])
    expect(
      throughputByWeek([
        merged('2026-10-27T12:00:00Z', 2, 1, 1),
        merged('2026-10-27T12:00:00Z', 4, 2, 2)
      ])[0].median
    ).toBe(3 * h)
  })
})

import { describe, expect, it } from 'vitest'
import { weekOf } from './time'

describe('weekOf', () => {
  it("names a time's week by its local Monday", () => {
    expect(weekOf(new Date(2026, 9, 26, 0).getTime())).toBe('2026-10-26')
    expect(weekOf(new Date(2026, 9, 28, 12).getTime())).toBe('2026-10-26')
    expect(weekOf(new Date(2026, 10, 1, 23).getTime())).toBe('2026-10-26')
  })

  it('puts Sunday in the week before Monday, across a month', () => {
    expect(weekOf(new Date(2026, 9, 25, 23).getTime())).toBe('2026-10-19')
    expect(weekOf(new Date(2026, 10, 2, 0).getTime())).toBe('2026-11-02')
    expect(weekOf(new Date(2026, 0, 1, 9).getTime())).toBe('2025-12-29')
  })
})

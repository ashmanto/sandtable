import { describe, expect, it } from 'vitest'
import { sidebarWidth } from './api'

describe('sidebarWidth', () => {
  it('clamps to the range, rounds, and falls back to the default', () => {
    expect(sidebarWidth(100)).toBe(180)
    expect(sidebarWidth(900)).toBe(400)
    expect(sidebarWidth(250.6)).toBe(251)
    expect(sidebarWidth(undefined)).toBe(224)
    expect(sidebarWidth(Number.NaN)).toBe(224)
    expect(sidebarWidth('300')).toBe(224)
  })
})

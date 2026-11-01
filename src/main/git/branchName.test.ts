import { describe, expect, it } from 'vitest'
import { branchName } from './branchName'

describe('branchName', () => {
  it('slugifies the title after the number', () => {
    expect(branchName(147, 'Dark mode toggle')).toBe('147-dark-mode-toggle')
    expect(branchName(12, 'Fix --json flag!')).toBe('12-fix-json-flag')
  })

  it('falls back to the number when nothing ASCII is left', () => {
    expect(branchName(9, '🚀 日本語')).toBe('9')
  })

  it('caps the length without a trailing hyphen', () => {
    const name = branchName(5, 'word '.repeat(24))
    expect(name.length).toBeLessThanOrEqual(50)
    expect(name.endsWith('-')).toBe(false)
  })

  it('takes a string prefix, such as a Linear key', () => {
    expect(branchName('app-12', 'Fix the thing')).toBe('app-12-fix-the-thing')
  })
})

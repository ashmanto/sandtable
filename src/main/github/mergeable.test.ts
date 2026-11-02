import { describe, expect, it } from 'vitest'
import { knownMergeable } from './mergeable'

describe('knownMergeable', () => {
  it('keeps the last known value per pull request while GitHub reports UNKNOWN', () => {
    expect(knownMergeable('a', 'CONFLICTING')).toBe('CONFLICTING')
    expect(knownMergeable('a', 'UNKNOWN')).toBe('CONFLICTING')
    expect(knownMergeable('b', 'UNKNOWN')).toBe('UNKNOWN')
    expect(knownMergeable('a', 'MERGEABLE')).toBe('MERGEABLE')
    expect(knownMergeable('a', 'UNKNOWN')).toBe('MERGEABLE')
  })
})

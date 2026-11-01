import { describe, expect, it } from 'vitest'
import { shellQuote } from './shell'

describe('shellQuote', () => {
  it('single-quotes a word, closing and reopening around each single quote', () => {
    expect(shellQuote('/a b')).toBe("'/a b'")
    expect(shellQuote("it's")).toBe("'it'\\''s'")
  })
})

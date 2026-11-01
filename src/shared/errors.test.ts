import { describe, expect, it } from 'vitest'
import { messageOf } from './errors'

describe('messageOf', () => {
  it("gives an Error's message and any other value as a string", () => {
    expect(messageOf(new Error('boom'))).toBe('boom')
    expect(messageOf('plain')).toBe('plain')
    expect(messageOf(42)).toBe('42')
  })
})

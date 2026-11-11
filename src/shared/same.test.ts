import { describe, expect, it } from 'vitest'
import { same } from './same'

describe('same', () => {
  it('compares by JSON value', () => {
    expect(same({ a: 1 }, { a: 1 })).toBe(true)
    expect(same([1], [2])).toBe(false)
    expect(same(undefined, undefined)).toBe(true)
  })
})

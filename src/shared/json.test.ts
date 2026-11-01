import { describe, expect, it } from 'vitest'
import { parseJson } from './json'

describe('parseJson', () => {
  it('parses valid JSON', () => {
    expect(parseJson('{"a":[1]}')).toEqual({ a: [1] })
  })

  it('returns undefined for bad JSON', () => {
    expect(parseJson('{oops')).toBeUndefined()
    expect(parseJson('')).toBeUndefined()
  })
})

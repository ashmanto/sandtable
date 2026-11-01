import { describe, expect, it } from 'vitest'
import { parseReadiness } from './readiness'

const answer = (structured: unknown): string =>
  JSON.stringify({ type: 'result', is_error: false, structured_output: structured })

describe('parseReadiness', () => {
  it('returns the gaps, cleaned and cut to 100 characters', () => {
    expect(
      parseReadiness(answer({ gaps: ['No way to tell ‮when it’s done', ' ', 'x'.repeat(150)] }))
    ).toEqual(['No way to tell when it’s done', 'x'.repeat(100)])
  })

  it('returns none for a ready ticket', () => {
    expect(parseReadiness(answer({ gaps: [] }))).toEqual([])
  })

  it('drops a repeated gap', () => {
    expect(parseReadiness(answer({ gaps: ['a', 'a '] }))).toEqual(['a'])
  })

  it('keeps at most five gaps', () => {
    expect(parseReadiness(answer({ gaps: ['a', 'b', 'c', 'd', 'e', 'f'] }))).toHaveLength(5)
  })

  it('throws without an answer', () => {
    expect(() => parseReadiness(answer({}))).toThrow(
      "Readiness check failed: Claude didn't return an answer"
    )
    expect(() =>
      parseReadiness(JSON.stringify({ is_error: true, result: 'Rate limited' }))
    ).toThrow('Readiness check failed: Rate limited')
  })
})

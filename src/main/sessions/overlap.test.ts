import { describe, expect, it } from 'vitest'
import type { Ticket } from '../../shared/types'
import { openingPrompt } from './claudeLaunch'
import { overlapPrompt, parseOverlap } from './overlap'

const ticket = (number: number, title: string): Ticket => ({
  key: `octo/shop#${number}`,
  itemId: `item-${number}`,
  number,
  title,
  body: `Body of ${number}.`,
  url: `https://github.com/octo/shop/issues/${number}`,
  repo: 'octo/shop',
  status: 'Todo',
  doneAt: null,
  labels: [],
  assignees: [],
  createdAt: '',
  updatedAt: '',
  parent: null,
  subIssues: { completed: 0, total: 0, items: [] },
  boardFields: [],
  blockedBy: [],
  mergedPr: null,
  mergedAt: null,
  prStage: null
})

const me = ticket(147, 'Dark mode toggle')
const candidates = [ticket(67, 'Sort the board'), ticket(91, 'Red clean-up icon')]
const answer = (structured: unknown): string =>
  JSON.stringify({ type: 'result', is_error: false, structured_output: structured })

describe('overlapPrompt', () => {
  it('names the service it is given', () => {
    const prompt = overlapPrompt(me, candidates, 'Jira')
    expect(prompt).toContain(openingPrompt(me, 'Jira'))
    expect(prompt).toContain(openingPrompt(candidates[0], 'Jira'))
  })

  it('holds the ticket and every in-progress ticket in full', () => {
    const prompt = overlapPrompt(me, candidates, 'GitHub')
    const at = [
      openingPrompt(me, 'GitHub'),
      '## In progress',
      ...candidates.map((c) => openingPrompt(c, 'GitHub'))
    ].map((part) => prompt.indexOf(part))
    expect(at).not.toContain(-1)
    expect(at).toEqual([...at].sort((a, b) => a - b))
    expect(prompt).toContain("Don't change any files.")
  })
})

describe('parseOverlap', () => {
  it('cuts each reason to 200 characters', () => {
    const [o] = parseOverlap(
      answer({ overlaps: [{ number: 91, reason: 'x'.repeat(500) }] }),
      candidates
    )
    expect(o.reason).toHaveLength(200)
  })

  it('returns each overlapping candidate with its reason', () => {
    expect(
      parseOverlap(
        answer({ overlaps: [{ number: 91, reason: 'Both change Card.tsx.' }] }),
        candidates
      )
    ).toEqual([
      {
        key: 'octo/shop#91',
        number: 91,
        title: 'Red clean-up icon',
        reason: 'Both change Card.tsx.'
      }
    ])
  })

  it('drops unknown numbers and empty reasons', () => {
    expect(
      parseOverlap(
        answer({
          overlaps: [
            { number: 5, reason: 'Not a candidate.' },
            { number: 67, reason: '  ' }
          ]
        }),
        candidates
      )
    ).toEqual([])
  })

  it('strips invisible characters from each reason', () => {
    expect(
      parseOverlap(
        answer({ overlaps: [{ number: 91, reason: '\u200bBoth change\u202e Card.tsx. ' }] }),
        candidates
      )
    ).toEqual([
      {
        key: 'octo/shop#91',
        number: 91,
        title: 'Red clean-up icon',
        reason: 'Both change Card.tsx.'
      }
    ])
  })

  it('throws when the answer has no overlaps list', () => {
    expect(() => parseOverlap(answer({}), candidates)).toThrow(
      "Overlap check failed: Claude didn't return an answer"
    )
  })

  it("throws when the answer isn't JSON", () => {
    expect(() => parseOverlap('nope', candidates)).toThrow(
      "Overlap check failed: Claude's answer wasn't JSON"
    )
  })

  it('throws when Claude returns no answer', () => {
    expect(() => parseOverlap(JSON.stringify({ is_error: false }), candidates)).toThrow(
      "Overlap check failed: Claude didn't return an answer"
    )
  })
})

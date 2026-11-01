import { describe, expect, it } from 'vitest'
import { areaOf, overlapCandidates, startProblems } from './areas'
import type { Ticket } from './types'

const t = (number: number, over: Partial<Ticket> = {}): Omit<Ticket, 'body'> => ({
  key: `o/r#${number}`,
  itemId: `i${number}`,
  number,
  title: `Ticket ${number}`,
  url: '',
  repo: 'o/r',
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
  prStage: null,
  ...over
})

const sessions_ = { name: 'area: sessions', color: '' }

describe('areaOf', () => {
  it('picks the area: label', () => {
    expect(areaOf([{ name: 'bug' }, { name: 'area: sessions' }])).toBe('area: sessions')
  })
  it('returns undefined with none', () => {
    expect(areaOf([{ name: 'bug' }])).toBeUndefined()
  })
})

describe('startProblems', () => {
  it('reports each open blocker', () => {
    const me = t(46, {
      blockedBy: [
        { key: 'o/r#38', number: 38, title: 'Add a settings screen', repo: 'O/R' },
        { key: 'o/other#5', number: 5, title: 'Fix it', repo: 'o/other' }
      ]
    })
    expect(startProblems(me)).toEqual([
      'Blocked by #38: Add a settings screen',
      'Blocked by o/other#5: Fix it'
    ])
  })
})

describe('overlapCandidates', () => {
  it('lists busy tickets in the same area and repo', () => {
    const me = t(46, { labels: [sessions_] })
    const other = t(30, { labels: [sessions_] })
    expect(overlapCandidates(me, [me, other], ['o/r#30'])).toEqual([other])
  })

  it('ignores tickets that are not busy, other areas, other repos, and the ticket itself', () => {
    const me = t(46, { labels: [sessions_] })
    const other = t(30, { labels: [sessions_] })
    const elsewhere = t(31, { labels: [{ name: 'area: ui', color: '' }] })
    const otherRepo = t(32, { key: 'o/x#32', repo: 'o/x', labels: [sessions_] })
    expect(overlapCandidates(me, [me, other], [])).toEqual([])
    expect(overlapCandidates(me, [me, elsewhere], ['o/r#31'])).toEqual([])
    expect(overlapCandidates(me, [me, otherRepo], ['o/x#32'])).toEqual([])
    expect(overlapCandidates(me, [me], ['o/r#46'])).toEqual([])
  })

  it('returns none for a ticket with no area', () => {
    const me = t(46)
    const other = t(30)
    expect(overlapCandidates(me, [me, other], ['o/r#30'])).toEqual([])
  })
})

describe('Linear tickets', () => {
  const l = (number: number, over: Partial<Ticket> = {}): Omit<Ticket, 'body'> =>
    t(number, { key: `APP-${number}`, repo: '', ...over })

  it('names Linear blockers by key', () => {
    const me = l(46, { blockedBy: [{ key: 'APP-7', number: 7, title: 'First', repo: '' }] })
    expect(startProblems(me)).toEqual(['Blocked by APP-7: First'])
  })

  it('checks busy tickets in the area whatever repo they were given', () => {
    const me = l(46, { labels: [sessions_] })
    const other = l(30, { labels: [sessions_], repo: 'o/r' })
    expect(overlapCandidates(me, [me, other], ['APP-30'])).toEqual([other])
  })
})

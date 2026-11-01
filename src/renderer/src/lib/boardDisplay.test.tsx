import { beforeEach, describe, expect, it } from 'vitest'
import { IN_PROGRESS_LABEL } from '../../../shared/columns'
import { loadBoardDisplay, saveBoardDisplay, sortTickets, type BoardDisplay } from './boardDisplay'

const t = (
  n: number,
  createdAt: string,
  updatedAt: string,
  ...labels: string[]
): {
  n: number
  createdAt: string
  updatedAt: string
  labels: { name: string; color: string }[]
} => ({
  n,
  createdAt,
  updatedAt,
  labels: labels.map((name) => ({ name, color: 'ffffff' }))
})

const tickets = [
  t(1, '2026-10-01', '2026-10-05', 'docs'),
  t(2, '2026-10-03', '2026-10-04'),
  t(3, '2026-10-02', '2026-10-09', 'Bug', 'zeta'),
  t(4, '2026-10-04', '2026-10-01', IN_PROGRESS_LABEL.name, 'docs')
]
const order = (s: Pick<BoardDisplay, 'order' | 'dir'>): number[] =>
  sortTickets(tickets, s).map((x) => x.n)

describe('sortTickets', () => {
  it("keeps GitHub's order for Manual", () => {
    expect(order({ order: 'manual', dir: 'asc' })).toEqual([1, 2, 3, 4])
  })

  it('orders by updated or created time', () => {
    expect(order({ order: 'updated', dir: 'desc' })).toEqual([3, 1, 2, 4])
    expect(order({ order: 'updated', dir: 'asc' })).toEqual([4, 2, 1, 3])
    expect(order({ order: 'created', dir: 'desc' })).toEqual([4, 2, 3, 1])
  })

  it("groups by each ticket's first label, ignoring case and Sandtable's own, unlabeled last", () => {
    expect(order({ order: 'label', dir: 'asc' })).toEqual([3, 1, 4, 2])
    expect(order({ order: 'label', dir: 'desc' })).toEqual([1, 4, 3, 2])
  })

  it('picks the first label the same way it compares tickets', () => {
    const accented = [t(1, '', '', 'fix', 'éclair'), t(2, '', '', 'eggs')]
    expect(sortTickets(accented, { order: 'label', dir: 'asc' }).map((x) => x.n)).toEqual([1, 2])
  })
})

describe('loadBoardDisplay', () => {
  beforeEach(() => localStorage.clear())

  it("remembers each project's sort", () => {
    saveBoardDisplay('p1', { group: 'assignee', order: 'updated', dir: 'desc' })
    expect(loadBoardDisplay('p1')).toEqual({ group: 'assignee', order: 'updated', dir: 'desc' })
    expect(loadBoardDisplay('p2')).toEqual({ group: 'none', order: 'manual', dir: 'asc' })
  })

  it('remembers grouping by parent', () => {
    saveBoardDisplay('p1', { group: 'parent', order: 'manual', dir: 'asc' })
    expect(loadBoardDisplay('p1').group).toBe('parent')
  })

  it('falls back to Manual on a bad value', () => {
    localStorage.setItem('boardDisplay:p1', '{nope')
    expect(loadBoardDisplay('p1')).toEqual({ group: 'none', order: 'manual', dir: 'asc' })
    localStorage.setItem('boardDisplay:p1', JSON.stringify({ order: 'x', dir: 1 }))
    expect(loadBoardDisplay('p1')).toEqual({ group: 'none', order: 'manual', dir: 'asc' })
  })

  it('keeps the sort but drops an unknown or missing grouping', () => {
    localStorage.setItem('boardDisplay:p1', JSON.stringify({ order: 'label', dir: 'asc' }))
    expect(loadBoardDisplay('p1')).toEqual({ group: 'none', order: 'label', dir: 'asc' })
    localStorage.setItem(
      'boardDisplay:p1',
      JSON.stringify({ group: 'repo', order: 'label', dir: 'asc' })
    )
    expect(loadBoardDisplay('p1')).toEqual({ group: 'none', order: 'label', dir: 'asc' })
  })
})

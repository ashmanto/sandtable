import { beforeEach, describe, expect, it } from 'vitest'
import {
  boardPeople,
  loadAssigneeFilter,
  passesAssignee,
  saveAssigneeFilter,
  type AssigneeFilter
} from './assigneeFilter'

const t = (...logins: string[]): { assignees: { login: string; name: string | null }[] } => ({
  assignees: logins.map((login) => ({ login, name: null }))
})

describe('passesAssignee', () => {
  it('shows every ticket when no one is selected', () => {
    expect(passesAssignee({ mode: 'only', people: [] }, t(), null)).toBe(true)
    expect(passesAssignee({ mode: 'hide', people: [] }, t('ann'), null)).toBe(true)
  })

  it('shows only tickets assigned to a selected person, ignoring case', () => {
    const f: AssigneeFilter = { mode: 'only', people: ['Ann', 'bo'] }
    expect(passesAssignee(f, t('cy', 'ann'), null)).toBe(true)
    expect(passesAssignee(f, t('cy'), null)).toBe(false)
    expect(passesAssignee(f, t(), null)).toBe(false)
  })

  it('matches Me against the signed-in login, and nothing while it is unknown', () => {
    const f: AssigneeFilter = { mode: 'only', people: ['@me'] }
    expect(passesAssignee(f, t('Ann'), 'ann')).toBe(true)
    expect(passesAssignee(f, t('bo'), 'ann')).toBe(false)
    expect(passesAssignee(f, t('ann'), null)).toBe(false)
  })

  it('matches Unassigned against tickets with no assignee', () => {
    const f: AssigneeFilter = { mode: 'only', people: ['@none'] }
    expect(passesAssignee(f, t(), null)).toBe(true)
    expect(passesAssignee(f, t('ann'), null)).toBe(false)
  })

  it('hides tickets that match in hide mode', () => {
    const f: AssigneeFilter = { mode: 'hide', people: ['@me', '@none'] }
    expect(passesAssignee(f, t('ann'), 'ann')).toBe(false)
    expect(passesAssignee(f, t(), 'ann')).toBe(false)
    expect(passesAssignee(f, t('bo'), 'ann')).toBe(true)
  })
})

describe('boardPeople', () => {
  it('lists each assignee once by name, falling back to login, sorted', () => {
    const tickets = [
      { assignees: [{ login: 'zed', name: 'Ann Z' }] },
      {
        assignees: [
          { login: 'Bo', name: null },
          { login: 'ZED', name: 'Other' }
        ]
      }
    ]
    expect(boardPeople(tickets, [])).toEqual([
      { login: 'zed', name: 'Ann Z' },
      { login: 'Bo', name: 'Bo' }
    ])
  })

  it('keeps a selected person no ticket has, so they can be cleared, but not Me or Unassigned', () => {
    expect(boardPeople([t('ann')], ['gone', '@me', '@none'])).toEqual([
      { login: 'ann', name: 'ann' },
      { login: 'gone', name: 'gone' }
    ])
  })
})

describe('loadAssigneeFilter', () => {
  beforeEach(() => localStorage.clear())

  it('returns the filter saved for that project only', () => {
    saveAssigneeFilter('p1', { mode: 'hide', people: ['@me'] })
    expect(loadAssigneeFilter('p1')).toEqual({ mode: 'hide', people: ['@me'] })
    expect(loadAssigneeFilter('p2')).toEqual({ mode: 'only', people: [] })
  })

  it('falls back to no filter for unreadable data', () => {
    localStorage.setItem('assigneeFilter:p1', '{nope')
    expect(loadAssigneeFilter('p1')).toEqual({ mode: 'only', people: [] })
    localStorage.setItem('assigneeFilter:p1', JSON.stringify({ mode: 'only', people: [1] }))
    expect(loadAssigneeFilter('p1')).toEqual({ mode: 'only', people: [] })
  })
})

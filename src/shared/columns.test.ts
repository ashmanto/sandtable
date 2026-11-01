import { describe, expect, it } from 'vitest'
import { columnFor, JIRA_STATUS, LINEAR_STATUS, REPO_STATUS, statusMapOf } from './columns'
import type { StatusMap } from './types'

const map: StatusMap = { todo: 'Todo', inProgress: 'In Progress', done: 'Done' }

describe('columnFor', () => {
  it('maps board options to columns', () => {
    expect(columnFor('Todo', map)).toBe('todo')
    expect(columnFor('In Progress', map)).toBe('inProgress')
    expect(columnFor('Done', map)).toBe('done')
  })

  it('hides unknown statuses', () => {
    expect(columnFor('Wont fix', map)).toBe('hidden')
  })

  it('treats a missing status as todo', () => {
    expect(columnFor(null, map)).toBe('todo')
  })

  it('uses the names from the map', () => {
    const custom: StatusMap = { todo: 'Backlog', inProgress: 'Doing', done: 'Shipped' }
    expect(columnFor('Doing', custom)).toBe('inProgress')
    expect(columnFor('Todo', custom)).toBe('hidden')
  })
})

describe('statusMapOf', () => {
  it('maps a Linear project by state type', () => {
    const linear = { id: 'p', name: 'P', repos: [], linear: { team: 'APP', projects: [] } }
    expect(statusMapOf(linear)).toBe(LINEAR_STATUS)
    expect(columnFor('started', LINEAR_STATUS)).toBe('inProgress')
    expect(columnFor('canceled', LINEAR_STATUS)).toBe('hidden')
    expect(statusMapOf({ id: 'p', name: 'P', repos: [] })).toBe(REPO_STATUS)
  })

  it('maps a Jira project by status category', () => {
    const jira = { site: 'acme.atlassian.net', project: 'INF', name: 'Internal' }
    expect(statusMapOf({ id: 'p', name: 'P', repos: [], jira })).toBe(JIRA_STATUS)
    expect(columnFor('indeterminate', JIRA_STATUS)).toBe('inProgress')
  })
})

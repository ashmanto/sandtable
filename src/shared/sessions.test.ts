import { describe, expect, it } from 'vitest'
import {
  elsewhereOf,
  isDoneOpen,
  repoName,
  sessionRepos,
  ticketActions,
  tokenCapOf
} from './sessions'
import type { Project, SessionRecord } from './types'

const map = { todo: 'Todo', inProgress: 'In Progress', done: 'Done' }
const s = (state: SessionRecord['state']): SessionRecord => ({ state }) as SessionRecord

describe('isDoneOpen', () => {
  it('is true only for a live session on a done ticket', () => {
    expect(isDoneOpen(s('running'), { status: 'Done' }, map)).toBe(true)
    expect(isDoneOpen(s('needsYou'), { status: 'Done' }, map)).toBe(true)
    expect(isDoneOpen(s('finished'), { status: 'Done' }, map)).toBe(false)
    expect(isDoneOpen(s('running'), { status: 'In Progress' }, map)).toBe(false)
    expect(isDoneOpen(s('running'), undefined, map)).toBe(false)
  })
})

describe('elsewhereOf', () => {
  const web = { id: 'p2', name: 'Web' } as Project
  const theirs = {
    projectId: 'p2',
    ticketKey: 'a#1',
    state: 'running',
    startedAt: '2026-10-24T00:00:00Z'
  } as SessionRecord

  it("shows another project's session unless the ticket's own is live", () => {
    expect(elsewhereOf([theirs], [web], 'a#1', s('finished'))).toEqual({
      session: theirs,
      project: web
    })
    expect(elsewhereOf([theirs], [web], 'a#1', s('idle'))).toBeUndefined()
  })

  it("shows none when the other session's project isn't listed", () => {
    expect(elsewhereOf([theirs], [], 'a#1', undefined)).toBeUndefined()
  })
})

describe('ticketActions', () => {
  const finished = { state: 'finished' } as SessionRecord
  const removed = { state: 'finished', removedAt: '2026-10-24T11:00:00Z' } as SessionRecord
  const base = { session: undefined, done: false, hasRepo: true, blocked: false }

  it.each([
    ['no session', {}, ['start']],
    ['a removed worktree', { session: removed }, ['start']],
    ['no session in Done', { done: true }, []],
    ['no session and no repo', { hasRepo: false }, []],
    ['Running', { session: s('running') }, []],
    ['Needs you', { session: s('needsYou') }, []],
    ['Finished', { session: finished }, ['resume', 'removeWorktree']],
    ['Finished in Done', { session: finished, done: true }, ['removeWorktree', 'resume']],
    ['Done, session open', { session: s('needsYou'), done: true }, ['endSession']],
    ["Can't start", { blocked: true }, ['chooseFolder']],
    ['a session in another project', { elsewhere: true }, []],
    [
      'Finished with a session in another project',
      { session: finished, elsewhere: true },
      ['removeWorktree']
    ]
  ] as const)('%s', (_, over, actions) => {
    expect(ticketActions({ ...base, ...over })).toEqual(actions)
  })
})

describe('sessionRepos', () => {
  const repos = [
    { github: 'o/a', path: '/r/a' },
    { github: 'o/b', path: '/r/b' }
  ]

  it('lists the project repos of the worktrees in order, or of the checkout', () => {
    const wt = {
      worktrees: ['/r/b-wt.noindex/x', '/r/gone-wt.noindex/x', '/r/b-wt/x', '/r/a-wt.noindex/x']
    } as SessionRecord
    expect(sessionRepos(repos, wt)).toEqual([repos[1], repos[0]])
    expect(
      sessionRepos(repos, { worktrees: [], checkout: '/r/a' } as unknown as SessionRecord)
    ).toEqual([repos[0]])
    expect(sessionRepos(repos, { worktrees: [] } as unknown as SessionRecord)).toEqual([])
  })
})

describe('repoName', () => {
  it('names the repo of a worktree', () => {
    expect(repoName('/r/app-wt.noindex/12-x')).toBe('app')
    expect(repoName('/r/app-wt/12-x')).toBe('app-wt')
  })
})

describe('tokenCapOf', () => {
  it("is the larger of the project's cap and the session's raised cap, and none without a project cap", () => {
    expect(tokenCapOf({ tokenCap: 25e6 }, {})).toBe(25e6)
    expect(tokenCapOf({ tokenCap: 25e6 }, { tokenCap: 40e6 })).toBe(40e6)
    expect(tokenCapOf({ tokenCap: 50e6 }, { tokenCap: 40e6 })).toBe(50e6)
    expect(tokenCapOf({}, { tokenCap: 40e6 })).toBeUndefined()
    expect(tokenCapOf(undefined, {})).toBeUndefined()
  })
})

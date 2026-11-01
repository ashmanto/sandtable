import { beforeEach, describe, expect, it } from 'vitest'
import { linearProject, project } from '../test/fixtures'
import { filterRepos, loadRepoFilter, passesRepo, saveRepoFilter } from './repoFilter'

describe('passesRepo', () => {
  it('shows every ticket when no repo is selected', () => {
    expect(passesRepo({ mode: 'hide', repos: [] }, { repo: 'a/b' })).toBe(true)
  })

  it('shows only tickets from a selected repo in only mode, ignoring case', () => {
    const f = { mode: 'only' as const, repos: ['Octo/App', ''] }
    expect(passesRepo(f, { repo: 'octo/app' })).toBe(true)
    expect(passesRepo(f, { repo: '' })).toBe(true)
    expect(passesRepo(f, { repo: 'octo/web' })).toBe(false)
  })

  it('hides tickets from a selected repo in hide mode', () => {
    const f = { mode: 'hide' as const, repos: ['octo/app'] }
    expect(passesRepo(f, { repo: 'octo/app' })).toBe(false)
    expect(passesRepo(f, { repo: 'octo/web' })).toBe(true)
  })
})

describe('filterRepos', () => {
  it("lists the project's repos by name", () => {
    const p = { ...project, repos: [...project.repos].reverse() }
    expect(filterRepos(p, [])).toEqual([
      { value: 'octo/shop', name: 'octo/shop' },
      { value: 'octo/shop-web', name: 'octo/shop-web' }
    ])
  })

  it('keeps a checked repo the project no longer has, so it can be unchecked', () => {
    expect(filterRepos(project, ['OCTO/SHOP', 'gone/repo', '']).slice(2)).toEqual([
      { value: 'gone/repo', name: 'gone/repo' },
      { value: '', name: 'No repo' }
    ])
  })

  it('adds No repo last on a Linear project', () => {
    expect(filterRepos(linearProject, []).at(-1)).toEqual({ value: '', name: 'No repo' })
  })

  it('adds No repo last on a Jira project', () => {
    const jira = { site: 'acme.atlassian.net', project: 'INF', name: 'Internal' }
    expect(filterRepos({ ...project, jira }, []).at(-1)).toEqual({ value: '', name: 'No repo' })
  })
})

describe('loadRepoFilter', () => {
  beforeEach(() => localStorage.clear())

  it('returns the filter saved for that project only', () => {
    saveRepoFilter('p1', { mode: 'hide', repos: ['octo/app'] })
    expect(loadRepoFilter('p1')).toEqual({ mode: 'hide', repos: ['octo/app'] })
    expect(loadRepoFilter('p2')).toEqual({ mode: 'only', repos: [] })
  })

  it('falls back to no filter for unreadable data', () => {
    localStorage.setItem('repoFilter:p1', '{nope')
    expect(loadRepoFilter('p1')).toEqual({ mode: 'only', repos: [] })
    localStorage.setItem('repoFilter:p1', JSON.stringify({ mode: 'only', repos: [1] }))
    expect(loadRepoFilter('p1')).toEqual({ mode: 'only', repos: [] })
  })
})

import { describe, expect, it } from 'vitest'
import {
  canStart,
  sameRepo,
  folderError,
  folderErrorRepo,
  isTrackerKey,
  serviceOf,
  ticketLabel
} from './repo'

describe('sameRepo', () => {
  it('ignores case', () => {
    expect(sameRepo('Octo/Shop', 'octo/shop')).toBe(true)
    expect(sameRepo('a/b', 'a/c')).toBe(false)
  })
})

describe('folderError', () => {
  it('names the repo and parses it back', () => {
    expect(folderError('octo/shop-web')).toBe(
      'The folder for octo/shop-web is missing or no longer points at it'
    )
    expect(folderErrorRepo(folderError('octo/shop-web'))).toBe('octo/shop-web')
    expect(folderErrorRepo('Repo not in this project')).toBeNull()
  })
})

describe('canStart', () => {
  const repos = [{ github: 'o/r', path: '/r' }]
  it('is true for a project repo or no repo yet, false for a repo outside the project', () => {
    expect(canStart(repos, { repo: 'O/R' })).toBe(true)
    expect(canStart(repos, { repo: '' })).toBe(true)
    expect(canStart(repos, { repo: 'o/elsewhere' })).toBe(false)
  })
})

describe('ticketLabel', () => {
  it('is #number for GitHub and the key for Linear', () => {
    expect(isTrackerKey('APP-12')).toBe(true)
    expect(isTrackerKey('o/r#12')).toBe(false)
    expect(ticketLabel({ key: 'o/r#12', number: 12 })).toBe('#12')
    expect(ticketLabel({ key: 'APP-12', number: 12 })).toBe('APP-12')
  })
})

describe('serviceOf', () => {
  it('names where a project takes its tickets from', () => {
    expect(serviceOf({ id: 'p', name: 'P', repos: [] })).toBe('GitHub')
    expect(
      serviceOf({ id: 'p', name: 'P', repos: [], linear: { team: 'APP', projects: [] } })
    ).toBe('Linear')
    const jira = { site: 'acme.atlassian.net', project: 'INF', name: 'Internal' }
    expect(serviceOf({ id: 'p', name: 'P', repos: [], jira })).toBe('Jira')
  })
})

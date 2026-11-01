import { describe, expect, it } from 'vitest'
import type { Project } from './types'
import { isSandboxDomain, sandboxDomains } from './sandbox'

const project = (extra: Partial<Project> = {}): Project => ({
  id: 'p1',
  name: 'P',
  repos: [],
  ...extra
})

describe('sandboxDomains', () => {
  it('lists GitHub and the npm registry for a GitHub project', () => {
    expect(sandboxDomains(project())).toEqual([
      'github.com',
      'api.github.com',
      'registry.npmjs.org'
    ])
  })

  it('adds the Linear API or the Jira site, then the project domains once', () => {
    expect(
      sandboxDomains(
        project({
          linear: { team: 'APP', projects: [] },
          sandboxDomains: ['pypi.org', 'github.com']
        })
      )
    ).toEqual(['github.com', 'api.github.com', 'registry.npmjs.org', 'api.linear.app', 'pypi.org'])
    expect(
      sandboxDomains(project({ jira: { site: 'acme.atlassian.net', project: 'INF', name: 'I' } }))
    ).toContain('acme.atlassian.net')
  })
})

describe('isSandboxDomain', () => {
  it('takes a host name, optionally starting with *.', () => {
    for (const d of ['pypi.org', '*.example.com', 'a-b.c.io']) expect(isSandboxDomain(d)).toBe(true)
    for (const d of ['', 'pypi', 'https://pypi.org', 'pypi.org/simple', '*', 'a.*.com', 'a b.com'])
      expect(isSandboxDomain(d)).toBe(false)
  })
})

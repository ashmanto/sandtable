import { homedir } from 'node:os'
import { describe, expect, it, vi, type Mock } from 'vitest'
import type { Account, Project, ProjectGroup } from '../shared/types'
import type { MergedPr } from './github/merged'
import { createProjects, type ProjectsApi } from './projects'
import type { Synced } from './sync'
import { project, repoProject } from './test/orchestrator'

const claudeDir = '/home/u/.claude'

type Built = {
  api: ProjectsApi
  synced: Map<string, Synced>
  mergedPrs: Map<string, MergedPr[]>
  calls: string[]
  resetSource: Mock
  persistCache: Mock
  sync: Mock
  projects: () => Project[]
}

const build = (initial: Project[] = [project]): Built => {
  let projects = initial
  let groups: ProjectGroup[] = []
  let accounts: Account[] = []
  const synced = new Map<string, Synced>([['p1', { tickets: [], syncedAt: null, error: null }]])
  const mergedPrs = new Map<string, MergedPr[]>([['p1', []]])
  const calls: string[] = []
  const resetSource = vi.fn(() => calls.push('resetSource'))
  const persistCache = vi.fn(() => calls.push('persistCache'))
  const sync = vi.fn(async () => {
    calls.push('sync')
    return null
  })
  const api = createProjects({
    deps: { claudeDir, jiraCredentials: { save: vi.fn(), sites: async () => [] } },
    projects: () => projects,
    setProjects: (next) => (projects = next),
    groups: () => groups,
    setGroups: (next) => (groups = next),
    accounts: () => accounts,
    setAccounts: (next) => (accounts = next),
    sessions: () => [],
    synced,
    mergedPrs,
    projectById: (id) => projects.find((p) => p.id === id)!,
    savedRepo: async (r) => r,
    persist: async () => undefined,
    persistCache,
    changed: () => undefined,
    clearFixedFolders: async () => false,
    resetSource,
    assertModel: () => undefined,
    assertEffort: () => undefined,
    syncGate: async () => undefined,
    sync
  })
  return {
    api,
    synced,
    mergedPrs,
    calls,
    resetSource,
    persistCache,
    sync,
    projects: () => projects
  }
}

describe('createProjects', () => {
  it('rejects a project with two ticket sources', async () => {
    const { api } = build()
    await expect(
      api.saveProject({
        ...project,
        linear: { team: 'ENG', projects: [] }
      })
    ).rejects.toThrow('Pick one ticket source')
  })

  it("a changed ticket source resets the project's sync state", async () => {
    const { api, synced, mergedPrs, calls, resetSource, persistCache } = build([repoProject])
    await api.saveProject({ ...repoProject, linear: { team: 'ENG', projects: [] } })
    expect(synced.has('p1')).toBe(false)
    expect(mergedPrs.has('p1')).toBe(false)
    expect(resetSource).toHaveBeenCalledWith('p1')
    expect(persistCache).toHaveBeenCalledTimes(1)
    expect(calls).toEqual(['resetSource', 'persistCache', 'sync'])
  })

  it('refuses the home folder as an account folder', async () => {
    const { api } = build()
    await expect(api.addAccount({ name: 'Work', dir: '~/' })).rejects.toThrow(
      new RegExp(`^${homedir()}`)
    )
  })

  it('refuses to remove Default', async () => {
    const { api } = build()
    await expect(api.removeAccount(claudeDir)).rejects.toThrow("Default can't be removed")
  })

  it("arrangeProjects drops groups it doesn't know", async () => {
    const { api, projects } = build()
    await api.arrangeProjects([{ id: 'g1', name: 'One' }], [{ id: 'p1', group: 'gone' }])
    expect(projects()[0].group).toBeUndefined()
  })
})

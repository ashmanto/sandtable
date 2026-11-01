import { findRepo, sameRepo, serviceOf } from '../../../shared/repo'
import type { Project } from '../../../shared/types'
import { loadFilter, passesFilter, saveSaved, type SavedFilter } from './utils'

type RepoFilter = SavedFilter<'repos'>

const key = (projectId: string): string => `repoFilter:${projectId}`

/** Whether the filter lets the ticket show. */
export const passesRepo = (f: RepoFilter, t: { repo: string }): boolean =>
  passesFilter(f, f.repos, (r) => sameRepo(r, t.repo))

/** The repo filter's rows: the project's repos by name, checked ones it no longer has, then No repo on a Linear or Jira project. */
export const filterRepos = (
  project: Project,
  checked: string[]
): { value: string; name: string }[] => [
  ...project.repos
    .map((r) => ({ value: r.github, name: r.github }))
    .sort((a, b) => a.name.localeCompare(b.name)),
  ...checked.filter((r) => r && !findRepo(project.repos, r)).map((r) => ({ value: r, name: r })),
  ...(serviceOf(project) !== 'GitHub' || checked.includes('')
    ? [{ value: '', name: 'No repo' }]
    : [])
]

/** The filter saved for the project, or no filter. */
export const loadRepoFilter = (projectId: string): RepoFilter => loadFilter(key(projectId), 'repos')

/** Saves the project's filter for the next launch. */
export const saveRepoFilter = (projectId: string, f: RepoFilter): void =>
  saveSaved(key(projectId), f)

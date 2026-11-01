import type { Project, ProjectRepo } from './types'

/** True when two `owner/name` strings name the same repo. */
export function sameRepo(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

/** The project repo named `github`, matched case-insensitively. */
export function findRepo(repos: ProjectRepo[], github: string): ProjectRepo | undefined {
  return repos.find((r) => sameRepo(r.github, github))
}

/** True when Start can run: the ticket's repo is in the project, or it has none yet and Start asks. */
export const canStart = (repos: ProjectRepo[], ticket: { repo: string }): boolean =>
  !!findRepo(repos, ticket.repo) || !ticket.repo

/** The repo and issue number of an `owner/name#number` ticket key. */
export function parseTicketKey(key: string): { repo: string; number: number } {
  const at = key.lastIndexOf('#')
  return { repo: key.slice(0, at), number: Number(key.slice(at + 1)) }
}

/** True for a Linear or Jira key such as `APP-12`, which has no `#`. */
export const isTrackerKey = (key: string): boolean => !key.includes('#')

/** A service tickets come from, as text names it. */
export type Service = 'GitHub' | 'Linear' | 'Jira'

/** The service a project's tickets come from. */
export const serviceOf = (p: Project): Service => (p.linear ? 'Linear' : p.jira ? 'Jira' : 'GitHub')

/** Where a project's ticket keys are unique: GitHub, a Linear workspace, or a Jira site. */
export const ticketSource = (p: Project): string =>
  p.linear ? `linear:${p.linear.workspace ?? ''}` : p.jira ? `jira:${p.jira.site}` : 'github'

/** True when two projects' tickets can be the same ticket; a Linear project with no workspace saved uses the CLI's default, so it matches any workspace. */
export const sameTicketSource = (a: Project, b: Project): boolean => {
  const [x, y] = [ticketSource(a), ticketSource(b)]
  return (
    x === y ||
    (x.startsWith('linear:') &&
      y.startsWith('linear:') &&
      (!a.linear?.workspace || !b.linear?.workspace))
  )
}

/** How a ticket is named in text: `#12` for a GitHub issue, the key for a Linear or Jira one. */
export const ticketLabel = (t: { key: string; number: number }): string =>
  isTrackerKey(t.key) ? t.key : `#${t.number}`

/** How text names an issue from a ticket in `repo`: its Linear or Jira key, `#12`, or `owner/name#12` in another repo. */
export const issueLabel = (
  i: { key: string; number: number; repo: string },
  repo: string
): string => (isTrackerKey(i.key) ? i.key : `${sameRepo(i.repo, repo) ? '' : i.repo}#${i.number}`)

const FOLDER_ERROR = /^The folder for (\S+) is missing or no longer points at it$/

/** The error Start throws when a repo's folder is gone or its remote no longer matches. */
export const folderError = (repo: string): string =>
  `The folder for ${repo} is missing or no longer points at it`

/** The repo a `folderError` message names, or null for any other message. */
export const folderErrorRepo = (message: string): string | null =>
  FOLDER_ERROR.exec(message)?.[1] ?? null

/** How a create's error starts when the issue exists but a later step failed. */
export const CREATED = 'Created'

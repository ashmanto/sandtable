import { statusMapOf } from '../shared/columns'
import { CREATED, findRepo, isTrackerKey, parseTicketKey, sameRepo } from '../shared/repo'
import type {
  Area,
  BoardColumn,
  Column,
  Project,
  ProjectRepo,
  Ticket,
  TicketDetails,
  Triage
} from '../shared/types'
import type { OrchestratorDeps } from './orchestrator'

/** The calls a Linear team or Jira project answers, where `team` is its key. */
export type TeamClient = {
  tickets(
    team: string,
    projectIds: string[],
    closedSince: string,
    alsoNumbers: number[],
    truncated?: (message: string) => void
  ): Promise<Ticket[]>
  setColumn(team: string, identifier: string, column: BoardColumn): Promise<void>
  setAssignee(identifier: string, assigneeId: string | null): Promise<void>
  details(identifier: string): Promise<TicketDetails>
  postComment(identifier: string, body: string): Promise<void>
  create(
    team: string,
    title: string,
    body: string,
    projectId?: string,
    parentId?: string
  ): Promise<string>
  viewer(): Promise<string>
  areas(team: string): Promise<Area[]>
  applyTriage(team: string, identifier: string, t: Triage): Promise<void>
}

/** The calls every project's ticket source answers, bound to that project; each refuses a key outside it. */
export type Tracker = {
  tickets(
    closedSince: string,
    alsoKeys: string[],
    truncated: (message: string) => void
  ): Promise<Ticket[]>
  /** Moves the ticket from column `from` to `column`; `reopen` lets a closed issue that leaves Done reopen. */
  setColumn(ticket: Ticket, from: Column, column: BoardColumn, reopen: boolean): Promise<void>
  setAssignee(ticket: Ticket, from: string | null, to: string | null): Promise<void>
  details(key: string): Promise<TicketDetails>
  postComment(key: string, body: string): Promise<void>
  /** Files an issue in `where`, a repo or Linear project, and returns its key. */
  create(title: string, body: string, where: string, parent?: string): Promise<string>
  viewer(): Promise<string>
  areas(ticket: Ticket): Promise<Area[]>
  applyTriage(key: string, t: Triage): Promise<void>
}

type TrackerDeps = Pick<
  OrchestratorDeps,
  | 'board'
  | 'repoIssues'
  | 'areas'
  | 'linear'
  | 'jira'
  | 'ticketDetails'
  | 'postComment'
  | 'githubViewer'
>

/** The project repo named `github`; throws when the project has none. */
export const repoOf = (project: Project, github: string): ProjectRepo => {
  const repo = findRepo(project.repos, github)
  if (!repo) throw new Error(github ? 'Repo not in this project' : 'Pick a repo')
  return repo
}

/** The Linear project ID `id`, or undefined when the project follows none; throws for one it doesn't follow. */
export const linearProjectIn = (
  linear: NonNullable<Project['linear']>,
  id: string | undefined
): string | undefined => {
  if (linear.projects.length === 0) return undefined
  if (!linear.projects.some((p) => p.id === id))
    throw new Error('Choose one of the Linear projects')
  return id
}

const keyIn = (team: string, key: string): string => {
  if (!isTrackerKey(key) || !key.startsWith(`${team}-`))
    throw new Error('Issue not in this project')
  return key
}

const teamTracker = (
  client: TeamClient,
  team: string,
  projectIds: string[],
  linear?: NonNullable<Project['linear']>
): Tracker => ({
  tickets: (closedSince, alsoKeys, truncated) =>
    client.tickets(
      team,
      projectIds,
      closedSince,
      alsoKeys
        .filter((k) => isTrackerKey(k) && k.startsWith(`${team}-`))
        .map((k) => Number(k.slice(team.length + 1))),
      truncated
    ),
  setColumn: (ticket, _from, column) => client.setColumn(team, ticket.key, column),
  setAssignee: (ticket, _from, to) => client.setAssignee(ticket.key, to),
  details: async (key) => client.details(keyIn(team, key)),
  postComment: async (key, body) => client.postComment(keyIn(team, key), body),
  create: async (title, body, where, parent) => {
    const projectId = linear && linearProjectIn(linear, where)
    const parentId = parent === undefined ? undefined : keyIn(team, parent)
    return client.create(team, title, body, projectId, parentId)
  },
  viewer: () => client.viewer(),
  areas: () => client.areas(team),
  applyTriage: async (key, t) => client.applyTriage(team, keyIn(team, key), t)
})

const githubTracker = (p: Project, deps: TrackerDeps): Tracker => {
  const issueIn = (key: string): { repo: string; number: number } => {
    const { repo, number } = parseTicketKey(key)
    return { repo: repoOf(p, repo).github, number }
  }
  const issueKeys = (keys: string[]): string[] => keys.filter((k) => !isTrackerKey(k))
  return {
    tickets(closedSince, alsoKeys, truncated) {
      if (p.board)
        return deps.board.tickets(
          p.board.source,
          p.board.statusMap,
          closedSince,
          issueKeys(alsoKeys),
          truncated
        )
      const issues = issueKeys(alsoKeys).map(parseTicketKey)
      return Promise.all(
        p.repos.map((r) =>
          deps.repoIssues.tickets(
            r.github,
            closedSince,
            issues.filter(({ repo }) => sameRepo(repo, r.github)).map(({ number }) => number),
            truncated
          )
        )
      ).then((lists) => lists.flat())
    },
    setColumn: async (ticket, from, column, reopen) => {
      if (!p.board) return deps.repoIssues.setColumn(ticket.repo, ticket.number, column, reopen)
      await deps.board.setStatus(p.board.source, ticket.itemId, statusMapOf(p)[column])
      if (reopen && from === 'done') await deps.repoIssues.reopen(ticket.repo, ticket.number)
    },
    setAssignee: (ticket, from, to) =>
      deps.repoIssues.setAssignee(ticket.repo, ticket.number, from, to),
    details: async (key) => {
      const { repo, number } = issueIn(key)
      return deps.ticketDetails(repo, number)
    },
    postComment: async (key, body) => {
      const { repo, number } = issueIn(key)
      return deps.postComment(repo, number, body)
    },
    async create(title, body, where, parent) {
      const parentIssue = parent === undefined ? undefined : parseTicketKey(parent)
      const repo = repoOf(p, parentIssue?.repo ?? where).github
      const { id, number } = await deps.repoIssues.create(repo, title, body, parentIssue?.number)
      const key = `${repo}#${number}`
      if (p.board) {
        const { source, statusMap } = p.board
        try {
          await deps.board.setStatus(source, await deps.board.addItem(source, id), statusMap.todo)
        } catch (err) {
          throw new Error(
            `${CREATED} ${key}, but couldn't put it in ${statusMap.todo} on the board: ${(err as Error).message}`,
            { cause: err }
          )
        }
      }
      return key
    },
    viewer: () => deps.githubViewer(),
    areas: (ticket) => deps.areas.list(repoOf(p, ticket.repo).github),
    applyTriage: async (key, t) => {
      const { repo, number } = issueIn(key)
      return deps.areas.apply(repo, number, t)
    }
  }
}

/** The tracker a project takes its tickets from: its Linear team, Jira project, or GitHub repos and board. */
export function trackerOf(p: Project, deps: TrackerDeps): Tracker {
  if (p.linear)
    return teamTracker(
      deps.linear(p.linear.workspace),
      p.linear.team,
      p.linear.projects.map((x) => x.id),
      p.linear
    )
  if (p.jira) return teamTracker(deps.jira(p.jira.site).forBoard(p.jira.board), p.jira.project, [])
  return githubTracker(p, deps)
}

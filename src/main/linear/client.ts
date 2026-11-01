import { AREA_PREFIX, areaOf } from '../../shared/areas'
import { columnFor, LINEAR_STATUS, statusField } from '../../shared/columns'
import type { BoardColumn, LinearTeam, LinearWorkspace, Ticket, IssueRef } from '../../shared/types'
import { cliToken, graphqlWith, paginate, runCli, type GraphqlFn } from '../github/graphql'
import { newestMerged } from '../github/repoIssues'
import type { TeamClient } from '../tracker'

export type LinearClient = TeamClient & {
  teams(): Promise<LinearTeam[]>
}

const TEAMS = `
query($cursor: String) {
  teams(first: 50, after: $cursor) { pageInfo { hasNextPage endCursor } nodes { key name } }
}`

const PROJECTS = `
query($cursor: String) {
  projects(first: 100, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes { id name teams(first: 50) { nodes { key } } }
  }
}`

const ISSUES = `
query($filter: IssueFilter!, $cursor: String) {
  issues(first: 100, after: $cursor, filter: $filter, orderBy: updatedAt) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id identifier number title description url createdAt updatedAt completedAt state { type name }
      labels(first: 50) { nodes { name color } }
      assignee { id name displayName }
      parent { identifier number title url state { type } children(first: 100) { nodes { state { type } } } }
      children(first: 100) { nodes { identifier number title url state { type } assignee { displayName } } }
      inverseRelations(first: 50) { nodes { type issue { identifier number title state { type } } } }
      attachments(first: 20) { nodes { sourceType url metadata } }
    }
  }
}`

const STATES = `
query($team: String!) {
  team(id: $team) { id states(first: 100) { nodes { id name type position } } }
}`

const UPDATE_STATE = `
mutation($id: String!, $stateId: String!) {
  issueUpdate(id: $id, input: { stateId: $stateId }) { success }
}`

const UPDATE_ASSIGNEE = `
mutation($id: String!, $assigneeId: String) {
  issueUpdate(id: $id, input: { assigneeId: $assigneeId }) { success }
}`

const CREATE = `
mutation($input: IssueCreateInput!) {
  issueCreate(input: $input) { issue { identifier } }
}`

const DETAILS = `
query($id: String!) {
  issue(id: $id) {
    description
    labels(first: 50) { nodes { name color } }
    comments(first: 100, orderBy: createdAt) { nodes { body createdAt user { displayName } botActor { name } } }
    attachments(first: 50) { nodes { sourceType url title metadata } }
  }
}`

const COMMENT = `
mutation($issueId: String!, $body: String!) {
  commentCreate(input: { issueId: $issueId, body: $body }) { success }
}`

const AREAS = `
query($team: String!, $cursor: String) {
  issueLabels(
    first: 100
    after: $cursor
    filter: { name: { startsWith: "${AREA_PREFIX}" }, team: { key: { eq: $team } } }
  ) { pageInfo { hasNextPage endCursor } nodes { id name description isGroup } }
}`

const ISSUE_AREA = `
query($id: String!) {
  issue(id: $id) { labels(first: 100) { nodes { name } } team { id key } }
}`

const CREATE_LABEL = `
mutation($input: IssueLabelCreateInput!) {
  issueLabelCreate(input: $input) { issueLabel { id } }
}`

const ADD_LABEL = `
mutation($id: String!, $labelId: String!) {
  issueAddLabel(id: $id, labelId: $labelId) { success }
}`

const ADD_RELATION = `
mutation($input: IssueRelationCreateInput!) {
  issueRelationCreate(input: $input) { success }
}`

/** Authenticates with the API key from `linear auth token`, for workspace or else the CLI's default. */
export async function linearGraphql(workspace?: string): Promise<GraphqlFn> {
  const key = await cliToken(
    'linear',
    'Linear',
    `Linear CLI is not signed in${workspace ? ` to ${workspace}` : ''}; run \`linear auth login\``,
    workspace ? ['--workspace', workspace] : []
  )
  return graphqlWith('https://api.linear.app/graphql', key, 'Linear')
}

/** The workspaces `linear auth list` shows, marking the CLI's default. */
export async function linearWorkspaces(): Promise<LinearWorkspace[]> {
  const { stdout, stderr, code } = await runCli('linear', 'Linear', ['auth', 'list'])
  if (code !== 0)
    throw new Error(
      stderr.trim() || stdout.trim() || `\`linear auth list\` exited with code ${code}`
    )
  const lines = stdout.split('\n')
  const at = lines.findIndex((l) => l.includes('WORKSPACE'))
  const header = lines[at] ?? ''
  const slugAt = header.indexOf('WORKSPACE')
  const orgAt = header.indexOf('ORGANIZATION')
  const userAt = header.indexOf('USER')
  if (slugAt < 0 || orgAt < 0 || userAt < 0)
    throw new Error(stdout.trim() || '`linear auth list` printed no workspaces')
  return lines
    .slice(at + 1)
    .filter((r) => r.trim())
    .map((r) => ({
      slug: r.slice(slugAt, orgAt).trim(),
      organization: r.slice(orgAt, userAt).trim(),
      default: r.slice(0, slugAt).includes('*')
    }))
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const closed = (s: { type: string }): boolean =>
  s.type === 'completed' || s.type === 'canceled' || s.type === 'duplicate'

const COLUMN_NAMES: Record<BoardColumn, string> = {
  todo: 'todo',
  inProgress: 'in progress',
  done: 'done'
}

const labels = (l: any): { name: string; color: string }[] =>
  l.nodes.map((n: any) => ({ name: n.name, color: n.color.replace(/^#/, '') }))

const ref = (i: any): IssueRef => ({
  key: i.identifier,
  number: i.number,
  title: i.title,
  repo: '',
  url: i.url,
  column: columnFor(
    i.state.type === 'backlog' || i.state.type === 'triage' ? LINEAR_STATUS.todo : i.state.type,
    LINEAR_STATUS
  )
})

const toTicket = (i: any): Ticket => ({
  key: i.identifier,
  itemId: i.id,
  number: i.number,
  title: i.title,
  body: i.description ?? '',
  url: i.url,
  repo: '',
  status: i.state.type,
  doneAt: i.completedAt,
  labels: labels(i.labels),
  assignees: i.assignee
    ? [{ id: i.assignee.id, login: i.assignee.displayName, name: i.assignee.name }]
    : [],
  createdAt: i.createdAt,
  updatedAt: i.updatedAt,
  parent: i.parent && {
    ...ref(i.parent),
    subIssues: {
      completed: i.parent.children.nodes.filter((c: any) => closed(c.state)).length,
      total: i.parent.children.nodes.length
    }
  },
  subIssues: {
    completed: i.children.nodes.filter((c: any) => closed(c.state)).length,
    total: i.children.nodes.length,
    items: i.children.nodes.map((c: any) => ({
      ...ref(c),
      assignee: c.assignee?.displayName ?? null
    }))
  },
  boardFields: statusField(LINEAR_STATUS, COLUMN_NAMES, i.state.type, i.state.name),
  blockedBy: i.inverseRelations.nodes
    .filter((r: any) => r.type === 'blocks' && !closed(r.issue.state))
    .map((r: any) => ({
      key: r.issue.identifier,
      number: r.issue.number,
      title: r.issue.title,
      repo: ''
    })),
  ...newestMerged(
    i.attachments.nodes
      .filter((a: any) => a.sourceType === 'github')
      .map((a: any) => ({ url: a.url, mergedAt: a.metadata?.mergedAt }))
  ),
  prStage: null
})

/** Builds a client that reads and changes a Linear team's issues. */
export function createLinearClient(gql: GraphqlFn): LinearClient {
  const stateOf = async (
    team: string,
    column: BoardColumn
  ): Promise<{ teamId: string; stateId: string }> => {
    const type = LINEAR_STATUS[column]
    const data = await gql(STATES, { team })
    const states = data.team.states.nodes
      .filter((s: any) => s.type === type)
      .sort((a: any, b: any) => a.position - b.position)
    const state =
      states.find((s: any) => s.name.toLowerCase() === COLUMN_NAMES[column]) ?? states[0]
    if (!state) throw new Error(`Linear team ${team} has no ${type} state`)
    return { teamId: data.team.id, stateId: state.id }
  }
  const areaLabels = async (
    team: string
  ): Promise<{ id: string; name: string; description: string | null }[]> =>
    (await paginate(gql, AREAS, { team }, (d) => d.issueLabels)).filter(
      (l) => l.name.startsWith(AREA_PREFIX) && !l.isGroup
    )
  return {
    viewer: async () => (await gql('query { viewer { displayName } }', {})).viewer.displayName,

    async teams() {
      const [teams, projects] = await Promise.all([
        paginate(gql, TEAMS, {}, (d) => d.teams),
        paginate(gql, PROJECTS, {}, (d) => d.projects)
      ])
      return teams.map((t) => ({
        key: t.key,
        name: t.name,
        projects: projects
          .filter((p) => p.teams.nodes.some((pt: any) => pt.key === t.key))
          .map((p) => ({ id: p.id, name: p.name }))
      }))
    },
    async tickets(team, projectIds, closedSince, alsoNumbers, truncated) {
      const current = {
        or: [
          { state: { type: { in: ['unstarted', 'started'] } } },
          { completedAt: { gte: closedSince } }
        ]
      }
      // Linear ORs sibling fields inside an `or` entry, so the project needs an explicit `and`.
      const filter = {
        team: { key: { eq: team } },
        or: [
          projectIds.length > 0
            ? { and: [{ project: { id: { in: projectIds } } }, current] }
            : current,
          { number: { in: alsoNumbers } }
        ]
      }
      const issues = await paginate(gql, ISSUES, { filter }, (d) => d.issues, {
        pages: 10,
        truncated: () =>
          truncated?.(
            `Linear team ${team} has more than 1,000 open or recently done issues; Sandtable shows the 1,000 most recently updated.`
          )
      })
      return issues.map(toTicket)
    },
    async setColumn(team, identifier, column) {
      const { stateId } = await stateOf(team, column)
      await gql(UPDATE_STATE, { id: identifier, stateId })
    },
    async setAssignee(identifier, assigneeId) {
      await gql(UPDATE_ASSIGNEE, { id: identifier, assigneeId })
    },
    async details(identifier) {
      const { issue: i } = await gql(DETAILS, { id: identifier })
      if (!i) throw new Error('Issue not found')
      return {
        body: i.description ?? '',
        labels: labels(i.labels),
        comments: i.comments.nodes
          .map((c: any) => ({
            author: c.user?.displayName ?? c.botActor?.name ?? 'Unknown',
            createdAt: c.createdAt,
            body: c.body
          }))
          .sort((a: any, b: any) => a.createdAt.localeCompare(b.createdAt)),
        pullRequests: i.attachments.nodes
          .filter((a: any) => a.sourceType === 'github' && a.metadata?.number !== undefined)
          .map((a: any) => ({
            number: a.metadata.number,
            title: a.metadata.title ?? a.title,
            url: a.url,
            state:
              a.metadata.status === 'merged' || a.metadata.status === 'closed'
                ? a.metadata.status
                : 'open'
          }))
      }
    },
    async postComment(identifier, body) {
      await gql(COMMENT, { issueId: identifier, body })
    },
    async areas(team) {
      return (await areaLabels(team)).map((l) => ({
        name: l.name,
        description: l.description ?? ''
      }))
    },
    async applyTriage(team, identifier, t) {
      const { issue } = await gql(ISSUE_AREA, { id: identifier })
      if (!issue) throw new Error('Issue not found')
      if (issue.team.key !== team) throw new Error(`${identifier} is not in team ${team}`)
      const has = areaOf(issue.labels.nodes)
      if (has) throw new Error(`${identifier} already has ${has}`)
      const existing = await areaLabels(team)
      const ids = new Map(existing.map((l) => [l.name, l.id]))
      const unfinished = existing.every((l) => t.newAreas.some((a) => a.name === l.name))
      for (const a of unfinished ? t.newAreas : []) {
        if (ids.has(a.name)) continue
        const input = { teamId: issue.team.id, name: a.name, description: a.description }
        ids.set(a.name, (await gql(CREATE_LABEL, { input })).issueLabelCreate.issueLabel.id)
      }
      const labelId = ids.get(t.area)
      if (!labelId) throw new Error(`Label "${t.area}" not found`)
      for (const b of t.blockedBy)
        await gql(ADD_RELATION, {
          input: { issueId: b.key, relatedIssueId: identifier, type: 'blocks' }
        })
      await gql(ADD_LABEL, { id: identifier, labelId })
    },
    async create(team, title, body, projectId, parentId) {
      const input = {
        ...(await stateOf(team, 'todo')),
        title,
        description: body,
        ...(projectId && { projectId }),
        ...(parentId && { parentId })
      }
      const data = await gql(CREATE, { input })
      const issue = data.issueCreate.issue
      if (!issue) throw new Error("Linear didn't return the new issue")
      return issue.identifier
    }
  }
}

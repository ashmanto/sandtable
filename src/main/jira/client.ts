import { AREA_PREFIX, areaOf } from '../../shared/areas'
import { columnFor, COLUMNS, JIRA_STATUS, statusField } from '../../shared/columns'
import { CREATED } from '../../shared/repo'
import type { BoardColumn, IssueRef, JiraProject, Ticket } from '../../shared/types'
import type { TeamClient } from '../tracker'
import type { JiraFn } from './rest'

/** True for a Jira project key such as `INF`. */
export const isJiraProjectKey = (key: string): boolean => /^[A-Z][A-Z0-9_]*$/.test(key)

/** A tracker client for one Jira site, where `team` is a Jira project key. */
export type JiraClient = TeamClient & {
  projects(): Promise<{ key: string; name: string }[]>
  boards(project: string): Promise<JiraBoard[]>
  forBoard(board?: JiraBoard): TeamClient
}

/** A Jira board a project follows, whose active sprints, or columns, are what Sandtable shows. */
type JiraBoard = NonNullable<JiraProject['board']>

const goneBoard = (board: JiraBoard): string =>
  `The Jira board ${board.name} no longer exists; edit the project to pick another.`

/* eslint-disable @typescript-eslint/no-explicit-any */
const FIELDS = [
  'summary',
  'description',
  'status',
  'labels',
  'assignee',
  'created',
  'updated',
  'statuscategorychangedate',
  'parent',
  'subtasks',
  'issuelinks'
]

const TITLES = Object.fromEntries(COLUMNS.map((c) => [c.id, c.title])) as Record<
  BoardColumn,
  string
>

const issuePath = (key: string, rest = ''): string =>
  `/rest/api/2/issue/${encodeURIComponent(key)}${rest}`

const iso = (jiraDate: string): string => new Date(jiraDate).toISOString()
const numberOf = (key: string): number => Number(key.slice(key.lastIndexOf('-') + 1))
const categoryOf = (i: any): string => i.fields.status.statusCategory.key
const labels = (names: string[]): { name: string; color: string }[] =>
  names.map((name) => ({ name, color: '' }))

const gone = (err: any): undefined => {
  if (err?.status === 404 || err?.status === 403) return undefined
  throw err
}

const toTicket = (i: any): Ticket => {
  const f = i.fields
  const done = categoryOf(i) === JIRA_STATUS.done
  const origin = new URL(i.self).origin
  const ref = (r: any): IssueRef => ({
    key: r.key,
    number: numberOf(r.key),
    title: r.fields.summary,
    repo: '',
    url: `${origin}/browse/${r.key}`,
    column: columnFor(categoryOf(r), JIRA_STATUS)
  })
  return {
    key: i.key,
    itemId: i.id,
    number: numberOf(i.key),
    title: f.summary,
    body: f.description ?? '',
    url: `${origin}/browse/${i.key}`,
    repo: '',
    status: categoryOf(i),
    doneAt: done ? iso(f.statuscategorychangedate ?? f.updated) : null,
    labels: labels(f.labels ?? []),
    assignees: f.assignee
      ? [{ id: f.assignee.accountId, login: f.assignee.displayName, name: null }]
      : [],
    createdAt: iso(f.created),
    updatedAt: iso(f.updated),
    parent: f.parent ? ref(f.parent) : null,
    subIssues: {
      completed: (f.subtasks ?? []).filter((s: any) => categoryOf(s) === JIRA_STATUS.done).length,
      total: (f.subtasks ?? []).length,
      items: (f.subtasks ?? []).map((s: any) => ({ ...ref(s), assignee: null }))
    },
    boardFields: statusField(JIRA_STATUS, TITLES, categoryOf(i), f.status.name),
    blockedBy: (f.issuelinks ?? [])
      .filter(
        (l: any) =>
          l.type.inward?.toLowerCase() === 'is blocked by' &&
          l.inwardIssue &&
          categoryOf(l.inwardIssue) !== JIRA_STATUS.done
      )
      .map((l: any) => ({
        key: l.inwardIssue.key,
        number: numberOf(l.inwardIssue.key),
        title: l.inwardIssue.fields.summary,
        repo: ''
      })),
    mergedPr: null,
    mergedAt: null,
    prStage: null
  }
}

/** Builds a client that reads and changes a Jira site's issues through rest. */
export function createJiraClient(rest: JiraFn): JiraClient {
  const offsetPages = async <T>(path: string, size: number): Promise<T[]> => {
    const values: T[] = []
    for (;;) {
      const page = await rest(
        'GET',
        `${path}${path.includes('?') ? '&' : '?'}startAt=${values.length}&maxResults=${size}`
      )
      values.push(...page.values)
      if (page.isLast || page.values.length === 0) return values
    }
  }
  const search = async (jql: string, fields: string[], capped?: () => void): Promise<any[]> => {
    const issues: any[] = []
    let nextPageToken: string | undefined
    for (let pages = 1; ; pages++) {
      const page = await rest('POST', '/rest/api/2/search/jql', {
        jql,
        fields,
        maxResults: 100,
        ...(nextPageToken && { nextPageToken })
      })
      issues.push(...page.issues)
      if (page.isLast || !page.nextPageToken) return issues
      if (pages >= 10) {
        capped?.()
        return issues
      }
      nextPageToken = page.nextPageToken
    }
  }
  // shortcut: reads labels from the project's 1,000 most recent labeled issues; page further if areas go missing.
  const areaNames = async (team: string): Promise<string[]> => [
    ...new Set(
      (await search(`project = "${team}" AND labels is not EMPTY`, ['labels']))
        .flatMap((i) => (i.fields.labels ?? []) as string[])
        .filter((l) => l.startsWith(AREA_PREFIX))
    )
  ]
  const status = (err: any): number | undefined => err?.status
  const backlogKeys = async (
    board: JiraBoard,
    truncated?: (message: string) => void
  ): Promise<Set<string> | 'gone'> => {
    const keys = new Set<string>()
    for (let fetched = 0; ;) {
      const page = await rest(
        'GET',
        `/rest/agile/1.0/board/${board.id}/backlog?fields=key&startAt=${fetched}&maxResults=100`
      ).catch((err: any) => {
        if (status(err) === 400) return null
        if (status(err) === 404) return 'gone' as const
        throw err
      })
      if (page === 'gone') return page
      if (!page) return keys
      for (const i of page.issues) keys.add(i.key)
      fetched += page.issues.length
      if (!page.issues.length || fetched >= page.total) return keys
      if (fetched >= 1000) {
        truncated?.(
          "The Jira board's backlog has more than 1,000 issues; Sandtable hides the first 1,000 and may show the rest in To do."
        )
        return keys
      }
    }
  }
  const activeSprints = async (board: JiraBoard): Promise<number[] | 'no sprints' | 'gone'> => {
    const sprints = await offsetPages<any>(
      `/rest/agile/1.0/board/${board.id}/sprint?state=active`,
      50
    ).catch((err: any) => {
      if (status(err) === 400) return 'no sprints' as const
      if (status(err) === 404) return 'gone' as const
      throw err
    })
    if (typeof sprints === 'string') return sprints
    if (!sprints.every((x) => Number.isInteger(x.id)))
      throw new Error("Jira returned a sprint ID that isn't a number")
    return sprints.map((x) => x.id)
  }
  const placeOnBoard = async (board: JiraBoard, key: string): Promise<void> => {
    const notPlaced = (err: Error): never => {
      throw new Error(`${CREATED} ${key}, but couldn't put it on the board: ${err.message}`)
    }
    const sprints = await activeSprints(board).catch(notPlaced)
    if (!Array.isArray(sprints)) return
    if (sprints.length !== 1)
      throw new Error(`${CREATED} ${key} in the backlog: the board has no single active sprint`)
    await rest('POST', `/rest/agile/1.0/sprint/${sprints[0]}/issue`, { issues: [key] }).catch(
      notPlaced
    )
  }
  const written = new Map<string, number>()
  const wrote = (key: string): void => void written.set(key, Date.now())
  const ticketsOn = async (
    board: JiraBoard | undefined,
    team: string,
    closedSince: string,
    alsoNumbers: number[],
    truncated?: (message: string) => void
  ): Promise<Ticket[]> => {
    if (!isJiraProjectKey(team)) throw new Error(`${team} is not a Jira project key`)
    const minutes = Math.ceil((Date.now() - Date.parse(closedSince)) / 60_000)
    const sprints = board ? await activeSprints(board) : 'no sprints'
    const scoped = Array.isArray(sprints)
    const inSprint = scoped && sprints.length ? ` AND sprint in (${sprints.join(', ')})` : ''
    const jql = `project = "${team}" AND (statusCategory != Done OR statuscategorychangedate >= "-${minutes}m")${inSprint} ORDER BY updated DESC`
    const issues =
      scoped && sprints.length === 0
        ? []
        : await search(jql, FIELDS, () =>
            truncated?.(
              `Jira project ${team} has more than 1,000 open or recently done issues; Sandtable shows the 1,000 most recently updated.`
            )
          )
    for (const [key, at] of written) if (Date.now() - at >= 120_000) written.delete(key)
    const found = new Set(issues.map((i) => i.key))
    const ours = (key: string): boolean => key.startsWith(`${team}-`)
    const byKey = new Set([
      ...[...written.keys()].filter(ours),
      ...alsoNumbers.map((n) => `${team}-${n}`).filter((k) => !found.has(k))
    ])
    for (const key of byKey) {
      const i = await rest('GET', issuePath(key, `?fields=${FIELDS.join(',')}`)).catch(gone)
      if (!i || !ours(i.key)) continue
      const at = issues.findIndex((x) => x.key === i.key)
      if (at >= 0) issues[at] = i
      else issues.push(i)
    }
    if (sprints === 'gone') truncated?.(goneBoard(board!))
    if (!board || sprints !== 'no sprints') return issues.map(toTicket)
    const backlog = await backlogKeys(board, truncated)
    if (backlog === 'gone') {
      truncated?.(goneBoard(board))
      return issues.map(toTicket)
    }
    const keep = new Set([...written.keys(), ...alsoNumbers.map((n) => `${team}-${n}`)])
    return issues.filter((i) => !backlog.has(i.key) || keep.has(i.key)).map(toTicket)
  }
  const createOn = async (
    board: JiraBoard | undefined,
    team: string,
    title: string,
    body: string
  ): Promise<string> => {
    const { issueTypes } = await rest('GET', `/rest/api/2/project/${encodeURIComponent(team)}`)
    const type =
      issueTypes.find((t: any) => t.name === 'Task' && !t.subtask) ??
      issueTypes.find((t: any) => !t.subtask)
    if (!type) throw new Error(`Jira project ${team} has no issue type for a new ticket`)
    const created = await rest('POST', '/rest/api/2/issue', {
      fields: {
        project: { key: team },
        summary: title,
        description: body,
        issuetype: { id: type.id }
      }
    })
    if (!created?.key) throw new Error("Jira didn't return the new issue")
    wrote(created.key)
    if (board) await placeOnBoard(board, created.key)
    return created.key
  }
  const base: Omit<TeamClient, 'tickets' | 'create'> & Pick<JiraClient, 'projects' | 'boards'> = {
    viewer: async () => (await rest('GET', '/rest/api/2/myself')).displayName,

    projects: async () =>
      (await offsetPages<any>('/rest/api/2/project/search', 50)).map((p) => ({
        key: p.key,
        name: p.name
      })),

    boards: async (project: string) =>
      (
        await offsetPages<any>(
          `/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(project)}`,
          50
        )
      ).map((b) => ({ id: b.id, name: b.name })),

    async setColumn(_team, key, column) {
      const { transitions } = await rest('GET', issuePath(key, '/transitions'))
      const into = transitions.filter((t: any) => t.to.statusCategory.key === JIRA_STATUS[column])
      const t =
        into.find((t: any) => t.to.name.toLowerCase() === TITLES[column].toLowerCase()) ?? into[0]
      if (!t) throw new Error(`${key} has no Jira transition to ${TITLES[column]}`)
      await rest('POST', issuePath(key, '/transitions'), { transition: { id: t.id } })
      wrote(key)
    },
    async setAssignee(key, accountId) {
      await rest('PUT', issuePath(key, '/assignee'), { accountId })
      wrote(key)
    },
    async details(key) {
      const { fields: f } = await rest('GET', issuePath(key, '?fields=description,labels,comment'))
      return {
        body: f.description ?? '',
        labels: labels(f.labels ?? []),
        comments: f.comment.comments
          .map((c: any) => ({
            author: c.author?.displayName ?? 'Unknown',
            createdAt: iso(c.created),
            body: c.body
          }))
          .sort((a: any, b: any) => a.createdAt.localeCompare(b.createdAt)),
        pullRequests: []
      }
    },
    async postComment(key, body) {
      await rest('POST', issuePath(key, '/comment'), { body })
    },
    areas: async (team) => (await areaNames(team)).map((name) => ({ name, description: '' })),
    async applyTriage(team, key, t) {
      if (/\s/.test(t.area)) throw new Error(`Jira labels cannot contain spaces: "${t.area}"`)
      const { fields: f } = await rest('GET', issuePath(key, '?fields=labels,project'))
      if (f.project.key !== team) throw new Error(`${key} is not in Jira project ${team}`)
      const has = areaOf((f.labels ?? []).map((name: string) => ({ name })))
      if (has) throw new Error(`${key} already has ${has}`)
      const existing = await areaNames(team)
      const unfinished = existing.every((l) => t.newAreas.some((a) => a.name === l))
      const known = [...existing, ...(unfinished ? t.newAreas.map((a) => a.name) : [])]
      if (!known.includes(t.area)) throw new Error(`Label "${t.area}" not found`)
      if (t.blockedBy.length) {
        const { issueLinkTypes } = await rest('GET', '/rest/api/2/issueLinkType')
        const type = issueLinkTypes.find((x: any) => x.outward?.toLowerCase() === 'blocks')
        if (!type) throw new Error('Jira has no link type that blocks')
        for (const b of t.blockedBy)
          await rest('PUT', issuePath(key), {
            update: {
              issuelinks: [{ add: { type: { name: type.name }, inwardIssue: { key: b.key } } }]
            }
          })
      }
      await rest('PUT', issuePath(key), { update: { labels: [{ add: t.area }] } })
      wrote(key)
    }
  }
  const forBoard = (board?: JiraBoard): TeamClient => ({
    ...base,
    tickets: (team, _projectIds, closedSince, alsoNumbers, truncated) =>
      ticketsOn(board, team, closedSince, alsoNumbers, truncated),
    create: async (team, title, body, _projectId, parentId) => {
      if (parentId !== undefined) throw new Error("Jira sub-tasks aren't supported")
      return createOn(board, team, title, body)
    }
  })
  return { ...forBoard(), projects: base.projects, boards: base.boards, forBoard }
}

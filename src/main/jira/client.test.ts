import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { columnFor, JIRA_STATUS } from '../../shared/columns'
import { createJiraClient } from './client'

type Call = { method: string; path: string; body?: unknown }

function fake(handler: (method: string, path: string, body?: unknown) => unknown): {
  calls: Call[]
  rest: (method: string, path: string, body?: unknown) => Promise<unknown>
} {
  const calls: Call[] = []
  return {
    calls,
    rest: async (method, path, body) => {
      calls.push({ method, path, body })
      return handler(method, path, body)
    }
  }
}

const category = (key: string): { key: string } => ({ key })

const BOARD = { id: 379, name: 'INF board' }

const issue = (n: number, fields: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: `100${n}`,
  key: `INF-${n}`,
  self: `https://acme.atlassian.net/rest/api/2/issue/100${n}`,
  fields: {
    summary: `t${n}`,
    description: `d${n}`,
    status: { name: 'To Do', statusCategory: category('new') },
    labels: [],
    assignee: null,
    created: '2026-10-01T10:00:00.000+0200',
    updated: '2026-10-02T10:00:00.000+0000',
    statuscategorychangedate: '2026-10-02T10:00:00.000+0000',
    parent: undefined,
    subtasks: [],
    issuelinks: [],
    ...fields
  }
})

const searchPage = (issues: unknown[], next?: string): unknown => ({
  issues,
  nextPageToken: next,
  isLast: next === undefined
})

describe('createJiraClient tickets', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-29T12:00:00.000Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('searches the project for open and recently done issues, in whole minutes', async () => {
    const { calls, rest } = fake(() => searchPage([issue(1)]))
    await createJiraClient(rest).tickets('INF', [], '2026-10-22T11:59:30.000Z', [])
    expect(calls).toEqual([
      {
        method: 'POST',
        path: '/rest/api/2/search/jql',
        body: expect.objectContaining({
          jql: 'project = "INF" AND (statusCategory != Done OR statuscategorychangedate >= "-10081m") ORDER BY updated DESC',
          maxResults: 100
        })
      }
    ])
  })

  it('fetches asked-for issues the search missed, skipping ones Jira no longer shows', async () => {
    const gone = (status: number): Error =>
      Object.assign(new Error(`Jira answered ${status}: Issue does not exist`), { status })
    const { calls, rest } = fake((_m, path) => {
      if (path === '/rest/api/2/search/jql') return searchPage([issue(1)])
      if (path.includes('INF-7')) throw gone(404)
      if (path.includes('INF-8')) throw gone(403)
      return issue(9)
    })
    const ts = await createJiraClient(rest).tickets('INF', [], '2026-10-22T12:00:00Z', [1, 7, 8, 9])
    expect(ts.map((t) => t.key)).toEqual(['INF-1', 'INF-9'])
    expect(calls.slice(1).map((c) => c.path)).toEqual([
      expect.stringMatching(/^\/rest\/api\/2\/issue\/INF-7\?fields=summary,description,status,/),
      expect.stringMatching(/^\/rest\/api\/2\/issue\/INF-8\?fields=/),
      expect.stringMatching(/^\/rest\/api\/2\/issue\/INF-9\?fields=/)
    ])
  })

  it('keeps other errors from an asked-for issue', async () => {
    const { rest } = fake((_m, path) => {
      if (path === '/rest/api/2/search/jql') return searchPage([])
      throw Object.assign(new Error('Jira answered 500: Boom'), { status: 500 })
    })
    await expect(
      createJiraClient(rest).tickets('INF', [], '2026-10-22T12:00:00Z', [7])
    ).rejects.toThrow('Jira answered 500: Boom')
  })

  it('reads back by key what it changed in the last two minutes, over a lagging search', async () => {
    const moved = {
      transitions: [
        {
          id: '21',
          name: 'Start',
          to: { name: 'In Progress', statusCategory: category('indeterminate') }
        }
      ]
    }
    const started = issue(1, {
      status: { name: 'In Progress', statusCategory: category('indeterminate') }
    })
    const { calls, rest } = fake((m, path) => {
      if (path === '/rest/api/2/search/jql') return searchPage([issue(1)])
      if (path.endsWith('/transitions')) return m === 'GET' ? moved : undefined
      if (m === 'POST' && path === '/rest/api/2/issue') return { key: 'INF-40' }
      if (path.startsWith('/rest/api/2/project/'))
        return { issueTypes: [{ id: '3', name: 'Task', subtask: false }] }
      if (path.startsWith('/rest/api/2/issue/INF-40?')) return issue(40)
      if (path.startsWith('/rest/api/2/issue/INF-1?')) return started
      return undefined
    })
    const client = createJiraClient(rest)
    await client.setColumn('INF', 'INF-1', 'inProgress')
    await expect(client.create('INF', 'Sub', '', undefined, 'INF-1')).rejects.toThrow(
      "Jira sub-tasks aren't supported"
    )
    await expect(
      client.forBoard(BOARD).create('INF', 'Sub', '', undefined, 'INF-1')
    ).rejects.toThrow("Jira sub-tasks aren't supported")
    await client.create('INF', 'New', '')
    const fresh = await client.tickets('INF', [], '2026-10-22T12:00:00Z', [])
    expect(fresh.map((t) => [t.key, t.status])).toEqual([
      ['INF-1', 'indeterminate'],
      ['INF-40', 'new']
    ])
    vi.setSystemTime(new Date('2026-10-29T12:02:01.000Z'))
    calls.length = 0
    const later = await client.tickets('INF', [], '2026-10-22T12:00:00Z', [])
    expect(later.map((t) => [t.key, t.status])).toEqual([['INF-1', 'new']])
    expect(calls).toHaveLength(1)
  })

  describe('with a board', () => {
    const backlogPage = (keys: string[], startAt: number, total: number): unknown => ({
      issues: keys.map((key) => ({ key })),
      startAt,
      maxResults: 100,
      total
    })
    const noSprints = (): never => {
      throw Object.assign(new Error('Jira answered 400: The board does not support sprints'), {
        status: 400
      })
    }
    const sprintsPath = '/rest/agile/1.0/board/379/sprint?state=active'

    it("shows only the issues in the board's active sprints", async () => {
      const { calls, rest } = fake((_m, path) => {
        if (path.startsWith(sprintsPath))
          return path.includes('startAt=0')
            ? { values: [{ id: 2329 }], isLast: false }
            : { values: [{ id: 2330 }], isLast: true }
        return searchPage([issue(1)])
      })
      const ts = await createJiraClient(rest)
        .forBoard(BOARD)
        .tickets('INF', [], '2026-10-22T12:00:00Z', [])
      expect(ts.map((t) => t.key)).toEqual(['INF-1'])
      expect(
        (calls.find((c) => c.path === '/rest/api/2/search/jql')?.body as { jql: string }).jql
      ).toContain(') AND sprint in (2329, 2330) ORDER BY updated DESC')
      expect(calls.some((c) => c.path.includes('backlog'))).toBe(false)
    })

    it('shows only session issues and recent writes while no sprint is active', async () => {
      const { calls, rest } = fake((_m, path) => {
        if (path.startsWith(sprintsPath)) return { values: [], isLast: true }
        if (path.startsWith('/rest/api/2/issue/INF-3?')) return issue(3)
        return searchPage([issue(1)])
      })
      const ts = await createJiraClient(rest)
        .forBoard(BOARD)
        .tickets('INF', [], '2026-10-22T12:00:00Z', [3])
      expect(ts.map((t) => t.key)).toEqual(['INF-3'])
      expect(calls.some((c) => c.path === '/rest/api/2/search/jql')).toBe(false)
    })

    it('refuses a sprint ID that is not a whole number', async () => {
      const { rest } = fake((_m, path) =>
        path.startsWith(sprintsPath)
          ? { values: [{ id: '1) OR (1' }], isLast: true }
          : searchPage([])
      )
      await expect(
        createJiraClient(rest).forBoard(BOARD).tickets('INF', [], '2026-10-22T12:00:00Z', [])
      ).rejects.toThrow("Jira returned a sprint ID that isn't a number")
    })

    it('hides the backlog of a board without sprints, apart from session issues and its own recent writes', async () => {
      const moved = {
        transitions: [
          {
            id: '21',
            name: 'Start',
            to: { name: 'In Progress', statusCategory: category('indeterminate') }
          }
        ]
      }
      const { calls, rest } = fake((m, path) => {
        if (path === '/rest/api/2/search/jql')
          return searchPage([issue(1), issue(2), issue(3), issue(4)])
        if (path.startsWith('/rest/agile/1.0/board/379/backlog'))
          return path.includes('startAt=0')
            ? backlogPage(['INF-2', 'INF-3'], 0, 3)
            : backlogPage(['INF-4'], 2, 3)
        if (path.endsWith('/transitions')) return m === 'GET' ? moved : undefined
        if (path.startsWith('/rest/api/2/issue/INF-4?')) return issue(4)
        if (path.startsWith(sprintsPath)) noSprints()
        return undefined
      })
      const client = createJiraClient(rest)
      await client.setColumn('INF', 'INF-4', 'inProgress')
      const ts = await client.forBoard(BOARD).tickets('INF', [], '2026-10-22T12:00:00Z', [3])
      expect(ts.map((t) => t.key)).toEqual(['INF-1', 'INF-3', 'INF-4'])
      expect(calls.filter((c) => c.path.includes('backlog')).map((c) => c.path)).toEqual([
        '/rest/agile/1.0/board/379/backlog?fields=key&startAt=0&maxResults=100',
        '/rest/agile/1.0/board/379/backlog?fields=key&startAt=2&maxResults=100'
      ])
    })

    it.each([
      ['sprints', (path: string) => path.startsWith(sprintsPath)],
      ['backlog', (path: string) => path.includes('/backlog')]
    ])('says the board is gone when its %s answer 404, and hides nothing', async (_, gone) => {
      const { rest } = fake((_m, path) => {
        if (path === '/rest/api/2/search/jql') return searchPage([issue(1)])
        if (gone(path))
          throw Object.assign(new Error('Jira answered 404: Not found'), { status: 404 })
        return noSprints()
      })
      const warnings: string[] = []
      const ts = await createJiraClient(rest)
        .forBoard(BOARD)
        .tickets('INF', [], '2026-10-22T12:00:00Z', [], (m) => warnings.push(m))
      expect(ts.map((t) => t.key)).toEqual(['INF-1'])
      expect(warnings).toEqual([
        'The Jira board INF board no longer exists; edit the project to pick another.'
      ])
    })

    it('stops paging when the backlog shifts between pages', async () => {
      const { calls, rest } = fake((_m, path) =>
        path === '/rest/api/2/search/jql'
          ? searchPage([issue(1)])
          : path.startsWith(sprintsPath)
            ? noSprints()
            : backlogPage(['INF-2', 'INF-3'], 0, 3)
      )
      await createJiraClient(rest).forBoard(BOARD).tickets('INF', [], '2026-10-22T12:00:00Z', [])
      expect(calls.filter((c) => c.path.includes('backlog')).map((c) => c.path)).toEqual([
        '/rest/agile/1.0/board/379/backlog?fields=key&startAt=0&maxResults=100',
        '/rest/agile/1.0/board/379/backlog?fields=key&startAt=2&maxResults=100'
      ])
    })

    it('hides nothing on a board without a backlog', async () => {
      const { rest } = fake((_m, path) => {
        if (path === '/rest/api/2/search/jql') return searchPage([issue(1)])
        throw Object.assign(new Error('Jira answered 400: The board does not support backlog'), {
          status: 400
        })
      })
      const ts = await createJiraClient(rest)
        .forBoard(BOARD)
        .tickets('INF', [], '2026-10-22T12:00:00Z', [])
      expect(ts.map((t) => t.key)).toEqual(['INF-1'])
    })

    it('says when the backlog has more than 1,000 issues', async () => {
      let page = 0
      const keys = (n: number): string[] =>
        Array.from({ length: 100 }, (_, i) => `INF-${n * 100 + i + 1}`)
      const { rest } = fake((_m, path) =>
        path === '/rest/api/2/search/jql'
          ? searchPage([issue(1000), issue(1001)])
          : path.startsWith(sprintsPath)
            ? noSprints()
            : backlogPage(keys(page), page++ * 100, 5000)
      )
      const warnings: string[] = []
      const ts = await createJiraClient(rest)
        .forBoard(BOARD)
        .tickets('INF', [], '2026-10-22T12:00:00Z', [], (m) => warnings.push(m))
      expect(page).toBe(10)
      expect(ts.map((t) => t.key)).toEqual(['INF-1001'])
      expect(warnings).toEqual([
        "The Jira board's backlog has more than 1,000 issues; Sandtable hides the first 1,000 and may show the rest in To do."
      ])
    })
  })

  it('drops an issue fetched by key that moved to another project', async () => {
    const { rest } = fake((_m, path) =>
      path === '/rest/api/2/search/jql'
        ? searchPage([])
        : { ...issue(3), key: 'OPS-3', self: 'https://acme.atlassian.net/rest/api/2/issue/1' }
    )
    expect(await createJiraClient(rest).tickets('INF', [], '2026-10-22T12:00:00Z', [7])).toEqual([])
  })

  it('stops when a page has no next token', async () => {
    const { calls, rest } = fake(() => ({ issues: [issue(1)], isLast: false }))
    await createJiraClient(rest).tickets('INF', [], '2026-10-22T12:00:00Z', [])
    expect(calls).toHaveLength(1)
  })

  it('reads an issue with missing list fields and no category change date', async () => {
    const bare = issue(1, {
      status: { name: 'Done', statusCategory: category('done') },
      labels: undefined,
      subtasks: undefined,
      issuelinks: undefined,
      statuscategorychangedate: undefined
    })
    const { rest } = fake(() => searchPage([bare]))
    const [t] = await createJiraClient(rest).tickets('INF', [], '2026-10-22T12:00:00Z', [])
    expect(t).toMatchObject({
      labels: [],
      subIssues: { completed: 0, total: 0, items: [] },
      blockedBy: [],
      doneAt: '2026-10-02T10:00:00.000Z'
    })
  })

  it('refuses a project key that is not a Jira key', async () => {
    const { rest } = fake(() => searchPage([]))
    await expect(
      createJiraClient(rest).tickets('INF" OR 1=1', [], '2026-10-22T00:00:00Z', [])
    ).rejects.toThrow('INF" OR 1=1 is not a Jira project key')
  })

  it('maps an issue to a ticket', async () => {
    const { rest } = fake(() =>
      searchPage([
        issue(12, {
          status: { name: 'Code review', statusCategory: category('indeterminate') },
          labels: ['area:ui', 'bug'],
          assignee: { accountId: 'acc-1', displayName: 'Ada' },
          parent: {
            key: 'INF-3',
            fields: { summary: 'Epic', status: { statusCategory: category('indeterminate') } }
          },
          subtasks: [
            {
              key: 'INF-13',
              fields: { summary: 'Part', status: { statusCategory: category('done') } }
            },
            {
              key: 'INF-14',
              fields: { summary: 'Other part', status: { statusCategory: category('new') } }
            }
          ],
          issuelinks: [
            {
              type: { name: 'Block', inward: 'Is Blocked By', outward: 'blocks' },
              inwardIssue: {
                key: 'INF-4',
                fields: { summary: 'Blocker', status: { statusCategory: category('new') } }
              }
            },
            {
              type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
              inwardIssue: {
                key: 'INF-5',
                fields: { summary: 'Done blocker', status: { statusCategory: category('done') } }
              }
            },
            {
              type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
              outwardIssue: {
                key: 'INF-6',
                fields: { summary: 'Blocked', status: { statusCategory: category('new') } }
              }
            },
            {
              type: { name: 'Blocks', inward: 'relates to', outward: 'relates to' },
              inwardIssue: {
                key: 'INF-8',
                fields: { summary: 'Related', status: { statusCategory: category('new') } }
              }
            }
          ]
        })
      ])
    )
    const [t] = await createJiraClient(rest).tickets('INF', [], '2026-10-01T00:00:00Z', [])
    expect(t).toEqual({
      key: 'INF-12',
      itemId: '10012',
      number: 12,
      title: 't12',
      body: 'd12',
      url: 'https://acme.atlassian.net/browse/INF-12',
      repo: '',
      status: 'indeterminate',
      doneAt: null,
      labels: [
        { name: 'area:ui', color: '' },
        { name: 'bug', color: '' }
      ],
      assignees: [{ id: 'acc-1', login: 'Ada', name: null }],
      createdAt: '2026-10-01T08:00:00.000Z',
      updatedAt: '2026-10-02T10:00:00.000Z',
      parent: {
        key: 'INF-3',
        number: 3,
        title: 'Epic',
        repo: '',
        url: 'https://acme.atlassian.net/browse/INF-3',
        column: 'inProgress'
      },
      subIssues: {
        completed: 1,
        total: 2,
        items: [
          {
            key: 'INF-13',
            number: 13,
            title: 'Part',
            repo: '',
            url: 'https://acme.atlassian.net/browse/INF-13',
            column: 'done',
            assignee: null
          },
          {
            key: 'INF-14',
            number: 14,
            title: 'Other part',
            repo: '',
            url: 'https://acme.atlassian.net/browse/INF-14',
            column: 'todo',
            assignee: null
          }
        ]
      },
      boardFields: [{ name: 'Status', value: 'Code review' }],
      blockedBy: [{ key: 'INF-4', number: 4, title: 'Blocker', repo: '' }],
      mergedPr: null,
      mergedAt: null,
      prStage: null
    })
    expect(columnFor(t.status, JIRA_STATUS)).toBe('inProgress')
  })

  it('shows no Status chip when the status is named like its column, and dates a done issue', async () => {
    const { rest } = fake(() =>
      searchPage([
        issue(1, { description: null }),
        issue(2, { status: { name: 'In Progress', statusCategory: category('indeterminate') } }),
        issue(3, { status: { name: 'DONE', statusCategory: category('done') } })
      ])
    )
    const ts = await createJiraClient(rest).tickets('INF', [], '2026-10-01T00:00:00Z', [])
    expect(ts.map((t) => t.boardFields)).toEqual([[], [], []])
    expect(ts[0].body).toBe('')
    expect(ts.map((t) => t.doneAt)).toEqual([null, null, '2026-10-02T10:00:00.000Z'])
  })

  it('follows nextPageToken and warns after ten pages', async () => {
    const { calls, rest } = fake(() => searchPage([issue(1)], 'more'))
    const warnings: string[] = []
    const ts = await createJiraClient(rest).tickets('INF', [], '2026-10-01T00:00:00Z', [], (m) =>
      warnings.push(m)
    )
    expect(calls).toHaveLength(10)
    expect(calls[0].body).not.toHaveProperty('nextPageToken')
    expect(calls[1].body).toMatchObject({ nextPageToken: 'more' })
    expect(ts).toHaveLength(10)
    expect(warnings).toEqual([
      'Jira project INF has more than 1,000 open or recently done issues; Sandtable shows the 1,000 most recently updated.'
    ])
  })
})

describe('createJiraClient changes', () => {
  const transitions = {
    transitions: [
      { id: '11', name: 'Back', to: { name: 'Backlog', statusCategory: category('new') } },
      { id: '12', name: 'Reopen', to: { name: 'To Do', statusCategory: category('new') } },
      {
        id: '21',
        name: 'Start',
        to: { name: 'Review', statusCategory: category('indeterminate') }
      },
      { id: '31', name: 'Finish', to: { name: 'Closed', statusCategory: category('done') } }
    ]
  }

  it('moves an issue through the transition named like the column, else the first in it', async () => {
    const { calls, rest } = fake((m) => (m === 'GET' ? transitions : undefined))
    const client = createJiraClient(rest)
    await client.setColumn('INF', 'INF-1', 'todo')
    await client.setColumn('INF', 'INF-1', 'inProgress')
    expect(calls).toEqual([
      { method: 'GET', path: '/rest/api/2/issue/INF-1/transitions' },
      {
        method: 'POST',
        path: '/rest/api/2/issue/INF-1/transitions',
        body: { transition: { id: '12' } }
      },
      { method: 'GET', path: '/rest/api/2/issue/INF-1/transitions' },
      {
        method: 'POST',
        path: '/rest/api/2/issue/INF-1/transitions',
        body: { transition: { id: '21' } }
      }
    ])
  })

  it('names the column when no transition reaches it', async () => {
    const { rest } = fake(() => ({ transitions: transitions.transitions.slice(0, 2) }))
    await expect(createJiraClient(rest).setColumn('INF', 'INF-1', 'done')).rejects.toThrow(
      'INF-1 has no Jira transition to Done'
    )
  })

  it('replaces the assignee, or clears it', async () => {
    const { calls, rest } = fake(() => undefined)
    const client = createJiraClient(rest)
    await client.setAssignee('INF-1', 'acc-1')
    await client.setAssignee('INF-1', null)
    expect(calls).toEqual([
      { method: 'PUT', path: '/rest/api/2/issue/INF-1/assignee', body: { accountId: 'acc-1' } },
      { method: 'PUT', path: '/rest/api/2/issue/INF-1/assignee', body: { accountId: null } }
    ])
  })

  it('posts a comment as plain text', async () => {
    const { calls, rest } = fake(() => ({}))
    await createJiraClient(rest).postComment('INF-1', 'Hello')
    expect(calls).toEqual([
      { method: 'POST', path: '/rest/api/2/issue/INF-1/comment', body: { body: 'Hello' } }
    ])
  })

  it('encodes the key in the path', async () => {
    const { calls, rest } = fake(() => ({}))
    await createJiraClient(rest).postComment('INF-1/../x', 'Hello')
    expect(calls[0].path).toBe('/rest/api/2/issue/INF-1%2F..%2Fx/comment')
  })

  it('creates a Task, else the first type that is not a subtask', async () => {
    const types = (issueTypes: unknown[]): unknown => ({ issueTypes })
    let project = types([
      { id: '1', name: 'Sub-task', subtask: true },
      { id: '2', name: 'Bug', subtask: false },
      { id: '3', name: 'Task', subtask: false }
    ])
    const { calls, rest } = fake((m) => (m === 'GET' ? project : { key: 'INF-40' }))
    const client = createJiraClient(rest)
    expect(await client.create('INF', 'Title', 'Body')).toBe('INF-40')
    project = types([
      { id: '1', name: 'Sub-task', subtask: true },
      { id: '2', name: 'Bug', subtask: false }
    ])
    await client.create('INF', 'Title', 'Body')
    expect(calls[0]).toEqual({ method: 'GET', path: '/rest/api/2/project/INF' })
    expect(calls[1]).toEqual({
      method: 'POST',
      path: '/rest/api/2/issue',
      body: {
        fields: {
          project: { key: 'INF' },
          summary: 'Title',
          description: 'Body',
          issuetype: { id: '3' }
        }
      }
    })
    expect(calls[3].body).toMatchObject({ fields: { issuetype: { id: '2' } } })
  })

  describe('on a board', () => {
    const TYPES = { issueTypes: [{ id: '3', name: 'Task', subtask: false }] }
    const board = (
      sprints: (path: string) => unknown,
      place: () => unknown = () => undefined
    ): ReturnType<typeof fake> =>
      fake((_m, path) => {
        if (path.startsWith('/rest/api/2/project/')) return TYPES
        if (path === '/rest/api/2/issue') return { key: 'INF-12' }
        if (path.startsWith('/rest/agile/1.0/board/379/sprint')) return sprints(path)
        return place()
      })
    const placed = (calls: { method: string; path: string; body?: unknown }[]): unknown =>
      calls.filter((c) => c.method === 'POST' && c.path.startsWith('/rest/agile'))

    it("adds a new issue to the board's one active sprint", async () => {
      const { calls, rest } = board(() => ({
        values: [{ id: 2329, state: 'active' }],
        isLast: true
      }))
      expect(await createJiraClient(rest).forBoard(BOARD).create('INF', 'T', 'B')).toBe('INF-12')
      expect(calls.find((c) => c.path.includes('/sprint?'))?.path).toBe(
        '/rest/agile/1.0/board/379/sprint?state=active&startAt=0&maxResults=50'
      )
      expect(placed(calls)).toEqual([
        { method: 'POST', path: '/rest/agile/1.0/sprint/2329/issue', body: { issues: ['INF-12'] } }
      ])
    })

    it("leaves a new issue where Jira puts it on a board that doesn't run sprints", async () => {
      const { calls, rest } = board(() => {
        throw Object.assign(new Error('Jira answered 400: The board does not support sprints'), {
          status: 400
        })
      })
      expect(await createJiraClient(rest).forBoard(BOARD).create('INF', 'T', 'B')).toBe('INF-12')
      expect(placed(calls)).toEqual([])
    })

    it.each([
      ['no', []],
      ['several', [{ id: 1 }, { id: 2 }]]
    ])(
      'leaves a new issue in the backlog when %s sprints are active, and says so',
      async (_, values) => {
        const { calls, rest } = board(() => ({ values, isLast: true }))
        await expect(
          createJiraClient(rest).forBoard(BOARD).create('INF', 'T', 'B')
        ).rejects.toThrow('Created INF-12 in the backlog: the board has no single active sprint')
        expect(placed(calls)).toEqual([])
      }
    )

    it('says the issue exists when it cannot go on the board', async () => {
      const { rest } = board(
        () => ({ values: [{ id: 2329 }], isLast: true }),
        () => {
          throw new Error('Jira answered 403: Forbidden')
        }
      )
      await expect(createJiraClient(rest).forBoard(BOARD).create('INF', 'T', 'B')).rejects.toThrow(
        "Created INF-12, but couldn't put it on the board: Jira answered 403: Forbidden"
      )
      const failed = board(() => {
        throw new Error('Jira answered 500: Boom')
      })
      await expect(
        createJiraClient(failed.rest).forBoard(BOARD).create('INF', 'T', 'B')
      ).rejects.toThrow("Created INF-12, but couldn't put it on the board: Jira answered 500: Boom")
    })
  })

  it('refuses to create in a project with no issue type it can use', async () => {
    const { rest } = fake(() => ({ issueTypes: [{ id: '1', name: 'Sub-task', subtask: true }] }))
    await expect(createJiraClient(rest).create('INF', 'T', 'B')).rejects.toThrow(
      'Jira project INF has no issue type for a new ticket'
    )
  })

  it('says so when Jira returns no new issue', async () => {
    const { rest } = fake((m) =>
      m === 'GET' ? { issueTypes: [{ id: '3', name: 'Task', subtask: false }] } : {}
    )
    await expect(createJiraClient(rest).create('INF', 'T', 'B')).rejects.toThrow(
      "Jira didn't return the new issue"
    )
  })
})

describe('createJiraClient reads', () => {
  it('reads details with comments oldest first and no pull requests', async () => {
    const { calls, rest } = fake(() => ({
      fields: {
        description: null,
        labels: ['bug'],
        comment: {
          comments: [
            { author: { displayName: 'Bo' }, created: '2026-10-03T00:00:00.000+0000', body: 'b' },
            { author: { displayName: 'Ada' }, created: '2026-10-02T00:00:00.000+0000', body: 'a' },
            { created: '2026-10-04T00:00:00.000+0000', body: 'c' }
          ]
        }
      }
    }))
    expect(await createJiraClient(rest).details('INF-1')).toEqual({
      body: '',
      labels: [{ name: 'bug', color: '' }],
      comments: [
        { author: 'Ada', createdAt: '2026-10-02T00:00:00.000Z', body: 'a' },
        { author: 'Bo', createdAt: '2026-10-03T00:00:00.000Z', body: 'b' },
        { author: 'Unknown', createdAt: '2026-10-04T00:00:00.000Z', body: 'c' }
      ],
      pullRequests: []
    })
    expect(calls[0]).toEqual({
      method: 'GET',
      path: '/rest/api/2/issue/INF-1?fields=description,labels,comment'
    })
  })

  it('names the viewer', async () => {
    const { calls, rest } = fake(() => ({ displayName: 'Ada' }))
    expect(await createJiraClient(rest).viewer()).toBe('Ada')
    expect(calls[0]).toEqual({ method: 'GET', path: '/rest/api/2/myself' })
  })

  it('lists every project, page by page', async () => {
    const { calls, rest } = fake((_m, path) =>
      path.includes('startAt=0')
        ? { values: [{ key: 'INF', name: 'Internal', id: '1' }], isLast: false }
        : { values: [{ key: 'OPS', name: 'Ops', id: '2' }], isLast: true }
    )
    expect(await createJiraClient(rest).projects()).toEqual([
      { key: 'INF', name: 'Internal' },
      { key: 'OPS', name: 'Ops' }
    ])
    expect(calls.map((c) => c.path)).toEqual([
      '/rest/api/2/project/search?startAt=0&maxResults=50',
      '/rest/api/2/project/search?startAt=1&maxResults=50'
    ])
  })

  it("lists the project's boards, page by page", async () => {
    const { calls, rest } = fake((_m, path) =>
      path.includes('startAt=0')
        ? { values: [{ id: 379, name: 'INF board', type: 'simple' }], isLast: false }
        : { values: [{ id: 380, name: 'Ops view', type: 'kanban' }], isLast: true }
    )
    expect(await createJiraClient(rest).boards('INF')).toEqual([
      { id: 379, name: 'INF board' },
      { id: 380, name: 'Ops view' }
    ])
    expect(calls.map((c) => c.path)).toEqual([
      '/rest/agile/1.0/board?projectKeyOrId=INF&startAt=0&maxResults=50',
      '/rest/agile/1.0/board?projectKeyOrId=INF&startAt=1&maxResults=50'
    ])
  })

  it('reads details of an issue with no labels field', async () => {
    const { rest } = fake(() => ({ fields: { description: 'd', comment: { comments: [] } } }))
    expect((await createJiraClient(rest).details('INF-1')).labels).toEqual([])
  })

  it("lists the area labels the project's issues use, page by page", async () => {
    const { calls, rest } = fake((_m, _path, body) =>
      (body as { nextPageToken?: string }).nextPageToken
        ? { issues: [{ fields: { labels: ['area:sync', 'area:ui'] } }], isLast: true }
        : {
            issues: [{ fields: { labels: ['area:ui', 'bug'] } }, { fields: { labels: ['x'] } }],
            nextPageToken: 'n',
            isLast: false
          }
    )
    expect(await createJiraClient(rest).areas('INF')).toEqual([
      { name: 'area:ui', description: '' },
      { name: 'area:sync', description: '' }
    ])
    expect(calls.map((c) => c.body)).toEqual([
      { jql: 'project = "INF" AND labels is not EMPTY', fields: ['labels'], maxResults: 100 },
      {
        jql: 'project = "INF" AND labels is not EMPTY',
        fields: ['labels'],
        maxResults: 100,
        nextPageToken: 'n'
      }
    ])
  })
})

const writes = (c: Call): boolean => c.method !== 'GET' && c.path !== '/rest/api/2/search/jql'

const labelSearch = (labels: string[]): unknown => ({
  issues: labels.map((l) => ({ fields: { labels: [l] } })),
  isLast: true
})

describe('createJiraClient applyTriage', () => {
  const triage = {
    area: 'area:ui',
    newAreas: [],
    blockedBy: [{ key: 'INF-4', number: 4, title: 'Blocker' }],
    reason: 'r'
  }
  const linkTypes = {
    issueLinkTypes: [
      { name: 'Relates', inward: 'relates to', outward: 'relates to' },
      { name: 'Block', inward: 'is blocked by', outward: 'Blocks' }
    ]
  }
  const site = (
    labels: string[] = [],
    projectKey = 'INF',
    siteLabels = ['area:ui']
  ): ReturnType<typeof fake> =>
    fake((m, path) =>
      path === '/rest/api/2/search/jql'
        ? labelSearch(siteLabels)
        : path === '/rest/api/2/issueLinkType'
          ? linkTypes
          : m === 'GET'
            ? { fields: { labels, project: { key: projectKey } } }
            : undefined
    )

  it("links each blocker on the blocked issue with the site's blocks type, then adds the area label", async () => {
    const { calls, rest } = site()
    await createJiraClient(rest).applyTriage('INF', 'INF-1', triage)
    expect(calls.filter(writes)).toEqual([
      {
        method: 'PUT',
        path: '/rest/api/2/issue/INF-1',
        body: {
          update: {
            issuelinks: [{ add: { type: { name: 'Block' }, inwardIssue: { key: 'INF-4' } } }]
          }
        }
      },
      {
        method: 'PUT',
        path: '/rest/api/2/issue/INF-1',
        body: { update: { labels: [{ add: 'area:ui' }] } }
      }
    ])
  })

  it('adds a new area while the site has none', async () => {
    const { calls, rest } = site([], 'INF', [])
    await createJiraClient(rest).applyTriage('INF', 'INF-1', {
      ...triage,
      newAreas: [{ name: 'area:ui', description: 'UI' }]
    })
    expect(calls.at(-1)?.body).toEqual({ update: { labels: [{ add: 'area:ui' }] } })
  })

  it('reads an issue with no labels field', async () => {
    const { calls, rest } = fake((m, path) =>
      path === '/rest/api/2/search/jql'
        ? labelSearch(['area:ui'])
        : path === '/rest/api/2/issueLinkType'
          ? linkTypes
          : m === 'GET'
            ? { fields: { project: { key: 'INF' } } }
            : undefined
    )
    await createJiraClient(rest).applyTriage('INF', 'INF-1', triage)
    expect(calls.at(-1)?.body).toEqual({ update: { labels: [{ add: 'area:ui' }] } })
  })

  it.each([
    [
      'a new area while the site has other areas',
      site([], 'INF', ['area:sync']),
      { ...triage, area: 'area:new', newAreas: [{ name: 'area:new', description: '' }] },
      'Label "area:new" not found'
    ],
    [
      'an area with a space',
      site(),
      { ...triage, area: 'area:big ui' },
      'Jira labels cannot contain spaces: "area:big ui"'
    ],
    ['an issue in another project', site([], 'OPS'), triage, 'INF-1 is not in Jira project INF'],
    ['an issue that has an area', site(['area:sync']), triage, 'INF-1 already has area:sync'],
    [
      'an area the site lacks',
      site(),
      { ...triage, area: 'area:new' },
      'Label "area:new" not found'
    ],
    [
      'blockers on a site with no blocks link type',
      fake((_m, path) =>
        path === '/rest/api/2/search/jql'
          ? labelSearch(['area:ui'])
          : path === '/rest/api/2/issueLinkType'
            ? { issueLinkTypes: [linkTypes.issueLinkTypes[0]] }
            : { fields: { labels: [], project: { key: 'INF' } } }
      ),
      triage,
      'Jira has no link type that blocks'
    ]
  ])('refuses %s without writing', async (_, { calls, rest }, t, message) => {
    await expect(createJiraClient(rest).applyTriage('INF', 'INF-1', t)).rejects.toThrow(message)
    expect(calls.filter(writes)).toEqual([])
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { run } from '../env/tools'
import { createLinearClient, linearGraphql, linearWorkspaces } from './client'

vi.mock('../env/tools', () => ({ run: vi.fn() }))

type Call = { query: string; vars: Record<string, unknown> }

function fake(handler: (query: string, vars: Record<string, unknown>) => unknown): {
  calls: Call[]
  gql: (q: string, v: Record<string, unknown>) => Promise<unknown>
} {
  const calls: Call[] = []
  return {
    calls,
    gql: async (query, vars) => {
      calls.push({ query, vars })
      return handler(query, vars)
    }
  }
}

const conn = (nodes: unknown[], endCursor: string | null = null): unknown => ({
  pageInfo: { hasNextPage: endCursor !== null, endCursor },
  nodes
})

const issue = (n: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: `uuid-${n}`,
  identifier: `DEMO-${n}`,
  number: n,
  title: `t${n}`,
  description: `d${n}`,
  url: `https://linear.app/w/issue/DEMO-${n}`,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-02T00:00:00Z',
  completedAt: null,
  state: { type: 'unstarted', name: 'Todo' },
  labels: { nodes: [] },
  assignee: null,
  parent: null,
  children: { nodes: [] },
  inverseRelations: { nodes: [] },
  attachments: { nodes: [] },
  ...extra
})

const child = (
  n: number,
  type: string,
  assignee: { displayName: string } | null = null
): Record<string, unknown> => ({
  identifier: `DEMO-${n}`,
  number: n,
  title: `t${n}`,
  url: `https://linear.app/w/issue/DEMO-${n}`,
  state: { type },
  assignee
})

const ref = (
  n: number
): { key: string; number: number; title: string; repo: string; url: string } => ({
  key: `DEMO-${n}`,
  number: n,
  title: `t${n}`,
  repo: '',
  url: `https://linear.app/w/issue/DEMO-${n}`
})

afterEach(() => {
  vi.mocked(run).mockReset()
  vi.unstubAllGlobals()
})

describe('linearGraphql', () => {
  it('posts to Linear with the key from `linear auth token`, without Bearer', async () => {
    vi.mocked(run).mockResolvedValue({ stdout: 'lin_api_x\n', stderr: '', code: 0 })
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: { ok: 1 } })))
    vi.stubGlobal('fetch', fetch)
    const gql = await linearGraphql()
    expect(await gql('q', {})).toEqual({ ok: 1 })
    expect(run).toHaveBeenCalledWith('linear', ['auth', 'token'], undefined, 10_000)
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.linear.app/graphql')
    expect(init.headers).toMatchObject({ authorization: 'lin_api_x' })
  })

  it('names Linear and its first error message when it answers non-2xx', async () => {
    vi.mocked(run).mockResolvedValue({ stdout: 'k', stderr: '', code: 0 })
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(JSON.stringify({ errors: [{ message: 'Query too complex' }] }), {
          status: 400
        })
    )
    const gql = await linearGraphql()
    await expect(gql('q', {})).rejects.toThrow('Linear answered 400: Query too complex')
  })

  it("reads a workspace's key with `--workspace`", async () => {
    vi.mocked(run).mockResolvedValue({ stdout: 'lin_api_y\n', stderr: '', code: 0 })
    await linearGraphql('acme')
    expect(run).toHaveBeenCalledWith(
      'linear',
      ['auth', 'token', '--workspace', 'acme'],
      undefined,
      10_000
    )
  })

  it('names the workspace when the CLI has no key for it', async () => {
    vi.mocked(run).mockResolvedValue({ stdout: '', stderr: 'Workspace "acme" not found', code: 4 })
    await expect(linearGraphql('acme')).rejects.toThrow(
      'Linear CLI is not signed in to acme; run `linear auth login`'
    )
  })

  it("shows the CLI's reason when it rejects how it was called", async () => {
    vi.mocked(run).mockResolvedValue({
      stdout: '',
      stderr: 'Cannot use --workspace while LINEAR_API_KEY is set\n',
      code: 2
    })
    await expect(linearGraphql('acme')).rejects.toThrow(
      'Cannot use --workspace while LINEAR_API_KEY is set'
    )
  })

  it('says the Linear CLI is not signed in when it prints no key', async () => {
    vi.mocked(run).mockResolvedValue({ stdout: '', stderr: '', code: 1 })
    await expect(linearGraphql()).rejects.toThrow(
      'Linear CLI is not signed in; run `linear auth login`'
    )
  })
})

describe('linearWorkspaces', () => {
  it('reads each workspace from `linear auth list`, marking the default', async () => {
    vi.mocked(run).mockResolvedValue({
      stdout: [
        '   WORKSPACE  ORGANIZATION  USER',
        '*  globex     Globex        a@example.com <a@example.com>',
        '   acme       Acme Corp     b@example.com <b@example.com>',
        ''
      ].join('\n'),
      stderr: '',
      code: 0
    })
    expect(await linearWorkspaces()).toEqual([
      { slug: 'globex', organization: 'Globex', default: true },
      { slug: 'acme', organization: 'Acme Corp', default: false }
    ])
    expect(run).toHaveBeenCalledWith('linear', ['auth', 'list'], undefined, 10_000)
  })

  it("throws with the CLI's advice when it prints no table", async () => {
    vi.mocked(run).mockResolvedValue({
      stdout: 'No workspaces configured\nRun `linear auth login` to add a workspace\n',
      stderr: '',
      code: 0
    })
    await expect(linearWorkspaces()).rejects.toThrow('No workspaces configured')
  })

  it("says the Linear CLI isn't installed when it can't run", async () => {
    vi.mocked(run).mockResolvedValue({ stdout: '', stderr: 'spawn linear ENOENT', code: -1 })
    await expect(linearWorkspaces()).rejects.toThrow("Linear CLI isn't installed")
  })

  it('finds the header after lines the CLI prints before it', async () => {
    vi.mocked(run).mockResolvedValue({
      stdout:
        'A newer version is out\n   WORKSPACE  ORGANIZATION  USER\n*  globex     Globex        a@example.com\n',
      stderr: '',
      code: 0
    })
    expect(await linearWorkspaces()).toEqual([
      { slug: 'globex', organization: 'Globex', default: true }
    ])
  })

  it("says the Linear CLI didn't answer when `auth list` times out", async () => {
    vi.mocked(run).mockImplementation(async () => {
      vi.advanceTimersByTime(10_000)
      return { stdout: '', stderr: '', code: -1 }
    })
    vi.useFakeTimers()
    await expect(linearWorkspaces()).rejects.toThrow(
      "Linear CLI didn't answer `linear auth list` within 10 seconds"
    )
    vi.useRealTimers()
  })

  it("throws with the CLI's output when it fails", async () => {
    vi.mocked(run).mockResolvedValue({ stdout: '', stderr: 'No credentials found', code: 1 })
    await expect(linearWorkspaces()).rejects.toThrow('No credentials found')
  })
})

describe('teams', () => {
  it("lists each team with its projects, following both connections' pages", async () => {
    const { gql } = fake((q, v) => {
      if (!q.includes('projects('))
        return {
          teams: conn([
            { key: 'DEMO', name: 'Demo' },
            { key: 'OPS', name: 'Ops' }
          ])
        }
      return v.cursor === null
        ? {
            projects: conn(
              [{ id: 'p1', name: 'Pipes', teams: { nodes: [{ key: 'DEMO' }, { key: 'OPS' }] } }],
              'c1'
            )
          }
        : { projects: conn([{ id: 'p2', name: 'Lake', teams: { nodes: [{ key: 'DEMO' }] } }]) }
    })
    expect(await createLinearClient(gql).teams()).toEqual([
      {
        key: 'DEMO',
        name: 'Demo',
        projects: [
          { id: 'p1', name: 'Pipes' },
          { id: 'p2', name: 'Lake' }
        ]
      },
      { key: 'OPS', name: 'Ops', projects: [{ id: 'p1', name: 'Pipes' }] }
    ])
  })
})

describe('viewer', () => {
  it('returns the signed-in display name, the login Linear tickets use', async () => {
    const { gql } = fake(() => ({ viewer: { displayName: 'ann' } }))
    expect(await createLinearClient(gql).viewer()).toBe('ann')
  })
})

describe('tickets', () => {
  const since = '2026-10-19T00:00:00Z'

  it('filters by team, open or recently completed state, and the extra numbers', async () => {
    const { gql, calls } = fake(() => ({ issues: conn([]) }))
    await createLinearClient(gql).tickets('DEMO', [], since, [7])
    expect(calls[0].vars.filter).toEqual({
      team: { key: { eq: 'DEMO' } },
      or: [
        {
          or: [
            { state: { type: { in: ['unstarted', 'started'] } } },
            { completedAt: { gte: since } }
          ]
        },
        { number: { in: [7] } }
      ]
    })
  })

  it('narrows open and recent issues to the given projects, but not the extra numbers', async () => {
    const { gql, calls } = fake(() => ({ issues: conn([]) }))
    await createLinearClient(gql).tickets('DEMO', ['p1', 'p2'], since, [7])
    expect(calls[0].vars.filter).toEqual({
      team: { key: { eq: 'DEMO' } },
      or: [
        {
          and: [
            { project: { id: { in: ['p1', 'p2'] } } },
            {
              or: [
                { state: { type: { in: ['unstarted', 'started'] } } },
                { completedAt: { gte: since } }
              ]
            }
          ]
        },
        { number: { in: [7] } }
      ]
    })
  })

  it('links the most recently merged GitHub pull request attachment', async () => {
    const pr = (n: number, status: string, mergedAt: string | null): Record<string, unknown> => ({
      sourceType: 'github',
      url: `https://github.com/o/r/pull/${n}`,
      metadata: { number: n, status, mergedAt }
    })
    const i = issue(12, {
      attachments: {
        nodes: [
          pr(1, 'merged', '2026-10-20T00:00:00Z'),
          pr(2, 'merged', '2026-10-22T00:00:00Z'),
          pr(3, 'closed', null),
          { sourceType: 'slack', url: 'https://slack.com/x', metadata: {} }
        ]
      }
    })
    const none = issue(13, { attachments: { nodes: [pr(4, 'open', null)] } })
    const { gql } = fake(() => ({ issues: conn([i, none]) }))
    const tickets = await createLinearClient(gql).tickets('DEMO', [], since, [])
    expect(tickets.map((t) => t.mergedPr)).toEqual(['https://github.com/o/r/pull/2', null])
    expect(tickets.map((t) => t.mergedAt)).toEqual(['2026-10-22T00:00:00Z', null])
  })

  it('maps an issue to a ticket keyed by its identifier, with no repo', async () => {
    const i = issue(12, {
      completedAt: '2026-10-20T00:00:00Z',
      state: { type: 'completed', name: 'Done' },
      labels: { nodes: [{ name: 'bug', color: '#bec2c8' }] },
      assignee: { id: 'user-ada', name: 'Ada Lovelace', displayName: 'ada' },
      parent: {
        identifier: 'OPS-3',
        number: 3,
        title: 'Epic',
        url: 'https://linear.app/w/issue/OPS-3',
        state: { type: 'started' },
        children: {
          nodes: [{ state: { type: 'completed' } }, { state: { type: 'started' } }]
        }
      },
      children: {
        nodes: [
          child(20, 'completed', { displayName: 'ada' }),
          child(21, 'canceled'),
          child(22, 'duplicate'),
          child(23, 'started'),
          child(24, 'backlog'),
          child(25, 'triage')
        ]
      }
    })
    const { gql } = fake(() => ({ issues: conn([i]) }))
    expect(await createLinearClient(gql).tickets('DEMO', [], since, [])).toEqual([
      {
        key: 'DEMO-12',
        itemId: 'uuid-12',
        number: 12,
        title: 't12',
        body: 'd12',
        url: 'https://linear.app/w/issue/DEMO-12',
        repo: '',
        status: 'completed',
        doneAt: '2026-10-20T00:00:00Z',
        labels: [{ name: 'bug', color: 'bec2c8' }],
        assignees: [{ id: 'user-ada', login: 'ada', name: 'Ada Lovelace' }],
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-02T00:00:00Z',
        parent: {
          key: 'OPS-3',
          number: 3,
          title: 'Epic',
          repo: '',
          url: 'https://linear.app/w/issue/OPS-3',
          column: 'inProgress',
          subIssues: { completed: 1, total: 2 }
        },
        subIssues: {
          completed: 3,
          total: 6,
          items: [
            { ...ref(20), column: 'done', assignee: 'ada' },
            { ...ref(21), column: 'hidden', assignee: null },
            { ...ref(22), column: 'hidden', assignee: null },
            { ...ref(23), column: 'inProgress', assignee: null },
            { ...ref(24), column: 'todo', assignee: null },
            { ...ref(25), column: 'todo', assignee: null }
          ]
        },
        boardFields: [],
        blockedBy: [],
        mergedPr: null,
        mergedAt: null,
        prStage: null
      }
    ])
  })

  it('treats a missing description as an empty body and no assignee as none', async () => {
    const { gql } = fake(() => ({ issues: conn([issue(1, { description: null })]) }))
    const [t] = await createLinearClient(gql).tickets('DEMO', [], since, [])
    expect(t).toMatchObject({ body: '', assignees: [] })
  })

  it("shows the state's name as a Status field when it isn't the column's usual name", async () => {
    const { gql, calls } = fake(() => ({
      issues: conn([
        issue(1, { state: { type: 'started', name: 'In Review' } }),
        issue(2, { state: { type: 'started', name: 'In progress' } }),
        issue(3, { state: { type: 'unstarted', name: 'Todo' } })
      ])
    }))
    const tickets = await createLinearClient(gql).tickets('DEMO', [], since, [])
    expect(tickets.map((t) => t.boardFields)).toEqual([
      [{ name: 'Status', value: 'In Review' }],
      [],
      []
    ])
    expect(calls[0].query).toContain('state { type name }')
  })

  it('keeps only blocks relations whose blocker is still open', async () => {
    const blocker = (n: number, type: string): unknown => ({
      identifier: `DEMO-${n}`,
      number: n,
      title: `b${n}`,
      state: { type }
    })
    const i = issue(1, {
      inverseRelations: {
        nodes: [
          { type: 'blocks', issue: blocker(2, 'started') },
          { type: 'blocks', issue: blocker(3, 'completed') },
          { type: 'blocks', issue: blocker(4, 'canceled') },
          { type: 'blocks', issue: blocker(6, 'duplicate') },
          { type: 'related', issue: blocker(5, 'unstarted') }
        ]
      }
    })
    const { gql } = fake(() => ({ issues: conn([i]) }))
    const [t] = await createLinearClient(gql).tickets('DEMO', [], since, [])
    expect(t.blockedBy).toEqual([{ key: 'DEMO-2', number: 2, title: 'b2', repo: '' }])
  })

  it('stops after 10 pages and says the team has more', async () => {
    const { gql, calls } = fake(() => ({ issues: conn([issue(1)], 'more') }))
    const truncated = vi.fn()
    await createLinearClient(gql).tickets('DEMO', [], since, [], truncated)
    expect(calls).toHaveLength(10)
    expect(truncated).toHaveBeenCalledWith(
      'Linear team DEMO has more than 1,000 open or recently done issues; Sandtable shows the 1,000 most recently updated.'
    )
  })
})

describe('setColumn', () => {
  const states = {
    team: {
      states: {
        nodes: [
          { id: 's-review', name: 'In Review', type: 'started', position: 0 },
          { id: 's-doing', name: 'In Progress', type: 'started', position: 2 },
          { id: 's-todo', name: 'Todo', type: 'unstarted', position: 1 },
          { id: 's-backlog-todo', name: 'Ready', type: 'unstarted', position: 0 },
          { id: 's-done', name: 'Done', type: 'completed', position: 5 }
        ]
      }
    }
  }

  it("moves the issue to the state of the column's type named like the column", async () => {
    const { gql, calls } = fake((q) => (q.includes('issueUpdate') ? {} : states))
    await createLinearClient(gql).setColumn('DEMO', 'DEMO-12', 'inProgress')
    expect(calls[0].vars).toEqual({ team: 'DEMO' })
    expect(calls[1].query).toContain('issueUpdate')
    expect(calls[1].vars).toEqual({ id: 'DEMO-12', stateId: 's-doing' })
  })

  it('matches the name case-insensitively', async () => {
    const lower = {
      team: {
        states: {
          nodes: [
            { id: 's-ready', name: 'Ready', type: 'unstarted', position: 0 },
            { id: 's-todo', name: 'TODO', type: 'unstarted', position: 1 }
          ]
        }
      }
    }
    const { gql, calls } = fake((q) => (q.includes('issueUpdate') ? {} : lower))
    await createLinearClient(gql).setColumn('DEMO', 'DEMO-12', 'todo')
    expect(calls[1].vars).toEqual({ id: 'DEMO-12', stateId: 's-todo' })
  })

  it('falls back to the lowest-position state of the type when no name matches', async () => {
    const custom = {
      team: {
        states: {
          nodes: [
            { id: 's-ship', name: 'Shipped', type: 'completed', position: 4 },
            { id: 's-merged', name: 'Merged', type: 'completed', position: 3 }
          ]
        }
      }
    }
    const { gql, calls } = fake((q) => (q.includes('issueUpdate') ? {} : custom))
    await createLinearClient(gql).setColumn('DEMO', 'DEMO-12', 'done')
    expect(calls[1].vars).toEqual({ id: 'DEMO-12', stateId: 's-merged' })
  })

  it('throws when the team has no state of that type', async () => {
    const { gql, calls } = fake(() => ({ team: { states: { nodes: [] } } }))
    await expect(createLinearClient(gql).setColumn('DEMO', 'DEMO-12', 'done')).rejects.toThrow(
      'Linear team DEMO has no completed state'
    )
    expect(calls).toHaveLength(1)
  })
})

describe('create', () => {
  const states = {
    team: {
      id: 'team-uuid',
      states: {
        nodes: [
          { id: 's-ready', name: 'Ready', type: 'unstarted', position: 0 },
          { id: 's-todo', name: 'Todo', type: 'unstarted', position: 1 }
        ]
      }
    }
  }
  const created = { issueCreate: { issue: { identifier: 'DEMO-40' } } }

  it("creates the issue in the team's Todo state and the Linear project", async () => {
    const { gql, calls } = fake((q) => (q.includes('issueCreate') ? created : states))
    expect(await createLinearClient(gql).create('DEMO', 'Fix it', 'Body', 'lp1')).toBe('DEMO-40')
    expect(calls[1].vars).toEqual({
      input: {
        teamId: 'team-uuid',
        stateId: 's-todo',
        title: 'Fix it',
        description: 'Body',
        projectId: 'lp1'
      }
    })
  })

  it("says so when Linear doesn't return the issue", async () => {
    const { gql } = fake((q) =>
      q.includes('issueCreate') ? { issueCreate: { issue: null } } : states
    )
    await expect(createLinearClient(gql).create('DEMO', 'Fix it', '')).rejects.toThrow(
      "Linear didn't return the new issue"
    )
  })

  it('sets the parent by its key', async () => {
    const { gql, calls } = fake((q) => (q.includes('issueCreate') ? created : states))
    await createLinearClient(gql).create('DEMO', 'Fix it', '', undefined, 'DEMO-3')
    expect(calls[1].vars.input).toMatchObject({ parentId: 'DEMO-3' })
    expect(calls[1].vars.input).not.toHaveProperty('projectId')
  })

  it('leaves out the Linear project when there is none', async () => {
    const { gql, calls } = fake((q) => (q.includes('issueCreate') ? created : states))
    await createLinearClient(gql).create('DEMO', 'Fix it', '')
    expect(calls[1].vars.input).not.toHaveProperty('projectId')
  })
})

describe('details', () => {
  it('reads the description, labels, comments, and GitHub pull requests', async () => {
    const { gql, calls } = fake(() => ({
      issue: {
        description: 'Body',
        labels: { nodes: [{ name: 'bug', color: '#ff0000' }] },
        comments: {
          nodes: [
            { body: 'second', createdAt: '2026-10-03T00:00:00Z', user: { displayName: 'bo' } },
            { body: 'first', createdAt: '2026-10-02T00:00:00Z', user: null },
            {
              body: 'bot',
              createdAt: '2026-10-01T00:00:00Z',
              user: null,
              botActor: { name: 'GitHub' }
            }
          ]
        },
        attachments: {
          nodes: [
            {
              sourceType: 'github',
              url: 'https://github.com/o/r/pull/5',
              title: 'r#5 (Fix it)',
              metadata: { number: 5, title: 'Fix it', status: 'merged' }
            },
            {
              sourceType: 'github',
              url: 'https://github.com/o/r/pull/6',
              title: 'Draft',
              metadata: { number: 6, status: 'draft' }
            },
            {
              sourceType: 'github',
              url: 'https://github.com/o/r/pull/7',
              title: 'Shut',
              metadata: { number: 7, title: 'Shut', status: 'closed' }
            },
            { sourceType: 'slack', url: 'https://slack.com/x', title: 'Thread', metadata: {} },
            {
              sourceType: 'github',
              url: 'https://github.com/o/r/commit/abc',
              title: 'Commit abc',
              metadata: { sha: 'abc' }
            }
          ]
        }
      }
    }))
    expect(await createLinearClient(gql).details('DEMO-12')).toEqual({
      body: 'Body',
      labels: [{ name: 'bug', color: 'ff0000' }],
      comments: [
        { author: 'GitHub', createdAt: '2026-10-01T00:00:00Z', body: 'bot' },
        { author: 'Unknown', createdAt: '2026-10-02T00:00:00Z', body: 'first' },
        { author: 'bo', createdAt: '2026-10-03T00:00:00Z', body: 'second' }
      ],
      pullRequests: [
        { number: 5, title: 'Fix it', url: 'https://github.com/o/r/pull/5', state: 'merged' },
        { number: 6, title: 'Draft', url: 'https://github.com/o/r/pull/6', state: 'open' },
        { number: 7, title: 'Shut', url: 'https://github.com/o/r/pull/7', state: 'closed' }
      ]
    })
    expect(calls[0].vars).toEqual({ id: 'DEMO-12' })
    expect(calls[0].query).toContain('comments(first: 100, orderBy: createdAt)')
  })

  it('throws when the issue is not found', async () => {
    const { gql } = fake(() => ({ issue: null }))
    await expect(createLinearClient(gql).details('DEMO-1')).rejects.toThrow('Issue not found')
  })
})

describe('setAssignee', () => {
  it('replaces the assignee by user ID, and unassigns with null', async () => {
    const { gql, calls } = fake(() => ({ issueUpdate: { success: true } }))
    const client = createLinearClient(gql)
    await client.setAssignee('DEMO-12', 'user-ada')
    await client.setAssignee('DEMO-12', null)
    expect(calls[0].query).toContain('issueUpdate')
    expect(calls.map((c) => c.vars)).toEqual([
      { id: 'DEMO-12', assigneeId: 'user-ada' },
      { id: 'DEMO-12', assigneeId: null }
    ])
  })
})

describe('postComment', () => {
  it('creates a comment on the issue by its identifier', async () => {
    const { gql, calls } = fake(() => ({ commentCreate: { success: true } }))
    await createLinearClient(gql).postComment('DEMO-12', 'Hello')
    expect(calls[0].query).toContain('commentCreate')
    expect(calls[0].vars).toEqual({ issueId: 'DEMO-12', body: 'Hello' })
  })
})

describe('areas', () => {
  it("lists the team's area labels, not the workspace's, following pages", async () => {
    const { gql, calls } = fake((_q, v) => ({
      issueLabels: v.cursor
        ? conn([{ id: 'L2', name: 'area: board', description: null }])
        : conn(
            [
              { id: 'L1', name: 'area: sessions', description: 'Sessions' },
              { id: 'L3', name: 'Area: other', description: '' },
              { id: 'L4', name: 'area: group', description: '', isGroup: true }
            ],
            'c1'
          )
    }))
    expect(await createLinearClient(gql).areas('DEMO')).toEqual([
      { name: 'area: sessions', description: 'Sessions' },
      { name: 'area: board', description: '' }
    ])
    expect(calls[0].vars).toEqual({ team: 'DEMO', cursor: null })
    expect(calls[0].query).toContain('startsWith: "area:"')
    expect(calls[0].query).toContain('team: { key: { eq: $team } }')
    expect(calls[0].query).not.toContain('null')
  })
})

describe('applyTriage', () => {
  const lookup = (labels: string[], team = 'DEMO'): unknown => ({
    issue: { labels: { nodes: labels.map((name) => ({ name })) }, team: { id: 'T', key: team } },
    issueLabels: conn([{ id: 'L1', name: 'area: sessions', description: 'Sessions' }])
  })
  const triage = {
    area: 'area: board',
    newAreas: [
      { name: 'area: sessions', description: 'Sessions' },
      { name: 'area: board', description: 'Board' }
    ],
    blockedBy: [
      { key: 'DEMO-3', number: 3, title: 'a' },
      { key: 'DEMO-4', number: 4, title: 'b' }
    ],
    reason: 'r'
  }

  it('creates a team with no areas its new ones, adds the area, and adds blocks relations', async () => {
    const { gql, calls } = fake((q, v) =>
      q.includes('issueLabelCreate')
        ? { issueLabelCreate: { issueLabel: { id: `new-${(v.input as { name: string }).name}` } } }
        : q.includes('mutation')
          ? { success: true }
          : { ...(lookup(['bug']) as object), issueLabels: conn([]) }
    )
    await createLinearClient(gql).applyTriage('DEMO', 'DEMO-12', triage)
    expect(calls[0].vars).toEqual({ id: 'DEMO-12' })
    expect(calls[1].vars).toEqual({ team: 'DEMO', cursor: null })
    expect(calls.slice(2).map((c) => c.vars)).toEqual([
      { input: { teamId: 'T', name: 'area: sessions', description: 'Sessions' } },
      { input: { teamId: 'T', name: 'area: board', description: 'Board' } },
      { input: { issueId: 'DEMO-3', relatedIssueId: 'DEMO-12', type: 'blocks' } },
      { input: { issueId: 'DEMO-4', relatedIssueId: 'DEMO-12', type: 'blocks' } },
      { id: 'DEMO-12', labelId: 'new-area: board' }
    ])
  })

  it('refuses an issue that already has an area label, before any write', async () => {
    const { gql, calls } = fake(() => lookup(['area: board']))
    await expect(createLinearClient(gql).applyTriage('DEMO', 'DEMO-12', triage)).rejects.toThrow(
      'DEMO-12 already has area: board'
    )
    expect(calls).toHaveLength(1)
  })

  it("refuses an issue that moved to another team, and one Linear can't find", async () => {
    const moved = fake(() => lookup([], 'OTHER'))
    await expect(
      createLinearClient(moved.gql).applyTriage('DEMO', 'DEMO-12', triage)
    ).rejects.toThrow('DEMO-12 is not in team DEMO')
    const missing = fake(() => ({ issue: null, issueLabels: conn([]) }))
    await expect(
      createLinearClient(missing.gql).applyTriage('DEMO', 'DEMO-12', triage)
    ).rejects.toThrow('Issue not found')
    expect(moved.calls).toHaveLength(1)
  })

  it('creates no new areas once the team has some, so two triages make one set', async () => {
    const { gql, calls } = fake((q) => (q.includes('mutation') ? { success: true } : lookup([])))
    await createLinearClient(gql).applyTriage('DEMO', 'DEMO-12', {
      ...triage,
      area: 'area: sessions',
      newAreas: [{ name: 'area: board', description: 'Board' }],
      blockedBy: []
    })
    expect(calls.some((c) => c.query.includes('issueLabelCreate'))).toBe(false)
    expect(calls.slice(2).map((c) => c.vars)).toEqual([{ id: 'DEMO-12', labelId: 'L1' }])
  })

  it('finishes the new areas on a retry after creating them failed partway', async () => {
    const { gql, calls } = fake((q, v) =>
      q.includes('issueLabelCreate')
        ? { issueLabelCreate: { issueLabel: { id: `new-${(v.input as { name: string }).name}` } } }
        : q.includes('mutation')
          ? { success: true }
          : lookup([])
    )
    await createLinearClient(gql).applyTriage('DEMO', 'DEMO-12', { ...triage, blockedBy: [] })
    expect(calls.slice(2).map((c) => c.vars)).toEqual([
      { input: { teamId: 'T', name: 'area: board', description: 'Board' } },
      { id: 'DEMO-12', labelId: 'new-area: board' }
    ])
  })

  it('throws when the area is neither a label nor a new area', async () => {
    const { gql } = fake(() => lookup([]))
    await expect(
      createLinearClient(gql).applyTriage('DEMO', 'DEMO-12', { ...triage, newAreas: [] })
    ).rejects.toThrow('Label "area: board" not found')
  })
})

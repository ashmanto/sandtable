import { describe, expect, it, vi } from 'vitest'
import { boardError, createBoardClient } from './board'
import type { BoardSource, StatusMap } from '../../shared/types'

const src: BoardSource = {
  url: 'https://github.com/users/octo/projects/2',
  ownerType: 'user',
  owner: 'octo',
  number: 2
}

const map: StatusMap = { todo: 'Todo', inProgress: 'In Progress', done: 'Done' }

const issue = (
  n: number,
  status: string | null = 'Todo',
  updatedAt = '2026-10-01T00:00:00Z',
  closedAt: string | null = null
): Record<string, unknown> => ({
  id: `PVTI_${n}`,
  fieldValueByName: status ? { name: status, updatedAt } : null,
  fieldValues: { nodes: [] },
  content: {
    __typename: 'Issue',
    state: 'OPEN',
    number: n,
    title: `t${n}`,
    body: `b${n}`,
    url: `https://github.com/octo/shop/issues/${n}`,
    closedAt,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-02T00:00:00Z',
    assignees: { nodes: [] },
    labels: { nodes: [] },
    parent: null,
    subIssuesSummary: { completed: 0, total: 0 },
    subIssues: { nodes: [] },
    blockedBy: { nodes: [] },
    closedByPullRequestsReferences: { nodes: [] },
    repository: { nameWithOwner: 'octo/shop' }
  }
})

const page = (nodes: unknown[], endCursor: string | null): Record<string, unknown> => ({
  user: {
    projectV2: {
      items: { pageInfo: { hasNextPage: endCursor !== null, endCursor }, nodes }
    }
  }
})

describe('tickets', () => {
  it('follows pagination and maps issues', async () => {
    const first = Array.from({ length: 100 }, (_, i) => issue(i + 1))
    const second = Array.from({ length: 100 }, (_, i) => issue(i + 101))
    const gql = vi
      .fn()
      .mockResolvedValueOnce(page(first, 'c1'))
      .mockResolvedValueOnce(page(second, null))
    const tickets = await createBoardClient(gql).tickets(src, map)
    expect(tickets).toHaveLength(200)
    expect(gql.mock.calls[1][1]).toMatchObject({ cursor: 'c1' })
    expect(tickets[0]).toEqual({
      key: 'octo/shop#1',
      itemId: 'PVTI_1',
      number: 1,
      title: 't1',
      body: 'b1',
      url: 'https://github.com/octo/shop/issues/1',
      repo: 'octo/shop',
      status: 'Todo',
      doneAt: null,
      labels: [],
      assignees: [],
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-02T00:00:00Z',
      parent: null,
      subIssues: { completed: 0, total: 0, items: [] },
      boardFields: [],
      blockedBy: [],
      mergedPr: null,
      mergedAt: null,
      prStage: null
    })
  })

  it('stops at 10 pages and reports the cap', async () => {
    let n = 0
    const gql = vi.fn(async () => page([issue(++n)], 'more'))
    const truncated = vi.fn()
    expect(await createBoardClient(gql).tickets(src, map, undefined, [], truncated)).toHaveLength(
      10
    )
    expect(gql).toHaveBeenCalledTimes(10)
    expect(truncated).toHaveBeenCalledWith(
      'The board has more than 1,000 items; Sandtable shows the first 1,000.'
    )
  })

  it('asks for open items not done, and done or closed items updated since the cutoff', async () => {
    const queries = [
      'is:issue is:open -status:"Shipped"',
      'is:issue status:"Shipped" updated:>=2026-10-23',
      'is:issue is:closed -status:"Shipped" updated:>=2026-10-23'
    ]
    const gql = vi.fn(async (_q: string, vars: Record<string, unknown>) =>
      page([issue(queries.indexOf(vars.query as string) + 1)], 'more')
    )
    const truncated = vi.fn()
    const tickets = await createBoardClient(gql).tickets(
      src,
      { ...map, done: 'Shipped' },
      '2026-10-23T09:00:00.000Z',
      [],
      truncated
    )
    expect(tickets.map((t) => t.number)).toEqual([1, 2, 3])
    expect(gql).toHaveBeenCalledTimes(30)
    expect(new Set(gql.mock.calls.map((c) => c[1].query))).toEqual(new Set(queries))
    expect(gql.mock.calls[0][0]).toContain('items(first: 100, after: $cursor, query: $query)')
    expect(truncated.mock.calls).toEqual([
      ['The board has more than 1,000 open items; Sandtable shows the first 1,000.'],
      ['The board has more than 1,000 recently done items; Sandtable shows the first 1,000.'],
      [
        'The board has more than 1,000 recently closed items not in its done Status; Sandtable shows the first 1,000.'
      ]
    ])
  })

  it('keeps one ticket for an item two queries return, as when it closes mid-sync', async () => {
    const gql = vi.fn(async () => page([issue(1)], null))
    const tickets = await createBoardClient(gql).tickets(src, map, '2026-10-23T09:00:00.000Z')
    expect(gql).toHaveBeenCalledTimes(3)
    expect(tickets.map((t) => t.itemId)).toEqual(['PVTI_1'])
  })

  it('reads the most recently merged closing pull request', async () => {
    const node = issue(1)
    ;(node.content as Record<string, unknown>).closedByPullRequestsReferences = {
      nodes: [
        { url: 'https://github.com/o/r/pull/2', mergedAt: '2026-10-02T00:00:00Z' },
        { url: 'https://github.com/o/r/pull/3', mergedAt: '2026-10-03T00:00:00Z' },
        { url: 'https://github.com/o/r/pull/4', mergedAt: null },
        { url: 'https://github.com/o/r/pull/1', mergedAt: '2026-10-01T00:00:00Z' }
      ]
    }
    const gql = vi.fn().mockResolvedValue(page([node], null))
    const [t] = await createBoardClient(gql).tickets(src, map)
    expect(t.mergedPr).toBe('https://github.com/o/r/pull/3')
    expect(t.mergedAt).toBe('2026-10-03T00:00:00Z')
    expect(gql.mock.calls[0][0]).toContain('closedByPullRequestsReferences')
  })

  it('maps labels, assignees, parent, sub-issues, and board fields except Status', async () => {
    const base = issue(7) as { content: Record<string, unknown> }
    const node = {
      ...base,
      fieldValues: {
        nodes: [
          { name: 'Todo', field: { name: 'Status' } },
          {},
          { name: 'P1', field: { name: 'Priority' } }
        ]
      },
      content: {
        ...base.content,
        labels: {
          nodes: [
            { name: 'bug', color: 'd73a4a' },
            { name: 'enhancement', color: 'a2eeef' }
          ]
        },
        assignees: { nodes: [{ id: 'U_1', login: 'octo', name: null }] },
        parent: {
          number: 3,
          title: 'Epic',
          url: 'https://github.com/octo/shop/issues/3',
          state: 'CLOSED',
          repository: { nameWithOwner: 'octo/shop' }
        },
        subIssuesSummary: { completed: 3, total: 6 }
      }
    }
    const gql = vi.fn().mockResolvedValue(page([node], null))
    const [t] = await createBoardClient(gql).tickets(src, map)
    expect(t).toMatchObject({
      labels: [
        { name: 'bug', color: 'd73a4a' },
        { name: 'enhancement', color: 'a2eeef' }
      ],
      assignees: [{ id: 'U_1', login: 'octo', name: null }],
      parent: {
        key: 'octo/shop#3',
        number: 3,
        title: 'Epic',
        repo: 'octo/shop',
        url: 'https://github.com/octo/shop/issues/3',
        column: 'done'
      },
      subIssues: { completed: 3, total: 6, items: [] },
      boardFields: [{ name: 'Priority', value: 'P1' }]
    })
    const query = gql.mock.calls[0][0]
    expect(query).toContain('fieldValues(first: 50)')
    expect(query).toContain('labels(first: 100) { nodes { name color } }')
    expect(query).toContain('subIssuesSummary { completed total }')
  })

  it('maps open blockers and drops closed ones', async () => {
    const blocked = {
      blockedBy: {
        nodes: [
          {
            number: 38,
            title: 'Add a settings screen',
            state: 'OPEN',
            repository: { nameWithOwner: 'o/r' }
          },
          {
            number: 39,
            title: 'Done already',
            state: 'CLOSED',
            repository: { nameWithOwner: 'o/r' }
          }
        ]
      }
    }
    const base = issue(7) as { content: Record<string, unknown> }
    const gql = vi
      .fn()
      .mockResolvedValue(page([{ ...base, content: { ...base.content, ...blocked } }], null))
    const [t] = await createBoardClient(gql).tickets(src, map)
    expect(t.blockedBy).toEqual([
      { key: 'o/r#38', number: 38, title: 'Add a settings screen', repo: 'o/r' }
    ])
  })

  it('maps a missing status to null and reads the Status field', async () => {
    const gql = vi.fn().mockResolvedValue(page([issue(5, null)], null))
    const [t] = await createBoardClient(gql).tickets(src, map)
    expect(t.status).toBeNull()
    expect(gql.mock.calls[0][0]).toContain('fieldValueByName(name: "Status")')
  })

  it('reads doneAt from the Status value for done tickets, else closedAt, else null', async () => {
    const nodes = [
      issue(1, 'Done', '2026-10-02T00:00:00Z', '2026-09-01T00:00:00Z'),
      issue(2, 'Done', null as unknown as string, '2026-09-05T00:00:00Z'),
      issue(3, 'Todo', '2026-10-03T00:00:00Z', '2026-09-01T00:00:00Z'),
      { ...issue(4, 'Done'), fieldValueByName: { name: 'Done' } }
    ]
    const gql = vi.fn().mockResolvedValue(page(nodes, null))
    const tickets = await createBoardClient(gql).tickets(src, map)
    expect(tickets.map((t) => t.doneAt)).toEqual([
      '2026-10-02T00:00:00Z',
      '2026-09-05T00:00:00Z',
      null,
      null
    ])
    expect(gql.mock.calls[0][0]).toContain('updatedAt')
    expect(gql.mock.calls[0][0]).toContain('closedAt')
  })

  it('shows a closed issue as done from closedAt while its Status lags', async () => {
    const closed = (node: Record<string, unknown>): Record<string, unknown> => ({
      ...node,
      content: { ...(node.content as object), state: 'CLOSED' }
    })
    const nodes = [
      closed(issue(1, 'In Progress', '2026-10-02T00:00:00Z', '2026-10-25T12:32:00Z')),
      closed(issue(2, null, undefined, '2026-10-25T12:32:00Z')),
      closed(issue(3, 'Done', '2026-10-25T12:33:00Z', '2026-10-25T12:32:00Z')),
      closed(issue(4, 'Wont fix', '2026-10-02T00:00:00Z', '2026-10-25T12:32:00Z')),
      issue(5, 'In Progress', '2026-10-02T00:00:00Z', '2026-10-25T12:32:00Z')
    ]
    const gql = vi.fn().mockResolvedValue(page(nodes, null))
    const tickets = await createBoardClient(gql).tickets(src, map)
    expect(tickets.map((t) => [t.status, t.doneAt])).toEqual([
      ['Done', '2026-10-25T12:32:00Z'],
      ['Done', '2026-10-25T12:32:00Z'],
      ['Done', '2026-10-25T12:33:00Z'],
      ['Wont fix', null],
      ['In Progress', null]
    ])
    expect(gql.mock.calls[0][0]).toContain('... on Issue { state ')
  })

  it('skips draft issues and pull requests', async () => {
    const nodes = [
      issue(1),
      { id: 'PVTI_d', fieldValueByName: null, content: { __typename: 'DraftIssue' } },
      { id: 'PVTI_p', fieldValueByName: null, content: { __typename: 'PullRequest' } },
      { id: 'PVTI_n', fieldValueByName: null, content: null }
    ]
    const gql = vi.fn().mockResolvedValue(page(nodes, null))
    const tickets = await createBoardClient(gql).tickets(src, map)
    expect(tickets.map((t) => t.itemId)).toEqual(['PVTI_1'])
  })

  it('queries organization for org boards', async () => {
    const gql = vi.fn().mockResolvedValue({
      organization: { projectV2: { items: { pageInfo: { hasNextPage: false }, nodes: [] } } }
    })
    await createBoardClient(gql).tickets({ ...src, ownerType: 'org' }, map)
    expect(gql.mock.calls[0][0]).toContain('organization(login: $owner)')
  })

  it('fetches session keys missing from the items, keeping only this board’s item', async () => {
    const item = (n: number, url: string): Record<string, unknown> => {
      const { content, ...rest } = issue(n, 'Done', '2026-01-02T00:00:00Z')
      return { ...(content as object), projectItems: { nodes: [{ ...rest, project: { url } }] } }
    }
    const gql = vi.fn(async (q: string, vars: Record<string, unknown>) =>
      q.includes('repository(')
        ? {
            repository: {
              i5: item(5, 'https://github.com/users/Octo/projects/2'),
              i6: item(6, 'https://github.com/users/octo/projects/3'),
              i7: { __typename: 'PullRequest' },
              i8: null
            }
          }
        : page(String(vars.query).startsWith('is:issue is:open') ? [issue(1)] : [], null)
    )
    const tickets = await createBoardClient(gql).tickets(src, map, '2026-10-23T09:00:00.000Z', [
      'octo/shop#1',
      'octo/shop#5',
      'octo/shop#6',
      'octo/shop#7',
      'octo/shop#8'
    ])
    expect(tickets.map((t) => [t.number, t.itemId, t.status, t.doneAt])).toEqual([
      [1, 'PVTI_1', 'Todo', null],
      [5, 'PVTI_5', 'Done', '2026-01-02T00:00:00Z']
    ])
    const keyCall = gql.mock.calls.find((c) => c[0].includes('repository('))!
    expect(keyCall[1]).toEqual({ owner: 'octo', name: 'shop' })
    expect(keyCall[0]).toContain('i5: issueOrPullRequest(number: 5)')
    expect(keyCall[0]).not.toContain('number: 1)')
  })
})

const fieldResponse = {
  user: {
    projectV2: {
      id: 'PVT_1',
      field: {
        id: 'PVTSSF_1',
        options: [
          { id: 'o1', name: 'Todo' },
          { id: 'o2', name: 'In Progress' }
        ]
      }
    }
  }
}

describe('setStatus', () => {
  it('sends the mutation with the matching option id', async () => {
    const gql = vi.fn().mockResolvedValueOnce(fieldResponse).mockResolvedValueOnce({})
    await createBoardClient(gql).setStatus(src, 'PVTI_1', 'In Progress')
    const [query, vars] = gql.mock.calls[1]
    expect(query).toContain('updateProjectV2ItemFieldValue')
    expect(vars).toMatchObject({
      projectId: 'PVT_1',
      fieldId: 'PVTSSF_1',
      itemId: 'PVTI_1',
      optionId: 'o2'
    })
  })

  it('throws on an unknown option', async () => {
    const gql = vi.fn().mockResolvedValue(fieldResponse)
    await expect(createBoardClient(gql).setStatus(src, 'PVTI_1', 'Nope')).rejects.toThrow(
      'No Status option named "Nope"'
    )
    expect(gql).toHaveBeenCalledTimes(1)
  })
})

describe('addItem', () => {
  it('adds the content to the project and returns the item id', async () => {
    const gql = vi
      .fn()
      .mockResolvedValueOnce(fieldResponse)
      .mockResolvedValueOnce({ addProjectV2ItemById: { item: { id: 'PVTI_9' } } })
    expect(await createBoardClient(gql).addItem(src, 'I_9')).toBe('PVTI_9')
    const [query, vars] = gql.mock.calls[1]
    expect(query).toContain('addProjectV2ItemById')
    expect(vars).toEqual({ projectId: 'PVT_1', contentId: 'I_9' })
  })
})

describe('boardError', () => {
  it("says the board doesn't exist when GitHub can't resolve it, and keeps other errors", () => {
    const missing = new Error(
      'Request failed due to following response errors:\n - Could not resolve to a ProjectV2 with the number 2.'
    )
    expect(boardError(src, missing)).toEqual(
      new Error("GitHub says octo/projects/2 doesn't exist, or your token can't read it.")
    )
    const other = new Error('GitHub CLI is not logged in')
    expect(boardError(src, other)).toBe(other)
  })
})

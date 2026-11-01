import { describe, expect, it, vi } from 'vitest'
import { columnFor, IN_PROGRESS_LABEL, REPO_STATUS } from '../../shared/columns'
import { createRepoIssuesClient, ISSUE_PROPS } from './repoIssues'

type Call = { query: string; vars: Record<string, unknown> }

const issue = (n: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: `I_${n}`,
  number: n,
  title: `t${n}`,
  body: `b${n}`,
  url: `https://github.com/o/r/issues/${n}`,
  closedAt: null,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-02T00:00:00Z',
  assignees: { nodes: [] },
  labels: { nodes: [] },
  parent: null,
  subIssuesSummary: { completed: 0, total: 0 },
  subIssues: { nodes: [] },
  blockedBy: { nodes: [] },
  closedByPullRequestsReferences: { nodes: [] },
  repository: { nameWithOwner: 'o/r' },
  state: extra.closedAt ? 'CLOSED' : 'OPEN',
  ...extra
})

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

describe('tickets', () => {
  it('pages through open issues and maps status from the label', async () => {
    const { gql, calls } = fake((q, v) => {
      if (q.includes('OPEN')) {
        const first = v.cursor === null
        return {
          repository: {
            issues: {
              pageInfo: { hasNextPage: first, endCursor: first ? 'c1' : null },
              nodes: first
                ? [issue(1)]
                : [issue(2, { labels: { nodes: [{ name: IN_PROGRESS_LABEL.name }] } })]
            }
          }
        }
      }
      return { repository: { issues: { pageInfo: { hasNextPage: false }, nodes: [] } } }
    })
    const out = await createRepoIssuesClient(gql).tickets('o/r', '2026-10-18T00:00:00Z', [])
    expect(out.map((t) => [t.key, t.status, t.itemId, t.doneAt])).toEqual([
      ['o/r#1', REPO_STATUS.todo, 'I_1', null],
      ['o/r#2', REPO_STATUS.inProgress, 'I_2', null]
    ])
    expect(calls.filter((c) => c.query.includes('OPEN'))).toHaveLength(2)
  })

  it('keeps a reopened issue out of Done, going by its state rather than closedAt', async () => {
    const { gql, calls } = fake((q) => ({
      repository: {
        issues: {
          pageInfo: { hasNextPage: false },
          nodes: q.includes('OPEN')
            ? [issue(6, { closedAt: '2026-10-20T00:00:00Z', state: 'OPEN' })]
            : []
        }
      }
    }))
    const [t] = await createRepoIssuesClient(gql).tickets('o/r', '2026-10-18T00:00:00Z', [])
    expect([t.status, t.doneAt]).toEqual([REPO_STATUS.todo, null])
    expect(calls[0].query).toMatch(/\bstate\b/)
  })

  it('asks for closed issues since the cutoff and keeps only those closed after it', async () => {
    const { gql, calls } = fake((q) => {
      if (q.includes('CLOSED'))
        return {
          repository: {
            issues: {
              pageInfo: { hasNextPage: false },
              nodes: [
                issue(3, { closedAt: '2026-10-20T00:00:00Z' }),
                issue(4, { closedAt: '2026-10-01T00:00:00Z' })
              ]
            }
          }
        }
      return { repository: { issues: { pageInfo: { hasNextPage: false }, nodes: [] } } }
    })
    const out = await createRepoIssuesClient(gql).tickets('o/r', '2026-10-18T00:00:00Z', [])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      number: 3,
      status: REPO_STATUS.done,
      doneAt: '2026-10-20T00:00:00Z'
    })
    const closed = calls.find((c) => c.query.includes('CLOSED'))
    expect(closed?.vars.since).toBe('2026-10-18T00:00:00Z')
  })

  it('fetches alsoNumbers in one request, skips duplicates and pull requests', async () => {
    const { gql, calls } = fake((q) => {
      if (q.includes('i5:'))
        return {
          repository: {
            i5: issue(5, { closedAt: '2026-01-01T00:00:00Z' }),
            i1: issue(1),
            i9: {}
          }
        }
      return {
        repository: {
          issues: {
            pageInfo: { hasNextPage: false },
            nodes: q.includes('OPEN') ? [issue(1)] : []
          }
        }
      }
    })
    const out = await createRepoIssuesClient(gql).tickets('o/r', '2026-10-18T00:00:00Z', [1, 5, 9])
    expect(out.map((t) => [t.number, t.status])).toEqual([
      [1, REPO_STATUS.todo],
      [5, REPO_STATUS.done]
    ])
    expect(calls).toHaveLength(3)
  })

  it('maps labels, assignees, dates, parent, and sub-issues, with no board fields', async () => {
    const node = issue(8, {
      labels: {
        nodes: [
          { name: 'bug', color: 'd73a4a' },
          { name: IN_PROGRESS_LABEL.name, color: IN_PROGRESS_LABEL.color }
        ]
      },
      assignees: { nodes: [{ id: 'U_1', login: 'octo', name: null }] },
      parent: {
        number: 3,
        title: 'Epic',
        url: 'https://github.com/o/other/issues/3',
        state: 'OPEN',
        repository: { nameWithOwner: 'o/other' },
        subIssuesSummary: { completed: 1, total: 4 }
      },
      subIssuesSummary: { completed: 3, total: 6 },
      subIssues: {
        nodes: [
          {
            number: 9,
            title: 'Part',
            url: 'https://github.com/o/r/issues/9',
            state: 'CLOSED',
            repository: { nameWithOwner: 'o/r' },
            stateReason: 'COMPLETED'
          },
          {
            number: 10,
            title: 'Other part',
            url: 'https://github.com/o/r/issues/10',
            state: 'OPEN',
            repository: { nameWithOwner: 'o/r' }
          },
          {
            number: 11,
            title: 'Dropped part',
            url: 'https://github.com/o/r/issues/11',
            state: 'CLOSED',
            stateReason: 'NOT_PLANNED',
            repository: { nameWithOwner: 'o/r' }
          },
          {
            number: 12,
            title: 'Same part',
            url: 'https://github.com/o/r/issues/12',
            state: 'CLOSED',
            stateReason: 'DUPLICATE',
            repository: { nameWithOwner: 'o/r' }
          }
        ]
      }
    })
    const { gql, calls } = fake((q) => ({
      repository: {
        issues: { pageInfo: { hasNextPage: false }, nodes: q.includes('OPEN') ? [node] : [] }
      }
    }))
    const [t] = await createRepoIssuesClient(gql).tickets('o/r', '2026-10-18T00:00:00Z', [])
    expect(t).toMatchObject({
      status: REPO_STATUS.inProgress,
      labels: [
        { name: 'bug', color: 'd73a4a' },
        { name: IN_PROGRESS_LABEL.name, color: IN_PROGRESS_LABEL.color }
      ],
      assignees: [{ id: 'U_1', login: 'octo', name: null }],
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-02T00:00:00Z',
      parent: {
        key: 'o/other#3',
        number: 3,
        title: 'Epic',
        repo: 'o/other',
        url: 'https://github.com/o/other/issues/3',
        column: 'todo',
        subIssues: { completed: 1, total: 4 }
      },
      subIssues: {
        completed: 3,
        total: 6,
        items: [
          {
            key: 'o/r#9',
            number: 9,
            title: 'Part',
            repo: 'o/r',
            url: 'https://github.com/o/r/issues/9',
            column: 'done',
            assignee: null
          },
          {
            key: 'o/r#10',
            number: 10,
            title: 'Other part',
            repo: 'o/r',
            url: 'https://github.com/o/r/issues/10',
            column: 'todo',
            assignee: null
          },
          expect.objectContaining({ key: 'o/r#11', column: 'hidden' }),
          expect.objectContaining({ key: 'o/r#12', column: 'hidden' })
        ]
      },
      boardFields: [],
      blockedBy: [],
      mergedPr: null,
      mergedAt: null,
      prStage: null
    })
    expect(calls[0].query).toContain('labels(first: 100) { nodes { name color } }')
    expect(calls[0].query).toContain('subIssuesSummary { completed total }')
    expect(calls[0].query).toContain('assignees(first: 10) { nodes { id login name } }')
  })
})

describe('ISSUE_PROPS', () => {
  it('asks for no connection inside each sub-issue, which would multiply the sync cost', () => {
    const at = ISSUE_PROPS.indexOf('subIssues(first: 50)')
    let depth = 0
    let end = ISSUE_PROPS.indexOf('{', at)
    do {
      if (ISSUE_PROPS[end] === '{') depth++
      if (ISSUE_PROPS[end] === '}') depth--
      end++
    } while (depth > 0)
    expect(ISSUE_PROPS.slice(at + 'subIssues('.length, end)).not.toMatch(/\(first:/)
    expect(ISSUE_PROPS).toContain('stateReason repository { nameWithOwner } } }')
  })
})

describe('not planned', () => {
  it('hides an issue closed as not planned and keeps one closed as completed in Done', async () => {
    const closedAt = '2026-10-20T00:00:00Z'
    const { gql, calls } = fake((q) => ({
      repository: {
        issues: {
          pageInfo: { hasNextPage: false },
          nodes: q.includes('CLOSED')
            ? [
                issue(1, { closedAt, stateReason: 'NOT_PLANNED' }),
                issue(2, { closedAt, stateReason: 'COMPLETED' })
              ]
            : []
        }
      }
    }))
    const out = await createRepoIssuesClient(gql).tickets('o/r', '2026-10-18T00:00:00Z', [])
    expect(out.map((t) => [t.number, columnFor(t.status, REPO_STATUS), t.notPlanned])).toEqual([
      [1, 'hidden', true],
      [2, 'done', undefined]
    ])
    expect(calls[0].query).toContain('stateReason')
  })
})

describe('prStage', () => {
  const pr = (over: Record<string, unknown>): Record<string, unknown> => ({
    url: 'u',
    mergedAt: null,
    state: 'OPEN',
    createdAt: '2026-10-01T00:00:00Z',
    reviewDecision: null,
    mergeable: 'MERGEABLE',
    commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
    ...over
  })
  const stageOf = async (prs: Record<string, unknown>[]): Promise<unknown> => {
    const node = issue(1, { closedByPullRequestsReferences: { nodes: prs } })
    const { gql, calls } = fake((q) => ({
      repository: {
        issues: { pageInfo: { hasNextPage: false }, nodes: q.includes('OPEN') ? [node] : [] }
      }
    }))
    const [t] = await createRepoIssuesClient(gql).tickets('o/r', '2026-10-18T00:00:00Z', [])
    expect(calls[0].query).toContain('reviewDecision mergeable isDraft')
    return t.prStage
  }

  it('reads the newest open closing pull request', async () => {
    expect(
      await stageOf([
        pr({ createdAt: '2026-10-03T00:00:00Z', reviewDecision: 'CHANGES_REQUESTED' }),
        pr({ createdAt: '2026-10-02T00:00:00Z' }),
        pr({ state: 'MERGED', createdAt: '2026-10-04T00:00:00Z', mergedAt: '2026-10-05T00:00:00Z' })
      ])
    ).toBe('changesRequested')
  })

  it('reads a failing rollup and a pull request with no commits', async () => {
    expect(
      await stageOf([
        pr({ commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] } })
      ])
    ).toBe('checksFailing')
    expect(await stageOf([pr({ commits: { nodes: [] } })])).toBe('readyToMerge')
  })

  it('says open for a draft that would otherwise be ready to merge', async () => {
    expect(await stageOf([pr({ isDraft: true })])).toBe('open')
  })

  it('is null without an open pull request', async () => {
    expect(await stageOf([pr({ state: 'CLOSED' })])).toBeNull()
  })
})

describe('blockers', () => {
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
    const node = issue(8, blocked)
    const { gql } = fake((q) => ({
      repository: {
        issues: { pageInfo: { hasNextPage: false }, nodes: q.includes('OPEN') ? [node] : [] }
      }
    }))
    const [t] = await createRepoIssuesClient(gql).tickets('o/r', '2026-10-18T00:00:00Z', [])
    expect(t.blockedBy).toEqual([
      { key: 'o/r#38', number: 38, title: 'Add a settings screen', repo: 'o/r' }
    ])
  })
})

describe('tickets with a stale alsoNumbers entry', () => {
  const empty = { repository: { issues: { pageInfo: { hasNextPage: false }, nodes: [] } } }

  it('keeps the issues that resolved when GitHub reports one as not found', async () => {
    const { gql } = fake((q) => {
      if (!q.includes('i5:')) return empty
      throw Object.assign(new Error('Could not resolve'), {
        data: { repository: { i5: issue(5), i6: null } }
      })
    })
    const out = await createRepoIssuesClient(gql).tickets('o/r', '2026-10-18T00:00:00Z', [5, 6])
    expect(out.map((t) => t.number)).toEqual([5])
  })

  it('rethrows errors that carry no data', async () => {
    const { gql } = fake((q) => {
      if (!q.includes('i5:')) return empty
      throw new Error('bad credentials')
    })
    await expect(
      createRepoIssuesClient(gql).tickets('o/r', '2026-10-18T00:00:00Z', [5])
    ).rejects.toThrow('bad credentials')
  })
})

describe('setColumn', () => {
  const labelled = { nodes: [{ name: IN_PROGRESS_LABEL.name }] }
  const run = async (
    column: 'todo' | 'inProgress' | 'done',
    issueOver: Record<string, unknown> = {},
    label: unknown = { id: 'L_old' }
  ): Promise<Call[]> => {
    const { gql, calls } = fake((q) => {
      if (q.includes('createLabel')) return { createLabel: { label: { id: 'L_new' } } }
      if (q.includes('mutation')) return {}
      return {
        repository: {
          id: 'R_1',
          label,
          issue: { id: 'I_7', state: 'OPEN', labels: { nodes: [] }, ...issueOver }
        }
      }
    })
    await createRepoIssuesClient(gql).setColumn('o/r', 7, column)
    return calls
  }
  const has = (calls: Call[], name: string): boolean => calls.some((c) => c.query.includes(name))

  it('adds the label to an open issue for inProgress, creating the label when missing', async () => {
    const calls = await run('inProgress', {}, null)
    const create = calls.find((c) => c.query.includes('createLabel'))
    expect(create?.vars).toMatchObject({
      repositoryId: 'R_1',
      name: IN_PROGRESS_LABEL.name,
      color: IN_PROGRESS_LABEL.color,
      description: IN_PROGRESS_LABEL.description
    })
    const add = calls.find((c) => c.query.includes('addLabelsToLabelable'))
    expect(add?.vars).toMatchObject({ labelableId: 'I_7', labelIds: ['L_new'] })
    expect(has(calls, 'reopenIssue')).toBe(false)
  })

  it('only adds an existing label', async () => {
    const calls = await run('inProgress')
    expect(has(calls, 'createLabel')).toBe(false)
    expect(calls.find((c) => c.query.includes('addLabelsToLabelable'))?.vars).toMatchObject({
      labelIds: ['L_old']
    })
  })

  it('reopens a closed issue and removes the label for todo', async () => {
    const calls = await run('todo', { state: 'CLOSED', labels: labelled })
    expect(calls.find((c) => c.query.includes('reopenIssue'))?.vars).toMatchObject({
      issueId: 'I_7'
    })
    expect(calls.find((c) => c.query.includes('removeLabelsFromLabelable'))?.vars).toMatchObject({
      labelableId: 'I_7',
      labelIds: ['L_old']
    })
    expect(has(calls, 'closeIssue')).toBe(false)
  })

  it('closes as completed and removes the label for done', async () => {
    const calls = await run('done', { labels: labelled })
    const close = calls.find((c) => c.query.includes('closeIssue'))
    expect(close?.vars).toMatchObject({ issueId: 'I_7' })
    expect(close?.query).toContain('stateReason: COMPLETED')
    expect(has(calls, 'removeLabelsFromLabelable')).toBe(true)
  })

  it('says the issue is missing when the lookup finds no issue or repo', async () => {
    for (const repository of [null, { id: 'R_1', label: null, issue: null }]) {
      const { gql } = fake(() => ({ repository }))
      await expect(createRepoIssuesClient(gql).setColumn('o/r', 7, 'todo')).rejects.toThrow(
        'Issue not found'
      )
    }
  })

  it('skips the label calls when nothing changes', async () => {
    const calls = await run('todo')
    expect(calls).toHaveLength(1)
  })
})

describe('reopen', () => {
  const run = async (state: string): Promise<Call[]> => {
    const { gql, calls } = fake((q) =>
      q.includes('mutation') ? {} : { repository: { issue: { id: 'I_7', state } } }
    )
    await createRepoIssuesClient(gql).reopen('o/r', 7)
    return calls
  }

  it('reopens a closed issue', async () => {
    const calls = await run('CLOSED')
    expect(calls[0].vars).toMatchObject({ owner: 'o', name: 'r', number: 7 })
    expect(calls.find((c) => c.query.includes('reopenIssue'))?.vars).toMatchObject({
      issueId: 'I_7'
    })
  })

  it('leaves an open issue alone', async () => {
    expect(await run('OPEN')).toHaveLength(1)
  })

  it('says the issue is missing when the lookup finds none', async () => {
    const { gql } = fake(() => ({ repository: null }))
    await expect(createRepoIssuesClient(gql).reopen('o/r', 7)).rejects.toThrow('Issue not found')
  })
})

describe('setAssignee', () => {
  const added = (ids: string[]): unknown => ({
    addAssigneesToAssignable: { assignable: { assignees: { nodes: ids.map((id) => ({ id })) } } }
  })
  const run = async (from: string | null, to: string | null): Promise<Call[]> => {
    const { gql, calls } = fake((q, v) =>
      q.includes('addAssignees')
        ? added(v.assigneeIds as string[])
        : q.includes('mutation')
          ? {}
          : { repository: { issue: { id: 'I_7', state: 'OPEN' } } }
    )
    await createRepoIssuesClient(gql).setAssignee('o/r', 7, from, to)
    return calls
  }

  it('looks up the issue, adds the new assignee, then removes the old one', async () => {
    const calls = await run('U_a', 'U_b')
    expect(calls[0].vars).toEqual({ owner: 'o', name: 'r', number: 7 })
    expect(calls[1].query).toContain('addAssigneesToAssignable')
    expect(calls[1].vars).toEqual({ assignableId: 'I_7', assigneeIds: ['U_b'] })
    expect(calls[2].query).toContain('removeAssigneesFromAssignable')
    expect(calls[2].vars).toEqual({ assignableId: 'I_7', assigneeIds: ['U_a'] })
    expect(calls).toHaveLength(3)
  })

  it('skips the add when to is null and the remove when from is null', async () => {
    const unassign = await run('U_a', null)
    expect(unassign.map((c) => c.query.includes('removeAssignees'))).toEqual([false, true])
    const assign = await run(null, 'U_b')
    expect(assign.map((c) => c.query.includes('addAssignees'))).toEqual([false, true])
  })

  it("throws before the remove when GitHub didn't assign the person", async () => {
    const { calls, gql } = fake((q) =>
      q.includes('addAssignees')
        ? added(['U_a'])
        : { repository: { issue: { id: 'I_7', state: 'OPEN' } } }
    )
    await expect(createRepoIssuesClient(gql).setAssignee('o/r', 7, 'U_a', 'U_b')).rejects.toThrow(
      "Couldn't assign that person on o/r"
    )
    expect(calls.some((c) => c.query.includes('removeAssignees'))).toBe(false)
  })

  it('says the issue is missing when the lookup finds none', async () => {
    const { gql } = fake(() => ({ repository: null }))
    await expect(createRepoIssuesClient(gql).setAssignee('o/r', 7, null, 'U_b')).rejects.toThrow(
      'Issue not found'
    )
  })
})

describe('create', () => {
  it('looks up the repository and creates the issue in it', async () => {
    const { gql, calls } = fake((q) =>
      q.includes('createIssue')
        ? { createIssue: { issue: { id: 'I_9', number: 9 } } }
        : { repository: { id: 'R_1' } }
    )
    const out = await createRepoIssuesClient(gql).create('o/r', 'Title', 'Body')
    expect(out).toEqual({ id: 'I_9', number: 9 })
    expect(calls[0].vars).toEqual({ owner: 'o', name: 'r' })
    expect(calls[1].vars).toEqual({ repositoryId: 'R_1', title: 'Title', body: 'Body' })
  })

  it('looks up the parent with the repository and sets it on the new issue', async () => {
    const { gql, calls } = fake((q) =>
      q.includes('createIssue')
        ? { createIssue: { issue: { id: 'I_9', number: 9 } } }
        : { repository: { id: 'R_1', issue: { id: 'I_3' } } }
    )
    await createRepoIssuesClient(gql).create('o/r', 'Title', 'Body', 3)
    expect(calls[0].vars).toEqual({ owner: 'o', name: 'r', number: 3 })
    expect(calls[1].query).toContain('parentIssueId: $parentIssueId')
    expect(calls[1].vars).toEqual({
      repositoryId: 'R_1',
      title: 'Title',
      body: 'Body',
      parentIssueId: 'I_3'
    })
  })

  it('says the parent is missing when the lookup finds no such issue', async () => {
    const { gql, calls } = fake(() => ({ repository: { id: 'R_1', issue: null } }))
    await expect(createRepoIssuesClient(gql).create('o/r', 'T', '', 3)).rejects.toThrow(
      'Parent issue not found'
    )
    expect(calls).toHaveLength(1)
  })

  it('says the repo is missing when the lookup finds none', async () => {
    const { gql, calls } = fake(() => ({ repository: null }))
    await expect(createRepoIssuesClient(gql).create('o/r', 'T', '')).rejects.toThrow(
      'Repo not found'
    )
    expect(calls).toHaveLength(1)
  })
})

describe('tickets in a repo with too many issues', () => {
  it('stops after 10 pages, keeps what it fetched, and says so', async () => {
    const { gql, calls } = fake((q, vars) => ({
      repository: {
        issues: {
          pageInfo: { hasNextPage: true, endCursor: `${vars.cursor ?? ''}c` },
          nodes: q.includes('OPEN') ? [issue(String(vars.cursor ?? '').length + 1)] : []
        }
      }
    }))
    const truncated = vi.fn()
    const out = await createRepoIssuesClient(gql).tickets(
      'o/r',
      '2026-10-18T00:00:00Z',
      [],
      truncated
    )
    expect(out).toHaveLength(10)
    expect(calls).toHaveLength(20)
    expect(calls[0].query).toContain('orderBy: { field: UPDATED_AT, direction: DESC }')
    expect(truncated.mock.calls).toEqual([
      ['o/r has more than 1,000 open issues; Sandtable shows the 1,000 most recently updated.'],
      [
        'o/r has more than 1,000 recently closed or updated issues; Sandtable shows the 1,000 most recently updated.'
      ]
    ])
  })
})

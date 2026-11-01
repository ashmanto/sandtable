import { describe, expect, it } from 'vitest'
import { createAreasClient } from './areas'
import { ADD_LABEL, CREATE_LABEL } from './repoIssues'

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

const labels = {
  nodes: [
    { id: 'L1', name: 'area: sessions', description: 'Sessions' },
    { id: 'L2', name: 'sub-area: x', description: null },
    { id: 'L3', name: 'area: board', description: null }
  ]
}

describe('list', () => {
  it('keeps only labels that start with area:', async () => {
    const { gql, calls } = fake(() => ({ repository: { id: 'R', labels } }))
    expect(await createAreasClient(gql).list('o/r')).toEqual([
      { name: 'area: sessions', description: 'Sessions' },
      { name: 'area: board', description: '' }
    ])
    expect(calls[0].vars).toEqual({ owner: 'o', name: 'r' })
    expect(calls[0].query).toContain('query: "area:"')
  })
})

describe('apply', () => {
  it('creates new areas, adds the label, and links each blocker', async () => {
    const { gql, calls } = fake((q, v) => {
      if (q === CREATE_LABEL) return { createLabel: { label: { id: `new-${v.name}` } } }
      if (q === ADD_LABEL || q.includes('addBlockedBy')) return {}
      return {
        repository: {
          id: 'R',
          labels: { nodes: [] },
          issue: { id: 'I147', labels: { nodes: [] } }
        },
        b0: { issue: { id: 'I38' } },
        b1: { issue: { id: 'I40' } }
      }
    })
    await createAreasClient(gql).apply('o/r', 147, {
      area: 'area: board',
      newAreas: [
        { name: 'area: sessions', description: 'Sessions' },
        { name: 'area: board', description: 'Board' }
      ],
      blockedBy: [
        { key: 'o/r#38', number: 38, title: 'a' },
        { key: 'o/r#40', number: 40, title: 'b' }
      ],
      reason: 'r'
    })
    expect(calls[0].query).toContain(
      'issue(number: $number) { id labels(first: 100) { nodes { name } } }'
    )
    expect(calls[0].query).toContain('$n1: Int!')
    expect(calls[0].vars).toEqual({
      owner: 'o',
      name: 'r',
      number: 147,
      o0: 'o',
      r0: 'r',
      n0: 38,
      o1: 'o',
      r1: 'r',
      n1: 40
    })
    expect(calls.filter((c) => c.query === CREATE_LABEL).map((c) => c.vars)).toEqual([
      { repositoryId: 'R', name: 'area: sessions', color: 'c5def5', description: 'Sessions' },
      { repositoryId: 'R', name: 'area: board', color: 'c5def5', description: 'Board' }
    ])
    expect(calls.filter((c) => c.query === ADD_LABEL).map((c) => c.vars)).toEqual([
      { labelableId: 'I147', labelIds: ['new-area: board'] }
    ])
    expect(calls.filter((c) => c.query.includes('addBlockedBy')).map((c) => c.vars)).toEqual([
      { issueId: 'I147', blockingIssueId: 'I38' },
      { issueId: 'I147', blockingIssueId: 'I40' }
    ])
    expect(calls.at(-1)?.query).toBe(ADD_LABEL)
  })

  it("links a blocker in another repo to that repo's issue", async () => {
    const { gql, calls } = fake((q) => {
      if (q === ADD_LABEL || q.includes('addBlockedBy')) return {}
      return {
        repository: { id: 'R', labels, issue: { id: 'I5', labels: { nodes: [] } } },
        b0: { issue: { id: 'OTHER9' } }
      }
    })
    await createAreasClient(gql).apply('o/r', 5, {
      area: 'area: board',
      newAreas: [],
      blockedBy: [{ key: 'o/other#9', number: 9, title: 'a' }],
      reason: 'r'
    })
    expect(calls[0].vars).toEqual({ owner: 'o', name: 'r', number: 5, o0: 'o', r0: 'other', n0: 9 })
    expect(calls[0].query).toContain(
      'b0: repository(owner: $o0, name: $r0) { issue(number: $n0) { id } }'
    )
    expect(calls.filter((c) => c.query.includes('addBlockedBy')).map((c) => c.vars)).toEqual([
      { issueId: 'I5', blockingIssueId: 'OTHER9' }
    ])
  })

  it('adds no label when a blocker fails, so Apply can be retried', async () => {
    const { gql, calls } = fake((q) => {
      if (q.includes('addBlockedBy')) throw new Error('GitHub is down')
      return {
        repository: { id: 'R', labels, issue: { id: 'I5', labels: { nodes: [] } } },
        b0: { issue: { id: 'I6' } }
      }
    })
    await expect(
      createAreasClient(gql).apply('o/r', 5, {
        area: 'area: board',
        newAreas: [],
        blockedBy: [{ key: 'o/r#6', number: 6, title: 'a' }],
        reason: 'r'
      })
    ).rejects.toThrow('GitHub is down')
    expect(calls.some((c) => c.query === ADD_LABEL)).toBe(false)
  })

  it('refuses an issue that already has an area label, before any write', async () => {
    const { gql, calls } = fake(() => ({
      repository: {
        id: 'R',
        labels,
        issue: { id: 'I5', labels: { nodes: [{ name: 'bug' }, { name: 'area: board' }] } }
      }
    }))
    await expect(
      createAreasClient(gql).apply('o/r', 5, {
        area: 'area: sessions',
        newAreas: [],
        blockedBy: [],
        reason: 'r'
      })
    ).rejects.toThrow('#5 already has area: board')
    expect(calls).toHaveLength(1)
  })

  it("adds an existing area's label by its ID", async () => {
    const { gql, calls } = fake((q) =>
      q === ADD_LABEL
        ? {}
        : { repository: { id: 'R', labels, issue: { id: 'I5', labels: { nodes: [] } } } }
    )
    await createAreasClient(gql).apply('o/r', 5, {
      area: 'area: sessions',
      newAreas: [],
      blockedBy: [],
      reason: 'r'
    })
    expect(calls.map((c) => c.vars).slice(1)).toEqual([{ labelableId: 'I5', labelIds: ['L1'] }])
  })

  it('creates no new areas once the repo has some, so two triages make one set', async () => {
    const { gql, calls } = fake((q) =>
      q === ADD_LABEL
        ? {}
        : { repository: { id: 'R', labels, issue: { id: 'I5', labels: { nodes: [] } } } }
    )
    await expect(
      createAreasClient(gql).apply('o/r', 5, {
        area: 'area: new',
        newAreas: [{ name: 'area: new', description: 'New' }],
        blockedBy: [],
        reason: 'r'
      })
    ).rejects.toThrow('Label "area: new" not found')
    expect(calls.some((c) => c.query === CREATE_LABEL)).toBe(false)
  })

  it('finishes the new areas on a retry after creating them failed partway', async () => {
    const made: { id: string; name: string; description: string }[] = []
    let fail = true
    const { gql, calls } = fake((q, v) => {
      if (q === ADD_LABEL) return {}
      if (q === CREATE_LABEL) {
        if (made.length === 1 && fail) throw new Error('GitHub is down')
        made.push({ id: `new-${v.name}`, name: v.name as string, description: '' })
        return { createLabel: { label: { id: `new-${v.name}` } } }
      }
      return {
        repository: {
          id: 'R',
          labels: { nodes: [...made] },
          issue: { id: 'I5', labels: { nodes: [] } }
        }
      }
    })
    const triage = {
      area: 'area: board',
      newAreas: [
        { name: 'area: sessions', description: 'Sessions' },
        { name: 'area: board', description: 'Board' }
      ],
      blockedBy: [],
      reason: 'r'
    }
    await expect(createAreasClient(gql).apply('o/r', 5, triage)).rejects.toThrow('GitHub is down')
    fail = false
    await createAreasClient(gql).apply('o/r', 5, triage)
    expect(made.map((l) => l.name)).toEqual(['area: sessions', 'area: board'])
    expect(calls.filter((c) => c.query === ADD_LABEL).map((c) => c.vars)).toEqual([
      { labelableId: 'I5', labelIds: ['new-area: board'] }
    ])
  })

  it('skips creating a new area that already exists, so a second Apply works', async () => {
    const { gql, calls } = fake((q) =>
      q === ADD_LABEL
        ? {}
        : { repository: { id: 'R', labels, issue: { id: 'I5', labels: { nodes: [] } } } }
    )
    await createAreasClient(gql).apply('o/r', 5, {
      area: 'area: sessions',
      newAreas: [{ name: 'area: sessions', description: 'Sessions' }],
      blockedBy: [],
      reason: 'r'
    })
    expect(calls.some((c) => c.query === CREATE_LABEL)).toBe(false)
    expect(calls.map((c) => c.vars).slice(1)).toEqual([{ labelableId: 'I5', labelIds: ['L1'] }])
  })
})

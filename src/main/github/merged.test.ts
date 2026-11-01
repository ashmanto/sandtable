import { describe, expect, it, vi } from 'vitest'
import { mergedFor, mergedPullRequests, type MergedPr } from './merged'

const pr = (n: number, updatedAt: string, extra: Partial<MergedPr> = {}): MergedPr => ({
  number: n,
  headRefName: `branch-${n}`,
  title: `t${n}`,
  body: '',
  url: `https://github.com/o/r/pull/${n}`,
  mergedAt: updatedAt,
  updatedAt,
  ...extra
})

const page = (nodes: MergedPr[], endCursor: string | null = null): unknown => ({
  repository: {
    pullRequests: { pageInfo: { hasNextPage: endCursor !== null, endCursor }, nodes }
  }
})

describe('mergedPullRequests', () => {
  it('pages until it reaches pull requests updated before since', async () => {
    const vars: Record<string, unknown>[] = []
    const pages = [
      page([pr(3, '2026-10-20T00:00:00Z'), pr(2, '2026-10-15T00:00:00Z')], 'c1'),
      page([pr(1, '2026-10-12T00:00:00Z'), pr(0, '2026-09-01T00:00:00Z')], 'c2')
    ]
    const result = await mergedPullRequests(
      async (_q, v) => (vars.push(v), pages[vars.length - 1]),
      'o/r',
      '2026-10-10T00:00:00Z'
    )
    expect(result.map((p) => p.number)).toEqual([3, 2, 1])
    expect(vars).toEqual([
      { owner: 'o', name: 'r', cursor: null },
      { owner: 'o', name: 'r', cursor: 'c1' }
    ])
  })

  it('stops when there is no next page', async () => {
    let calls = 0
    const result = await mergedPullRequests(
      async () => (calls++, page([pr(1, '2026-10-20T00:00:00Z')])),
      'o/r',
      '2026-10-10T00:00:00Z'
    )
    expect(calls).toBe(1)
    expect(result).toHaveLength(1)
  })

  it('reads at most five pages, and says when it stopped early', async () => {
    let calls = 0
    const truncated = vi.fn()
    await mergedPullRequests(
      async () => page([pr(++calls, '2026-10-20T00:00:00Z')], `c${calls}`),
      'o/r',
      '2026-10-10T00:00:00Z',
      truncated
    )
    expect(calls).toBe(5)
    expect(truncated).toHaveBeenCalledWith(
      "o/r has more than 500 merged pull requests since 2026-10-10, so Sandtable didn't mark merges this sync."
    )
  })

  it("doesn't say it stopped early when the fifth page reaches older pull requests", async () => {
    let calls = 0
    const truncated = vi.fn()
    await mergedPullRequests(
      async () =>
        page([pr(++calls, calls === 5 ? '2026-10-01T00:00:00Z' : '2026-10-20T00:00:00Z')], 'c'),
      'o/r',
      '2026-10-10T00:00:00Z',
      truncated
    )
    expect(truncated).not.toHaveBeenCalled()
  })
})

describe('mergedFor', () => {
  it('takes the newest merged pull request that names the key anywhere', () => {
    const prs = [
      pr(1, '2026-10-01T00:00:00Z', { headRefName: 'inf-12-fix' }),
      pr(2, '2026-10-03T00:00:00Z', { title: 'Fix the thing (INF-12)' }),
      pr(3, '2026-10-02T00:00:00Z', { body: 'Closes INF-12' })
    ]
    expect(mergedFor('INF-12', prs)).toEqual({
      mergedPr: 'https://github.com/o/r/pull/2',
      mergedAt: '2026-10-03T00:00:00Z'
    })
  })

  it('matches the whole key only', () => {
    const prs = [
      pr(1, '2026-10-01T00:00:00Z', { headRefName: 'INF-12-fix' }),
      pr(2, '2026-10-01T00:00:00Z', { title: 'PINT-1 work' })
    ]
    expect(mergedFor('INF-1', prs)).toEqual({ mergedPr: null, mergedAt: null })
  })
})

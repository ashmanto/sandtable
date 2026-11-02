import { describe, expect, it, vi } from 'vitest'
import type { BoardSource } from '../../shared/types'
import type { GraphqlFn } from './graphql'
import { changeStamp } from './stamp'

const board: BoardSource = {
  url: 'https://github.com/orgs/o/projects/3',
  ownerType: 'org',
  owner: 'o',
  number: 3
}
const NEWEST = 'first: 1, orderBy: { field: UPDATED_AT, direction: DESC }'

describe('changeStamp', () => {
  it("asks for the board updatedAt and each repo's newest issue and pull request", async () => {
    const gql = vi.fn<GraphqlFn>(async () => ({}))
    await changeStamp(gql, board, ['o/a', 'o/b'])
    const [query, vars] = gql.mock.calls[0]
    expect(query).toContain('organization(login: $owner)')
    expect(query).toContain('projectV2(number: $number) { updatedAt }')
    expect(query.split(`issues(${NEWEST})`)).toHaveLength(3)
    expect(query.split(`pullRequests(${NEWEST})`)).toHaveLength(3)
    expect(vars).toEqual({ owner: 'o', number: 3, o0: 'o', n0: 'a', o1: 'o', n1: 'b' })
  })

  it('asks a user board through user', async () => {
    const gql = vi.fn<GraphqlFn>(async () => ({}))
    await changeStamp(gql, { ...board, ownerType: 'user' }, ['o/a'])
    expect(gql.mock.calls[0][0]).toContain('user(login: $owner)')
  })

  it('leaves out the board for a repo-issue project', async () => {
    const gql = vi.fn<GraphqlFn>(async () => ({}))
    await changeStamp(gql, undefined, ['o/a'])
    const [query, vars] = gql.mock.calls[0]
    expect(query).not.toContain('projectV2')
    expect(query).not.toContain('$owner')
    expect(vars).toEqual({ o0: 'o', n0: 'a' })
  })

  it('sends nothing for a project with no board and no repos', async () => {
    const gql = vi.fn<GraphqlFn>(async () => ({}))
    expect(await changeStamp(gql, undefined, [])).toBe('')
    expect(gql).not.toHaveBeenCalled()
  })

  it("changes when only the board's updatedAt moves", async () => {
    const at = (when: string): Promise<string> =>
      changeStamp(
        vi.fn(async () => ({
          user: { projectV2: { updatedAt: when } },
          r0: { issues: { nodes: [{ updatedAt: 'x' }] }, pullRequests: { nodes: [] } }
        })),
        { ...board, ownerType: 'user' },
        ['o/a']
      )
    expect(await at('2026-11-02T10:00:00Z')).not.toBe(await at('2026-11-02T10:01:00Z'))
  })

  it('passes names as variables', async () => {
    const gql = vi.fn<GraphqlFn>(async () => ({}))
    await changeStamp(gql, board, ['o/"x"'])
    expect(gql.mock.calls[0][0]).not.toContain('"x"')
  })

  it('returns the same string for the same answer and a different one when a timestamp moves', async () => {
    const answer = (at: string): unknown => ({
      r0: { issues: { nodes: [{ updatedAt: at }] }, pullRequests: { nodes: [] } }
    })
    const stamp = (at: string): Promise<string> =>
      changeStamp(
        vi.fn(async () => answer(at)),
        undefined,
        ['o/a']
      )
    expect(await stamp('2026-11-02T10:00:00Z')).toBe(await stamp('2026-11-02T10:00:00Z'))
    expect(await stamp('2026-11-02T10:00:00Z')).not.toBe(await stamp('2026-11-02T10:01:00Z'))
  })
})

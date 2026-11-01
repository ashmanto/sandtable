import { describe, expect, it } from 'vitest'
import { fetchTicketDetails } from './ticketDetails'

const pr = (number: number, state: string): Record<string, unknown> => ({
  __typename: 'PullRequest',
  number,
  title: `pr${number}`,
  url: `https://github.com/o/r/pull/${number}`,
  state
})

describe('fetchTicketDetails', () => {
  it('throws Issue not found when the issue is missing', async () => {
    await expect(
      fetchTicketDetails(async () => ({ repository: { issue: null } }), 'o/r', 4)
    ).rejects.toThrow('Issue not found')
  })

  it('asks for the newest 100 comments', async () => {
    let query = ''
    await fetchTicketDetails(
      async (q) => {
        query = q
        return { repository: { issue: null } }
      },
      'o/r',
      4
    ).catch(() => undefined)
    expect(query).toContain('comments(last: 100)')
  })

  it('maps body, labels, comments, and deduped linked pull requests', async () => {
    const calls: { vars: Record<string, unknown> }[] = []
    const details = await fetchTicketDetails(
      async (_q, vars) => {
        calls.push({ vars })
        return {
          repository: {
            issue: {
              body: 'the body',
              labels: { nodes: [{ name: 'bug', color: 'd73a4a' }] },
              comments: {
                nodes: [
                  { author: { login: 'ann' }, createdAt: '2026-01-01', body: 'one' },
                  { author: null, createdAt: '2026-01-02', body: 'two' }
                ]
              },
              closedByPullRequestsReferences: { nodes: [pr(7, 'MERGED')] },
              timelineItems: {
                nodes: [
                  { source: pr(7, 'MERGED') },
                  { source: pr(8, 'OPEN') },
                  { source: { __typename: 'Issue' } },
                  { source: pr(9, 'CLOSED') }
                ]
              }
            }
          }
        }
      },
      'o/r',
      4
    )
    expect(calls[0].vars).toEqual({ owner: 'o', name: 'r', number: 4 })
    expect(details).toEqual({
      body: 'the body',
      labels: [{ name: 'bug', color: 'd73a4a' }],
      comments: [
        { author: 'ann', createdAt: '2026-01-01', body: 'one' },
        { author: 'ghost', createdAt: '2026-01-02', body: 'two' }
      ],
      pullRequests: [
        { number: 7, title: 'pr7', url: 'https://github.com/o/r/pull/7', state: 'merged' },
        { number: 8, title: 'pr8', url: 'https://github.com/o/r/pull/8', state: 'open' },
        { number: 9, title: 'pr9', url: 'https://github.com/o/r/pull/9', state: 'closed' }
      ]
    })
  })
})

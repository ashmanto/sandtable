import { describe, expect, it, vi } from 'vitest'
import { postComment } from './comments'

describe('postComment', () => {
  it("looks up the issue's ID and adds the comment to it", async () => {
    const gql = vi
      .fn()
      .mockResolvedValueOnce({ repository: { issue: { id: 'I_1' } } })
      .mockResolvedValueOnce({ addComment: { clientMutationId: null } })
    await postComment(gql, 'o/r', 4, 'Done.')
    expect(gql.mock.calls[0][1]).toEqual({ owner: 'o', name: 'r', number: 4 })
    expect(gql.mock.calls[1][0]).toContain('addComment')
    expect(gql.mock.calls[1][1]).toEqual({ subjectId: 'I_1', body: 'Done.' })
  })

  it('throws when the issue is missing', async () => {
    const gql = vi.fn().mockResolvedValueOnce({ repository: { issue: null } })
    await expect(postComment(gql, 'o/r', 4, 'x')).rejects.toThrow('Issue #4 not found')
    expect(gql).toHaveBeenCalledTimes(1)
  })
})

import { describe, expect, it } from 'vitest'
import { parseBoardUrl } from './boardUrl'

describe('parseBoardUrl', () => {
  it('parses a user board', () => {
    expect(parseBoardUrl('https://github.com/users/octo/projects/2')).toEqual({
      url: 'https://github.com/users/octo/projects/2',
      ownerType: 'user',
      owner: 'octo',
      number: 2
    })
  })

  it('parses an org board with a view suffix', () => {
    expect(parseBoardUrl('https://github.com/orgs/acme/projects/7/views/1')).toMatchObject({
      ownerType: 'org',
      owner: 'acme',
      number: 7
    })
  })

  it('trims surrounding whitespace', () => {
    expect(parseBoardUrl('  https://github.com/users/octo/projects/2\n')).toMatchObject({
      url: 'https://github.com/users/octo/projects/2',
      number: 2
    })
  })

  it('rejects a repo URL', () => {
    expect(() => parseBoardUrl('https://github.com/octo/shop')).toThrow(
      'Not a GitHub Projects board URL'
    )
  })
})

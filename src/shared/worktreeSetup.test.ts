import { describe, expect, it } from 'vitest'
import { copyPathProblem } from './worktreeSetup'

describe('copyPathProblem', () => {
  it('accepts a path inside the repo', () => {
    expect(copyPathProblem('.env')).toBeNull()
    expect(copyPathProblem('config/local.json')).toBeNull()
    expect(copyPathProblem('a..b')).toBeNull()
  })

  it('refuses an empty path', () => {
    expect(copyPathProblem('  ')).toBe('it is empty')
  })

  it('refuses a path with spaces around it', () => {
    expect(copyPathProblem(' .env')).toBe('remove the spaces around it')
    expect(copyPathProblem('.env ')).toBe('remove the spaces around it')
  })

  it('refuses an absolute path or one that leaves the repo', () => {
    for (const p of ['/etc/passwd', '..', '../x', 'a/../../b'])
      expect(copyPathProblem(p)).toBe('use a path inside the repo')
  })

  it('refuses a NUL byte', () => {
    expect(copyPathProblem('a\0b')).toBe('remove the NUL byte')
  })
})

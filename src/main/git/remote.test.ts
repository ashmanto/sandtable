import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run } from '../env/tools'
import { githubRepoFromUrl, githubReposOf } from './remote'

vi.mock('../env/tools', async (load) => {
  const tools = await load<typeof import('../env/tools')>()
  return { ...tools, run: vi.fn(tools.run) }
})

describe('githubRepoFromUrl', () => {
  it.each([
    'https://github.com/O/R.git',
    'https://github.com/o/r',
    'git@github.com:o/r.git',
    'ssh://git@github.com/o/r.git'
  ])('reads %s', (url) => {
    expect(githubRepoFromUrl(url)).toBe('o/r')
  })

  it('returns null for other hosts', () => {
    expect(githubRepoFromUrl('https://gitlab.com/o/r.git')).toBeNull()
    expect(githubRepoFromUrl('git@gitlab.com:o/r.git')).toBeNull()
  })
})

describe('githubReposOf', () => {
  let dir: string
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sandtable-remote-'))
  })
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('returns every distinct github remote', async () => {
    const git = (...args: string[]): string =>
      execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' })
    git('init', '-b', 'main')
    git('remote', 'add', 'origin', 'git@github.com:Me/App.git')
    git('remote', 'add', 'upstream', 'https://github.com/org/app')
    git('remote', 'add', 'mirror', 'https://github.com/me/app.git')
    git('remote', 'add', 'other', 'https://gitlab.com/x/y.git')
    expect((await githubReposOf(dir)).sort()).toEqual(['me/app', 'org/app'])
  })

  it('returns [] for a folder that is not a repo', async () => {
    expect(await githubReposOf(dir)).toEqual([])
    expect(run).toHaveBeenLastCalledWith('git', ['-C', dir, 'remote', '-v'], undefined, 120_000)
  })
})

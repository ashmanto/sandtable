import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run } from '../env/tools'
import { ensureWorktree, gitOrThrow, removeWorktree, worktreePath } from './worktree'

vi.mock('../env/tools', async (load) => {
  const tools = await load<typeof import('../env/tools')>()
  return { ...tools, run: vi.fn(tools.run) }
})

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' })

let root: string
let repo: string

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sandtable-wt-')))
  repo = path.join(root, 'repo')
  const origin = path.join(root, 'origin.git')
  await fs.mkdir(repo)
  git(repo, 'init', '-b', 'main')
  git(repo, 'config', 'user.name', 'Test')
  git(repo, 'config', 'user.email', 'test@example.com')
  await fs.writeFile(path.join(repo, 'a.txt'), 'a\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-m', 'init')
  git(root, 'clone', '--bare', repo, origin)
  git(repo, 'remote', 'add', 'origin', origin)
  git(repo, 'fetch', 'origin')
  git(repo, 'branch', '-u', 'origin/main', 'main')
  git(repo, 'remote', 'set-head', 'origin', 'main')
})

afterEach(async () => {
  vi.mocked(run).mockClear()
  await fs.rm(root, { recursive: true, force: true })
})

describe('gitOrThrow', () => {
  it("keeps git's reason in the error", async () => {
    await expect(gitOrThrow(repo, 'rev-parse', '--verify', 'nope')).rejects.toThrow(
      /failed: fatal: Needed a single revision/
    )
  })

  it('says git ran out of time when the timeout stopped it', async () => {
    vi.mocked(run).mockResolvedValueOnce({ stdout: '', stderr: 'killed by SIGTERM', code: -1 })
    await expect(gitOrThrow(repo, 'status')).rejects.toThrow(
      "git status didn't finish within 120 seconds"
    )
  })

  it('gives local git calls two minutes', async () => {
    await ensureWorktree(repo, '20-x')
    const local = vi.mocked(run).mock.calls.filter((c) => c[0] === 'git' && c[3] !== 30_000)
    expect(local.length).toBeGreaterThan(0)
    expect(local.every((c) => c[3] === 120_000)).toBe(true)
  })
})

describe('ensureWorktree', () => {
  it('creates the worktree on a new branch from the default branch', async () => {
    const wt = (await ensureWorktree(repo, '1-thing')).path
    expect(wt).toBe(worktreePath(repo, '1-thing'))
    expect(wt).toBe(`${repo}-wt.noindex/1-thing`)
    expect(git(wt, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('1-thing')
    expect(git(wt, 'rev-parse', 'HEAD')).toBe(git(repo, 'rev-parse', 'main'))
  })

  it('returns the same path when called twice', async () => {
    const first = await ensureWorktree(repo, '1-thing')
    expect((await ensureWorktree(repo, '1-thing')).path).toBe(first.path)
  })

  it('returns the same path twice through a symlinked repo path', async () => {
    const link = path.join(os.tmpdir(), `sandtable-link-${path.basename(root)}`)
    await fs.symlink(root, link)
    try {
      const via = path.join(link, 'repo')
      const first = await ensureWorktree(via, '1-thing')
      expect(first.path).toBe(worktreePath(via, '1-thing'))
      expect(await ensureWorktree(via, '1-thing')).toEqual({ path: first.path, created: false })
    } finally {
      await fs.rm(link)
    }
  })

  it('checks out an existing branch that has no worktree', async () => {
    git(repo, 'branch', '2-old')
    const { path: wt } = await ensureWorktree(repo, '2-old')
    expect(git(wt, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('2-old')
  })

  const pushToOrigin = (): string => {
    const other = path.join(root, 'other')
    git(root, 'clone', path.join(root, 'origin.git'), other)
    git(other, 'config', 'user.name', 'Test')
    git(other, 'config', 'user.email', 'test@example.com')
    git(other, 'commit', '--allow-empty', '-m', 'ahead')
    git(other, 'push', 'origin', 'main')
    return git(other, 'rev-parse', 'HEAD')
  }

  it('fetches the default branch before creating a new branch', async () => {
    const ahead = pushToOrigin()
    const result = await ensureWorktree(repo, '9-fresh')
    expect(result.fetchError).toBeUndefined()
    expect(git(result.path, 'rev-parse', 'HEAD')).toBe(ahead)
  })

  it('runs one fetch at a time per repo', async () => {
    const real = (await vi.importActual<typeof import('../env/tools')>('../env/tools')).run
    let inFlight = 0
    let most = 0
    vi.mocked(run).mockImplementation(async (...a) => {
      if (!a[1].includes('fetch')) return real(...a)
      most = Math.max(most, ++inFlight)
      await new Promise((r) => setTimeout(r, 50))
      try {
        return await real(...a)
      } finally {
        inFlight--
      }
    })
    const results = await Promise.all([
      ensureWorktree(repo, '30-a'),
      ensureWorktree(repo, '31-b')
    ]).finally(() => vi.mocked(run).mockImplementation(real))
    expect(results.map((r) => r.fetchError)).toEqual([undefined, undefined])
    expect(most).toBe(1)
  })

  it('creates the branch from the local copy and reports why when the fetch fails', async () => {
    git(repo, 'remote', 'set-url', 'origin', path.join(root, 'missing.git'))
    const result = await ensureWorktree(repo, '10-offline')
    expect(result.fetchError).toMatch(/does not appear to be a git repository/)
    expect(git(result.path, 'rev-parse', 'HEAD')).toBe(git(repo, 'rev-parse', 'origin/main'))
  })

  it('fetches the default branch when the remote fetch refspec is narrowed', async () => {
    git(repo, 'config', 'remote.origin.fetch', '+refs/heads/other:refs/remotes/origin/other')
    const ahead = pushToOrigin()
    const result = await ensureWorktree(repo, '12-narrow')
    expect(git(result.path, 'rev-parse', 'HEAD')).toBe(ahead)
  })

  it('recovers a missing origin/HEAD from the remote and fetches', async () => {
    git(repo, 'symbolic-ref', '--delete', 'refs/remotes/origin/HEAD')
    git(repo, 'checkout', '-b', 'elsewhere')
    git(repo, 'commit', '--allow-empty', '-m', 'local only')
    const ahead = pushToOrigin()
    const result = await ensureWorktree(repo, '13-no-head')
    expect(result.fetchError).toBeUndefined()
    expect(git(result.path, 'rev-parse', 'HEAD')).toBe(ahead)
  })

  it('reports why it did not fetch when the repo has no origin, and the branch it started from', async () => {
    git(repo, 'remote', 'remove', 'origin')
    const result = await ensureWorktree(repo, '13-no-origin')
    expect(result.fetchError).toMatch(/no origin remote.*; it used main$/)
  })

  it("doesn't take the main checkout for the branch's worktree", async () => {
    git(repo, 'checkout', '-b', '12-x')
    await expect(ensureWorktree(repo, '12-x')).rejects.toThrow(/failed: fatal: .*12-x/)
  })

  it('reports why set-head could not recover a missing origin/HEAD', async () => {
    git(repo, 'symbolic-ref', '--delete', 'refs/remotes/origin/HEAD')
    git(repo, 'remote', 'set-url', 'origin', path.join(root, 'missing.git'))
    const result = await ensureWorktree(repo, '13-head-offline')
    expect(result.fetchError).toMatch(
      /^git remote set-head origin --auto failed: .*does not appear to be a git repository/
    )
  })

  it('recreates a worktree whose folder was deleted by hand at the same path', async () => {
    const first = await ensureWorktree(repo, '14-gone')
    await fs.rm(first.path, { recursive: true, force: true })
    const again = await ensureWorktree(repo, '14-gone')
    expect(again).toEqual({ path: worktreePath(repo, '14-gone'), created: true })
    expect(git(again.path, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('14-gone')
  })

  it('says whether it created the worktree', async () => {
    expect((await ensureWorktree(repo, '15-new')).created).toBe(true)
    expect((await ensureWorktree(repo, '15-new')).created).toBe(false)
  })

  it('reuses an existing branch without fetching', async () => {
    git(repo, 'branch', '11-old')
    const before = git(repo, 'rev-parse', 'refs/remotes/origin/main')
    pushToOrigin()
    const result = await ensureWorktree(repo, '11-old')
    expect(result.fetchError).toBeUndefined()
    expect(git(repo, 'rev-parse', 'refs/remotes/origin/main')).toBe(before)
    expect(git(result.path, 'rev-parse', 'HEAD')).toBe(before)
  })
})

describe('removeWorktree', () => {
  it('refuses when there is an untracked file', async () => {
    const { path: wt } = await ensureWorktree(repo, '3-x')
    await fs.writeFile(path.join(wt, 'new.txt'), 'x')
    expect(await removeWorktree(wt, [repo])).toEqual({
      removed: false,
      reason: 'Uncommitted changes'
    })
  })

  it('removes a worktree that has only ignored files, without --force', async () => {
    await fs.writeFile(path.join(repo, '.gitignore'), '.env\nnode_modules/\n')
    git(repo, 'add', '.gitignore')
    git(repo, 'commit', '-m', 'ignore')
    git(repo, 'push', 'origin', 'main')
    git(repo, 'fetch', 'origin')
    const { path: wt } = await ensureWorktree(repo, '180-x')
    await fs.writeFile(path.join(wt, '.env'), 'SECRET=1\n')
    await fs.mkdir(path.join(wt, 'node_modules/pkg'), { recursive: true })
    await fs.writeFile(path.join(wt, 'node_modules/pkg/index.js'), 'x\n')
    expect(await removeWorktree(wt, [repo])).toEqual({ removed: true })
    await expect(fs.stat(wt)).rejects.toThrow()
    const remove = vi.mocked(run).mock.calls.find((c) => c[1].includes('remove'))
    expect(remove?.[1]).not.toContain('--force')
  })

  it('refuses an untracked file even when git hides untracked files', async () => {
    git(repo, 'config', 'status.showUntrackedFiles', 'no')
    const { path: wt } = await ensureWorktree(repo, '3-x')
    await fs.writeFile(path.join(wt, 'new.txt'), 'x')
    expect(await removeWorktree(wt, [repo])).toEqual({
      removed: false,
      reason: 'Uncommitted changes'
    })
    await fs.stat(path.join(wt, 'new.txt'))
  })

  it('refuses when the upstream branch was deleted from the remote', async () => {
    const { path: wt } = await ensureWorktree(repo, '16-x')
    git(wt, 'commit', '--allow-empty', '-m', 'more')
    git(wt, 'push', '-u', 'origin', '16-x')
    git(wt, 'push', 'origin', '--delete', '16-x')
    expect(await removeWorktree(wt, [repo])).toEqual({
      removed: false,
      reason: 'Upstream not found'
    })
  })

  it('removes a worktree merged with a merge commit after its remote branch was pruned', async () => {
    const { path: wt } = await ensureWorktree(repo, '17-x')
    git(wt, 'commit', '--allow-empty', '-m', 'work')
    git(wt, 'push', '-u', 'origin', '17-x')
    git(repo, 'merge', '--no-ff', '-m', 'merge', '17-x')
    git(repo, 'push', 'origin', 'main')
    git(repo, 'push', 'origin', '--delete', '17-x')
    git(repo, 'fetch', '--prune', 'origin')
    expect(await removeWorktree(wt, [repo])).toEqual({ removed: true })
  })

  it('refuses when a tracked file is modified', async () => {
    const { path: wt } = await ensureWorktree(repo, '3-x')
    await fs.writeFile(path.join(wt, 'a.txt'), 'changed')
    expect(await removeWorktree(wt, [repo])).toEqual({
      removed: false,
      reason: 'Uncommitted changes'
    })
  })

  it('refuses when commits are not on the upstream', async () => {
    const { path: wt } = await ensureWorktree(repo, '4-x')
    git(wt, 'push', '-u', 'origin', '4-x')
    git(wt, 'commit', '--allow-empty', '-m', 'more')
    expect(await removeWorktree(wt, [repo])).toEqual({
      removed: false,
      reason: 'Commits not pushed'
    })
  })

  it('refuses when there is no upstream and commits are not on the default branch', async () => {
    const { path: wt } = await ensureWorktree(repo, '5-x')
    git(wt, 'commit', '--allow-empty', '-m', 'more')
    expect(await removeWorktree(wt, [repo])).toEqual({
      removed: false,
      reason: 'Commits not pushed'
    })
  })

  it('starts a new branch with no upstream', async () => {
    const { path: wt } = await ensureWorktree(repo, '7-x')
    expect(() => git(wt, 'rev-parse', '--abbrev-ref', '@{u}')).toThrow()
  })

  it('removes a worktree whose commits were pushed without -u', async () => {
    const { path: wt } = await ensureWorktree(repo, '8-x')
    git(wt, 'commit', '--allow-empty', '-m', 'more')
    git(wt, 'push', 'origin', 'HEAD')
    expect(await removeWorktree(wt, [repo])).toEqual({ removed: true })
  })

  it("keeps git's reason when git worktree remove fails", async () => {
    const { path: wt } = await ensureWorktree(repo, '18-x')
    git(repo, 'worktree', 'lock', wt)
    expect(await removeWorktree(wt, [repo])).toEqual({
      removed: false,
      reason: expect.stringMatching(/^git worktree remove failed: .*locked working tree/)
    })
  })

  it('never passes --force to git', async () => {
    const { path: wt } = await ensureWorktree(repo, '19-x')
    vi.mocked(run).mockClear()
    expect(await removeWorktree(wt, [repo])).toEqual({ removed: true })
    const args = vi.mocked(run).mock.calls.flatMap((c) => c[1])
    expect(args).toContain('remove')
    expect(args).not.toContain('--force')
    expect(args).not.toContain('-f')
  })

  it('runs no git in a worktree whose .git points at another git directory', async () => {
    const { path: wt } = await ensureWorktree(repo, '20-x')
    const other = path.join(root, 'other')
    git(root, 'init', other)
    await fs.writeFile(path.join(wt, '.git'), `gitdir: ${path.join(other, '.git')}\n`)
    vi.mocked(run).mockClear()
    expect(await removeWorktree(wt, [repo])).toEqual({
      removed: false,
      reason: expect.stringMatching(/points outside the project's repo/)
    })
    expect(vi.mocked(run).mock.calls.filter((c) => c[1].includes(wt))).toEqual([])
    await fs.stat(wt)
  })

  it('removes a clean worktree and keeps the branch', async () => {
    const { path: wt } = await ensureWorktree(repo, '6-x')
    expect(await removeWorktree(wt, [repo])).toEqual({ removed: true })
    await expect(fs.stat(wt)).rejects.toThrow()
    expect(git(repo, 'branch', '--list', '6-x')).toContain('6-x')
  })
})

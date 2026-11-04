import fs from 'node:fs/promises'
import path from 'node:path'
import type { RemoveResult } from '../../shared/types'
import { run } from '../env/tools'

/** Runs a local git command in `cwd`; never throws. */
export async function git(cwd: string, ...args: string[]): ReturnType<typeof run> {
  return run('git', ['-C', cwd, ...args], undefined, 120_000)
}

const cause = (stderr: string, code: number): string => {
  const lines = stderr.split('\n').filter((l) => l.trim())
  return lines.find((l) => /^(fatal|error):/.test(l)) ?? lines[0] ?? `exit code ${code}`
}

/** Runs git in `cwd` and returns its output; throws with git's reason on a non-zero exit. */
export async function gitOrThrow(cwd: string, ...args: string[]): Promise<string> {
  const { stdout, stderr, code } = await git(cwd, ...args)
  if (code === -1 && stderr === 'killed by SIGTERM')
    throw new Error(`git ${args.join(' ')} didn't finish within 120 seconds`)
  if (code !== 0) throw new Error(`git ${args.join(' ')} failed: ${cause(stderr, code)}`)
  return stdout
}

/** Says why a repo has no default branch Sandtable can read. */
export const NO_ORIGIN_HEAD =
  "the repo has no origin/HEAD, so Sandtable can't tell its default branch"

/** The repo's `origin/HEAD` as `origin/<name>`, read locally; undefined when it isn't set. */
export async function originHead(dir: string): Promise<string | undefined> {
  const head = await git(dir, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD')
  return head.code === 0 ? head.stdout.trim() || undefined : undefined
}

async function defaultBranch(dir: string): Promise<{ base: string; why?: string }> {
  const head = await originHead(dir)
  if (head) return { base: head }
  const why = await recoverOriginHead(dir)
  const recovered = why ? undefined : await originHead(dir)
  if (recovered) return { base: recovered }
  const base = (await gitOrThrow(dir, 'rev-parse', '--abbrev-ref', 'HEAD')).trim()
  return { base, why: `${why ?? NO_ORIGIN_HEAD}; it used ${base}` }
}

async function gitNetwork(
  dir: string,
  what: string,
  ...args: string[]
): Promise<string | undefined> {
  const { stderr, code } = await run(
    'git',
    ['-C', dir, ...args],
    { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    30_000
  )
  if (code === 0) return undefined
  if (code === -1) return `${what} got no answer within 30 seconds`
  return `${what} failed: ${cause(stderr, code)}`
}

async function recoverOriginHead(dir: string): Promise<string | undefined> {
  if ((await git(dir, 'remote', 'get-url', 'origin')).code !== 0)
    return "the repo has no origin remote, so Sandtable can't tell its default branch"
  const what = 'git remote set-head origin --auto'
  return gitNetwork(dir, what, 'remote', 'set-head', 'origin', '--auto')
}

/** Returns where a branch's worktree lives: `<repoPath>-wt.noindex/<branch>`; Spotlight skips `.noindex`. */
export function worktreePath(repoPath: string, branch: string): string {
  return `${repoPath}-wt.noindex/${branch}`
}

async function existingWorktree(repoPath: string, branch: string): Promise<string | undefined> {
  const out = await gitOrThrow(repoPath, 'worktree', 'list', '--porcelain')
  for (const block of out.split('\n\n').slice(1)) {
    const lines = block.split('\n')
    const dir = lines.find((l) => l.startsWith('worktree '))?.slice('worktree '.length)
    if (dir && lines.includes(`branch refs/heads/${branch}`)) return dir
  }
  return undefined
}

async function fetchDefault(repoPath: string, base: string): Promise<string | undefined> {
  const name = base.slice('origin/'.length)
  const refspec = `+refs/heads/${name}:refs/remotes/origin/${name}`
  return gitNetwork(repoPath, 'git fetch', 'fetch', 'origin', refspec)
}

/** Returns the branch's worktree and whether this call created it. */
export async function ensureWorktree(
  repoPath: string,
  branch: string
): Promise<{ path: string; created: boolean; fetchError?: string }> {
  await gitOrThrow(repoPath, 'worktree', 'prune')
  const found = await existingWorktree(repoPath, branch)
  const target = worktreePath(repoPath, branch)
  if (found)
    return {
      path: found === (await fs.realpath(target).catch(() => '')) ? target : found,
      created: false
    }
  const exists =
    (await git(repoPath, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`)).code === 0
  if (exists) {
    await gitOrThrow(repoPath, 'worktree', 'add', target, branch)
    return { path: target, created: true }
  }
  const { base, why } = await defaultBranch(repoPath)
  const fetchError = why ?? (await fetchDefault(repoPath, base))
  await gitOrThrow(repoPath, 'worktree', 'add', '--no-track', '-b', branch, target, base)
  return { path: target, created: true, fetchError }
}

/** Says why Sandtable won't run git in a worktree whose `.git` points outside its repo. */
export const FOREIGN_GIT_DIR =
  "the worktree's .git points outside the project's repo, so Sandtable didn't run git in it"

const real = (p: string): Promise<string> => fs.realpath(p).catch(() => '')

/** The repo in `repoPaths` whose linked worktree `wtPath` is, read without running git in it. */
export const ownRepo = async (wtPath: string, repoPaths: string[]): Promise<string | undefined> =>
  (await owned(wtPath, repoPaths))?.repo

/** The git folder of `wtPath` when it's a linked worktree of a repo in `repoPaths`, read without running git in it. */
export const ownGitDir = async (wtPath: string, repoPaths: string[]): Promise<string | undefined> =>
  (await owned(wtPath, repoPaths))?.dir

async function owned(
  wtPath: string,
  repoPaths: string[]
): Promise<{ repo: string; dir: string } | undefined> {
  const link = await fs.readFile(path.join(wtPath, '.git'), 'utf8').catch(() => '')
  const gitDir = /^gitdir: (.+)$/m.exec(link)?.[1]
  if (!gitDir) return undefined
  const dir = await real(path.resolve(wtPath, gitDir))
  const back = await fs.readFile(path.join(dir, 'gitdir'), 'utf8').catch(() => '')
  if (!dir || (await real(back.trim())) !== (await real(path.join(wtPath, '.git'))))
    return undefined
  for (const repo of repoPaths) {
    const { stdout } = await git(repo, 'rev-parse', '--path-format=absolute', '--git-common-dir')
    const common = await real(stdout.trim())
    if (common && path.dirname(dir) === path.join(common, 'worktrees')) return { repo, dir }
  }
  return undefined
}

/** Says whether a worktree is clean and every commit is on a remote, and where its repo is. */
export async function checkRemovable(
  wtPath: string,
  repoPaths: string[]
): Promise<{ removable: true; repoPath: string } | (RemoveResult & { removed: false })> {
  const repoPath = await ownRepo(wtPath, repoPaths)
  if (!repoPath) return { removed: false, reason: FOREIGN_GIT_DIR }
  const status = await gitOrThrow(wtPath, 'status', '--porcelain', '--untracked-files=normal')
  if (status.trim()) return { removed: false, reason: 'Uncommitted changes' }

  const hasUpstream = (await git(wtPath, 'rev-parse', '--verify', '--quiet', '@{u}')).code === 0
  const unpushed = hasUpstream
    ? await gitOrThrow(wtPath, 'rev-list', '@{u}..HEAD')
    : await gitOrThrow(wtPath, 'rev-list', 'HEAD', '--not', '--remotes')
  if (unpushed.trim()) {
    const branch = (await git(wtPath, 'symbolic-ref', '--short', 'HEAD')).stdout.trim()
    const tracked =
      !hasUpstream && branch && (await git(wtPath, 'config', `branch.${branch}.merge`)).code === 0
    return { removed: false, reason: tracked ? 'Upstream not found' : 'Commits not pushed' }
  }
  return { removable: true, repoPath }
}

/** Removes a worktree only if it is clean and every commit is on a remote. */
export async function removeWorktree(wtPath: string, repoPaths: string[]): Promise<RemoveResult> {
  const check = await checkRemovable(wtPath, repoPaths)
  if (!('removable' in check)) return check
  const res = await git(check.repoPath, 'worktree', 'remove', await fs.realpath(wtPath))
  return res.code === 0
    ? { removed: true }
    : { removed: false, reason: `git worktree remove failed: ${cause(res.stderr, res.code)}` }
}

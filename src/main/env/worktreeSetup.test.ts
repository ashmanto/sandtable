import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { copyPaths, ignoredProblem, runSetup, stopSetups, suggestSetup } from './worktreeSetup'

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' })

const pidIn = (lines: string[]): number => Number(lines.find((l) => /^\d+$/.test(l)))

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

let root: string
let from: string
let to: string

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sandtable-setup-')))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

const makeRepo = async (): Promise<void> => {
  from = path.join(root, 'repo')
  to = path.join(root, 'wt')
  await fs.mkdir(from)
  git(from, 'init', '-b', 'main')
  git(from, 'config', 'user.name', 'Test')
  git(from, 'config', 'user.email', 'test@example.com')
  await fs.writeFile(path.join(from, '.gitignore'), '.env\nnode_modules/\n')
  await fs.writeFile(path.join(from, 'a.txt'), 'a\n')
  git(from, 'add', '.')
  git(from, 'commit', '-m', 'init')
  git(from, 'worktree', 'add', '-b', 'x', to)
}

describe('ignoredProblem', () => {
  beforeEach(makeRepo)

  it('passes a path git ignores', async () => {
    expect(await ignoredProblem(to, '.env')).toBeNull()
  })

  it('refuses a tracked path', async () => {
    expect(await ignoredProblem(to, 'a.txt')).toBe('git tracks it')
  })

  it("refuses an untracked path git doesn't ignore", async () => {
    expect(await ignoredProblem(to, 'notes.txt')).toBe("git doesn't ignore it")
  })

  it('matches a folder against folder-only patterns', async () => {
    await fs.mkdir(path.join(to, 'node_modules'))
    expect(await ignoredProblem(to, 'node_modules')).toBeNull()
  })

  it('reads whether the path is a folder from another checkout when given one', async () => {
    await fs.mkdir(path.join(from, 'node_modules'))
    expect(await ignoredProblem(to, 'node_modules', from)).toBeNull()
  })

  it('passes an ignored symbolic link to a folder', async () => {
    await fs.writeFile(path.join(from, '.gitignore'), 'cache\n')
    await fs.mkdir(path.join(root, 'real'))
    await fs.symlink(path.join(root, 'real'), path.join(from, 'cache'))
    expect(await ignoredProblem(from, 'cache')).toBeNull()
  })

  it("refuses an ignored folder with a file git doesn't ignore inside it", async () => {
    await fs.writeFile(path.join(from, '.gitignore'), 'data/**\n!data/public.txt\n')
    await fs.mkdir(path.join(from, 'data'))
    await fs.writeFile(path.join(from, 'data/public.txt'), 'p\n')
    await fs.writeFile(path.join(from, 'data/secret.txt'), 's\n')
    expect(await ignoredProblem(from, 'data')).toBe("it has files git doesn't ignore")
  })

  it('refuses a tracked path written in another case', async () => {
    await fs.writeFile(path.join(from, '.env'), 'x\n')
    git(from, 'add', '-f', '.env')
    git(from, 'commit', '-m', 'env')
    expect(await ignoredProblem(from, '.ENV')).toBe('git tracks it')
  })
})

describe('copyPaths', () => {
  beforeEach(makeRepo)

  it('copies an ignored file and an ignored directory recursively', async () => {
    await fs.writeFile(path.join(from, '.env'), 'SECRET=1\n')
    await fs.mkdir(path.join(from, 'node_modules/pkg'), { recursive: true })
    await fs.writeFile(path.join(from, 'node_modules/pkg/index.js'), 'x\n')
    expect(await copyPaths(from, to, ['.env', 'node_modules'])).toEqual([])
    expect(await fs.readFile(path.join(to, '.env'), 'utf8')).toBe('SECRET=1\n')
    expect(await fs.readFile(path.join(to, 'node_modules/pkg/index.js'), 'utf8')).toBe('x\n')
  })

  it("skips an ignored folder with a file git doesn't ignore inside it", async () => {
    await fs.writeFile(path.join(from, '.gitignore'), 'data/**\n!data/public.txt\n')
    git(from, 'commit', '-am', 'ignore')
    git(to, 'merge', 'main')
    await fs.mkdir(path.join(from, 'data'))
    await fs.writeFile(path.join(from, 'data/public.txt'), 'p\n')
    expect(await copyPaths(from, to, ['data'])).toEqual([
      "Skipped data: it has files git doesn't ignore"
    ])
    await expect(fs.stat(path.join(to, 'data'))).rejects.toThrow()
  })

  it('stops before the next path once the signal aborts', async () => {
    await fs.writeFile(path.join(from, '.env'), 'SECRET=1\n')
    await fs.mkdir(path.join(from, 'node_modules'))
    const ac = new AbortController()
    ac.abort()
    expect(await copyPaths(from, to, ['.env', 'node_modules'], ac.signal)).toEqual([])
    await expect(fs.stat(path.join(to, '.env'))).rejects.toThrow()
  })

  it('creates parent folders for a nested path', async () => {
    await fs.writeFile(path.join(from, '.gitignore'), 'conf/local.json\n')
    git(from, 'commit', '-am', 'ignore')
    git(to, 'merge', 'main')
    await fs.mkdir(path.join(from, 'conf'))
    await fs.writeFile(path.join(from, 'conf/local.json'), '{}')
    expect(await copyPaths(from, to, ['conf/local.json'])).toEqual([])
    expect(await fs.readFile(path.join(to, 'conf/local.json'), 'utf8')).toBe('{}')
  })

  it('skips a tracked path, an unignored one, a missing source, and one outside the repo', async () => {
    await fs.writeFile(path.join(from, 'a.txt'), 'changed\n')
    await fs.writeFile(path.join(from, 'notes.txt'), 'n\n')
    await fs.writeFile(path.join(root, 'outside'), 'o\n')
    expect(await copyPaths(from, to, ['a.txt', 'notes.txt', '.env', '../outside'])).toEqual([
      'Skipped a.txt: git tracks it in this branch',
      "Skipped notes.txt: git doesn't ignore it in this branch",
      'Skipped .env: not in the main checkout',
      'Skipped ../outside: use a path inside the repo'
    ])
    expect(await fs.readFile(path.join(to, 'a.txt'), 'utf8')).toBe('a\n')
    await expect(fs.stat(path.join(to, 'notes.txt'))).rejects.toThrow()
  })
})

describe('runSetup', () => {
  const shell = process.env.SHELL
  beforeAll(() => {
    process.env.SHELL = '/bin/sh'
  })
  afterAll(() => {
    process.env.SHELL = shell
  })

  it("returns the command's output lines from stdout and stderr, and its exit code", async () => {
    const seen: string[] = []
    const res = await runSetup(root, 'echo one; printf "two\\r\\n"; echo three >&2', {
      onOutput: (line) => seen.push(line)
    })
    expect(res.code).toBe(0)
    expect(res.lines.sort()).toEqual(['one', 'three', 'two'])
    expect(seen.sort()).toEqual(['one', 'three', 'two'])
  })

  it('keeps a character split across chunks and ends a line at a lone carriage return', async () => {
    const res = await runSetup(
      root,
      "printf '\\342\\202'; sleep 0.1; printf '\\254\\n10%%\\r20%%\\n'",
      {}
    )
    expect(res.lines).toEqual(['\u20ac', '10%', '20%'])
  })

  it('runs the command in an interactive login shell', async () => {
    const res = await runSetup(root, 'echo $-', {})
    expect(res.lines[0]).toMatch(/i/)
  })

  it("returns a failing command's code", async () => {
    expect((await runSetup(root, 'echo bad; exit 3', {})).code).toBe(3)
  })

  it("resolves instead of throwing when the command can't be spawned", async () => {
    const res = await runSetup(root, 'echo a\u0000b', {})
    expect(res.code).toBeNull()
    expect(res.why).toMatch(/null bytes/)
  })

  it('keeps only the last 200 lines', async () => {
    const res = await runSetup(root, 'i=0; while [ $i -lt 250 ]; do echo $i; i=$((i+1)); done', {})
    expect(res.lines).toHaveLength(200)
    expect(res.lines[0]).toBe('50')
    expect(res.lines.at(-1)).toBe('249')
  })

  it("kills the command's children when it times out", async () => {
    const res = await runSetup(root, 'sleep 30 & echo $!; wait', { timeoutMs: 600 })
    expect(res.code).toBeNull()
    expect(res.why).toBe('timed out after 0.01 minutes')
    const pid = pidIn(res.lines)
    expect(Number.isInteger(pid) && pid > 0).toBe(true)
    await new Promise((r) => setTimeout(r, 100))
    expect(alive(pid)).toBe(false)
  })

  it('returns the exit code of a command that leaves a child holding its output', async () => {
    const res = await runSetup(root, '(sleep 3 &); echo ok', { timeoutMs: 1500 })
    expect(res).toEqual({ code: 0, lines: ['ok'] })
  })

  it('stops on timeout even when a child left the process group', async () => {
    const res = await runSetup(
      root,
      "perl -e 'use POSIX; POSIX::setsid(); sleep 10' & echo $!; wait",
      { timeoutMs: 500 }
    )
    const pid = pidIn(res.lines)
    expect(alive(pid)).toBe(true)
    process.kill(pid, 'SIGKILL')
    expect(res.why).toBe(`timed out after ${500 / 60_000} minutes`)
  })

  it('stops the command when the signal aborts', async () => {
    const ac = new AbortController()
    const res = await runSetup(root, 'echo started; sleep 30', {
      signal: ac.signal,
      onOutput: () => ac.abort()
    })
    expect(res).toMatchObject({ code: null, why: 'cancelled', lines: ['started'] })
  })

  it('stops every running setup and its children', async () => {
    const res = await runSetup(root, 'sleep 30 & echo $!; wait', { onOutput: () => stopSetups() })
    expect(res).toMatchObject({ code: null, why: 'Sandtable quit' })
    await new Promise((r) => setTimeout(r, 100))
    expect(alive(pidIn(res.lines))).toBe(false)
  })
})

describe('suggestSetup', () => {
  beforeEach(makeRepo)

  const write = async (p: string, text = 'x\n'): Promise<void> => {
    await fs.mkdir(path.dirname(path.join(from, p)), { recursive: true })
    await fs.writeFile(path.join(from, p), text)
  }

  it('suggests ignored settings files and the lockfile command', async () => {
    await fs.writeFile(path.join(from, '.gitignore'), '.env*\n.claude/settings.local.json\n')
    await write('.env')
    await write('.env.local')
    await write('.claude/settings.local.json')
    await write('package-lock.json', '{}\n')
    expect(await suggestSetup(from)).toEqual({
      copy: ['.env', '.env.local', '.claude/settings.local.json'],
      command: 'npm install'
    })
  })

  it('leaves out settings files git tracks or does not ignore', async () => {
    git(from, 'config', 'core.excludesFile', '/dev/null')
    await write('.env.example')
    git(from, 'add', '.env.example')
    await write('.claude/settings.local.json')
    expect(await suggestSetup(from)).toBeNull()
  })

  it('joins commands from different tools and drops conflicting Node lockfiles', async () => {
    await write('uv.lock')
    await write('Gemfile.lock')
    expect(await suggestSetup(from)).toEqual({ copy: [], command: 'uv sync && bundle install' })
    await write('yarn.lock')
    expect((await suggestSetup(from))?.command).toBe('yarn install && uv sync && bundle install')
    await write('pnpm-lock.yaml')
    expect((await suggestSetup(from))?.command).toBe('uv sync && bundle install')
  })

  it("doesn't run the folder's core.fsmonitor program", async () => {
    const marker = path.join(root, 'ran')
    const hook = path.join(root, 'hook.sh')
    await fs.writeFile(hook, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 })
    git(from, 'config', 'core.fsmonitor', hook)
    await write('.env')
    expect(await suggestSetup(from)).toEqual({ copy: ['.env'] })
    await expect(fs.access(marker)).rejects.toThrow()
  })

  it('suggests nothing for a folder with nothing to copy or install', async () => {
    expect(await suggestSetup(from)).toBeNull()
    expect(await suggestSetup(path.join(root, 'missing'))).toBeNull()
  })
})

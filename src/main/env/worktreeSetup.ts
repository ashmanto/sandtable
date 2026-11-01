import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { SetupSuggestion } from '../../shared/types'
import { copyPathProblem, LOCKFILES } from '../../shared/worktreeSetup'
import { git } from '../git/worktree'

const KEEP_LINES = 200

const UNIGNORED_FILES = "it has files git doesn't ignore"

// A repo's own .git/config can name a program for git to run; a folder you just picked isn't trusted yet.
const NO_FSMONITOR = ['-c', 'core.fsmonitor=false']

const running = new Set<() => void>()

const killGroup = (child: ChildProcess): void => {
  try {
    if (child.pid) process.kill(-child.pid, 'SIGKILL')
  } catch {
    // ESRCH when the group is gone; macOS says EPERM when only zombies are left in it.
  }
}

/** Why git won't let `p` be copied into the checkout at `dir`, or null when git ignores it; `from` says whether `p` is a folder. */
export async function ignoredProblem(dir: string, p: string, from = dir): Promise<string | null> {
  const folder = (await fs.lstat(path.join(from, p)).catch(() => undefined))?.isDirectory()
  if (folder) p = `${p}/`
  const tracked = await git(dir, ...NO_FSMONITOR, 'ls-files', '--', `:(icase)${p}`)
  if (tracked.code !== 0) return tracked.stderr.trim() || `git ls-files exit code ${tracked.code}`
  if (tracked.stdout.trim()) return 'git tracks it'
  const ignored = await git(dir, ...NO_FSMONITOR, 'check-ignore', '-q', '--', p)
  if (ignored.code === 1) return "git doesn't ignore it"
  if (ignored.code !== 0)
    return ignored.stderr.trim() || `git check-ignore exit code ${ignored.code}`
  if (!folder) return null
  const unignored = await git(
    from,
    ...NO_FSMONITOR,
    'ls-files',
    '--others',
    '--exclude-standard',
    '--',
    p
  )
  if (unignored.code !== 0)
    return unignored.stderr.trim() || `git ls-files exit code ${unignored.code}`
  return unignored.stdout.trim() ? UNIGNORED_FILES : null
}

/** The worktree setup the checkout at `dir` seems to need, or null when it has nothing to copy or install. */
export async function suggestSetup(dir: string): Promise<SetupSuggestion | null> {
  const names = await fs.readdir(dir).catch(() => [] as string[])
  const settings = [
    ...names
      .filter((n) => n === '.env' || n.startsWith('.env.'))
      .sort()
      .slice(0, 10),
    '.claude/settings.local.json'
  ]
  const copy: string[] = []
  for (const p of settings)
    if (
      (await fs.lstat(path.join(dir, p)).catch(() => undefined))?.isFile() &&
      !(await ignoredProblem(dir, p))
    )
      copy.push(p)
  const found = LOCKFILES.filter((l) => names.includes(l.file))
  const node = found.filter((l) => l.builds === 'node_modules')
  const commands = found
    .filter((l) => node.length === 1 || l.builds !== 'node_modules')
    .map((l) => l.command)
  if (!copy.length && !commands.length) return null
  return { copy, ...(commands.length && { command: commands.join(' && ') }) }
}

/** Copies each ignored path from the main checkout into a worktree; returns a note per path it skipped. */
export async function copyPaths(
  from: string,
  to: string,
  paths: string[],
  signal?: AbortSignal
): Promise<string[]> {
  const notes: string[] = []
  for (const p of paths) {
    if (signal?.aborted) break
    const problem = copyPathProblem(p)
    if (problem) {
      notes.push(`Skipped ${p}: ${problem}`)
      continue
    }
    const source = path.join(from, p)
    const stat = await fs.stat(source).catch(() => undefined)
    if (!stat) {
      notes.push(`Skipped ${p}: not in the main checkout`)
      continue
    }
    const why = await ignoredProblem(to, p, from)
    if (why) {
      notes.push(`Skipped ${p}: ${why}${why === UNIGNORED_FILES ? '' : ' in this branch'}`)
      continue
    }
    const target = path.join(to, p)
    try {
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.cp(source, target, { recursive: true, verbatimSymlinks: true })
    } catch (err) {
      notes.push(`Skipped ${p}: ${(err as Error).message}`)
    }
  }
  return notes
}

/** Runs a worktree's setup command in the login shell; never throws, and keeps the last 200 lines. */
export function runSetup(
  cwd: string,
  command: string,
  {
    signal,
    onOutput,
    timeoutMs = 10 * 60_000
  }: { signal?: AbortSignal; onOutput?: (line: string) => void; timeoutMs?: number }
): Promise<{ code: number | null; why?: string; lines: string[] }> {
  return new Promise((resolve) => {
    let child: ChildProcess
    const shell = process.env.SHELL || '/bin/zsh'
    // -i turns on bash's job control, which moves `cmd &` out of the group killGroup stops.
    const script = path.basename(shell) === 'fish' ? command : `set +m; ${command}`
    try {
      child = spawn(shell, ['-ilc', script], {
        cwd,
        env: process.env,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (err) {
      return resolve({ code: null, why: (err as Error).message, lines: [] })
    }
    let lines: string[] = []
    let why: string | undefined
    const stop = (reason: string): void => {
      why ??= reason
      killGroup(child)
    }
    const quit = (): void => stop('Sandtable quit')
    const onAbort = (): void => stop('cancelled')
    const timer = setTimeout(() => stop(`timed out after ${timeoutMs / 60_000} minutes`), timeoutMs)
    running.add(quit)
    if (signal?.aborted) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })
    const settle = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      running.delete(quit)
    }
    for (const input of [child.stdout, child.stderr])
      createInterface({ input: input! }).on('line', (line) => {
        lines.push(line)
        if (lines.length > KEEP_LINES) lines = lines.slice(-KEEP_LINES)
        onOutput?.(line)
      })
    child.on('exit', () => {
      settle()
      if (why) killGroup(child)
      // A child outside the group, or one that outlives the shell, can hold the pipes open.
      setTimeout(() => {
        child.stdout?.destroy()
        child.stderr?.destroy()
      }, 200).unref()
    })
    child.on('error', (err) => {
      settle()
      resolve({ code: null, why: why ?? err.message, lines })
    })
    child.on('close', (code) =>
      resolve({ code: why ? null : code, ...(why ? { why } : {}), lines })
    )
  })
}

/** Kills every setup command still running, with its children; for the app's quit path. */
export function stopSetups(): void {
  for (const stop of running) stop()
}

import { execFile, type ChildProcess } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { parseJson } from '../../shared/json'
import { setupSteps } from '../../shared/setup'
import type { Account, ToolCheck } from '../../shared/types'

export type RunFn = (
  file: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
  timeoutMs?: number,
  cwd?: string,
  live?: { signal?: AbortSignal; onStdout?: (chunk: string) => void; input?: string }
) => Promise<{ stdout: string; stderr: string; code: number }>

const TOOLS = ['tmux', 'claude', 'gh', 'git', 'linear', 'acli'] as const

const children = new Set<ChildProcess>()

const runWith =
  (tracked: boolean): RunFn =>
  (file, args, env, timeoutMs, cwd, live) =>
    new Promise((resolve) => {
      const child = execFile(
        file,
        args,
        {
          env,
          cwd,
          encoding: 'utf8',
          timeout: timeoutMs,
          killSignal: tracked ? 'SIGKILL' : 'SIGTERM',
          signal: live?.signal,
          maxBuffer: 64 * 1024 * 1024
        },
        (err, stdout, stderr) => {
          children.delete(child)
          if (!err) return resolve({ stdout, stderr, code: 0 })
          if (typeof err.code === 'number') return resolve({ stdout, stderr, code: err.code })
          const reason = err.signal ? `killed by ${err.signal}` : err.message.split('\n')[0]
          resolve({ stdout, stderr: reason, code: -1 })
        }
      )
      if (tracked) children.add(child)
      if (live?.onStdout) child.stdout?.on('data', live.onStdout)
      child.stdin?.on('error', () => undefined)
      child.stdin?.end(live?.input)
    })

/** Runs a program with an argument array; never throws, and reports code -1, with a one-line reason as stderr, if it cannot be spawned, is killed, or overflows the buffer. */
export const run: RunFn = runWith(false)

/** Like `run`, but a timeout or `stopChildren` sends SIGKILL; only for programs safe to kill mid-write, such as `claude -p`. */
export const runStoppable: RunFn = runWith(true)

/** Kills every program `runStoppable` started that hasn't exited yet. */
export function stopChildren(): void {
  for (const child of children) child.kill('SIGKILL')
}

/** Reads the PATH a login shell would have; empty if the shell fails or times out. */
export async function loginShellPath(runFn: RunFn = runStoppable): Promise<string> {
  const { stdout, code } = await runFn(
    process.env.SHELL || '/bin/zsh',
    ['-ilc', 'printf %s "$PATH"'],
    undefined,
    5000
  )
  return code === 0 ? (stdout.replace(/\n$/, '').split('\n').pop() ?? '') : ''
}

/** Resolves tmux, claude, gh, git, linear, and acli against the given PATH. */
export async function findTools(
  path: string,
  runFn: RunFn = run
): Promise<Pick<ToolCheck, 'paths' | 'missing'>> {
  const env = { ...process.env, PATH: path }
  const paths: Record<string, string> = {}
  const missing: ToolCheck['missing'] = []
  for (const tool of TOOLS) {
    const { stdout, code } = await runFn('/bin/sh', ['-c', 'command -v "$1"', 'sh', tool], env)
    if (code === 0 && stdout.trim()) paths[tool] = stdout.trim()
    else missing.push(tool)
  }
  return { paths, missing }
}

type GhHost = { active?: boolean; state?: string; error?: string; scopes?: unknown }

const ghCheck = (answer: unknown): ToolCheck['gh'] => {
  const hosts = (answer as { hosts?: Record<string, unknown> } | undefined)?.hosts
  if (!hosts) return null
  const list = hosts['github.com'] ?? []
  if (!Array.isArray(list)) return null
  const host = (list as GhHost[]).find((h) => h.active)
  if (!host) return { loggedIn: false, scopes: null }
  if (host.state === 'error')
    return /401|Bad credentials/.test(host.error ?? '') ? { loggedIn: false, scopes: null } : null
  if (host.scopes !== undefined && typeof host.scopes !== 'string') return null
  const scopes = host.scopes ? host.scopes.split(',').map((s) => s.trim()) : null
  return { loggedIn: true, scopes }
}

/** The extra env for an account's folder: CLAUDE_CONFIG_DIR, or none for Default's folder. */
export const accountEnv = (
  dir: string | undefined,
  defaultDir: string
): Record<string, string> | undefined =>
  dir && dir !== defaultDir ? { CLAUDE_CONFIG_DIR: dir } : undefined

/** Asks `claude auth status`, run with env, whether Claude Code is signed in; null when it can't tell. */
export async function claudeSignedIn(
  bin: string,
  env: NodeJS.ProcessEnv,
  runFn: RunFn = run
): Promise<boolean | null> {
  const answer = parseJson((await runFn(bin, ['auth', 'status'], env, 10000)).stdout)
  const loggedIn = (answer as { loggedIn?: unknown } | undefined)?.loggedIn
  return typeof loggedIn === 'boolean' ? loggedIn : null
}

/** The `.claude*` folders in home, as absolute paths, leaving out those in exclude. */
export async function claudeFolders(home: string, exclude: string[]): Promise<string[]> {
  const entries = await readdir(home, { withFileTypes: true }).catch(() => [])
  return entries
    .filter((e) => e.isDirectory() && e.name.startsWith('.claude'))
    .map((e) => join(home, e.name))
    .filter((dir) => !exclude.includes(dir))
    .sort()
}

/** Resolves the tools, then asks whether claude (Default and each account), gh, linear (default and each workspace), and acli's Jira login, and on which site, are signed in, and gh's scopes. */
export async function checkTools(
  path: string,
  runFn: RunFn = run,
  accounts: Account[] = [],
  workspaces: string[] = [],
  jiraSites: string[] = []
): Promise<ToolCheck> {
  const found = await findTools(path, runFn)
  const env = { ...process.env, PATH: path }
  const claude = found.paths.claude
  const signedIn = async (extra: NodeJS.ProcessEnv = {}): Promise<boolean | null> =>
    claude ? claudeSignedIn(claude, { ...env, ...extra }, runFn) : null
  const gh = found.paths.gh
  const linear = found.paths.linear
  const linearIn = async (args: string[] = []): Promise<boolean | null> =>
    linear
      ? runFn(linear, ['auth', 'token', ...args], env, 10000).then((r) =>
          r.code === -1 ? null : r.code === 0 && r.stdout.trim() !== ''
        )
      : null
  const acli = found.paths.acli
  const [claudeIn, ghAnswer, accountsIn, linearDefault, workspacesIn, jiraStatus] =
    await Promise.all([
      signedIn(),
      gh &&
        runFn(gh, ['auth', 'status', '--json', 'hosts'], env, 10000).then((r) =>
          parseJson(r.stdout)
        ),
      Promise.all(accounts.map((a) => signedIn({ CLAUDE_CONFIG_DIR: a.dir }))),
      linearIn(),
      Promise.all(workspaces.map((w) => linearIn(['--workspace', w]))),
      acli ? runFn(acli, ['jira', 'auth', 'status'], env, 10000) : null
    ])
  const jira = jiraStatus && (jiraStatus.code === -1 ? null : jiraStatus.code === 0)
  const jiraSite = jiraStatus && /^\s*Site:\s*(\S+)/m.exec(jiraStatus.stdout)?.[1]
  const check = {
    ...found,
    claudeSignedIn: claudeIn,
    accounts: accounts.map((a, i) => ({ ...a, signedIn: accountsIn[i] })),
    gh: ghCheck(ghAnswer),
    linear: linearDefault,
    linearWorkspaces: workspaces.map((slug, i) => ({ slug, signedIn: workspacesIn[i] })),
    jira,
    jiraSites: jiraSites.map((site) => ({
      site,
      signedIn: jira === null ? null : jira === true && jiraSite === site
    }))
  }
  return { ...check, ok: !setupSteps(check).some((s) => s.blocked) }
}

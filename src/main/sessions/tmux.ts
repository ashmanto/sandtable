import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from '../env/tools'

let socket: string | undefined

/** Selects a private tmux server socket; tests set it, the app leaves it unset. */
export function setTmuxSocket(name: string | undefined): void {
  socket = name
}

/** The leading tmux arguments for the configured socket. */
export function tmuxBaseArgs(): string[] {
  return socket ? ['-L', socket] : []
}

const tmux = (args: string[]): ReturnType<typeof run> =>
  run('tmux', [...tmuxBaseArgs(), ...args], undefined, 10_000)

/** The tmux session name for a ticket. */
export function tmuxName(projectId: string, ticketKey: string): string {
  return `st-${projectId}-${ticketKey}`.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/-$/, '')
}

const failure = (
  name: string,
  verb: string,
  { code, stderr }: { code: number; stderr: string }
): Error => new Error(`tmux ${verb} failed for ${name}: ${stderr.trim() || `exit ${code}`}`)

/** Starts a detached tmux session running the command in cwd, tagged with the data folder that owns it. */
export async function startTmux(
  name: string,
  cwd: string,
  command: string[],
  env: Record<string, string> = {},
  owner?: string
): Promise<void> {
  const vars = Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`])
  const args = ['new-session', '-d', '-s', name, '-c', cwd, ...vars, '--', ...command]
  // tmux reads an argument ending in `;` as a command separator unless it ends in `\;`.
  const created = await tmux(args.map((a) => a.replace(/;$/, '\\;')))
  if (created.code === -1) await killTmux(name)
  if (created.code !== 0) throw failure(name, args[0], created)
  await tmux(['set-option', '-t', `=${name}:`, 'status', 'off'])
  await tmux(['set-option', '-t', `=${name}:`, 'mouse', 'on'])
  if (owner !== undefined) await tmux(['set-option', '-t', `=${name}:`, '@sandtable', owner])
}

const step = async (name: string, args: string[]): Promise<void> => {
  const res = await tmux(args)
  if (res.code !== 0) throw failure(name, args[0], res)
}

/** Pastes `text` into the session as one bracketed paste; throws when a step fails. */
export async function pasteTmux(name: string, text: string): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'st-paste-'))
  const file = join(dir, 'text')
  const buffer = `st-${randomUUID()}`
  try {
    await writeFile(file, text)
    await step(name, ['load-buffer', '-b', buffer, file])
    await step(name, ['paste-buffer', '-p', '-d', '-b', buffer, '-t', `=${name}:`]).catch(
      async (err) => {
        await tmux(['delete-buffer', '-b', buffer])
        throw err
      }
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Presses Enter in the session; throws when tmux can't. */
export const enterTmux = (name: string): Promise<void> =>
  step(name, ['send-keys', '-t', `=${name}:`, 'Enter'])

/** Pastes `text` into the session through `tmux`, runs `pasted`, then presses Enter; throws when either step fails. */
export async function typeIntoTmux(
  tmux: {
    pasteTmux(name: string, text: string): Promise<void>
    enterTmux(name: string): Promise<void>
  },
  name: string,
  text: string,
  pasted?: () => unknown
): Promise<void> {
  await tmux.pasteTmux(name, text)
  await pasted?.()
  await tmux.enterTmux(name).catch(() => {
    throw new Error("Pasted, but Enter didn't reach the session. Press Enter in the terminal.")
  })
}

/** Presses Escape in the session, which interrupts Claude's turn; throws when tmux can't. */
export const escapeTmux = (name: string): Promise<void> =>
  step(name, ['send-keys', '-t', `=${name}:`, 'Escape'])

/** Sends each key to the session in its own tmux call, 100 ms apart, typing a `{ text }` as it is; throws when one fails. */
export async function keysTmux(name: string, keys: (string | { text: string })[]): Promise<void> {
  for (const key of keys) {
    const sent = typeof key === 'string' ? [key] : ['-l', '--', key.text.replace(/;$/, '\\;')]
    await step(name, ['send-keys', '-t', `=${name}:`, ...sent])
    await new Promise((done) => setTimeout(done, 100))
  }
}

/** The text on the session's screen, with its color codes when `colors`; throws when tmux can't read it. */
export async function captureTmux(name: string, colors = false): Promise<string> {
  const res = await tmux(['capture-pane', '-p', ...(colors ? ['-e'] : []), '-t', `=${name}:`])
  if (res.code !== 0) throw failure(name, 'capture-pane', res)
  return res.stdout
}

/** True when a session with exactly this name exists; throws when tmux doesn't answer. */
export async function hasTmux(name: string): Promise<boolean> {
  const { code, stderr } = await tmux(['has-session', '-t', `=${name}`])
  if (code === 0 || code === 1) return code === 0
  throw new Error(`tmux didn't say whether ${name} is running: ${stderr.trim() || `exit ${code}`}`)
}

/** Ends the session with exactly this name; does nothing when it's already gone. */
export async function killTmux(name: string): Promise<void> {
  await tmux(['kill-session', '-t', `=${name}`])
}

/** All running sessions with the data folder each was tagged with, or ''; empty when no server is running. */
export async function listTmux(): Promise<{ name: string; owner: string }[]> {
  const { stdout, code } = await tmux(['list-sessions', '-F', '#{session_name}\t#{@sandtable}'])
  if (code !== 0) return []
  return stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, owner = ''] = line.split('\t')
      return { name, owner }
    })
}

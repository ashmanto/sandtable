import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Ticket } from '../../shared/types'
import { run } from '../env/tools'
import { claudeArgs, openingPrompt, sessionRules } from './claudeLaunch'
import {
  hasTmux,
  killTmux,
  listTmux,
  captureTmux,
  enterTmux,
  escapeTmux,
  keysTmux,
  pasteTmux,
  setTmuxSocket,
  startTmux,
  tmuxBaseArgs,
  tmuxName
} from './tmux'

vi.mock('../env/tools', async (load) => {
  const tools = await load<typeof import('../env/tools')>()
  return { ...tools, run: vi.fn(tools.run) }
})

const SOCKET = `sandtable-test-${process.pid}`
let n = 0
const unique = (): string => `st-t${process.pid}-${n++}`
const killServer = (): void => {
  try {
    execFileSync('tmux', ['-L', SOCKET, 'kill-server'], { stdio: 'ignore' })
  } catch {
    // no server running
  }
}

const temps: string[] = []
const outFile = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'st-tmux-'))
  temps.push(dir)
  return join(dir, 'out')
}

beforeAll(() => setTmuxSocket(SOCKET))
afterAll(() => {
  killServer()
  setTmuxSocket(undefined)
  for (const dir of temps) rmSync(dir, { recursive: true, force: true })
})

describe('tmuxName', () => {
  it('has no dots or colons', () => {
    expect(tmuxName('p1', 'octo/shop#147')).toBe('st-p1-octo-shop-147')
    expect(tmuxName('p.1', 'a.b/c:d#1')).toBe('st-p-1-a-b-c-d-1')
  })
})

describe('tmuxBaseArgs', () => {
  it('follows the socket setting', () => {
    expect(tmuxBaseArgs()).toEqual(['-L', SOCKET])
    setTmuxSocket(undefined)
    try {
      expect(tmuxBaseArgs()).toEqual([])
    } finally {
      setTmuxSocket(SOCKET)
    }
  })
})

describe('tmux sessions', () => {
  it('gives every tmux call 10 seconds to answer', async () => {
    await listTmux()
    expect(run).toHaveBeenCalledWith('tmux', expect.any(Array), undefined, 10_000)
  })

  it("throws from hasTmux when tmux doesn't answer, instead of reporting the session gone", async () => {
    vi.stubEnv('PATH', '')
    try {
      await expect(hasTmux(unique())).rejects.toThrow()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('ends the session when new-session does not answer, then throws', async () => {
    const name = unique()
    vi.mocked(run).mockResolvedValueOnce({ stdout: '', stderr: '', code: -1 })
    await expect(startTmux(name, tmpdir(), ['sleep', '30'])).rejects.toThrow()
    expect(run).toHaveBeenLastCalledWith(
      'tmux',
      [...tmuxBaseArgs(), 'kill-session', '-t', `=${name}`],
      undefined,
      10_000
    )
  })

  it('leaves another session alive when new-session fails because its name is taken', async () => {
    const name = unique()
    await startTmux(name, tmpdir(), ['sleep', '30'])
    await expect(startTmux(name, tmpdir(), ['sleep', '30'])).rejects.toThrow(
      `tmux new-session failed for ${name}: duplicate session: ${name}`
    )
    expect(await hasTmux(name)).toBe(true)
  })

  it('starts a session that hasTmux and listTmux see', async () => {
    const name = unique()
    await startTmux(name, tmpdir(), ['sleep', '30'])
    expect(await hasTmux(name)).toBe(true)
    expect(await listTmux()).toContainEqual({ name, owner: '' })
  })

  it('lists the data folder a session was tagged with', async () => {
    const name = unique()
    await startTmux(name, tmpdir(), ['sleep', '30'], {}, '/data/sandtable dev')
    expect(await listTmux()).toContainEqual({ name, owner: '/data/sandtable dev' })
  })

  it('turns the status bar off and the mouse on', async () => {
    const name = unique()
    await startTmux(name, tmpdir(), ['sleep', '30'])
    const show = (opt: string): string =>
      execFileSync('tmux', [...tmuxBaseArgs(), 'show-options', '-v', '-t', `=${name}:`, opt], {
        encoding: 'utf8'
      }).trim()
    expect(show('status')).toBe('off')
    expect(show('mouse')).toBe('on')
  })

  it('matches names exactly, not by prefix', async () => {
    const name = unique()
    await startTmux(`${name}2`, tmpdir(), ['sleep', '30'])
    expect(await hasTmux(name)).toBe(false)
  })

  it('passes the last argument through unchanged', async () => {
    const out = outFile()
    const body = '"quotes" \'single\' `tick` $(whoami)\nsecond line'
    await startTmux(unique(), tmpdir(), ['sh', '-c', 'printf %s "$1" > "$2"', 'sh', body, out])
    await vi.waitFor(() => expect(readFileSync(out, 'utf8')).toBe(body), { timeout: 5000 })
  })

  it('passes arguments ending in a semicolon through unchanged', async () => {
    const out = outFile()
    const args = ['name;', 'a\\;', ';', 'body;']
    await startTmux(unique(), tmpdir(), ['sh', '-c', 'printf "%s|" "$@" > "$0"', out, ...args])
    await vi.waitFor(() => expect(readFileSync(out, 'utf8')).toBe(args.join('|') + '|'), {
      timeout: 5000
    })
  })

  it('sets each env entry in the session, a value ending in a semicolon included', async () => {
    const out = outFile()
    await startTmux(
      unique(),
      tmpdir(),
      ['sh', '-c', 'printf "%s|%s" "$CLAUDE_CONFIG_DIR" "$ST_OTHER" > "$0"', out],
      { CLAUDE_CONFIG_DIR: '/Users/a b/.claude-work', ST_OTHER: 'x;' }
    )
    await vi.waitFor(() => expect(readFileSync(out, 'utf8')).toBe('/Users/a b/.claude-work|x;'), {
      timeout: 5000
    })
  })

  it('starts with a full claude-shaped command carrying a truncated 70,000-byte prompt, a full note, full instructions, and three extra folders', async () => {
    const out = outFile()
    const prompt = openingPrompt(
      {
        ...({} as Ticket),
        key: 'o/r#1',
        repo: 'o/r',
        number: 1,
        title: '😀'.repeat(256),
        body: 'x'.repeat(70000),
        url: 'https://github.com/o/r/issues/1'
      },
      'GitHub',
      'é'.repeat(4000)
    )
    const args = claudeArgs({
      sessionId: 'sid',
      settingsFile: `/Users/someone/Library/Application Support/sandtable/settings/${'0'.repeat(36)}.json`,
      name: 'n',
      addDirs: [1, 2, 3].map(
        (i) => `/Users/someone/projects/repo-${i}-wt.noindex/1-a-long-branch-name`
      ),
      rules: sessionRules({
        repo: 'o/r',
        ticket: '#1',
        worktree: true,
        board: {
          source: { url: 'u', ownerType: 'user', owner: 'o', number: 1 },
          statusMap: { todo: 'Todo', inProgress: 'In Progress', done: 'Done' }
        },
        yours: [
          { text: 'i'.repeat(400) },
          ...Array.from({ length: 35 }, (_, i) => ({ label: `label-${i}`, text: 'j'.repeat(40) }))
        ]
      }),
      prompt
    })
    await startTmux(unique(), tmpdir(), ['sh', '-c', 'printf %s "$# $(($#))" > "$0"', out, ...args])
    await vi.waitFor(
      () => expect(readFileSync(out, 'utf8')).toBe(`${args.length} ${args.length}`),
      {
        timeout: 5000
      }
    )
  })

  it('is gone after the command exits', async () => {
    const name = unique()
    await startTmux(name, tmpdir(), ['sleep', '0.3'])
    await vi.waitFor(async () => expect(await hasTmux(name)).toBe(false), { timeout: 5000 })
  })

  it('kills a session by exact name and does nothing the second time', async () => {
    const name = unique()
    await startTmux(name, tmpdir(), ['sleep', '30'])
    await startTmux(`${name}2`, tmpdir(), ['sleep', '30'])
    await killTmux(name)
    expect(await hasTmux(name)).toBe(false)
    expect(await hasTmux(`${name}2`)).toBe(true)
    await expect(killTmux(name)).resolves.toBeUndefined()
  })

  it('pastes multi-line text as one bracketed paste, then presses Enter', async () => {
    const out = outFile()
    const name = unique()
    await startTmux(name, tmpdir(), [
      'sh',
      '-c',
      'printf "\\033[?2004h"; stty raw -echo; : > "$0.ready"; exec cat > "$0"',
      out
    ])
    await vi.waitFor(() => readFileSync(`${out}.ready`), { timeout: 5000 })
    await pasteTmux(name, 'first line\nsecond line')
    await enterTmux(name)
    await vi.waitFor(
      () => expect(readFileSync(out, 'utf8')).toBe('\x1b[200~first line\rsecond line\x1b[201~\r'),
      { timeout: 5000 }
    )
    const buffers = execFileSync('tmux', [...tmuxBaseArgs(), 'list-buffers'], { encoding: 'utf8' })
    expect(buffers).toBe('')
  })

  it('sends each key in turn, and text literally even when it starts with a dash', async () => {
    const out = outFile()
    const name = unique()
    await startTmux(name, tmpdir(), [
      'sh',
      '-c',
      'stty raw -echo; : > "$0.ready"; exec cat > "$0"',
      out
    ])
    await vi.waitFor(() => readFileSync(`${out}.ready`), { timeout: 5000 })
    await keysTmux(name, ['2', 'Down', { text: '-n Enter;' }, 'Enter'])
    await vi.waitFor(() => expect(readFileSync(out, 'utf8')).toBe('2\x1b[B-n Enter;\r'), {
      timeout: 5000
    })
  })

  it('reads the text on the screen, and throws when the session is gone', async () => {
    const name = unique()
    await startTmux(name, tmpdir(), ['sh', '-c', 'printf "❯ 1. Yes\\n"; exec sleep 30'])
    await vi.waitFor(async () => expect(await captureTmux(name)).toContain('❯ 1. Yes'), {
      timeout: 5000
    })
    await expect(captureTmux(unique())).rejects.toThrow(/capture-pane/)
  })

  it('keeps the colors on the screen when asked', async () => {
    const name = unique()
    await startTmux(name, tmpdir(), [
      'sh',
      '-c',
      'printf "❯ \\033[2mhint\\033[0m\\n"; exec sleep 30'
    ])
    await vi.waitFor(async () => expect(await captureTmux(name, true)).toContain('❯ \x1b[2mhint'), {
      timeout: 5000
    })
    expect(await captureTmux(name)).toContain('❯ hint')
  })

  it('throws from pasteTmux when the session is gone', async () => {
    await startTmux(unique(), tmpdir(), ['sleep', '30'])
    await expect(pasteTmux(unique(), 'text')).rejects.toThrow(/paste-buffer/)
    expect(execFileSync('tmux', [...tmuxBaseArgs(), 'list-buffers'], { encoding: 'utf8' })).toBe('')
  })

  it('waits 100 ms after each key before sending the next', async () => {
    const ok = { code: 0, stdout: '', stderr: '' }
    vi.mocked(run).mockResolvedValueOnce(ok).mockResolvedValueOnce(ok)
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    try {
      const calls = vi.mocked(run).mock.calls.length
      const sent = keysTmux(unique(), ['1', 'Enter'])
      await vi.advanceTimersByTimeAsync(99)
      expect(vi.mocked(run).mock.calls.length - calls).toBe(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(vi.mocked(run).mock.calls.length - calls).toBe(2)
      await vi.advanceTimersByTimeAsync(100)
      await sent
    } finally {
      vi.useRealTimers()
    }
  })

  it('presses Escape in the session', async () => {
    const out = outFile()
    const name = unique()
    await startTmux(name, tmpdir(), [
      'sh',
      '-c',
      'stty raw -echo; : > "$0.ready"; exec cat > "$0"',
      out
    ])
    await vi.waitFor(() => readFileSync(`${out}.ready`), { timeout: 5000 })
    await escapeTmux(name)
    await vi.waitFor(() => expect(readFileSync(out, 'utf8')).toBe('\x1b'), { timeout: 5000 })
  })

  it('throws from enterTmux when the session is gone', async () => {
    await expect(enterTmux(unique())).rejects.toThrow(/send-keys/)
  })

  it('lists nothing when no server is running', async () => {
    killServer()
    expect(await listTmux()).toEqual([])
  })
})

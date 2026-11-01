import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import type { Routine, SessionRecord } from '../../shared/types'
import { shortTime } from '../../shared/time'
import {
  expectSettingsUntouched,
  opusLine,
  project,
  session,
  settle,
  setup,
  tempDir,
  worktreesWithSettings,
  writeTranscript
} from '../test/orchestrator'

vi.mock('../env/tools', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../env/tools')>()),
  stopChildren: vi.fn()
}))

beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }))
afterEach(() => {
  vi.useRealTimers()
})

describe('routines', () => {
  const input = {
    projectId: 'p1',
    name: 'Dependency check',
    repo: 'octo/shop',
    worktree: true,
    message: 'Run npm outdated'
  }

  it('saves a routine and lists it on the board', async () => {
    const t = setup()
    await t.orch.reconnect()
    const r = await t.orch.saveRoutine(input)
    expect(r).toEqual({
      ...input,
      id: expect.any(String),
      scheduledThrough: '2026-10-24T12:00:00.000Z'
    })
    expect(await t.orch.listRoutines('p1')).toEqual([r])
    expect((await t.orch.getBoard('p1')).routines).toEqual([r])
    expect(t.deps.store.save).toHaveBeenLastCalledWith(expect.objectContaining({ routines: [r] }))
  })

  it('keeps scheduledThrough unless the schedule changes', async () => {
    const t = setup()
    await t.orch.reconnect()
    const schedule = { days: [1], time: '02:00' }
    const r = await t.orch.saveRoutine({ ...input, schedule })
    t.deps.now.mockReturnValue(new Date('2026-10-25T12:00:00.000Z'))
    const renamed = await t.orch.saveRoutine({ ...r, name: 'Deps' })
    expect(renamed.scheduledThrough).toBe('2026-10-24T12:00:00.000Z')
    const moved = await t.orch.saveRoutine({ ...r, schedule: { days: [2], time: '02:00' } })
    expect(moved.scheduledThrough).toBe('2026-10-25T12:00:00.000Z')
    expect(await t.orch.listRoutines('p1')).toEqual([moved])
  })

  it('asks for a repo when none is picked', async () => {
    const t = setup()
    await t.orch.reconnect()
    await expect(t.orch.saveRoutine({ ...input, repo: '' })).rejects.toThrow('Pick a repo')
  })

  it('refuses a duplicate name', async () => {
    const t = setup()
    await t.orch.reconnect()
    await t.orch.saveRoutine(input)
    await expect(t.orch.saveRoutine({ ...input, name: ' dependency CHECK ' })).rejects.toThrow(
      'Shop already has a routine named dependency CHECK'
    )
  })

  it('refuses a repo the project lacks', async () => {
    const t = setup()
    await t.orch.reconnect()
    await expect(t.orch.saveRoutine({ ...input, repo: 'octo/other' })).rejects.toThrow(
      'Repo not in this project'
    )
  })

  it('leaves a routine session unsandboxed when the project sandboxes its sessions', async () => {
    const t = setup({ projects: [{ ...project, sandbox: true }] })
    await t.orch.reconnect()
    const { id } = await t.orch.saveRoutine(input)
    const sessionId = await t.orch.startRoutine(id)
    const settings = readFileSync(join(t.dataDir, 'settings', `${sessionId}.json`), 'utf8')
    expect(JSON.parse(settings)).not.toHaveProperty('sandbox')
  })

  it('starts a routine as a session without a ticket with its first message', async () => {
    const t = setup()
    await t.orch.reconnect()
    const { id } = await t.orch.saveRoutine(input)
    const sessionId = await t.orch.startRoutine(id)
    const args = t.deps.tmux.startTmux.mock.calls[0][2]
    expect(args.slice(-4)).toEqual([
      '--append-system-prompt',
      expect.any(String),
      '--',
      'Run npm outdated'
    ])
    expect(args[args.indexOf('-n') + 1]).toBe(
      `Dependency check, ${shortTime('2026-10-24T12:00:00.000Z')}`
    )
    const s = t.orch.session(sessionId)
    expect(s?.routineId).toBe(id)
    expect(s).not.toHaveProperty('scheduled')
    expect(s?.branch).toMatch(/^session-/)
    expect(t.deps.board.setStatus).not.toHaveBeenCalled()
    expect(t.deps.board.addItem).not.toHaveBeenCalled()
    expect(t.deps.repoIssues.setColumn).not.toHaveBeenCalled()
    expect(t.deps.repoIssues.create).not.toHaveBeenCalled()
    expect(t.deps.repoIssues.reopen).not.toHaveBeenCalled()
  })

  it("lets only the routine's sessions use its allowed rules, and leaves the repo's settings", async () => {
    const [wt] = worktreesWithSettings(1)
    const t = setup()
    t.deps.git.ensureWorktree.mockResolvedValue({ path: wt, created: true })
    await t.orch.reconnect()
    const r = await t.orch.saveRoutine({ ...input, allow: [' Bash(npm outdated) ', '', 'Read'] })
    expect(r.allow).toEqual(['Bash(npm outdated)', 'Read'])
    const own = (id: string): string[] => [
      `Read(/${join(t.dataDir, 'images', id)}/**)`,
      `Read(/${join(t.dataDir, 'notes', `${id}.md`)})`,
      `Edit(/${join(t.dataDir, 'notes', `${id}.md`)})`
    ]
    const settingsOf = (id: string): { permissions?: { allow: string[] }; hooks: object } =>
      JSON.parse(readFileSync(join(t.dataDir, 'settings', `${id}.json`), 'utf8'))
    const routineSession = await t.orch.startRoutine(r.id)
    expect(settingsOf(routineSession).permissions).toEqual({
      allow: ['Bash(npm outdated)', 'Read', ...own(routineSession)]
    })
    expect(settingsOf(routineSession).hooks).toHaveProperty('Stop')
    const other = await t.orch.create('p1', 'octo/shop', true)
    expect(settingsOf(other).permissions).toEqual({ allow: own(other) })
    expectSettingsUntouched([wt])
    expect((await t.orch.saveRoutine({ ...r, allow: [] })).allow).toBeUndefined()
  })

  it("resumes a routine's session with the routine's rules as they are now", async () => {
    const t = setup({
      routines: [{ id: 'r1', ...input, allow: ['Bash(npm audit:*)'] }],
      sessions: [
        session({
          ticketKey: undefined,
          routineId: 'r1',
          state: 'finished',
          worktrees: [tempDir('st-wt-')]
        })
      ]
    })
    await t.orch.reconnect()
    await t.orch.resume('s1')
    expect(
      JSON.parse(readFileSync(join(t.dataDir, 'settings', 's1.json'), 'utf8')).permissions
    ).toEqual({
      allow: [
        'Bash(npm audit:*)',
        `Read(/${join(t.dataDir, 'images', 's1')}/**)`,
        `Read(/${join(t.dataDir, 'notes', 's1.md')})`,
        `Edit(/${join(t.dataDir, 'notes', 's1.md')})`
      ]
    })
  })

  it('refuses an allowed rule that would let the session run any command', async () => {
    const t = setup()
    await t.orch.reconnect()
    await expect(t.orch.saveRoutine({ ...input, allow: ['Bash(*)'] })).rejects.toThrow(
      'Bash(*) lets the session run any command'
    )
  })

  it('refuses to start while its last session is live', async () => {
    const t = setup()
    await t.orch.reconnect()
    const { id } = await t.orch.saveRoutine(input)
    const sessionId = await t.orch.startRoutine(id)
    await expect(t.orch.startRoutine(id)).rejects.toThrow(
      "Dependency check's last session is still open"
    )
    await t.orch.end(sessionId)
    await expect(t.orch.startRoutine(id)).resolves.toEqual(expect.any(String))
  })

  it('shows a run that ends its turn as Done, without a notification, and starts the next', async () => {
    const t = setup()
    await t.orch.reconnect()
    const { id } = await t.orch.saveRoutine(input)
    const sessionId = await t.orch.startRoutine(id)
    t.emit(sessionId, 'needsYou')
    expect(t.orch.session(sessionId)?.state).toBe('done')
    t.emit(sessionId, 'needsYou')
    expect(t.orch.session(sessionId)?.state).toBe('done')
    expect(t.deps.notify).not.toHaveBeenCalled()
    expect((await t.orch.getBoard('p1')).needsYou).toEqual({})
    expect(t.deps.tmux.startTmux.mock.calls[0][2].join('\n')).toContain('This routine:')
    await expect(t.orch.startRoutine(id)).resolves.not.toBe(sessionId)
  })

  it('keeps a run that stops to ask as Needs you, and busy', async () => {
    const t = setup()
    await t.orch.reconnect()
    const { id } = await t.orch.saveRoutine(input)
    const sessionId = await t.orch.startRoutine(id)
    t.emit(sessionId, 'needsYou')
    t.emit(sessionId, 'needsYou', true)
    expect(t.orch.session(sessionId)?.state).toBe('needsYou')
    expect(t.deps.notify).toHaveBeenCalledTimes(1)
    await expect(t.orch.startRoutine(id)).rejects.toThrow(
      "Dependency check's last session is still open"
    )
    t.emit(sessionId, 'running')
    t.emit(sessionId, 'needsYou')
    expect(t.orch.session(sessionId)?.state).toBe('done')
  })

  it('reads a routine session that ended its turn as Done on reconnect, unless it is asking', async () => {
    const run = (id: string): SessionRecord =>
      session({
        id,
        ticketKey: undefined,
        routineId: 'r1',
        tmuxName: id,
        eventsFile: `/e/${id}.jsonl`
      })
    const t = setup({ routines: [{ id: 'r1', ...input }], sessions: [run('s1'), run('s2')] })
    for (const id of ['s1', 's2']) {
      t.live.add(id)
      t.lastState.set(`/e/${id}.jsonl`, 'needsYou')
    }
    t.askingFiles.add('/e/s2.jsonl')
    await t.orch.reconnect()
    expect(t.orch.session('s1')?.state).toBe('done')
    expect(t.orch.session('s2')?.state).toBe('needsYou')
  })

  it('shows a resumed routine session as Done', async () => {
    const t = setup({
      routines: [{ id: 'r1', ...input }],
      sessions: [
        session({
          ticketKey: undefined,
          routineId: 'r1',
          state: 'finished',
          worktrees: [tempDir('st-wt-')]
        })
      ]
    })
    await t.orch.reconnect()
    await t.orch.resume('s1')
    expect(t.orch.session('s1')?.state).toBe('done')
    await expect(t.orch.startRoutine('r1')).resolves.toEqual(expect.any(String))
  })

  it('refuses a second start while the first is still launching', async () => {
    const t = setup()
    await t.orch.reconnect()
    const { id } = await t.orch.saveRoutine(input)
    const first = t.orch.startRoutine(id)
    await expect(t.orch.startRoutine(id)).rejects.toThrow(
      "Dependency check's last session is still open"
    )
    await first
    expect(t.deps.tmux.startTmux).toHaveBeenCalledTimes(1)
  })

  it('counts a session that is resuming as open', async () => {
    const t = setup({
      routines: [{ id: 'r1', ...input }],
      sessions: [
        session({
          ticketKey: undefined,
          routineId: 'r1',
          state: 'finished',
          worktrees: [tempDir('st-wt-')]
        })
      ]
    })
    await t.orch.reconnect()
    let release = (): void => undefined
    const start = t.deps.tmux.startTmux.getMockImplementation()!
    t.deps.tmux.startTmux.mockImplementationOnce(
      (...args) => new Promise((r) => (release = () => r(start(...args))))
    )
    const resumed = t.orch.resume('s1')
    await vi.waitFor(() => expect(t.deps.tmux.startTmux).toHaveBeenCalled())
    await expect(t.orch.startRoutine('r1')).rejects.toThrow(
      "Dependency check's last session is still open"
    )
    release()
    await resumed
  })

  it('refuses a first message over 10,000 bytes', async () => {
    const t = setup()
    await t.orch.reconnect()
    await expect(
      t.orch.create('p1', 'octo/shop', false, undefined, 'é'.repeat(5_001))
    ).rejects.toThrow('Shorten the first message')
    await expect(t.orch.saveRoutine({ ...input, message: 'é'.repeat(5_001) })).rejects.toThrow(
      'Shorten the first message'
    )
    expect(t.deps.tmux.startTmux).not.toHaveBeenCalled()
  })

  it('refuses a routine whose repo the project no longer has', async () => {
    const t = setup()
    await t.orch.reconnect()
    const { id } = await t.orch.saveRoutine(input)
    await t.orch.saveProject({ ...project, repos: [project.repos[1]] })
    await expect(t.orch.startRoutine(id)).rejects.toThrow('Repo not in this project')
  })

  it('removes a routine', async () => {
    const t = setup()
    await t.orch.reconnect()
    const { id } = await t.orch.saveRoutine(input)
    await t.orch.removeRoutine(id)
    expect(await t.orch.listRoutines('p1')).toEqual([])
  })

  it("removes a project's routines", async () => {
    const t = setup()
    await t.orch.reconnect()
    await t.orch.saveRoutine(input)
    await t.orch.removeProject('p1')
    expect(await t.orch.listRoutines('p1')).toEqual([])
  })

  it("passes New session's first message", async () => {
    const t = setup()
    await t.orch.reconnect()
    await t.orch.create('p1', 'octo/shop', false, undefined, 'Look at #12')
    expect(t.deps.tmux.startTmux.mock.calls[0][2].slice(-2)).toEqual(['--', 'Look at #12'])
    await t.orch.create('p1', 'octo/shop', false, undefined, '- npm outdated')
    expect(t.deps.tmux.startTmux.mock.calls[1][2].slice(-2)).toEqual(['--', '- npm outdated'])
    await t.orch.create('p1', 'octo/shop', false, undefined, '  ')
    expect(t.deps.tmux.startTmux.mock.calls[2][2].at(-2)).toBe('--append-system-prompt')
  })

  it("reads a session's first message from its transcript", async () => {
    const t = setup({ sessions: [session()] })
    await t.orch.reconnect()
    const folder = join(t.claudeDir, 'projects', 'x')
    mkdirSync(folder, { recursive: true })
    const say = (role: string, text: string): string =>
      JSON.stringify({ type: role, message: { role, content: text } })
    writeFileSync(
      join(folder, 's1.jsonl'),
      [say('assistant', 'Hello'), say('user', 'Triage the new issues'), say('user', 'More')].join(
        '\n'
      )
    )
    expect(await t.orch.firstMessage('s1')).toBe('Triage the new issues')
  })

  it('has no first message without a transcript', async () => {
    const t = setup({ sessions: [session()] })
    await t.orch.reconnect()
    expect(await t.orch.firstMessage('s1')).toBe('')
  })
})

describe('routine schedules', () => {
  const local = (day: number, h: number, m = 0, s = 0): Date => new Date(2026, 9, day, h, m, s)
  const everyDay = { days: [0, 1, 2, 3, 4, 5, 6], time: '13:00' }
  const routine = (over: Partial<Routine> = {}): Routine => ({
    id: 'r1',
    projectId: 'p1',
    name: 'Dependency check',
    repo: 'octo/shop',
    worktree: true,
    message: 'Run npm outdated',
    schedule: everyDay,
    ...over
  })
  const tick = async (t: ReturnType<typeof setup>, at: Date): Promise<void> => {
    t.deps.now.mockReturnValue(at)
    await vi.advanceTimersByTimeAsync(30_000)
    await settle()
  }
  const started = async (t: ReturnType<typeof setup>): Promise<void> => {
    await vi.waitFor(() => expect(t.deps.tmux.startTmux).toHaveBeenCalled())
    await t.orch.flush()
  }

  it('starts a scheduled routine at its time', async () => {
    const t = setup()
    t.deps.now.mockReturnValue(local(24, 12, 59, 30))
    await t.orch.reconnect()
    const { id } = await t.orch.saveRoutine({ ...routine(), id: undefined })
    await tick(t, local(24, 13, 0, 20))
    await started(t)
    expect(t.deps.tmux.startTmux).toHaveBeenCalledTimes(1)
    expect(t.saved().sessions).toEqual([
      expect.objectContaining({ routineId: id, scheduled: true })
    ])
    t.orch.stop()
  })

  describe('a start that stops before Claude Code fires SessionStart', () => {
    const NOT_STARTED =
      "Claude Code hasn't started. It's probably waiting for you to trust this folder: open the terminal to answer it."
    const startLine = JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup' }) + '\n'
    const scheduledStart = async (): Promise<ReturnType<typeof setup>> => {
      const t = setup()
      t.deps.now.mockReturnValue(local(24, 12, 59, 30))
      await t.orch.reconnect()
      await t.orch.saveRoutine({ ...routine(), id: undefined })
      await tick(t, local(24, 13, 0, 20))
      await started(t)
      return t
    }

    it('shows Needs you with the reason after 30 s, then Running once SessionStart arrives', async () => {
      const t = await scheduledStart()
      const [{ id, eventsFile }] = t.saved().sessions
      await tick(t, local(24, 13, 0, 40))
      expect(t.orch.session(id)?.state).toBe('running')
      await tick(t, local(24, 13, 1, 0))
      await vi.waitFor(() => expect(t.orch.session(id)?.state).toBe('needsYou'))
      expect(t.orch.session(id)).toMatchObject({
        state: 'needsYou',
        asking: true,
        startWarning: NOT_STARTED
      })
      expect(t.deps.notify).toHaveBeenCalledWith(
        expect.stringContaining('Needs you'),
        expect.anything(),
        expect.any(Function)
      )
      expect(await t.orch.routineHistory(t.saved().routines[0].id)).toEqual([
        expect.objectContaining({ kind: 'session', warning: NOT_STARTED })
      ])
      await expect(t.orch.clearNeedsYou(id)).rejects.toThrow('folder trust prompt')
      mkdirSync(dirname(eventsFile), { recursive: true })
      writeFileSync(eventsFile, startLine)
      await tick(t, local(24, 13, 2, 0))
      await vi.waitFor(() => expect(t.orch.session(id)?.startWarning).toBeUndefined())
      expect(t.orch.session(id)?.state).toBe('running')
      expect(t.orch.session(id)?.asking).toBeUndefined()
      t.orch.stop()
    })

    it('goes back to Running after a reopen once SessionStart arrives', async () => {
      const eventsFile = join(tempDir('st-events-'), 's1.jsonl')
      writeFileSync(eventsFile, startLine)
      const t = setup({
        sessions: [
          session({ eventsFile, state: 'needsYou', asking: true, startWarning: NOT_STARTED })
        ]
      })
      t.live.add('st-p1-octo-shop-147')
      await t.orch.reconnect()
      await vi.advanceTimersByTimeAsync(3000)
      await vi.waitFor(() => expect(t.orch.session('s1')?.state).toBe('running'))
      expect(t.orch.session('s1')?.startWarning).toBeUndefined()
      t.orch.stop()
    })

    it('goes back to Idle after a reopen when it started without a prompt', async () => {
      const eventsFile = join(tempDir('st-events-'), 's1.jsonl')
      writeFileSync(eventsFile, startLine)
      const t = setup({
        sessions: [
          session({
            eventsFile,
            state: 'needsYou',
            asking: true,
            startWarning: NOT_STARTED,
            unprompted: true
          })
        ]
      })
      t.live.add('st-p1-octo-shop-147')
      await t.orch.reconnect()
      await vi.advanceTimersByTimeAsync(3000)
      await vi.waitFor(() => expect(t.orch.session('s1')?.state).toBe('idle'))
      t.orch.stop()
    })

    it('takes the state the events file gives once SessionStart arrives', async () => {
      const t = await scheduledStart()
      const [{ id, eventsFile }] = t.saved().sessions
      await tick(t, local(24, 13, 1, 0))
      await vi.waitFor(() => expect(t.orch.session(id)?.startWarning).toBe(NOT_STARTED))
      mkdirSync(dirname(eventsFile), { recursive: true })
      writeFileSync(eventsFile, startLine)
      t.lastState.set(eventsFile, 'needsYou')
      t.askingFiles.add(eventsFile)
      await tick(t, local(24, 13, 1, 30))
      await vi.waitFor(() => expect(t.orch.session(id)?.startWarning).toBeUndefined())
      expect(t.orch.session(id)).toMatchObject({ state: 'needsYou', asking: true })
      t.orch.stop()
    })

    it('keeps an earlier start warning and stays asking after a reopen', async () => {
      const eventsFile = join(tempDir('st-events-'), 's1.jsonl')
      const t = setup({
        sessions: [
          session({
            eventsFile,
            state: 'needsYou',
            asking: true,
            startWarning: `Couldn't fetch origin ${NOT_STARTED}`
          })
        ]
      })
      t.live.add('st-p1-octo-shop-147')
      await t.orch.reconnect()
      expect(t.orch.session('s1')?.asking).toBe(true)
      writeFileSync(eventsFile, startLine)
      await vi.advanceTimersByTimeAsync(3000)
      await vi.waitFor(() =>
        expect(t.orch.session('s1')?.startWarning).toBe("Couldn't fetch origin")
      )
      expect(t.orch.session('s1')?.state).toBe('running')
      t.orch.stop()
    })

    it('stays Running when SessionStart arrives in time', async () => {
      const t = await scheduledStart()
      const [{ id, eventsFile }] = t.saved().sessions
      mkdirSync(dirname(eventsFile), { recursive: true })
      writeFileSync(eventsFile, startLine)
      await tick(t, local(24, 13, 5, 0))
      expect(t.orch.session(id)?.state).toBe('running')
      expect(t.orch.session(id)?.startWarning).toBeUndefined()
      t.orch.stop()
    })
  })

  it('starts once for the same time', async () => {
    const t = setup()
    t.deps.now.mockReturnValue(local(24, 12, 59, 30))
    await t.orch.reconnect()
    await t.orch.saveRoutine({ ...routine(), id: undefined })
    await tick(t, local(24, 13, 0, 20))
    await started(t)
    await tick(t, local(24, 13, 0, 40))
    await tick(t, local(24, 13, 1, 10))
    expect(t.deps.tmux.startTmux).toHaveBeenCalledTimes(1)
    expect(t.saved().skippedRuns).toEqual([])
    t.orch.stop()
  })

  it('skips a time that came while its last session was live', async () => {
    const t = setup()
    t.deps.now.mockReturnValue(local(24, 12, 59, 30))
    await t.orch.reconnect()
    const { id } = await t.orch.saveRoutine({ ...routine(), id: undefined })
    await tick(t, local(24, 13, 0, 20))
    await started(t)
    await tick(t, local(25, 13, 0, 10))
    expect(t.deps.tmux.startTmux).toHaveBeenCalledTimes(1)
    expect(t.saved().skippedRuns).toEqual([
      { routineId: id, at: local(25, 13).toISOString(), reason: 'running' }
    ])
    t.orch.stop()
  })

  it('skips the times that passed while Sandtable was closed', async () => {
    const t = setup({
      routines: [routine({ scheduledThrough: local(21, 14).toISOString() })]
    })
    t.deps.now.mockReturnValue(local(24, 14))
    await t.orch.reconnect()
    await settle()
    expect(t.deps.tmux.startTmux).not.toHaveBeenCalled()
    expect(t.saved().skippedRuns).toEqual(
      [22, 23, 24].map((d) => ({
        routineId: 'r1',
        at: local(d, 13).toISOString(),
        reason: 'closed'
      }))
    )
    expect(t.saved().routines[0].scheduledThrough).toBe(local(24, 14).toISOString())
    t.orch.stop()
  })

  it('records only the last 7 days of skips', async () => {
    const t = setup({
      routines: [routine({ scheduledThrough: new Date(2026, 8, 24, 14).toISOString() })]
    })
    t.deps.now.mockReturnValue(local(24, 14))
    await t.orch.reconnect()
    await settle()
    expect(t.saved().skippedRuns).toHaveLength(7)
    t.orch.stop()
  })

  it("leaves the times alone when tmux isn't available", async () => {
    const through = local(21, 14).toISOString()
    const t = setup({ routines: [routine({ scheduledThrough: through })] })
    t.deps.now.mockReturnValue(local(24, 14))
    await t.orch.reconnect(false)
    await tick(t, local(24, 14, 0, 30))
    expect(t.deps.tmux.startTmux).not.toHaveBeenCalled()
    expect(t.saved().skippedRuns).toEqual([])
    expect(t.saved().routines[0].scheduledThrough).toBe(through)
    t.orch.stop()
  })

  it('saves nothing on a tick that changes nothing', async () => {
    const t = setup({ routines: [routine({ scheduledThrough: local(24, 14).toISOString() })] })
    t.deps.now.mockReturnValue(local(24, 14))
    await t.orch.reconnect()
    await settle()
    t.deps.store.save.mockClear()
    await tick(t, local(24, 14, 0, 30))
    expect(t.deps.store.save).not.toHaveBeenCalled()
    t.orch.stop()
  })

  it('keeps scheduledThrough when only the order of the days changes', async () => {
    const t = setup()
    await t.orch.reconnect()
    const r = await t.orch.saveRoutine({
      ...routine(),
      id: undefined,
      schedule: { days: [1, 3], time: '02:00' }
    })
    t.deps.now.mockReturnValue(new Date('2026-10-25T12:00:00.000Z'))
    const saved = await t.orch.saveRoutine({ ...r, schedule: { time: '02:00', days: [3, 1] } })
    expect(saved.scheduledThrough).toBe(r.scheduledThrough)
    t.orch.stop()
  })

  const holdFirstStart = (t: ReturnType<typeof setup>): (() => void) => {
    let release = (): void => undefined
    const ensure = t.deps.git.ensureWorktree.getMockImplementation()!
    t.deps.git.ensureWorktree.mockImplementationOnce(
      (...args) => new Promise((r) => (release = () => r(ensure(...args))))
    )
    return () => release()
  }
  const twoDue = (): ReturnType<typeof setup> =>
    setup({
      routines: [
        routine({ scheduledThrough: local(24, 12, 59).toISOString() }),
        routine({
          id: 'r2',
          name: 'Triage',
          worktree: false,
          scheduledThrough: local(22, 14).toISOString()
        })
      ]
    })

  const holdNextSave = (t: ReturnType<typeof setup>): (() => void) => {
    let release = (): void => undefined
    const save = t.deps.store.save.getMockImplementation()!
    t.deps.store.save.mockImplementationOnce(
      (d) => new Promise((r) => (release = () => r(save(structuredClone(d)))))
    )
    return () => release()
  }
  const dueAfterSave = async (t: ReturnType<typeof setup>): Promise<() => void> => {
    t.deps.now.mockReturnValue(local(24, 12, 59, 30))
    await t.orch.reconnect()
    await t.orch.flush()
    const release = holdNextSave(t)
    await tick(t, local(24, 13, 0, 20))
    return release
  }

  it("doesn't start or record a routine removed while the schedule saves", async () => {
    const t = twoDue()
    const release = await dueAfterSave(t)
    void t.orch.removeRoutine('r2')
    release()
    await started(t)
    await settle()
    await t.orch.flush()
    expect(t.deps.tmux.startTmux).toHaveBeenCalledTimes(1)
    expect(t.saved().sessions.map((s) => s.routineId)).toEqual(['r1'])
    expect(t.saved().skippedRuns).toEqual([])
    t.orch.stop()
  })

  it('starts a routine saved while the schedule saves once, without repeating its skips', async () => {
    const t = twoDue()
    const release = await dueAfterSave(t)
    const [, r2] = await t.orch.listRoutines('p1')
    void t.orch.saveRoutine({ ...r2, name: 'Triage again' })
    release()
    await vi.waitFor(() => expect(t.deps.tmux.startTmux).toHaveBeenCalledTimes(2))
    await t.orch.flush()
    await settle()
    expect(t.saved().routines[1].scheduledThrough).toBe(local(24, 13, 0, 20).toISOString())
    await tick(t, local(24, 13, 0, 50))
    await t.orch.flush()
    expect(t.deps.tmux.startTmux).toHaveBeenCalledTimes(2)
    expect(t.saved().skippedRuns).toEqual([
      { routineId: 'r2', at: local(23, 13).toISOString(), reason: 'closed' }
    ])
    t.orch.stop()
  })

  it("starts each due routine without waiting for another's start", async () => {
    const t = twoDue()
    const release = holdFirstStart(t)
    t.deps.now.mockReturnValue(local(24, 13, 0, 20))
    await t.orch.reconnect()
    await vi.waitFor(() => expect(t.deps.tmux.startTmux).toHaveBeenCalledTimes(1))
    release()
    await vi.waitFor(() => expect(t.deps.tmux.startTmux).toHaveBeenCalledTimes(2))
    t.orch.stop()
  })

  it("doesn't start a due routine once Sandtable stops", async () => {
    const t = twoDue()
    const release = await dueAfterSave(t)
    t.orch.stop()
    release()
    await settle()
    await t.orch.flush()
    expect(t.deps.git.ensureWorktree).not.toHaveBeenCalled()
  })

  it('records a scheduled start that fails with its error', async () => {
    const t = setup({ routines: [routine({ scheduledThrough: local(24, 12, 59).toISOString() })] })
    t.deps.git.ensureWorktree.mockRejectedValueOnce(new Error('fetch failed'))
    t.deps.now.mockReturnValue(local(24, 13, 0, 20))
    await t.orch.reconnect()
    await vi.waitFor(() => expect(t.saved().skippedRuns).toHaveLength(1))
    const failed = { at: local(24, 13).toISOString(), reason: 'failed', error: 'fetch failed' }
    expect(t.saved().skippedRuns).toEqual([{ routineId: 'r1', ...failed }])
    expect(await t.orch.routineHistory('r1')).toEqual([
      { kind: 'skipped', scheduled: true, ...failed }
    ])
    t.orch.stop()
  })

  it('still reports a failed scheduled start when saving it fails', async () => {
    const t = setup({ routines: [routine({ scheduledThrough: local(24, 12, 59).toISOString() })] })
    const unhandled: unknown[] = []
    const onUnhandled = (err: unknown): number => unhandled.push(err)
    process.on('unhandledRejection', onUnhandled)
    onTestFinished(() => void process.off('unhandledRejection', onUnhandled))
    const changes: string[] = []
    t.orch.onChange((id) => changes.push(id))
    t.deps.git.ensureWorktree.mockImplementationOnce(async () => {
      t.deps.store.save.mockRejectedValue(new Error('disk full'))
      changes.length = 0
      throw new Error('fetch failed')
    })
    t.deps.now.mockReturnValue(local(24, 13, 0, 20))
    await t.orch.reconnect()
    await vi.waitFor(() => expect(changes).toContain('p1'))
    await settle()
    expect(unhandled).toEqual([])
    t.orch.stop()
  })

  it('records a time as skipped when you start the routine while the schedule saves', async () => {
    const t = setup({ routines: [routine({ scheduledThrough: local(24, 12, 59).toISOString() })] })
    const release = await dueAfterSave(t)
    const manual = t.orch.startRoutine('r1')
    release()
    await manual
    await vi.waitFor(() => expect(t.saved().skippedRuns).toHaveLength(1))
    expect(t.deps.tmux.startTmux).toHaveBeenCalledTimes(1)
    expect(t.saved().skippedRuns).toEqual([
      { routineId: 'r1', at: local(24, 13).toISOString(), reason: 'running' }
    ])
    t.orch.stop()
  })

  it('pulls a scheduledThrough far in the future back to now', async () => {
    const t = setup({ routines: [routine({ scheduledThrough: local(30, 14).toISOString() })] })
    t.deps.now.mockReturnValue(local(24, 12, 59, 30))
    await t.orch.reconnect()
    await t.orch.flush()
    expect(t.saved().routines[0].scheduledThrough).toBe(local(24, 12, 59, 30).toISOString())
    await tick(t, local(24, 13, 0, 20))
    await started(t)
    t.orch.stop()
  })

  it('runs schedules once tmux shows up after launch', async () => {
    const t = setup({ routines: [routine({ scheduledThrough: local(24, 12, 59).toISOString() })] })
    t.deps.now.mockReturnValue(local(24, 12, 59, 30))
    await t.orch.reconnect(false)
    await t.orch.watchTmux()
    await tick(t, local(24, 13, 0, 20))
    await started(t)
    expect(t.saved().sessions).toEqual([expect.objectContaining({ routineId: 'r1' })])
    t.orch.stop()
  })

  it("lists a routine's runs and skips, newest first", async () => {
    const t = setup({
      routines: [routine({ scheduledThrough: local(24, 14).toISOString() })],
      sessions: [
        session({
          id: 's1',
          ticketKey: undefined,
          routineId: 'r1',
          scheduled: true,
          branch: 'session-abc',
          startedAt: local(23, 13).toISOString(),
          state: 'finished'
        }),
        session({
          id: 's2',
          ticketKey: undefined,
          tmuxName: 'st-other',
          branch: undefined,
          worktrees: [],
          checkout: '/repos/shop',
          routineId: 'r1',
          startedAt: local(22, 9).toISOString(),
          state: 'finished',
          removedAt: local(22, 10).toISOString()
        })
      ],
      skippedRuns: [{ routineId: 'r1', at: local(24, 13).toISOString(), reason: 'running' }]
    })
    t.deps.now.mockReturnValue(local(24, 14))
    await t.orch.reconnect()
    const say = (text: string): string =>
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text }] }
      })
    writeTranscript(
      join(t.claudeDir, 'projects', 'x', 's1.jsonl'),
      [opusLine('a', 5), say('Checking'), say('All up to date')].join('\n')
    )
    expect(await t.orch.routineHistory('r1')).toEqual([
      { kind: 'skipped', at: local(24, 13).toISOString(), scheduled: true, reason: 'running' },
      {
        kind: 'session',
        at: local(23, 13).toISOString(),
        scheduled: true,
        sessionId: 's1',
        state: 'finished',
        removed: false,
        place: 'session-abc',
        usage: [expect.objectContaining({ model: 'claude-opus-5-5', input: 5 })],
        lastMessage: 'All up to date'
      },
      {
        kind: 'session',
        at: local(22, 9).toISOString(),
        scheduled: false,
        sessionId: 's2',
        state: 'finished',
        removed: true,
        place: 'main checkout',
        usage: [],
        lastMessage: null
      }
    ])
    t.orch.stop()
  })

  it('names the tool a run is waiting on permission for', async () => {
    const t = setup({
      routines: [routine({ scheduledThrough: local(24, 14).toISOString() })],
      sessions: [
        session({
          id: 's1',
          ticketKey: undefined,
          routineId: 'r1',
          scheduled: true,
          tmuxName: 'alive',
          eventsFile: '/e/s1.jsonl',
          startedAt: local(24, 2).toISOString(),
          state: 'needsYou'
        })
      ]
    })
    t.live.add('alive')
    t.askingFiles.add('/e/s1.jsonl')
    t.deps.now.mockReturnValue(local(24, 14))
    await t.orch.reconnect()
    const use = (id: string, name: string, toolInput: object): string =>
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id, name, input: toolInput }]
        }
      })
    const result = (id: string): string =>
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }]
        }
      })
    const file = join(t.claudeDir, 'projects', 'x', 's1.jsonl')
    const lines = [
      use('t1', 'Read', { file_path: '/a' }),
      result('t1'),
      use('t2', 'Bash', { command: 'npm outdated', description: 'List outdated packages' })
    ]
    writeTranscript(file, lines.join('\n'))
    const waiting = async (): Promise<unknown> =>
      (await t.orch.routineHistory('r1')).map((r) => r.kind === 'session' && r.waitingFor)
    expect(await waiting()).toEqual(['Bash(npm outdated)'])
    writeTranscript(
      file,
      [...lines.slice(0, 2), use('t3', 'WebFetch', { url: 'https://x' })].join('\n')
    )
    expect(await waiting()).toEqual(['WebFetch'])
    writeTranscript(file, [...lines, use('t4', 'Read', { file_path: '/b' })].join('\n'))
    expect(await waiting()).toEqual(['Bash(npm outdated)'])
    for (const name of ['Agent', 'Task', 'AskUserQuestion', 'ExitPlanMode']) {
      writeTranscript(file, [...lines.slice(0, 2), use('t5', name, {})].join('\n'))
      expect(await waiting()).toEqual([undefined])
    }
    writeTranscript(file, lines.slice(0, 2).join('\n'))
    expect(await waiting()).toEqual([undefined])
    t.orch.stop()
  })
})

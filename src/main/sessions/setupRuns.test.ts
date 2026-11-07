import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Finding, Project, ProjectRepo } from '../../shared/types'
import { SETUP_CANCELLED, SETUP_FAILED } from '../../shared/worktreeSetup'
import { project, session, setup, tempDir, tempWorktree } from '../test/orchestrator'

vi.mock('../env/tools', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../env/tools')>()),
  stopChildren: vi.fn()
}))

beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }))
afterEach(() => {
  vi.useRealTimers()
})

describe('worktree setup', () => {
  const KEY = 'octo/shop#147'
  const TARGET = `p1\n${KEY}`
  const SETUP_ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
  const wt0 = '/repos/shop-wt.noindex/147-dark-mode-toggle'
  const wt1 = '/repos/shop-web-wt.noindex/147-dark-mode-toggle'
  const npm = { copy: ['.env'], command: 'npm install' }
  const withSetup = (...setups: ProjectRepo['setup'][]): Project => ({
    ...project,
    repos: project.repos.map((r, i) => (setups[i] ? { ...r, setup: setups[i] } : r))
  })
  const ready = async (
    opts: Parameters<typeof setup>[0] = {},
    before: (t: ReturnType<typeof setup>) => void = () => undefined
  ): Promise<ReturnType<typeof setup>> => {
    const t = setup({ projects: [withSetup(npm)], ...opts })
    before(t)
    await t.orch.reconnect()
    await t.orch.sync('p1')
    return t
  }
  const keepOnLoad = (t: ReturnType<typeof setup>): void => {
    t.deps.git.removeWorktree.mockResolvedValueOnce({
      removed: false,
      reason: 'Uncommitted changes'
    })
  }
  const failing = { code: 1, lines: ['a', 'b', 'c', 'd', 'e', 'npm ERR! boom'] }
  const keptOrphan = (): string => {
    const path = join(tempDir('st-repo-'), 'session-0a1b2c3d')
    mkdirSync(path)
    return path
  }

  it('copies the paths and runs the command in a new worktree before starting claude', async () => {
    const t = await ready()
    const order: string[] = []
    t.deps.setup.copy.mockImplementation(async () => (order.push('copy'), []))
    t.deps.setup.run.mockImplementation(async () => (order.push('run'), { code: 0, lines: [] }))
    t.deps.tmux.startTmux.mockImplementation(async () => void order.push('launch'))
    await t.orch.start('p1', KEY)
    expect(order).toEqual(['copy', 'run', 'launch'])
    expect(t.deps.setup.copy).toHaveBeenCalledWith(
      '/repos/shop',
      wt0,
      ['.env'],
      expect.any(AbortSignal)
    )
    expect(t.deps.setup.run).toHaveBeenCalledWith(
      wt0,
      'npm install',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
    await t.orch.flush()
    expect(t.saved().setupPending).toEqual([])
    expect(t.orch.setupProgress(TARGET)).toBeNull()
  })

  it('pushes the copy notes and the latest output, redacted, then clears the progress', async () => {
    const t = await ready()
    const pushes: unknown[] = []
    t.orch.onSetupProgress((target, p) => pushes.push([target, p && structuredClone(p)]))
    t.deps.setup.copy.mockResolvedValue(['Skipped .env: not in the main checkout'])
    t.deps.setup.run.mockImplementation(async (_cwd, _cmd, { onOutput }) => {
      onOutput?.('using ghp_abcdefghij0123456789')
      await new Promise((r) => setTimeout(r, 250))
      return { code: 0, lines: [] }
    })
    await t.orch.start('p1', KEY)
    expect(pushes).toContainEqual([
      TARGET,
      {
        repo: 'octo/shop',
        state: 'running',
        notes: ['Skipped .env: not in the main checkout'],
        lines: ['using [redacted]'],
        startedAt: '2026-10-24T12:00:00.000Z'
      }
    ])
    expect(pushes.at(-1)).toEqual([TARGET, null])
  })

  it('finishes a setup with only copy paths right after copying', async () => {
    const t = await ready({ projects: [withSetup({ copy: ['.env'] })] })
    await t.orch.start('p1', KEY)
    expect(t.deps.setup.copy).toHaveBeenCalled()
    expect(t.deps.setup.run).not.toHaveBeenCalled()
    expect(t.deps.tmux.startTmux).toHaveBeenCalled()
  })

  it('never touches setup for a repo without one', async () => {
    const t = await ready({ projects: [project] })
    await t.orch.start('p1', KEY)
    expect(t.deps.setup.copy).not.toHaveBeenCalled()
    expect(t.deps.setup.run).not.toHaveBeenCalled()
    expect(t.deps.tmux.startTmux).toHaveBeenCalled()
  })

  it('skips setup in a reused worktree whose setup finished', async () => {
    const t = await ready()
    t.deps.git.ensureWorktree.mockResolvedValue({ path: wt0, created: false })
    await t.orch.start('p1', KEY)
    expect(t.deps.setup.run).not.toHaveBeenCalled()
    expect(t.deps.tmux.startTmux).toHaveBeenCalled()
  })

  it('runs setup again in a reused worktree whose setup never finished', async () => {
    const t = await ready({ setupPending: [wt0] })
    t.deps.git.ensureWorktree.mockResolvedValue({ path: wt0, created: false })
    await t.orch.start('p1', KEY)
    expect(t.deps.setup.run).toHaveBeenCalledWith(wt0, 'npm install', expect.anything())
    await t.orch.flush()
    expect(t.saved().setupPending).toEqual([])
  })

  it('keeps the worktree pending and starts nothing when the command fails', async () => {
    const t = await ready()
    t.deps.setup.run.mockResolvedValue(failing)
    await expect(t.orch.start('p1', KEY)).rejects.toThrow(
      `${SETUP_FAILED}: npm install exited with code 1`
    )
    expect(t.deps.git.removeWorktree).not.toHaveBeenCalled()
    expect(t.deps.tmux.startTmux).not.toHaveBeenCalled()
    expect(t.orch.setupProgress(TARGET)).toMatchObject({
      state: 'failed',
      error: 'npm install exited with code 1',
      lines: failing.lines
    })
    await t.orch.flush()
    expect(t.saved().setupPending).toEqual([wt0])
    expect(t.saved().sessions).toEqual([])
  })

  it("saves a failed setup's last lines with the ticket's failure, with no repo", async () => {
    const t = await ready()
    t.deps.setup.run.mockResolvedValue(failing)
    await expect(t.orch.start('p1', KEY)).rejects.toThrow(SETUP_FAILED)
    await t.orch.flush()
    expect(t.saved().startFailures).toEqual([
      {
        projectId: 'p1',
        ticketKey: KEY,
        at: '2026-10-24T12:00:00.000Z',
        reason: `${SETUP_FAILED}: npm install exited with code 1`,
        repo: null,
        lines: failing.lines
      }
    ])
  })

  it("shows runSetup's reason when the command times out", async () => {
    const t = await ready()
    t.deps.setup.run.mockResolvedValue({ code: null, why: 'timed out after 10 minutes', lines: [] })
    await expect(t.orch.start('p1', KEY)).rejects.toThrow(
      `${SETUP_FAILED}: timed out after 10 minutes`
    )
  })

  it('starts anyway with setup false and forgets the pending setup', async () => {
    const t = await ready({ setupPending: [wt0] })
    t.deps.git.ensureWorktree.mockResolvedValue({ path: wt0, created: false })
    await t.orch.start('p1', KEY, [], undefined, undefined, undefined, false)
    expect(t.deps.setup.run).not.toHaveBeenCalled()
    expect(t.deps.tmux.startTmux).toHaveBeenCalled()
    await t.orch.flush()
    expect(t.saved().setupPending).toEqual([])
  })

  it('runs no setup for a Main checkout session or a resume', async () => {
    const wt = tempWorktree()
    const t = await ready({ sessions: [session({ state: 'finished', worktrees: [wt] })] })
    await t.orch.create('p1', 'octo/shop', false)
    await t.orch.resume('s1')
    expect(t.deps.setup.copy).not.toHaveBeenCalled()
    expect(t.deps.setup.run).not.toHaveBeenCalled()
  })

  it('runs each repo’s setup in repo order', async () => {
    const t = await ready({ projects: [withSetup(npm, { command: 'pnpm i' })] })
    await t.orch.start('p1', KEY, ['octo/shop-web'])
    expect(t.deps.setup.run.mock.calls.map((c) => c.slice(0, 2))).toEqual([
      [wt0, 'npm install'],
      [wt1, 'pnpm i']
    ])
  })

  it('stops at the first repo whose setup fails', async () => {
    const t = await ready({ projects: [withSetup(npm, { command: 'pnpm i' })] })
    t.deps.setup.run.mockResolvedValueOnce(failing)
    await expect(t.orch.start('p1', KEY, ['octo/shop-web'])).rejects.toThrow(SETUP_FAILED)
    expect(t.deps.setup.run).toHaveBeenCalledTimes(1)
    expect(t.deps.tmux.startTmux).not.toHaveBeenCalled()
  })

  it('throws SETUP_CANCELLED and clears the progress when cancelled during a run', async () => {
    const t = await ready()
    t.deps.setup.run.mockImplementation(
      (_cwd, _cmd, { signal }) =>
        new Promise((resolve) =>
          signal?.addEventListener('abort', () =>
            resolve({ code: null, why: 'cancelled', lines: [] })
          )
        )
    )
    const started = t.orch.start('p1', KEY)
    await vi.waitFor(() => expect(t.deps.setup.run).toHaveBeenCalled())
    await t.orch.cancelSetup(TARGET)
    await expect(started).rejects.toThrow(SETUP_CANCELLED)
    expect(t.orch.setupProgress(TARGET)).toBeNull()
    expect(t.deps.git.removeWorktree).not.toHaveBeenCalled()
  })

  it("doesn't save a cancelled setup as a failed start", async () => {
    const t = await ready()
    t.deps.setup.run.mockImplementation(
      (_cwd, _cmd, { signal }) =>
        new Promise((resolve) =>
          signal?.addEventListener('abort', () =>
            resolve({ code: null, why: 'cancelled', lines: [] })
          )
        )
    )
    const started = t.orch.start('p1', KEY)
    await vi.waitFor(() => expect(t.deps.setup.run).toHaveBeenCalled())
    await t.orch.cancelSetup(TARGET)
    await expect(started).rejects.toThrow(SETUP_CANCELLED)
    await t.orch.flush()
    expect(t.saved().startFailures).toEqual([])
  })

  it("names a new session's branch after its setup ID and refuses one that isn't a UUID", async () => {
    const t = await ready()
    await t.orch.create('p1', 'octo/shop', true, undefined, undefined, undefined, SETUP_ID)
    expect(t.deps.git.ensureWorktree).toHaveBeenCalledWith('/repos/shop', 'session-0a1b2c3d')
    expect(t.deps.setup.run).toHaveBeenCalled()
    await expect(
      t.orch.create('p1', 'octo/shop', true, undefined, undefined, undefined, 'nope')
    ).rejects.toThrow('Not a setup ID')
  })

  it('refuses a second Start anyway for the same setup ID while the first starts', async () => {
    const path = keptOrphan()
    const t = await ready({ setupPending: [path] }, keepOnLoad)
    t.deps.git.ensureWorktree.mockResolvedValue({ path, created: false })
    let finish: () => void = () => undefined
    t.deps.tmux.startTmux.mockReturnValueOnce(new Promise<void>((r) => (finish = r)))
    const create = (): Promise<string> =>
      t.orch.create('p1', 'octo/shop', true, undefined, undefined, undefined, SETUP_ID, false)
    const first = create()
    await expect(create()).rejects.toThrow('The session is already starting')
    await vi.waitFor(() => expect(t.deps.tmux.startTmux).toHaveBeenCalled())
    finish()
    await first
    expect(t.deps.tmux.startTmux).toHaveBeenCalledTimes(1)
    await expect(create()).rejects.toThrow('Another session uses session-0a1b2c3d')
  })

  it("keeps a new session's failed worktree until Cancel, which tries to remove it", async () => {
    const t = await ready()
    t.deps.setup.run.mockResolvedValue(failing)
    const path = '/repos/shop-wt.noindex/session-0a1b2c3d'
    await expect(
      t.orch.create('p1', 'octo/shop', true, undefined, undefined, undefined, SETUP_ID)
    ).rejects.toThrow(SETUP_FAILED)
    expect(t.deps.git.removeWorktree).not.toHaveBeenCalled()
    await t.orch.cancelSetup(SETUP_ID)
    expect(t.deps.git.removeWorktree).toHaveBeenCalledWith(path, ['/repos/shop'])
    expect(t.orch.setupProgress(SETUP_ID)).toBeNull()
    await t.orch.flush()
    expect(t.saved().setupPending).toEqual([])
  })

  it('starts a new session anyway in the kept worktree with setup false', async () => {
    const path = keptOrphan()
    const t = await ready({ setupPending: [path] }, keepOnLoad)
    t.deps.git.ensureWorktree.mockResolvedValue({ path, created: false })
    await t.orch.create('p1', 'octo/shop', true, undefined, undefined, undefined, SETUP_ID, false)
    expect(t.deps.setup.run).not.toHaveBeenCalled()
    expect(t.deps.tmux.startTmux).toHaveBeenCalled()
    await t.orch.flush()
    expect(t.saved().setupPending).toEqual([])
  })

  it('records a scheduled routine whose setup fails as skipped with its last lines, and tries to remove its worktree', async () => {
    const local = (day: number, h: number, m = 0, s = 0): Date => new Date(2026, 9, day, h, m, s)
    const t = setup({
      projects: [withSetup(npm)],
      routines: [
        {
          id: 'r1',
          projectId: 'p1',
          name: 'Dependency check',
          repo: 'octo/shop',
          worktree: true,
          message: 'Run npm outdated',
          schedule: { days: [0, 1, 2, 3, 4, 5, 6], time: '13:00' },
          scheduledThrough: local(24, 12, 59).toISOString()
        }
      ]
    })
    t.deps.setup.run.mockResolvedValue(failing)
    t.deps.now.mockReturnValue(local(24, 13, 0, 20))
    await t.orch.reconnect()
    await vi.waitFor(() => expect(t.saved().skippedRuns).toHaveLength(1))
    expect(t.saved().skippedRuns).toEqual([
      {
        routineId: 'r1',
        at: local(24, 13).toISOString(),
        reason: 'failed',
        error: `${SETUP_FAILED}: npm install exited with code 1\nb\nc\nd\ne\nnpm ERR! boom`
      }
    ])
    const [[path]] = t.deps.git.removeWorktree.mock.calls
    expect(path).toMatch(/^\/repos\/shop-wt\.noindex\/session-[0-9a-f]{8}$/)
    expect(t.deps.tmux.startTmux).not.toHaveBeenCalled()
    t.orch.stop()
  })

  it('marks every worktree that gets setup pending before the first runs, so a failure leaves the rest pending', async () => {
    const t = await ready({ projects: [withSetup(npm, { command: 'pnpm i' })] })
    t.deps.setup.run.mockResolvedValueOnce(failing)
    await expect(t.orch.start('p1', KEY, ['octo/shop-web'])).rejects.toThrow(SETUP_FAILED)
    await t.orch.flush()
    expect(t.saved().setupPending).toEqual([wt0, wt1])
    t.deps.git.ensureWorktree.mockImplementation(async (repo, branch) => ({
      path: `${repo}-wt.noindex/${branch}`,
      created: false
    }))
    t.deps.setup.run.mockClear()
    await t.orch.start('p1', KEY, ['octo/shop-web'])
    expect(t.deps.setup.run.mock.calls.map((c) => c[0])).toEqual([wt0, wt1])
  })

  it('stops a copy-only setup cancelled while it copies', async () => {
    const t = await ready({ projects: [withSetup({ copy: ['node_modules'] })] })
    let release = (): void => undefined
    t.deps.setup.copy.mockImplementation(
      () => new Promise((resolve) => (release = () => resolve([])))
    )
    const started = t.orch.start('p1', KEY)
    await vi.waitFor(() => expect(t.deps.setup.copy).toHaveBeenCalled())
    await t.orch.cancelSetup(TARGET)
    release()
    await expect(started).rejects.toThrow(SETUP_CANCELLED)
    expect(t.orch.setupProgress(TARGET)).toBeNull()
    expect(t.deps.tmux.startTmux).not.toHaveBeenCalled()
    expect(t.deps.board.setStatus).not.toHaveBeenCalled()
  })

  it('clears the progress when copying throws', async () => {
    const t = await ready()
    t.deps.setup.copy.mockRejectedValue(new Error('EACCES'))
    await expect(t.orch.start('p1', KEY)).rejects.toThrow('EACCES')
    expect(t.orch.setupProgress(TARGET)).toBeNull()
  })

  it('refuses a second setup for the same target while one runs', async () => {
    const t = await ready()
    let finish = (): void => undefined
    t.deps.setup.run.mockImplementationOnce(
      () => new Promise((resolve) => (finish = () => resolve({ code: 0, lines: [] })))
    )
    const first = t.orch.create('p1', 'octo/shop', true, undefined, undefined, undefined, SETUP_ID)
    await vi.waitFor(() => expect(t.deps.setup.run).toHaveBeenCalled())
    for (const choice of [undefined, false] as const)
      await expect(
        t.orch.create('p1', 'octo/shop', true, undefined, undefined, undefined, SETUP_ID, choice)
      ).rejects.toThrow('The session is already starting')
    finish()
    await first
  })

  it("refuses a new session's setup ID whose worktree a live session uses", async () => {
    const path = '/repos/shop-wt.noindex/session-0a1b2c3d'
    const t = await ready({
      sessions: [
        session({ ticketKey: undefined, name: 'x', branch: 'session-0a1b2c3d', worktrees: [path] })
      ]
    })
    t.deps.git.ensureWorktree.mockResolvedValue({ path, created: false })
    await expect(
      t.orch.create('p1', 'octo/shop', true, undefined, undefined, undefined, SETUP_ID)
    ).rejects.toThrow('Another session uses session-0a1b2c3d')
    expect(t.deps.setup.run).not.toHaveBeenCalled()
    expect(t.deps.git.removeWorktree).not.toHaveBeenCalled()
  })

  it("keeps a reused worktree that was set up when the new session's launch fails", async () => {
    const path = '/repos/shop-wt.noindex/session-0a1b2c3d'
    const t = await ready()
    t.deps.git.ensureWorktree.mockResolvedValue({ path, created: false })
    t.deps.tmux.startTmux.mockRejectedValue(new Error('tmux died'))
    await expect(
      t.orch.create('p1', 'octo/shop', true, undefined, undefined, undefined, SETUP_ID)
    ).rejects.toThrow('tmux died')
    expect(t.deps.git.removeWorktree).not.toHaveBeenCalled()
  })

  it('refuses to start once the project is removed during setup', async () => {
    const t = await ready()
    t.deps.setup.run.mockImplementation(async () => {
      await t.orch.removeProject('p1')
      return { code: 0, lines: [] }
    })
    await expect(t.orch.start('p1', KEY)).rejects.toThrow('Unknown project')
    expect(t.deps.tmux.startTmux).not.toHaveBeenCalled()
  })

  it('forgets a pending setup when its worktree is removed', async () => {
    const wt = tempWorktree()
    const t = setup({
      sessions: [session({ state: 'finished', worktrees: [wt] })],
      setupPending: [wt]
    })
    await t.orch.reconnect()
    await t.orch.removeWorktree('s1')
    await t.orch.flush()
    expect(t.saved().setupPending).toEqual([])
  })

  it('names a long or multi-line command as the setup command when it fails', async () => {
    const t = await ready({
      projects: [withSetup({ command: 'npm install && npm run build:everything:now' })]
    })
    t.deps.setup.run.mockResolvedValue({ code: 3, lines: [] })
    await expect(t.orch.start('p1', KEY)).rejects.toThrow(
      `${SETUP_FAILED}: the setup command exited with code 3`
    )
    const t2 = await ready({ projects: [withSetup({ command: 'npm i\nnpm t' })] })
    t2.deps.setup.run.mockResolvedValue({ code: 3, lines: [] })
    await expect(t2.orch.start('p1', KEY)).rejects.toThrow(
      `${SETUP_FAILED}: the setup command exited with code 3`
    )
  })

  it('redacts the failure reason and folds a private key block into one line', async () => {
    const t = await ready()
    const pushes: string[][] = []
    t.orch.onSetupProgress((_target, p) => p && pushes.push(p.lines))
    const key = [
      '-----BEGIN OPENSSH PRIVATE KEY-----',
      'b3BlbnNzaC1rZXktdjEAAAAA',
      '-----END OPENSSH PRIVATE KEY-----'
    ]
    t.deps.setup.run.mockImplementation(async (_cwd, _cmd, { onOutput }) => {
      for (const line of ['before', ...key, 'after']) onOutput?.(line)
      await new Promise((r) => setTimeout(r, 250))
      return { code: null, why: 'used ghp_abcdefghij0123456789', lines: ['x', ...key, 'y'] }
    })
    await expect(t.orch.start('p1', KEY)).rejects.toThrow(`${SETUP_FAILED}: used [redacted]`)
    expect(pushes).toContainEqual(['before', '[redacted]', 'after'])
    expect(t.orch.setupProgress(TARGET)).toMatchObject({
      error: 'used [redacted]',
      lines: ['x', '[redacted]', 'y']
    })
  })

  it('drops the end of a private key block cut off at the start of the kept lines', async () => {
    const t = await ready()
    t.deps.setup.run.mockResolvedValue({
      code: 1,
      lines: ['b3BlbnNzaC1rZXktdjEAAAAA', '-----END RSA PRIVATE KEY-----', 'y']
    })
    await expect(t.orch.start('p1', KEY)).rejects.toThrow(SETUP_FAILED)
    expect(t.orch.setupProgress(TARGET)?.lines).toEqual(['[redacted]', 'y'])
  })

  it('keeps the worktree pending when Start anyway fails to launch, so the next Start runs setup', async () => {
    const t = await ready()
    t.deps.setup.run.mockResolvedValueOnce(failing)
    await expect(t.orch.start('p1', KEY)).rejects.toThrow(SETUP_FAILED)
    t.deps.git.ensureWorktree.mockResolvedValue({ path: wt0, created: false })
    t.deps.tmux.startTmux.mockRejectedValueOnce(new Error('tmux died'))
    await expect(
      t.orch.start('p1', KEY, [], undefined, undefined, undefined, false)
    ).rejects.toThrow('tmux died')
    await t.orch.flush()
    expect(t.saved().setupPending).toEqual([wt0])
    t.deps.setup.run.mockClear()
    await t.orch.start('p1', KEY)
    expect(t.deps.setup.run).toHaveBeenCalledWith(wt0, 'npm install', expect.anything())
  })

  it("keeps a new session's worktree pending when Start anyway fails to launch and it can't be removed", async () => {
    const path = keptOrphan()
    const t = await ready({ setupPending: [path] }, keepOnLoad)
    t.deps.git.ensureWorktree.mockResolvedValue({ path, created: false })
    t.deps.git.removeWorktree.mockResolvedValue({ removed: false, reason: 'Uncommitted changes' })
    t.deps.tmux.startTmux.mockRejectedValueOnce(new Error('tmux died'))
    await expect(
      t.orch.create('p1', 'octo/shop', true, undefined, undefined, undefined, SETUP_ID, false)
    ).rejects.toThrow('tmux died')
    await t.orch.flush()
    expect(t.saved().setupPending).toEqual([path])
  })

  it('marks a created worktree pending as soon as it exists, before the other repos finish', async () => {
    const t = await ready({ projects: [withSetup(npm, { command: 'pnpm i' })] })
    let finish = (): void => undefined
    t.deps.git.ensureWorktree.mockImplementation(async (repo, branch) => {
      if (repo === '/repos/shop-web') await new Promise<void>((r) => (finish = r))
      return { path: `${repo}-wt.noindex/${branch}`, created: true }
    })
    const started = t.orch.start('p1', KEY, ['octo/shop-web'])
    await vi.waitFor(async () => {
      await t.orch.flush()
      expect(t.saved().setupPending).toEqual([wt0])
    })
    finish()
    await started
  })

  it('removes the created worktree when the project is removed during setup', async () => {
    const t = await ready()
    t.deps.setup.run.mockImplementation(async () => {
      await t.orch.removeProject('p1')
      return { code: 0, lines: [] }
    })
    await expect(t.orch.start('p1', KEY)).rejects.toThrow('Unknown project')
    expect(t.deps.git.removeWorktree).toHaveBeenCalledWith(wt0, expect.anything())
  })

  it("removes a new session's worktree when the project is removed during setup", async () => {
    const t = await ready()
    t.deps.setup.run.mockImplementation(async () => {
      await t.orch.removeProject('p1')
      return { code: 0, lines: [] }
    })
    await expect(
      t.orch.create('p1', 'octo/shop', true, undefined, undefined, undefined, SETUP_ID)
    ).rejects.toThrow('Unknown project')
    expect(t.deps.git.removeWorktree).toHaveBeenCalledWith(
      '/repos/shop-wt.noindex/session-0a1b2c3d',
      ['/repos/shop']
    )
  })

  it("removes a pending new-session worktree no session uses when it loads, and keeps a ticket's", async () => {
    const orphan = keptOrphan()
    const gone = '/repos/shop-wt.noindex/session-22222222'
    const used = '/repos/shop-wt.noindex/session-11111111'
    const ticketWt = '/repos/shop-wt.noindex/147-dark-mode-toggle'
    const t = setup({
      projects: [withSetup(npm)],
      sessions: [
        session({ state: 'finished', ticketKey: undefined, name: 'x', worktrees: [used] })
      ],
      setupPending: [orphan, gone, used, ticketWt]
    })
    await t.orch.reconnect()
    expect(t.deps.git.removeWorktree.mock.calls).toEqual([
      [orphan, ['/repos/shop', '/repos/shop-web']]
    ])
    await t.orch.flush()
    expect(t.saved().setupPending).toEqual([used, ticketWt])
  })

  it('keeps the review findings in every save while it removes a pending worktree on load', async () => {
    const finding: Finding = {
      id: 'f1',
      sessionId: 's1',
      source: 'you',
      text: 'Off by one.',
      checked: true
    }
    const t = setup({
      projects: [withSetup(npm)],
      sessions: [session({ state: 'finished' })],
      findings: [finding],
      setupPending: ['/repos/shop-wt.noindex/session-0a1b2c3d']
    })
    await t.orch.reconnect()
    await t.orch.flush()
    expect(t.deps.store.save.mock.calls.map(([d]) => d.findings)).not.toContainEqual([])
    expect(t.saved().findings).toEqual([finding])
  })

  it('keeps a pending new-session worktree it could not remove when it loads, and logs why', async () => {
    const orphan = keptOrphan()
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const t = setup({ projects: [withSetup(npm)], setupPending: [orphan] })
    t.deps.git.removeWorktree.mockResolvedValue({ removed: false, reason: 'Uncommitted changes' })
    await t.orch.reconnect()
    await t.orch.flush()
    expect(t.saved().setupPending).toEqual([orphan])
    expect(error).toHaveBeenCalledWith(
      `Sandtable could not remove the leftover worktree ${orphan}`,
      new Error('Uncommitted changes')
    )
  })

  describe('saving a project', () => {
    it('refuses a path git tracks', async () => {
      const t = setup()
      await t.orch.reconnect()
      t.deps.setup.problem.mockResolvedValue('git tracks it')
      await expect(t.orch.saveProject(withSetup({ copy: ['.env'] }))).rejects.toThrow(
        "Can't copy .env: git tracks it. Only paths git ignores can be copied."
      )
      expect(t.deps.setup.problem).toHaveBeenCalledWith('/repos/shop', '.env')
    })

    it('checks only the copy paths of a repo whose list or folder changed', async () => {
      const t = setup({
        projects: [withSetup({ copy: ['.env'] }, { copy: ['.env'] })],
        folders: {
          '/repos/shop-moved': ['octo/shop'],
          '/repos/shop-web': ['octo/shop-web']
        }
      })
      await t.orch.reconnect()
      const saved = withSetup({ copy: ['.env'] }, { copy: ['.env', '.npmrc'] })
      await t.orch.saveProject({
        ...saved,
        repos: saved.repos.map((r, i) => (i === 0 ? { ...r, path: '/repos/shop-moved' } : r))
      })
      expect(t.deps.setup.problem.mock.calls).toEqual([
        ['/repos/shop-moved', '.env'],
        ['/repos/shop-web', '.env'],
        ['/repos/shop-web', '.npmrc']
      ])
      t.deps.setup.problem.mockClear()
      await t.orch.saveProject({ ...(await t.orch.listProjects())[0], name: 'Renamed' })
      expect(t.deps.setup.problem).not.toHaveBeenCalled()
    })

    it("asks for a repo's folder before checking its copy paths", async () => {
      const t = setup({ folders: { '/repos/shop-web': ['octo/shop-web'] } })
      await t.orch.reconnect()
      await expect(t.orch.saveProject(withSetup({ copy: ['.env'] }))).rejects.toThrow(
        'Choose a folder for octo/shop before setting its worktree setup'
      )
      expect(t.deps.setup.problem).not.toHaveBeenCalled()
    })

    it.each([
      [{ copy: ['/etc/hosts'] }, "Can't copy /etc/hosts: use a path inside the repo"],
      [{ copy: ['a/../b'] }, "Can't copy a/../b: use a path inside the repo"],
      [{ copy: ['.env', '.env'] }, '.env is listed twice'],
      [{ copy: Array.from({ length: 21 }, (_, i) => `f${i}`) }, 'at most 20'],
      [{ command: 'npm i\0rm' }, 'Not a setup command'],
      [{ command: 'x'.repeat(1001) }, 'Shorten the setup command'],
      ['npm i', 'Not a worktree setup']
    ])('refuses %j', async (bad, message) => {
      const t = setup()
      await t.orch.reconnect()
      await expect(t.orch.saveProject(withSetup(bad as ProjectRepo['setup']))).rejects.toThrow(
        message
      )
    })

    it('saves a trimmed command, and drops a blank command and an empty copy list', async () => {
      const t = setup()
      await t.orch.reconnect()
      await t.orch.saveProject(
        withSetup({ copy: [], command: '  npm install\n' }, { copy: [], command: '  ' })
      )
      const [main, front] = (await t.orch.listProjects())[0].repos
      expect(main.setup).toEqual({ command: 'npm install' })
      expect(front).not.toHaveProperty('setup')
    })
  })

  describe('suggestion', () => {
    const suggested = { copy: ['.env'], command: 'npm install' }

    it('suggests a setup for a folder from the main checkout', async () => {
      const t = await ready()
      t.deps.setup.suggest.mockResolvedValue(suggested)
      expect(await t.orch.suggestSetup('/repos/other')).toEqual(suggested)
      expect(t.deps.setup.suggest).toHaveBeenCalledWith('/repos/other')
    })

    it('hints only for a repo with no setup, until Not now, which is kept', async () => {
      const t = await ready()
      t.deps.setup.suggest.mockResolvedValue(suggested)
      expect(await t.orch.setupHint('p1', 'octo/shop')).toBeNull()
      expect(await t.orch.setupHint('p1', 'octo/shop-web')).toEqual(suggested)
      expect(t.deps.setup.suggest).toHaveBeenCalledWith('/repos/shop-web')
      await t.orch.hideSetupHint('p1', 'octo/shop-web')
      expect(await t.orch.setupHint('p1', 'octo/shop-web')).toBeNull()
      expect(t.saved().setupHintsOff).toEqual(['p1\nocto/shop-web'])
      const again = setup({ projects: [withSetup(npm)], setupPending: [] })
      again.deps.store.load.mockResolvedValue(structuredClone(t.saved()))
      await again.orch.reconnect()
      again.deps.setup.suggest.mockResolvedValue(suggested)
      expect(await again.orch.setupHint('p1', 'octo/shop-web')).toBeNull()
    })

    it('forgets Not now for a removed project and refuses an unknown repo', async () => {
      const t = await ready()
      await t.orch.hideSetupHint('p1', 'octo/shop-web')
      await expect(t.orch.hideSetupHint('p1', 'octo/nope')).rejects.toThrow()
      await t.orch.removeProject('p1')
      expect(t.saved().setupHintsOff).toEqual([])
    })
  })
})

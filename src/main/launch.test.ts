import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { project, session, setup } from './test/orchestrator'

vi.mock('./env/tools', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./env/tools')>()),
  stopChildren: vi.fn()
}))

beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }))
afterEach(() => {
  vi.useRealTimers()
})

describe('launch', () => {
  it('resume of a removed worktree says to use Start', async () => {
    const t = setup({
      sessions: [session({ state: 'finished', removedAt: '2026-10-24T11:00:00.000Z' })]
    })
    await t.orch.reconnect()
    await expect(t.orch.resume('s1')).rejects.toThrow('The worktree was removed; use Start')
    t.orch.stop()
  })

  it("start records the project's model and effort", async () => {
    const t = setup({ projects: [{ ...project, model: 'opus', effort: 'high' }] })
    await t.orch.reconnect()
    await t.orch.sync('p1')
    await t.orch.start('p1', 'octo/shop#147')
    const [s] = (await t.orch.getBoard('p1')).sessions
    expect(s).toMatchObject({ model: 'opus', effort: 'high' })
    const [, , cmd] = t.deps.tmux.startTmux.mock.calls[0]
    expect(cmd[cmd.indexOf('--model') + 1]).toBe('opus')
    t.orch.stop()
  })

  it('a session that exits right after starting says so', async () => {
    const t = setup()
    await t.orch.reconnect()
    await t.orch.sync('p1')
    await t.orch.start('p1', 'octo/shop#147')
    t.deps.now.mockReturnValue(new Date('2026-10-24T12:00:05.000Z'))
    t.live.clear()
    await vi.advanceTimersByTimeAsync(3000)
    const [s] = (await t.orch.getBoard('p1')).sessions
    expect(s.startWarning).toBe(
      "Claude exited right after it started. Run claude in the session's folder to see why."
    )
    t.orch.stop()
  })
})

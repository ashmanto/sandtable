import { existsSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelUsage, SessionRecord } from '../../shared/types'
import {
  inputOf,
  runTranscript,
  project,
  session,
  settle,
  setup,
  tempDir,
  opusLine,
  writeTranscript
} from '../test/orchestrator'
import { keepCached, transcriptTotals, weeklyUsage } from './usage'
import { mergeUsage } from '../../shared/pricing'

vi.mock('../env/tools', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../env/tools')>()),
  stopChildren: vi.fn()
}))

vi.mock('./usage', async (importOriginal) => {
  const real = await importOriginal<typeof import('./usage')>()
  return {
    ...real,
    transcriptTotals: vi.fn(real.transcriptTotals),
    weeklyUsage: vi.fn(real.weeklyUsage),
    keepCached: vi.fn(real.keepCached)
  }
})

beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }))
afterEach(() => {
  vi.useRealTimers()
})

describe('live usage and the token cap', () => {
  const ownTranscript = (claudeDir: string, input: number): void =>
    writeTranscript(join(claudeDir, 'projects', 'x', 's1.jsonl'), opusLine('a', input))
  const capFile = (t: ReturnType<typeof setup>): string => join(t.dataDir, 'settings', 's1.capped')
  const capped = async (
    over: Partial<SessionRecord> = {},
    tokenCap: number | null = 10e6
  ): Promise<ReturnType<typeof setup>> => {
    const t = setup({
      projects: [tokenCap === null ? project : { ...project, tokenCap }],
      sessions: [session(over)]
    })
    t.live.add('st-p1-octo-shop-147')
    ownTranscript(t.claudeDir, 10e6 + 1)
    await t.orch.reconnect()
    await t.orch.sync('p1')
    await vi.advanceTimersByTimeAsync(3000)
    await vi.waitFor(() => expect(t.orch.liveUsage().s1).toBeDefined())
    await settle()
    return t
  }
  const inputs = (usage: Record<string, ModelUsage[]>): Record<string, number> =>
    Object.fromEntries(
      Object.entries(usage).map(([id, rows]) => [id, rows.reduce((n, u) => n + u.input, 0)])
    )

  it("pushes live sessions' usage when it changes, and drops a session once it finishes", async () => {
    const t = setup({ sessions: [session()] })
    t.live.add('st-p1-octo-shop-147')
    ownTranscript(t.claudeDir, 5)
    const pushed = vi.fn()
    t.orch.onLiveUsage(pushed)
    await t.orch.reconnect()
    await vi.advanceTimersByTimeAsync(3000)
    await vi.waitFor(() => expect(pushed).toHaveBeenCalledTimes(1))
    expect(inputs(pushed.mock.calls[0][0])).toEqual({ s1: 5 })
    expect(t.orch.liveUsage()).toEqual(pushed.mock.calls[0][0])
    await vi.advanceTimersByTimeAsync(3000)
    expect(pushed).toHaveBeenCalledTimes(1)
    t.live.clear()
    await vi.waitFor(async () => {
      await vi.advanceTimersByTimeAsync(3000)
      expect(pushed).toHaveBeenLastCalledWith({})
    })
    expect(t.orch.liveUsage()).toEqual({})
    t.orch.stop()
  })

  it("counts only a live session's own conversations and their subagents", async () => {
    const t = setup({ sessions: [session()] })
    t.live.add('st-p1-octo-shop-147')
    const folder = join(t.claudeDir, 'projects', 'x')
    ownTranscript(t.claudeDir, 1)
    writeTranscript(join(folder, 's1', 'subagents', 'agent-x.jsonl'), opusLine('b', 10))
    writeTranscript(join(folder, 'earlier.jsonl'), opusLine('c', 100))
    await t.orch.reconnect()
    await vi.advanceTimersByTimeAsync(3000)
    await vi.waitFor(() => expect(inputs(t.orch.liveUsage())).toEqual({ s1: 11 }))
    t.orch.stop()
  })

  it('stops a session past its project cap, shows Needs you, and notifies once', async () => {
    const t = await capped()
    expect(existsSync(capFile(t))).toBe(true)
    expect((await t.orch.getBoard('p1')).sessions[0].state).toBe('needsYou')
    expect(t.saved().sessions[0].capped).toBe(true)
    expect(t.deps.notify).toHaveBeenCalledTimes(1)
    expect(t.deps.notify.mock.calls[0].slice(0, 2)).toEqual([
      'Needs you: shop#147',
      'Reached its token cap'
    ])
    t.emit('s1', 'running')
    await vi.advanceTimersByTimeAsync(3000)
    await settle()
    expect((await t.orch.getBoard('p1')).sessions[0].state).toBe('needsYou')
    expect(t.deps.notify).toHaveBeenCalledTimes(1)
    t.orch.stop()
  })

  it('notifies at the cap when the session already needs you', async () => {
    const t = await capped({ state: 'needsYou' })
    expect(t.deps.notify).toHaveBeenCalledTimes(1)
    expect(t.deps.notify.mock.calls[0][1]).toBe('Reached its token cap')
    t.orch.stop()
  })

  it("doesn't stop a session when its project has no cap", async () => {
    const t = await capped({}, null)
    expect(existsSync(capFile(t))).toBe(false)
    expect((await t.orch.getBoard('p1')).sessions[0].state).toBe('running')
    expect(t.deps.notify).not.toHaveBeenCalled()
    t.orch.stop()
  })

  it('lifts the cap once the project turns it off', async () => {
    const t = await capped()
    await t.orch.saveProject(project)
    await vi.advanceTimersByTimeAsync(3000)
    await vi.waitFor(() => expect(existsSync(capFile(t))).toBe(false))
    expect(t.saved().sessions[0].capped).toBeUndefined()
    t.orch.stop()
  })

  it('shows a capped routine run as Needs you, not Done', async () => {
    const t = await capped({ ticketKey: undefined, name: 'Nightly', routineId: 'r1' })
    t.emit('s1', 'needsYou')
    await settle()
    expect((await t.orch.getBoard('p1')).sessions[0].state).toBe('needsYou')
    expect(t.deps.notify.mock.calls[0].slice(0, 2)).toEqual([
      'Needs you: Nightly',
      'Reached its token cap'
    ])
    t.orch.stop()
  })

  it("raises a capped session's cap a project cap above its use and lets it run on", async () => {
    const t = await capped()
    await t.orch.raiseCap('s1')
    expect(existsSync(capFile(t))).toBe(false)
    expect(t.saved().sessions[0]).toMatchObject({ tokenCap: 20e6 + 1 })
    expect(t.saved().sessions[0].capped).toBeUndefined()
    expect((await t.orch.getBoard('p1')).sessions[0].state).toBe('needsYou')
    await vi.advanceTimersByTimeAsync(3000)
    await settle()
    expect(existsSync(capFile(t))).toBe(false)
    t.orch.stop()
  })

  it('saves only a token cap the select offers', async () => {
    const t = setup()
    await t.orch.reconnect()
    await expect(t.orch.saveProject({ ...project, tokenCap: 12345 })).rejects.toThrow(
      'Not a token cap'
    )
    await t.orch.saveProject({ ...project, tokenCap: 25e6 })
    expect(t.saved().projects[0].tokenCap).toBe(25e6)
  })

  it("refuses to raise the cap of a session that isn't capped", async () => {
    const t = await capped({}, null)
    await expect(t.orch.raiseCap('s1')).rejects.toThrow('Session is not capped')
    t.orch.stop()
  })
})

describe('usage', () => {
  const key = 'octo/shop#147'

  it("adds up every transcript in the folders of the ticket's sessions, subagents included", async () => {
    const t = setup({
      sessions: [session(), session({ id: 's9', ticketKey: 'octo/shop#30' })]
    })
    await t.orch.reconnect()
    const folder = join(t.claudeDir, 'projects', '-repos-shop-wt-noindex-147')
    writeTranscript(join(folder, 's1.jsonl'), [opusLine('a', 1), opusLine('a', 1)].join('\n'))
    writeTranscript(join(folder, 's1', 'subagents', 'agent-x.jsonl'), opusLine('b', 10))
    writeTranscript(join(folder, 'cleared.jsonl'), opusLine('c', 100))
    writeTranscript(join(t.claudeDir, 'projects', 'other', 's9.jsonl'), opusLine('d', 1000))
    expect((await t.orch.usage('p1', key)).usage).toEqual([
      {
        model: 'claude-opus-5-5',
        name: 'Opus 5.5',
        input: 111,
        output: 0,
        cacheWrite: 0,
        cacheRead: 0,
        price: expect.closeTo(0.000444, 9)
      }
    ])
  })

  it("adds up the working time of the ticket's sessions only", async () => {
    const t = setup({
      sessions: [session(), session({ id: 's9', ticketKey: 'octo/shop#30' })]
    })
    await t.orch.reconnect()
    const turn = (uuid: string, durationMs: number): string =>
      JSON.stringify({ type: 'system', subtype: 'turn_duration', durationMs, uuid })
    const folder = join(t.claudeDir, 'projects', '-repos-shop-wt-noindex-147')
    writeTranscript(join(folder, 's1.jsonl'), [turn('t1', 1000), turn('t2', 500)].join('\n'))
    writeTranscript(join(t.claudeDir, 'projects', 'other', 's9.jsonl'), turn('t3', 9000))
    expect((await t.orch.usage('p1', key)).workMs).toBe(1500)
  })

  it('returns nothing for a ticket with no sessions or runs', async () => {
    const t = setup()
    await t.orch.reconnect()
    expect(await t.orch.usage('p1', key)).toEqual({ usage: [], workMs: 0 })
  })

  it('throws for an unknown project', async () => {
    const t = setup()
    await t.orch.reconnect()
    await expect(t.orch.usage('nope', key)).rejects.toThrow('Unknown project')
  })

  it("reads sessions and runs from the project's own account", async () => {
    const work = tempDir('st-work-')
    const t = setup({
      accounts: [{ name: 'Work', dir: work }],
      projects: [{ ...project, claudeDir: work }],
      sessions: [session({ claudeDir: work })]
    })
    await t.orch.reconnect()
    await t.orch.sync('p1')
    writeTranscript(join(work, 'projects', 'wt', 's1.jsonl'), opusLine('a', 1))
    writeTranscript(join(t.claudeDir, 'projects', 'wt', 's1.jsonl'), opusLine('x', 1000))
    const print = t.deps.claude.print.getMockImplementation()!
    t.deps.claude.print.mockImplementationOnce(async (cwd, args, env) => {
      runTranscript(work, args, 10)
      return print(cwd, args, env)
    })
    await t.orch.triage('p1', key)
    expect(t.saved().runs[0].claudeDir).toBe(work)
    expect(await inputOf(t, key)).toBe(11)
  })

  it('counts a triage run by the session ID it records before running claude, until the project is removed', async () => {
    const t = setup()
    await t.orch.reconnect()
    await t.orch.sync('p1')
    const print = t.deps.claude.print.getMockImplementation()!
    t.deps.claude.print.mockImplementationOnce(async (cwd, args, env) => {
      expect(t.saved().runs).toEqual([
        { projectId: 'p1', ticketKey: key, claudeDir: t.claudeDir, id: expect.any(String) }
      ])
      runTranscript(t.claudeDir, args, 5)
      return print(cwd, args, env)
    })
    await t.orch.triage('p1', key)
    expect(await inputOf(t, key)).toBe(5)
    await t.orch.removeProject('p1')
    expect(t.saved().runs).toEqual([])
  })

  it('runs one lookup at a time', async () => {
    const t = setup()
    await t.orch.reconnect()
    vi.mocked(transcriptTotals).mockClear()
    let release = (): void => undefined
    vi.mocked(transcriptTotals).mockImplementationOnce(
      () => new Promise((r) => (release = () => r({ usage: [], workMs: 0 })))
    )
    const both = Promise.all([t.orch.usage('p1', key), t.orch.usage('p1', key)])
    await settle()
    expect(transcriptTotals).toHaveBeenCalledTimes(1)
    release()
    await both
    expect(transcriptTotals).toHaveBeenCalledTimes(2)
  })

  it("doesn't follow symlinked folders in a session's transcript folder", async () => {
    const t = setup({ sessions: [session()] })
    await t.orch.reconnect()
    const folder = join(t.claudeDir, 'projects', '-repos-shop-wt-noindex-147')
    writeTranscript(join(folder, 's1.jsonl'), opusLine('a', 1))
    writeTranscript(join(t.claudeDir, 'elsewhere', 'x.jsonl'), opusLine('b', 10))
    symlinkSync(join(t.claudeDir, 'elsewhere'), join(folder, 'linked'))
    symlinkSync(folder, join(folder, 'loop'))
    expect(await inputOf(t, key)).toBe(1)
  })

  it('looks up a run without a transcript again only while it runs', async () => {
    const t = setup()
    await t.orch.reconnect()
    await t.orch.sync('p1')
    const print = t.deps.claude.print.getMockImplementation()!
    t.deps.claude.print.mockImplementationOnce(async (cwd, args, env) => {
      expect(await inputOf(t, key)).toBe(0)
      runTranscript(t.claudeDir, args, 5)
      expect(await inputOf(t, key)).toBe(5)
      return print(cwd, args, env)
    })
    await t.orch.triage('p1', key)
    await t.orch.triage('p1', key)
    expect(await inputOf(t, key)).toBe(5)
    const missed = t.saved().runs[1].id
    writeTranscript(join(t.claudeDir, 'projects', 'runs', `${missed}.jsonl`), opusLine('late', 7))
    expect(await inputOf(t, key)).toBe(5)
  })

  it("doesn't record a run for a project removed while the run was getting ready", async () => {
    const t = setup()
    await t.orch.reconnect()
    await t.orch.sync('p1')
    let release = (): void => undefined
    t.deps.areas.list.mockImplementationOnce(() => new Promise((r) => (release = () => r([]))))
    const triage = t.orch.triage('p1', key)
    await settle()
    await t.orch.removeProject('p1')
    release()
    await expect(triage).rejects.toThrow('Unknown project')
    expect(t.saved().runs).toEqual([])
    expect(t.deps.claude.print).not.toHaveBeenCalled()
  })

  it("forgets a run whose save failed and doesn't run claude", async () => {
    const t = setup()
    await t.orch.reconnect()
    await t.orch.sync('p1')
    t.deps.store.save.mockRejectedValueOnce(new Error('disk full'))
    await expect(t.orch.triage('p1', key)).rejects.toThrow('disk full')
    expect(t.deps.claude.print).not.toHaveBeenCalled()
    await t.orch.triage('p1', key)
    expect(t.saved().runs).toHaveLength(1)
  })

  it('records a failed run too, since it spent tokens', async () => {
    const t = setup()
    await t.orch.reconnect()
    await t.orch.sync('p1')
    t.deps.claude.print.mockResolvedValueOnce({ stdout: '', stderr: 'boom', code: 1 })
    await expect(t.orch.triage('p1', key)).rejects.toThrow('Triage failed: boom')
    expect(t.saved().runs).toHaveLength(1)
  })
})

describe('usageByWeek', () => {
  const lastWeek = new Date(2026, 9, 21, 9)
  const thisWeek = new Date(2026, 9, 26, 9)
  const weeks = async (t: ReturnType<typeof setup>): Promise<unknown> =>
    (await t.orch.usageByWeek()).projects.map((p) => ({
      projectId: p.projectId,
      weeks: p.weeks.map((w) => [w.week, w.usage.reduce((sum, u) => sum + u.input, 0)])
    }))

  it("counts a project's ticketless sessions and runs by week, leaving out projects without use", async () => {
    const t = setup({
      projects: [project, { ...project, id: 'p2', name: 'Other' }],
      sessions: [
        session({ id: 's2', ticketKey: undefined, worktrees: ['/repos/shop-wt.noindex/x'] })
      ]
    })
    await t.orch.reconnect()
    await t.orch.sync('p1')
    writeTranscript(join(t.claudeDir, 'projects', 'wt', 's2.jsonl'), opusLine('a', 1, lastWeek))
    const print = t.deps.claude.print.getMockImplementation()!
    t.deps.claude.print.mockImplementationOnce(async (cwd, args, env) => {
      runTranscript(t.claudeDir, args, 10)
      return print(cwd, args, env)
    })
    await t.orch.triage('p1', 'octo/shop#147')
    const run = t.saved().runs[0].id
    utimesSync(join(t.claudeDir, 'projects', 'runs', `${run}.jsonl`), thisWeek, thisWeek)
    expect(await weeks(t)).toEqual([
      {
        projectId: 'p1',
        weeks: [
          ['2026-10-26', 10],
          ['2026-10-19', 1]
        ]
      }
    ])
  })

  it("counts only a checkout session's own conversations and their subagents", async () => {
    const events = join(tempDir('st-events-'), 's3.jsonl')
    writeFileSync(
      events,
      JSON.stringify({ hook_event_name: 'SessionStart', source: 'clear', session_id: 'c2' })
    )
    const t = setup({
      sessions: [
        session({
          id: 's3',
          ticketKey: undefined,
          branch: undefined,
          worktrees: [],
          checkout: '/repos/shop',
          eventsFile: events
        })
      ]
    })
    await t.orch.reconnect()
    const folder = join(t.claudeDir, 'projects', '-repos-shop')
    writeTranscript(join(folder, 's3.jsonl'), opusLine('a', 1, thisWeek))
    writeTranscript(join(folder, 's3', 'subagents', 'agent-x.jsonl'), opusLine('b', 10, thisWeek))
    writeTranscript(join(folder, 'c2.jsonl'), opusLine('c', 100, thisWeek))
    writeTranscript(join(folder, 'mine.jsonl'), opusLine('d', 1000, thisWeek))
    expect(await weeks(t)).toEqual([{ projectId: 'p1', weeks: [['2026-10-26', 111]] }])
  })

  it("equals the sum of the project's ticket usage and its ticketless sessions", async () => {
    const other = 'octo/shop#30'
    const t = setup({
      sessions: [
        session(),
        session({ id: 's9', ticketKey: other, worktrees: ['/repos/shop-wt.noindex/30'] }),
        session({ id: 's2', ticketKey: undefined, worktrees: ['/repos/shop-wt.noindex/x'] })
      ]
    })
    await t.orch.reconnect()
    await t.orch.sync('p1')
    writeTranscript(
      join(t.claudeDir, 'projects', 'a', 's1.jsonl'),
      [opusLine('a', 1, lastWeek), opusLine('b', 10, thisWeek)].join('\n')
    )
    writeTranscript(join(t.claudeDir, 'projects', 'b', 's9.jsonl'), opusLine('c', 100, thisWeek))
    writeTranscript(join(t.claudeDir, 'projects', 'x', 's2.jsonl'), opusLine('d', 1000, thisWeek))
    const print = t.deps.claude.print.getMockImplementation()!
    t.deps.claude.print.mockImplementationOnce(async (cwd, args, env) => {
      runTranscript(t.claudeDir, args, 10000)
      return print(cwd, args, env)
    })
    await t.orch.triage('p1', 'octo/shop#147')
    const {
      projects: [{ weeks: byWeek }]
    } = await t.orch.usageByWeek()
    const [project] = mergeUsage(byWeek.flatMap((w) => w.usage))
    const [tickets] = mergeUsage([
      ...(await t.orch.usage('p1', 'octo/shop#147')).usage,
      ...(await t.orch.usage('p1', other)).usage
    ])
    expect(tickets.input).toBe(10111)
    expect(project).toEqual({
      ...tickets,
      input: tickets.input + 1000,
      price: expect.closeTo(tickets.price! * (11111 / 10111), 12)
    })
  })

  it('counts a worktree two projects share in each project but once in all projects', async () => {
    const wt = '/repos/shop-wt.noindex/147-dark-mode-toggle'
    const t = setup({
      projects: [project, { ...project, id: 'p2', name: 'Other' }],
      sessions: [
        session({ worktrees: [wt] }),
        session({ id: 's2', projectId: 'p2', worktrees: [wt] })
      ]
    })
    await t.orch.reconnect()
    const folder = join(t.claudeDir, 'projects', '-repos-shop-wt-noindex-147')
    writeTranscript(join(folder, 's1.jsonl'), opusLine('a', 1, thisWeek))
    writeTranscript(join(folder, 's2.jsonl'), opusLine('b', 10, thisWeek))
    const { all } = await t.orch.usageByWeek()
    expect(await weeks(t)).toEqual([
      { projectId: 'p1', weeks: [['2026-10-26', 11]] },
      { projectId: 'p2', weeks: [['2026-10-26', 11]] }
    ])
    expect(all.map((w) => [w.week, w.usage.reduce((sum, u) => sum + u.input, 0)])).toEqual([
      ['2026-10-26', 11]
    ])
  })

  it('keeps only the transcripts it scanned in the usage cache', async () => {
    const wt = '/repos/shop-wt.noindex/147-dark-mode-toggle'
    const t = setup({ sessions: [session({ worktrees: [wt] })] })
    await t.orch.reconnect()
    const folder = join(t.claudeDir, 'projects', '-repos-shop-wt-noindex-147')
    writeTranscript(join(folder, 's1.jsonl'), opusLine('a', 1, thisWeek))
    writeTranscript(join(folder, 'other.jsonl'), opusLine('b', 10, thisWeek))
    vi.mocked(keepCached).mockClear()
    await t.orch.usageByWeek()
    expect(vi.mocked(keepCached).mock.calls).toEqual([
      [new Set([join(folder, 's1.jsonl'), join(folder, 'other.jsonl')])]
    ])
  })

  it('lists each merge once across projects, from its first Start, with its sessions’ Needs you and usage', async () => {
    const mergedAt = '2026-10-25T00:00:00Z'
    const earlier = '2026-10-20T00:00:00Z'
    const t = setup({
      projects: [project, { ...project, id: 'p2', name: 'Other' }],
      sessions: [
        session({ eventsFile: '/data/events/s1.jsonl', mergedAt }),
        session({
          id: 's6',
          projectId: 'p2',
          startedAt: '2026-10-23T00:00:00.000Z',
          eventsFile: '/data/events/s6.jsonl',
          removedAt: '2026-10-25T01:00:00.000Z',
          mergedAt
        }),
        session({
          id: 's7',
          startedAt: '2026-10-19T00:00:00.000Z',
          worktrees: ['/repos/shop-wt.noindex/147-b'],
          eventsFile: '/data/events/s7.jsonl',
          mergedAt: earlier
        }),
        session({
          id: 's8',
          startedAt: '2026-10-26T00:00:00.000Z',
          worktrees: ['/repos/shop-wt.noindex/147-c']
        }),
        session({
          id: 's5',
          ticketKey: 'octo/shop#30',
          worktrees: ['/repos/shop-wt.noindex/30']
        }),
        session({ id: 's9', projectId: 'gone', mergedAt })
      ]
    })
    t.deps.events.countNeedsYou.mockImplementation(async (file) =>
      file.endsWith('s1.jsonl') ? 3 : 2
    )
    await t.orch.reconnect()
    await t.orch.sync('p1')
    writeTranscript(join(t.claudeDir, 'projects', 'a', 's1.jsonl'), opusLine('a', 7, thisWeek))
    writeTranscript(join(t.claudeDir, 'projects', 'a', 's6.jsonl'), opusLine('b', 10, thisWeek))
    writeTranscript(join(t.claudeDir, 'projects', 'b', 's7.jsonl'), opusLine('c', 1, thisWeek))
    writeTranscript(join(t.claudeDir, 'projects', 'c', 's8.jsonl'), opusLine('d', 100, thisWeek))
    const print = t.deps.claude.print.getMockImplementation()!
    t.deps.claude.print.mockImplementationOnce(async (cwd, args, env) => {
      runTranscript(t.claudeDir, args, 1000)
      return print(cwd, args, env)
    })
    await t.orch.triage('p1', 'octo/shop#147')
    const { merged } = await t.orch.usageByWeek()
    expect(merged).toEqual([
      {
        projectIds: ['p1', 'p2'],
        ticketKey: 'octo/shop#147',
        startedAt: '2026-10-23T00:00:00.000Z',
        mergedAt,
        needsYou: 5,
        usage: [expect.objectContaining({ input: 1017 })]
      },
      {
        projectIds: ['p1'],
        ticketKey: 'octo/shop#147',
        startedAt: '2026-10-19T00:00:00.000Z',
        mergedAt: earlier,
        needsYou: 2,
        usage: [expect.objectContaining({ input: 1 })]
      }
    ])
  })

  it('shares a scan in flight instead of queuing another', async () => {
    const t = setup()
    await t.orch.reconnect()
    vi.mocked(weeklyUsage).mockClear()
    let release = (): void => undefined
    vi.mocked(weeklyUsage).mockImplementationOnce(() => new Promise((r) => (release = () => r([]))))
    const first = t.orch.usageByWeek()
    await settle()
    expect(t.orch.usageByWeek()).toBe(first)
    release()
    await first
    expect(weeklyUsage).toHaveBeenCalledTimes(2)
    await t.orch.usageByWeek()
    expect(weeklyUsage).toHaveBeenCalledTimes(4)
  })

  it("remembers a finished session's missing transcript until it resumes, but not a live one's", async () => {
    const wt = tempDir('st-wt-')
    const t = setup({
      sessions: [
        session({ state: 'finished', worktrees: [wt] }),
        session({
          id: 's2',
          ticketKey: 'octo/shop#30',
          tmuxName: 'st-p1-octo-shop-30',
          worktrees: ['/repos/shop-wt.noindex/30']
        })
      ]
    })
    t.deps.tmux.hasTmux.mockResolvedValueOnce(true)
    await t.orch.reconnect()
    expect(await weeks(t)).toEqual([])
    writeTranscript(join(t.claudeDir, 'projects', 'a', 's1.jsonl'), opusLine('a', 1, thisWeek))
    writeTranscript(join(t.claudeDir, 'projects', 'b', 's2.jsonl'), opusLine('b', 10, thisWeek))
    expect(await weeks(t)).toEqual([{ projectId: 'p1', weeks: [['2026-10-26', 10]] }])
    await t.orch.resume('s1')
    expect(await weeks(t)).toEqual([{ projectId: 'p1', weeks: [['2026-10-26', 11]] }])
  })
})

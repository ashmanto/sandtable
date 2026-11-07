import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { ChatState, ConversationEntry, SessionRecord, Ticket } from '../../shared/types'
import { statusMapOf } from '../../shared/columns'
import { project, session, setup, ticket } from '../test/orchestrator'
import type { CliHandler } from './cli'
import { createCliCommands, resolveTicket, stateWord } from './cliCommands'

const other = ticket({ key: 'octo/shop-web#12', number: 12, repo: 'octo/shop-web' })
const tracker = ticket({ key: 'APP-12', number: 12 })
const caller = session({ id: 'c1', ticketKey: 'octo/shop#1' })
const target = ticket({ key: 'octo/shop#12', number: 12, title: 'Target' })

const make = (
  sessions: SessionRecord[],
  tickets: Ticket[],
  extra: {
    transcript?: ConversationEntry[] | null
    chat?: ChatState['chat']
    pending?: () => boolean
    busy?: () => boolean
    listeners?: Set<(projectId: string) => void>
    starts?: Partial<StartFakes>
  } = {}
): CliHandler =>
  createCliCommands({
    sessions: () => sessions,
    synced: new Map([['p1', { tickets }]]),
    projectById: () => project,
    statusMapOf,
    transcriptOf: async () => extra.transcript ?? null,
    chat: async () => ({ chat: extra.chat ?? null, answering: false }),
    pending: extra.pending ?? (() => false),
    busy: extra.busy ?? (() => false),
    onChange: (cb) => {
      const set = extra.listeners ?? new Set()
      set.add(cb)
      return () => set.delete(cb)
    },
    ...fakes(),
    ...extra.starts
  }).run

type StartCtx = Pick<
  Parameters<typeof createCliCommands>[0],
  'checkStart' | 'checkReady' | 'overlap' | 'start' | 'resume'
>
type StartFakes = { [K in keyof StartCtx]: Mock<StartCtx[K]> }
const fakes = (): StartFakes => ({
  checkStart: vi.fn<StartCtx['checkStart']>(async () => ({
    triage: false,
    problems: [],
    overlap: [],
    ready: false
  })),
  checkReady: vi.fn<StartCtx['checkReady']>(async () => []),
  overlap: vi.fn<StartCtx['overlap']>(async () => []),
  start: vi.fn<StartCtx['start']>(async () => undefined),
  resume: vi.fn<StartCtx['resume']>(async () => undefined)
})

describe('resolveTicket', () => {
  it('matches #12, owner/name#12, and app-12 case-insensitively', () => {
    expect(resolveTicket([target], '#12')).toBe(target)
    expect(resolveTicket([target], 'OCTO/shop#12')).toBe(target)
    expect(resolveTicket([tracker], 'app-12')).toBe(tracker)
  })

  it('refuses an ambiguous #12 and names both keys', () => {
    const text = resolveTicket([target, other], '#12')
    expect(text).toContain('octo/shop#12')
    expect(text).toContain('octo/shop-web#12')
  })

  it('refuses an unknown ticket', () => {
    expect(resolveTicket([target], '#99')).toBe('No ticket #99 in this project')
  })
})

describe('stateWord', () => {
  const map = statusMapOf(project)
  const done = ticket({ status: 'Done' })
  it('names each case', () => {
    expect(stateWord(undefined, ticket(), map)).toBe('No session')
    expect(stateWord(undefined, done, map)).toBe('Done')
    expect(stateWord(session({ state: 'finished' }), done, map)).toBe('Done')
    expect(stateWord(session(), done, map)).toBe('Done, session open')
    expect(stateWord(session({ state: 'needsYou', asking: true }), ticket(), map)).toBe(
      'Needs you (asking)'
    )
    expect(stateWord(session({ state: 'idle' }), ticket(), map)).toBe('Idle')
  })
})

describe('sandtable commands', () => {
  it("refuses a caller that isn't a session", async () => {
    expect(await make([], [target])('nope', 'status', '#12')).toEqual({
      code: 1,
      text: 'Not a Sandtable ticket session'
    })
  })

  it("refuses a ticket outside the caller's project", async () => {
    const run = make([caller], [])
    expect(await run('c1', 'status', '#12')).toEqual({
      code: 1,
      text: 'No ticket #12 in this project'
    })
  })

  it("refuses the caller's own ticket", async () => {
    const run = make([caller], [ticket({ key: 'octo/shop#1', number: 1 })])
    expect(await run('c1', 'status', '#1')).toEqual({
      code: 1,
      text: "A session can't use sandtable on its own ticket"
    })
  })

  it('status prints Needs you (asking) while Claude asks', async () => {
    const run = make([caller, session({ id: 'w', ticketKey: target.key, asking: true })], [target])
    expect(await run('c1', 'status', '#12')).toEqual({ code: 0, text: 'Needs you (asking)' })
  })

  it('status prints Done for a ticket in Done with no live session', async () => {
    const run = make(
      [caller, session({ id: 'w', ticketKey: target.key, state: 'finished' })],
      [{ ...target, status: 'Done' }]
    )
    expect(await run('c1', 'status', '#12')).toEqual({ code: 0, text: 'Done' })
  })

  it('status prints Done for a ticket in Done with no session', async () => {
    const run = make([caller], [{ ...target, status: 'Done' }])
    expect(await run('c1', 'status', '#12')).toEqual({ code: 0, text: 'Done' })
  })

  it('info prints the branch and worktrees', async () => {
    const run = make(
      [
        caller,
        session({ id: 'w', ticketKey: target.key, branch: '12-target', worktrees: ['/a', '/b'] })
      ],
      [target]
    )
    expect(await run('c1', 'info', '#12')).toEqual({ code: 0, text: '12-target\n/a\n/b' })
  })

  it('info refuses a ticket with no session', async () => {
    expect(await make([caller], [target])('c1', 'info', '#12')).toEqual({
      code: 1,
      text: '#12 has no session'
    })
  })

  const finished = session({ id: 'w', ticketKey: target.key, state: 'finished' })
  const chat = (summary?: true): NonNullable<ChatState['chat']> =>
    ({ draft: 'Saved summary', summary }) as NonNullable<ChatState['chat']>
  const transcript: ConversationEntry[] = [
    { kind: 'assistant', text: 'first' },
    { kind: 'user', text: 'u' },
    { kind: 'assistant', text: 'last words' }
  ]

  it('summary prefers the saved summary of a finished session', async () => {
    const run = make([caller, finished], [target], { chat: chat(true), transcript })
    expect(await run('c1', 'summary', '#12')).toEqual({ code: 0, text: 'Saved summary' })
  })

  it('summary falls back to the last assistant message', async () => {
    const run = make([caller, finished], [target], { chat: chat(), transcript })
    expect(await run('c1', 'summary', '#12')).toEqual({ code: 0, text: 'last words' })
  })

  it('summary refuses when there is no message', async () => {
    expect(await make([caller, finished], [target])('c1', 'summary', '#12')).toEqual({
      code: 1,
      text: '#12 has no message yet'
    })
  })
})

describe('start', () => {
  const started = (n: number, over: Partial<SessionRecord> = {}): SessionRecord[] =>
    Array.from({ length: n }, (_, i) =>
      session({ id: `x${i}`, ticketKey: `octo/shop#${50 + i}`, startedBy: 'c1', ...over })
    )

  it('start refuses past 5 live started sessions', async () => {
    const f = fakes()
    const run = make([caller, ...started(5)], [target], { starts: f })
    expect(await run('c1', 'start', '#12')).toEqual({
      code: 1,
      text: 'This session already started 5 live sessions. Wait for one to finish.'
    })
    expect(f.start).not.toHaveBeenCalled()
    const ok = make(
      [caller, ...started(4), ...started(1, { id: 'y', state: 'finished' })],
      [target]
    )
    expect((await ok('c1', 'start', '#12')).code).toBe(0)
  })

  it('leaves sessions whose ticket is in Done out of the cap', async () => {
    const done = started(5).map((s, i) => ({ ...s, ticketKey: `octo/shop#${60 + i}` }))
    const tickets = [
      target,
      ...done.map((s, i) => ticket({ key: s.ticketKey!, number: 60 + i, status: 'Done' }))
    ]
    expect((await make([caller, ...done], tickets)('c1', 'start', '#12')).code).toBe(0)
  })

  it('says Started without a branch when no session is found after start', async () => {
    expect(await make([caller], [target])('c1', 'start', '#12')).toEqual({
      code: 0,
      text: 'Started #12'
    })
  })

  it('counts starts still in flight toward the cap', async () => {
    let release = (): void => undefined
    const f = fakes()
    f.start.mockImplementation(() => new Promise<void>((r) => (release = r)))
    const tickets = [target, ticket({ key: 'octo/shop#13', number: 13 })]
    const run = make([caller, ...started(4)], tickets, { starts: f })
    const first = run('c1', 'start', '#12')
    await vi.waitFor(() => expect(f.start).toHaveBeenCalled())
    expect((await run('c1', 'start', '#13')).code).toBe(1)
    release()
    await first
  })

  it('start resumes a finished session without running the checks', async () => {
    const f = fakes()
    const w = session({ id: 'w', ticketKey: target.key, state: 'finished', branch: '12-t' })
    expect(await make([caller, w], [target], { starts: f })('c1', 'start', '#12')).toEqual({
      code: 0,
      text: 'Resumed #12 on 12-t'
    })
    expect(f.resume).toHaveBeenCalledWith('c1', 'w')
    expect(f.checkStart).not.toHaveBeenCalled()
  })

  it('start refuses a ticket that needs triage, and on blockers', async () => {
    const f = fakes()
    const run = make([caller], [target], { starts: f })
    f.checkStart.mockResolvedValueOnce({ triage: true, problems: [], overlap: [], ready: true })
    expect(await run('c1', 'start', '#12')).toEqual({
      code: 1,
      text: '#12 needs an area label first. Ask the user to start it in Sandtable, which offers triage.'
    })
    f.checkStart.mockResolvedValueOnce({
      triage: false,
      problems: ['Blocked by #3: A', 'Blocked by #4: B'],
      overlap: [],
      ready: true
    })
    expect(await run('c1', 'start', '#12')).toEqual({
      code: 1,
      text: 'Blocked by #3: A\nBlocked by #4: B'
    })
    expect(f.checkReady).not.toHaveBeenCalled()
    expect(f.start).not.toHaveBeenCalled()
  })

  it('start refuses on readiness gaps and lists them', async () => {
    const f = fakes()
    f.checkStart.mockResolvedValue({ triage: false, problems: [], overlap: [], ready: true })
    f.checkReady.mockResolvedValue(['Which screen?', 'No acceptance test.'])
    expect(await make([caller], [target], { starts: f })('c1', 'start', '#12')).toEqual({
      code: 1,
      text: 'The readiness check found gaps in #12:\nWhich screen?\nNo acceptance test.'
    })
    expect(f.overlap).not.toHaveBeenCalled()
    expect(f.start).not.toHaveBeenCalled()
  })

  it('start skips readiness when the check says it is not needed', async () => {
    const f = fakes()
    await make([caller], [target], { starts: f })('c1', 'start', '#12')
    expect(f.checkReady).not.toHaveBeenCalled()
    expect(f.start).toHaveBeenCalled()
  })

  it('start refuses on overlaps, leaving out the caller and the tickets it started', async () => {
    const f = fakes()
    f.overlap.mockResolvedValue([
      { key: 'octo/shop#30', number: 30, title: 'Other', reason: 'Both change tmux.ts.' }
    ])
    const run = make(
      [
        caller,
        ...started(1),
        ...started(1, { id: 'y', ticketKey: 'octo/shop#70', state: 'finished' })
      ],
      [target],
      { starts: f }
    )
    expect(await run('c1', 'start', '#12')).toEqual({
      code: 1,
      text: '#12 overlaps work in progress:\n#30 Other: Both change tmux.ts.'
    })
    expect(f.overlap).toHaveBeenCalledWith('p1', target.key, ['octo/shop#1', 'octo/shop#50'])
    expect(f.start).not.toHaveBeenCalled()
  })

  it("start uses the caller's main repo for a ticket with no repo", async () => {
    const f = fakes()
    const noRepo = { ...target, repo: '' }
    const c = { ...caller, worktrees: ['/repos/shop-web-wt.noindex/1-x'] }
    await make([c], [noRepo], { starts: f })('c1', 'start', '#12')
    expect(f.start).toHaveBeenCalledWith('c1', 'p1', target.key, [], 'octo/shop-web')
  })

  it("start reuses the extra repos of the ticket's last session", async () => {
    const f = fakes()
    const gone = session({
      id: 'w',
      ticketKey: target.key,
      state: 'finished',
      removedAt: '2026-10-25T00:00:00.000Z',
      branch: 'old',
      worktrees: ['/repos/shop-wt.noindex/12-t', '/repos/shop-web-wt.noindex/12-t']
    })
    const all = [caller, gone]
    f.start.mockImplementation(async () => {
      all.push(
        session({
          id: 'n',
          ticketKey: target.key,
          branch: '12-t',
          startedAt: '2026-10-26T00:00:00.000Z'
        })
      )
    })
    const run = make(all, [target], { starts: f })
    expect(await run('c1', 'start', '#12')).toEqual({ code: 0, text: 'Started #12 on 12-t' })
    expect(f.start).toHaveBeenCalledWith('c1', 'p1', target.key, ['octo/shop-web'], 'octo/shop')
  })

  it('start gives no extras for a checkout session and drops the old main', async () => {
    const f = fakes()
    const mk = (over: Partial<SessionRecord>): SessionRecord =>
      session({
        id: 'w',
        ticketKey: target.key,
        state: 'finished',
        removedAt: '2026-10-25T00:00:00.000Z',
        ...over
      })
    const oldMain = mk({
      worktrees: ['/repos/shop-web-wt.noindex/12-t', '/repos/shop-wt.noindex/12-t']
    })
    await make([caller, oldMain], [target], { starts: f })('c1', 'start', '#12')
    expect(f.start).toHaveBeenLastCalledWith('c1', 'p1', target.key, [], 'octo/shop')
    f.start.mockClear()
    const checkout = mk({ worktrees: [], checkout: '/repos/shop-web' })
    await make([caller, checkout], [target], { starts: f })('c1', 'start', '#12')
    expect(f.start).toHaveBeenLastCalledWith('c1', 'p1', target.key, [], 'octo/shop')
  })

  it("start reports start's refusal as code 1", async () => {
    const f = fakes()
    f.start.mockRejectedValue(new Error('Ticket already has a live session'))
    expect(await make([caller], [target], { starts: f })('c1', 'start', '#12')).toEqual({
      code: 1,
      text: 'Ticket already has a live session'
    })
  })
})

describe('wait', () => {
  afterEach(() => vi.useRealTimers())
  const live = (over: Partial<SessionRecord> = {}): SessionRecord =>
    session({ id: 'w', ticketKey: target.key, ...over })

  it('returns at once when there is no live session', async () => {
    expect(await make([caller], [target])('c1', 'wait', '#12')).toEqual({
      code: 0,
      text: 'No session'
    })
  })

  it('returns at Needs you', async () => {
    const run = make([caller, live({ state: 'needsYou' })], [target])
    expect(await run('c1', 'wait', '#12')).toEqual({ code: 0, text: 'Needs you' })
  })

  it('keeps waiting while a review round is pending', async () => {
    const w = live({ state: 'needsYou' })
    let busy = true
    const listeners = new Set<(projectId: string) => void>()
    const run = make([caller, w], [target], { pending: () => busy, listeners })
    let out: unknown
    void run('c1', 'wait', '#12').then((r) => (out = r))
    await vi.waitFor(() => expect(listeners.size).toBe(1))
    expect(out).toBeUndefined()
    busy = false
    listeners.forEach((cb) => cb('p1'))
    await vi.waitFor(() => expect(out).toEqual({ code: 0, text: 'Needs you' }))
  })

  it('keeps waiting while a start for the ticket is still running its checks', async () => {
    let busy = true
    const all = [caller]
    const listeners = new Set<(projectId: string) => void>()
    const run = make(all, [target], { busy: () => busy, listeners })
    let out: unknown
    void run('c1', 'wait', '#12').then((r) => (out = r))
    await vi.waitFor(() => expect(listeners.size).toBe(1))
    expect(await make(all, [target], { busy: () => busy })('c1', 'status', '#12')).toEqual({
      code: 0,
      text: 'Starting'
    })
    busy = false
    all.push(live({ state: 'needsYou' }))
    listeners.forEach((cb) => cb('p1'))
    await vi.waitFor(() => expect(out).toEqual({ code: 0, text: 'Needs you' }))
  })

  it('caps the timeout at an hour', async () => {
    vi.useFakeTimers()
    const listeners = new Set<(projectId: string) => void>()
    const run = make([caller, live({ state: 'running' })], [target], { listeners })
    let out: unknown
    void run('c1', 'wait', '#12', 10_000_000).then((r) => (out = r))
    await vi.advanceTimersByTimeAsync(1000)
    expect(out).toBeUndefined()
    await vi.advanceTimersByTimeAsync(3600 * 1000)
    expect(out).toEqual({ code: 3, text: 'Running' })
  })

  it('stops waiting when the caller hangs up', async () => {
    const listeners = new Set<(projectId: string) => void>()
    const run = make([caller, live({ state: 'running' })], [target], { listeners })
    const ac = new AbortController()
    const out = run('c1', 'wait', '#12', undefined, ac.signal)
    await vi.waitFor(() => expect(listeners.size).toBe(1))
    ac.abort()
    expect((await out).code).toBe(3)
    expect(listeners.size).toBe(0)
  })

  it('returns when the user clears Needs you to Idle', async () => {
    const w = live({ state: 'running' })
    const listeners = new Set<(projectId: string) => void>()
    const run = make([caller, w], [target], { listeners })
    const out = run('c1', 'wait', '#12')
    await vi.waitFor(() => expect(listeners.size).toBe(1))
    w.state = 'idle'
    listeners.forEach((cb) => cb('p1'))
    expect(await out).toEqual({ code: 0, text: 'Idle' })
  })

  it('returns when the session finishes', async () => {
    const w = live({ state: 'running' })
    const listeners = new Set<(projectId: string) => void>()
    const run = make([caller, w], [target], { listeners })
    const out = run('c1', 'wait', '#12')
    await vi.waitFor(() => expect(listeners.size).toBe(1))
    w.state = 'finished'
    listeners.forEach((cb) => cb('p1'))
    expect(await out).toEqual({ code: 0, text: 'Finished' })
  })

  it('times out with code 3 and the current state', async () => {
    vi.useFakeTimers()
    const listeners = new Set<(projectId: string) => void>()
    const run = make([caller, live({ state: 'running' })], [target], { listeners })
    const out = run('c1', 'wait', '#12', 5)
    await vi.advanceTimersByTimeAsync(5000)
    expect(await out).toEqual({ code: 3, text: 'Running' })
    expect(listeners.size).toBe(0)
  })

  it('unsubscribes after it returns', async () => {
    const w = live({ state: 'running' })
    const listeners = new Set<(projectId: string) => void>()
    const run = make([caller, w], [target], { listeners })
    const out = run('c1', 'wait', '#12')
    await vi.waitFor(() => expect(listeners.size).toBe(1))
    w.state = 'apiError'
    listeners.forEach((cb) => cb('p1'))
    await out
    expect(listeners.size).toBe(0)
  })
})

describe('orchestrator wiring', () => {
  it('answers status through the server handler', async () => {
    const t = setup({
      cli: true,
      sessions: [
        session({ id: 'c1', ticketKey: 'octo/shop#1' }),
        session({ id: 'w', ticketKey: 'octo/shop#147' })
      ],
      tickets: [ticket()]
    })
    t.live.add(session().tmuxName)
    await t.orch.reconnect()
    await t.orch.sync('p1')
    const handler = t.deps.cli!.mock.calls[0][0]
    expect(await handler('c1', 'status', '#147')).toEqual({ code: 0, text: 'Running' })
  })
})

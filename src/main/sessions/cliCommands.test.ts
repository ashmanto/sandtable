import { afterEach, describe, expect, it, vi } from 'vitest'
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
    listeners?: Set<(projectId: string) => void>
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
    onChange: (cb) => {
      const set = extra.listeners ?? new Set()
      set.add(cb)
      return () => set.delete(cb)
    }
  }).run

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
    expect(stateWord(undefined, ticket(), map, false)).toBe('No session')
    expect(stateWord(undefined, done, map, false)).toBe('Done')
    expect(stateWord(session({ state: 'finished' }), done, map, false)).toBe('Done')
    expect(stateWord(session(), done, map, false)).toBe('Done, session open')
    expect(stateWord(session({ state: 'needsYou' }), ticket(), map, true)).toBe(
      'Needs you (asking)'
    )
    expect(stateWord(session({ state: 'idle' }), ticket(), map, false)).toBe('Idle')
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

  it('answers start as not ready', async () => {
    expect(await make([caller], [target])('c1', 'start', '#12')).toEqual({
      code: 1,
      text: 'Not ready'
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

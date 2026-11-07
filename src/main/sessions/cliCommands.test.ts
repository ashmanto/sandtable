import { describe, expect, it } from 'vitest'
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
  extra: { transcript?: ConversationEntry[] | null; chat?: ChatState['chat'] } = {}
): CliHandler =>
  createCliCommands({
    sessions: () => sessions,
    synced: new Map([['p1', { tickets }]]),
    projectById: () => project,
    statusMapOf,
    transcriptOf: async () => extra.transcript ?? null,
    chat: async () => ({ chat: extra.chat ?? null, answering: false })
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
    expect(stateWord(undefined, done, map, false)).toBe('No session')
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

  it('answers wait and start as not ready', async () => {
    expect(await make([caller], [target])('c1', 'wait', '#12')).toEqual({
      code: 1,
      text: 'Not ready'
    })
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

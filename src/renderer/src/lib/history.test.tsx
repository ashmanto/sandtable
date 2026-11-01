import { describe, expect, it } from 'vitest'
import { project, session, ticket } from '../test/fixtures'
import { push, reachable, replace, walk, type History } from './history'

const start: History<string> = { entries: ['a'], index: 0 }
const always = (): boolean => true

describe('history', () => {
  it('adds an entry for each move and ignores a move to the screen you are on', () => {
    expect(push(push(push(start, 'b'), 'b'), 'c')).toEqual({ entries: ['a', 'b', 'c'], index: 2 })
  })

  it('goes back for a move to the screen just before this one, keeping the forward entries', () => {
    expect(push(push(start, 'b'), 'a')).toEqual({ entries: ['a', 'b'], index: 0 })
  })

  it('goes back and forward', async () => {
    const h = push(push(start, 'b'), 'c')
    const back = await walk(h, -1, always)
    expect(back).toEqual({ entries: ['a', 'b', 'c'], index: 1 })
    expect(await walk(back, 1, always)).toEqual(h)
  })

  it('drops the forward entries when you move somewhere else after going back', async () => {
    const back = await walk(push(push(start, 'b'), 'c'), -1, always)
    expect(push(back, 'd')).toEqual({ entries: ['a', 'b', 'd'], index: 2 })
  })

  it('skips an entry whose target is gone', async () => {
    const h = push(push(start, 'gone'), 'c')
    expect(await walk(h, -1, async (e) => e !== 'gone')).toEqual({ ...h, index: 0 })
  })

  it('skips an entry that is the screen you are on', async () => {
    const h = { entries: ['a', 'b', 'a'], index: 2 }
    expect(await walk(h, -1, always)).toEqual({ ...h, index: 1 })
  })

  it('drops the entries that way when none can be reached, so the button disables', async () => {
    const h = push(push(start, 'b'), 'c')
    expect(await walk(h, -1, () => false)).toEqual({ entries: ['c'], index: 0 })
    expect(await walk({ ...h, index: 0 }, 1, () => false)).toEqual({ entries: ['a'], index: 0 })
  })

  it('replaces the current entry without adding one', () => {
    expect(replace(push(start, 'b'), 'B')).toEqual({ entries: ['a', 'B'], index: 1 })
  })
})

describe('reachable', () => {
  const t = ticket(1)
  const view = { tickets: [t], sessions: [session(t.key), session('', { id: 's2' })] }
  const gone = { tickets: [], sessions: [session('', { id: 's2', removedAt: 'x' })] }

  it('accepts a board, ticket, or session that still exists', () => {
    expect(reachable({ name: 'board', projectId: project.id }, [project], view)).toBe(true)
    expect(
      reachable({ name: 'ticket', projectId: project.id, ticketKey: t.key }, [project], view)
    ).toBe(true)
    expect(
      reachable({ name: 'session', projectId: project.id, sessionId: 's2' }, [project], view)
    ).toBe(true)
    expect(reachable({ name: 'add', projectId: 'new' }, [], view)).toBe(true)
  })

  it('refuses a removed project, a ticket that left the board, and an ended session', () => {
    expect(reachable({ name: 'board', projectId: project.id }, [], view)).toBe(false)
    expect(reachable({ name: 'add', projectId: project.id }, [], view)).toBe(false)
    expect(
      reachable({ name: 'ticket', projectId: project.id, ticketKey: t.key }, [project], gone)
    ).toBe(false)
    expect(
      reachable({ name: 'session', projectId: project.id, sessionId: 's2' }, [project], gone)
    ).toBe(false)
  })
})

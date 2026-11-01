import { describe, expect, it } from 'vitest'
import { visibleTickets } from './visibleTickets'
import type { SessionRecord, SessionState } from './types'

const now = new Date('2026-10-25T12:00:00Z')
const daysAgo = (d: number): string => new Date(now.getTime() - d * 86_400_000).toISOString()
const ticket = (doneAt: string | null): { key: string; doneAt: string | null } => ({
  key: 'o/r#1',
  doneAt
})
const session = (state: SessionState, startedAt = daysAgo(9), removedAt?: string): SessionRecord =>
  ({ ticketKey: 'o/r#1', state, startedAt, removedAt }) as SessionRecord
const show = (
  t: { key: string; doneAt: string | null },
  sessions: SessionRecord[] = [],
  done = true,
  days = 7
): boolean => visibleTickets([t], sessions, () => done, now, days).length === 1

describe('visibleTickets', () => {
  it('shows a ticket done 6 days ago and hides one done 8 days ago', () => {
    expect(show(ticket(daysAgo(6)))).toBe(true)
    expect(show(ticket(daysAgo(8)))).toBe(false)
  })

  it('uses the window it is given', () => {
    expect(show(ticket(daysAgo(2)), [], true, 1)).toBe(false)
    expect(show(ticket(daysAgo(20)), [], true, 30)).toBe(true)
    expect(show(ticket(daysAgo(20)), [session('finished')], true, 1)).toBe(true)
  })

  it('always shows a ticket that is not done', () => {
    expect(show(ticket(daysAgo(30)), [], false)).toBe(true)
  })

  it('shows an old done ticket with no done time', () => {
    expect(show(ticket(null))).toBe(true)
    expect(show({ key: 'o/r#1' } as { key: string; doneAt: string | null })).toBe(true)
  })

  it.each(['running', 'needsYou', 'finished'] as const)(
    'shows an old done ticket whose newest session is %s and not removed',
    (state) => {
      expect(show(ticket(daysAgo(8)), [session(state)])).toBe(true)
    }
  )

  it('hides an old done ticket whose newest session was removed', () => {
    expect(show(ticket(daysAgo(8)), [session('finished', daysAgo(9), daysAgo(8))])).toBe(false)
  })

  it('judges by the newest session by start time', () => {
    const old = session('finished', daysAgo(20))
    const removed = session('finished', daysAgo(9), daysAgo(8))
    expect(show(ticket(daysAgo(8)), [removed, old])).toBe(false)
    expect(show(ticket(daysAgo(8)), [old, removed])).toBe(false)
  })
})

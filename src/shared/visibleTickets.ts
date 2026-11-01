import { currentSession } from './sessions'
import type { SessionRecord } from './types'

/** The choices for a project's Keep done tickets, in days. */
export const KEEP_DONE_DAYS = [1, 3, 7, 14, 30]

/** How many days a project keeps done tickets on the board when it hasn't chosen. */
export const DEFAULT_KEEP_DONE_DAYS = 7

/** The time `days` days before `now`. */
export const daysBefore = (now: Date, days: number): Date =>
  new Date(now.getTime() - days * 24 * 60 * 60 * 1000)

/** Drops tickets done more than `days` days ago, unless their newest session still has a worktree. */
export function visibleTickets<T extends { key: string; doneAt: string | null }>(
  tickets: T[],
  sessions: SessionRecord[],
  isDone: (t: T) => boolean,
  now: Date,
  days: number
): T[] {
  return tickets.filter((t) => {
    if (!isDone(t) || !t.doneAt) return true
    if (Date.parse(t.doneAt) >= daysBefore(now, days).getTime()) return true
    const s = currentSession(sessions, t.key)
    return !!s && !s.removedAt
  })
}

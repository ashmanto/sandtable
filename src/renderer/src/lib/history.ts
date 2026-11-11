import { same } from '../../../shared/same'
import type { BoardView } from '../../../shared/api'
import type { Project, TicketTab } from '../../../shared/types'

/** A screen in the panel: a project's board, a ticket on a tab, a session, or the add-project flow. */
export type Route =
  | { name: 'board'; projectId: string }
  | { name: 'ticket'; projectId: string; ticketKey: string; tab?: TicketTab }
  | { name: 'session'; projectId: string; sessionId: string }
  | { name: 'add'; projectId: string; repo?: string }

/** The screens you visited, oldest first, and the one you're on. */
export type History<T> = { entries: T[]; index: number }

export { same }

/** Adds `entry` after the current one and drops the forward entries; the screen you're on or the one before it moves instead. */
export const push = <T>(h: History<T>, entry: T): History<T> =>
  same(entry, h.entries[h.index])
    ? h
    : same(entry, h.entries[h.index - 1])
      ? { ...h, index: h.index - 1 }
      : { entries: [...h.entries.slice(0, h.index + 1), entry], index: h.index + 1 }

/** Swaps the current entry for `entry`. */
export const replace = <T>(h: History<T>, entry: T): History<T> => ({
  entries: h.entries.with(h.index, entry),
  index: h.index
})

/** Moves to the nearest entry in `step`'s direction that `ok` accepts and isn't the current screen; with none, drops the entries that way. */
export async function walk<T>(
  h: History<T>,
  step: 1 | -1,
  ok: (entry: T) => boolean | Promise<boolean>
): Promise<History<T>> {
  for (let i = h.index + step; i >= 0 && i < h.entries.length; i += step)
    if (!same(h.entries[i], h.entries[h.index]) && (await ok(h.entries[i])))
      return { ...h, index: i }
  return step < 0
    ? { entries: h.entries.slice(h.index), index: 0 }
    : { entries: h.entries.slice(0, h.index + 1), index: h.index }
}

/** Whether `route`'s project, ticket, or session still exists, an ended session counting as gone. */
export const reachable = (
  route: Route,
  projects: Project[],
  { tickets, sessions }: Pick<BoardView, 'tickets' | 'sessions'>
): boolean =>
  route.projectId === 'new' ||
  (projects.some((p) => p.id === route.projectId) &&
    (route.name === 'ticket'
      ? tickets.some((t) => t.key === route.ticketKey)
      : route.name !== 'session' || sessions.some((s) => s.id === route.sessionId && !s.removedAt)))

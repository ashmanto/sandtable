import type { KeyboardCoordinateGetter } from '@dnd-kit/core'
import type { BoardColumn, LaneChange, Ticket } from '../../../shared/types'
import { COLUMNS } from '../../../shared/columns'
import { ticketLabel } from '../../../shared/repo'
import { NO_ASSIGNEE, personName } from './assigneeFilter'

type Person = Ticket['assignees'][number]

/** A column's title, or '' for anything else. */
export const titleOf = (id: unknown): string => COLUMNS.find((c) => c.id === id)?.title ?? ''

/** A parent lane's header: the parent's key, title, column, and sub-issue counts where known. */
type LaneParent = {
  key: string
  number: number
  repo: string
  title: string
  column: BoardColumn
  subIssues?: { completed: number; total: number }
}

/** A lane of tickets, keyed by assignee ID or parent key, with `parent` on a parent's lane. */
export type Lane<T> = { id: string; name: string; tickets: T[]; parent?: LaneParent }

/** The No parent lane's ID. */
export const NO_PARENT = '@noparent'

type Parented = Pick<Ticket, 'key' | 'number' | 'repo' | 'title' | 'parent' | 'subIssues'>

/** One lane per parent, sorted by key, a parent in its own lane, then No parent, always; `all` holds parents on the board but not among `tickets`. */
export function parentLanesOf<T extends Parented>(
  tickets: T[],
  all: T[],
  columnOf: (t: T) => string
): Lane<T>[] {
  const parents = new Set(tickets.flatMap((t) => (t.parent ? [t.parent.key] : [])))
  const lanes = new Map<string, Lane<T>>()
  const none: Lane<T> = { id: NO_PARENT, name: 'No parent', tickets: [] }
  const headOf = (id: string, child: T): LaneParent => {
    const own = [...tickets, ...all].find((x) => x.key === id)
    const { key, number, repo, title, column, subIssues } = own
      ? { ...own, column: columnOf(own), subIssues: own.subIssues }
      : child.parent!
    const counts = subIssues && { completed: subIssues.completed, total: subIssues.total }
    return {
      key,
      number,
      repo,
      title,
      column: column === 'hidden' ? 'done' : (column as BoardColumn),
      ...(counts && { subIssues: counts })
    }
  }
  for (const t of tickets) {
    const id = t.subIssues.total > 0 || parents.has(t.key) ? t.key : t.parent?.key
    if (!id) {
      none.tickets.push(t)
      continue
    }
    if (!lanes.has(id)) {
      const parent = headOf(id, t)
      lanes.set(id, { id, name: `${ticketLabel(parent)} ${parent.title}`, tickets: [], parent })
    }
    lanes.get(id)!.tickets.push(t)
  }
  const byKey = (a: Lane<T>, b: Lane<T>): number =>
    a.id.localeCompare(b.id, undefined, { numeric: true })
  return [...[...lanes.values()].sort(byKey), none]
}

/** The lanes of the tickets' assignees, sorted by name, each in the tickets' order, then No assignee, always. */
export function lanesOf<T extends { assignees: Person[] }>(tickets: T[]): Lane<T>[] {
  const lanes = new Map<string, Lane<T>>()
  const none: Lane<T> = { id: NO_ASSIGNEE, name: 'No assignee', tickets: [] }
  for (const t of tickets) {
    if (t.assignees.length === 0) none.tickets.push(t)
    for (const a of t.assignees) {
      if (!lanes.has(a.id)) lanes.set(a.id, { id: a.id, name: personName(a), tickets: [] })
      lanes.get(a.id)!.tickets.push(t)
    }
  }
  return [...[...lanes.values()].sort((a, b) => a.name.localeCompare(b.name)), none]
}

/** A lane with its tickets split by column. */
export type LaneCells<T> = Omit<Lane<T>, 'tickets'> & {
  count: number
  cells: { id: BoardColumn; title: string; tickets: T[] }[]
}

/** The lanes, each split into the board's columns by `columnOf`. */
export const laneCells = <T>(lanes: Lane<T>[], columnOf: (t: T) => string): LaneCells<T>[] =>
  lanes.map(({ tickets, ...l }) => ({
    ...l,
    count: tickets.length,
    cells: COLUMNS.map((c) => ({ ...c, tickets: tickets.filter((t) => columnOf(t) === c.id) }))
  }))

/** A drag or drop ID inside a lane: `<lane>|<ticket key or column>`. */
export const laneId = (lane: string, rest: string): string => `${lane}|${rest}`

/** A drag or drop ID's lane, null outside lanes, and the rest. */
export function splitLane(id: string): [string | null, string] {
  const at = id.indexOf('|')
  return at < 0 ? [null, id] : [id.slice(0, at), id.slice(at + 1)]
}

type Next = (over: string, code: string) => string | undefined

const along =
  (ids: string[], keys: Record<string, number>): Next =>
  (over, code) => {
    const at = ids.indexOf(over)
    return at < 0 || !keys[code] ? undefined : ids[at + keys[code]]
  }

const across = { ArrowLeft: -1, ArrowRight: 1 }
const upDown = { ArrowUp: -1, ArrowDown: 1 }
const columnIds: string[] = COLUMNS.map((c) => c.id)

/** The board's cell after an arrow key: Left and Right choose the column, Up and Down the lane. */
export const nextCellId =
  (lanes: string[]): Next =>
  (over, code) => {
    const [lane, column] = splitLane(over)
    return (
      along(
        columnIds.map((c) => laneId(lane ?? '', c)),
        across
      )(over, code) ??
      along(
        lanes.map((l) => laneId(l, column)),
        upDown
      )(over, code)
    )
  }

/** The list's group after Up or Down: each lane's status groups in order, a collapsed lane as its header. */
export const nextLaneGroupId = (lanes: string[], collapsed: string[]): Next =>
  along(
    lanes.flatMap((l) =>
      collapsed.includes(l) ? [laneId(l, '')] : columnIds.map((c) => laneId(l, c))
    ),
    upDown
  )

/** `next`, kept to the lane it starts in. */
export const inLane =
  (next: Next): Next =>
  (over, code) => {
    const id = next(over, code)
    return id !== undefined && splitLane(id)[0] === splitLane(over)[0] ? id : undefined
  }

/** A keyboard getter that centers the dragged card on the drop target `next` picks. */
export const stepper =
  (next: Next): KeyboardCoordinateGetter =>
  (event, { context }) => {
    const id = context.over && next(String(context.over.id), event.code)
    const target = id && context.droppableRects.get(id)
    const card = context.collisionRect
    if (!target || !card) return
    event.preventDefault()
    return {
      x: target.left + (target.width - card.width) / 2,
      y: target.top + (target.height - card.height) / 2
    }
  }

/** The keyboard getter for the columns. */
export const nextColumn = stepper(along(columnIds, across))
/** The keyboard getter for the list's status groups. */
export const nextGroup = stepper(along(columnIds, upDown))

const assigneeOf = (lane: string): string | null => (lane === NO_ASSIGNEE ? null : lane)

/** Where a dragged card would land. */
export type Drop = {
  key: string
  from: string | null
  to: string | null
  column: BoardColumn
  fromColumn: BoardColumn
  lane: LaneChange | undefined
  moves: boolean
}

/** Where the card dragged as `activeId` lands over `overId`; a header drop keeps its column. */
export function placeDrop(
  activeId: string,
  overId: string | undefined,
  columnOf: (key: string) => BoardColumn
): Drop {
  const [from, key] = splitLane(activeId)
  const [to, over] = overId === undefined ? [from, ''] : splitLane(overId)
  const fromColumn = columnOf(key)
  const column = (over || fromColumn) as BoardColumn
  const lane =
    from && to && from !== to ? { from: assigneeOf(from), to: assigneeOf(to) } : undefined
  return { key, from, to, column, fromColumn, lane, moves: column !== fromColumn || !!lane }
}

/** A place as a screen reader hears it: the column, after the lane's name inside lanes. */
export const whereOf = (
  lane: string | null,
  column: BoardColumn,
  nameOf: (lane: string) => string
): string => (lane === null ? titleOf(column) : `${nameOf(lane)}, ${titleOf(column)}`)

/** What a screen reader hears after a drop; `keepsOthers` when the card has assignees besides `from`. */
export function droppedWords(
  d: Drop,
  label: string,
  nameOf: (lane: string) => string,
  keepsOthers: boolean
): string {
  if (!d.moves) return `${label} stays in ${whereOf(d.from, d.fromColumn, nameOf)}.`
  if (d.lane?.to === null && d.from && keepsOthers) {
    const removed = `Removed ${nameOf(d.from)} from ${label}`
    return d.column === d.fromColumn
      ? `${removed}.`
      : `${removed} and moved it to ${titleOf(d.column)}.`
  }
  return `Moved ${label} to ${whereOf(d.to, d.column, nameOf)}.`
}

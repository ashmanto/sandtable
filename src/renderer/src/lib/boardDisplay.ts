import { IN_PROGRESS_LABEL } from '../../../shared/columns'
import { loadSaved, saveSaved } from './utils'

/** How the board groups its tickets into lanes and orders each column; `manual` keeps GitHub's order. */
export type BoardDisplay = {
  group: 'none' | 'assignee' | 'parent'
  order: 'manual' | 'created' | 'updated' | 'label'
  dir: 'asc' | 'desc'
}

type Sortable = { createdAt: string; updatedAt: string; labels: { name: string }[] }

const orders: unknown[] = ['manual', 'created', 'updated', 'label']
const groups: unknown[] = ['assignee', 'parent']
const manual: BoardDisplay = { group: 'none', order: 'manual', dir: 'asc' }
const key = (projectId: string): string => `boardDisplay:${projectId}`

const firstLabel = (t: Sortable): string | undefined =>
  t.labels
    .map((l) => l.name.toLowerCase())
    .filter((n) => n !== IN_PROGRESS_LABEL.name)
    .sort((a, b) => a.localeCompare(b))[0]

/** The tickets in the display's order; ties keep GitHub's order, and unlabeled tickets go last. */
export function sortTickets<T extends Sortable>(
  tickets: T[],
  d: Pick<BoardDisplay, 'order' | 'dir'>
): T[] {
  if (d.order === 'manual') return tickets
  const sign = d.dir === 'desc' ? -1 : 1
  if (d.order === 'label')
    return tickets.toSorted((a, b) => {
      const [x, y] = [firstLabel(a), firstLabel(b)]
      return x === y ? 0 : x === undefined ? 1 : y === undefined ? -1 : sign * x.localeCompare(y)
    })
  const at = (t: T): number => Date.parse(d.order === 'created' ? t.createdAt : t.updatedAt)
  return tickets.toSorted((a, b) => sign * (at(a) - at(b)))
}

/** The display saved for the project, or Manual. */
export const loadBoardDisplay = (projectId: string): BoardDisplay =>
  loadSaved(key(projectId), manual, (d) =>
    d && orders.includes(d.order) && (d.dir === 'asc' || d.dir === 'desc')
      ? { group: groups.includes(d.group) ? d.group! : 'none', order: d.order!, dir: d.dir }
      : null
  )

/** Saves the project's display for the next launch. */
export const saveBoardDisplay = (projectId: string, d: BoardDisplay): void =>
  saveSaved(key(projectId), d)

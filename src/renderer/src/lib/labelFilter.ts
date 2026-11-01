import { IN_PROGRESS_LABEL } from '../../../shared/columns'
import { loadFilter, passesFilter, saveSaved, type SavedFilter } from './utils'

/** Which labels the board filters on, and whether it shows only those tickets or hides them. */
export type LabelFilter = SavedFilter<'labels'>

type Labeled = { labels: { name: string; color: string }[] }

const key = (projectId: string): string => `labelFilter:${projectId}`

/** Whether `names` holds `name`, ignoring case as GitHub does. */
export const hasLabel = (names: string[], name: string): boolean =>
  names.some((n) => n.toLowerCase() === name.toLowerCase())

/** Whether the filter lets the ticket show on the board. */
export const passes = (f: LabelFilter, t: Labeled): boolean =>
  passesFilter(f, f.labels, (name) =>
    t.labels.some((l) => l.name.toLowerCase() === name.toLowerCase())
  )

/** The labels on the tickets, plus any selected ones, by name, without Sandtable's own label. */
export function boardLabels(
  tickets: Labeled[],
  selected: string[]
): { name: string; color: string | null }[] {
  const byName = new Map<string, { name: string; color: string | null }>()
  const add = (l: { name: string; color: string | null }): void => {
    const k = l.name.toLowerCase()
    if (!byName.has(k)) byName.set(k, l)
  }
  for (const t of tickets) t.labels.forEach(add)
  for (const name of selected) add({ name, color: null })
  byName.delete(IN_PROGRESS_LABEL.name)
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** The filter saved for the project, or no filter. */
export const loadLabelFilter = (projectId: string): LabelFilter =>
  loadFilter(key(projectId), 'labels')

/** Saves the project's filter for the next launch. */
export const saveLabelFilter = (projectId: string, f: LabelFilter): void =>
  saveSaved(key(projectId), f)

import type { BoardColumn } from '../../../shared/types'
import { loadSaved, saveSaved } from './utils'

type BoardLayout = { view: 'board' | 'list'; collapsed: BoardColumn[]; lanes: string[] }

const known: unknown[] = ['todo', 'inProgress', 'done'] satisfies BoardColumn[]
const fallback: BoardLayout = { view: 'board', collapsed: [], lanes: [] }
const key = (projectId: string): string => `boardLayout:${projectId}`

/** The layout saved for the project, or the board with nothing collapsed; `lanes` are the collapsed lane IDs. */
export const loadBoardLayout = (projectId: string): BoardLayout =>
  loadSaved(key(projectId), fallback, (l) =>
    (l?.view === 'board' || l?.view === 'list') && Array.isArray(l.collapsed)
      ? {
          view: l.view,
          collapsed: l.collapsed.filter((c) => known.includes(c)),
          lanes: Array.isArray(l.lanes) ? l.lanes.filter((id) => typeof id === 'string') : []
        }
      : null
  )

/** Saves the project's layout for the next launch. */
export const saveBoardLayout = (projectId: string, l: BoardLayout): void =>
  saveSaved(key(projectId), l)

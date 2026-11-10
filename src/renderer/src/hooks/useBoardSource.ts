import { useState } from 'react'
import { useLatestLoad } from './useLatestLoad'
import { parseBoardUrl } from '../../../shared/boardUrl'
import type { Project, StatusMap } from '../../../shared/types'

type Loaded = { url: string; options: string[]; repos: string[] }

/** The board columns and the board status each one usually maps to. */
export const STATUS_FIELDS: { key: keyof StatusMap; label: string; usual: string }[] = [
  { key: 'todo', label: 'To do', usual: 'Todo' },
  { key: 'inProgress', label: 'In progress', usual: 'In Progress' },
  { key: 'done', label: 'Done', usual: 'Done' }
]

const boardName = (url: string): string | null => {
  try {
    const { owner, number } = parseBoardUrl(url)
    return `${owner}/projects/${number}`
  } catch {
    return null
  }
}

/** The GitHub Projects board a project's tickets come from: its URL, loaded statuses and repos, and status map. */
export type BoardStepState = {
  issue: string | null
  summary: string
  saved: NonNullable<Project['board']> | null
  board: Loaded | null
  url: string
  statusMap: Partial<StatusMap>
  loading: boolean
  error: string | null
  badUrl: boolean
  reset: () => void
  load: () => void
  changeUrl: (url: string) => void
  setStatus: (key: keyof StatusMap, status: string) => void
}

/** The board step's state, prefilled from `project`; `on.loaded` gets a loaded board's repos, and `on.cleared` runs when a URL change drops a loaded board. */
export function useBoardSource(
  project: Project | undefined,
  on: { loaded: (repos: string[]) => void; cleared: () => void }
): BoardStepState {
  const board0 = project?.board
  const [url, setUrl] = useState(board0?.source.url ?? '')
  const boardLoad = useLatestLoad<Loaded>(
    board0
      ? {
          url: board0.source.url,
          options: [...new Set(Object.values(board0.statusMap))],
          repos: project?.repos.map((r) => r.github) ?? []
        }
      : null
  )
  const [badUrl, setBadUrl] = useState(false)
  const [statusMap, setStatusMap] = useState<Partial<StatusMap>>(board0?.statusMap ?? {})
  const loaded = boardLoad.data
  const board = loaded?.url === url.trim() && boardName(url) ? loaded : null

  function load(): void {
    if (!boardName(url)) return setBadUrl(true)
    const target = url.trim()
    void boardLoad.load(
      async () => {
        const [options, repos] = await Promise.all([
          window.sandtable.projects.statusOptions(target),
          window.sandtable.projects.boardRepos(target)
        ])
        return { url: target, options, repos }
      },
      ({ options, repos }) => {
        setStatusMap((m) =>
          Object.fromEntries(
            STATUS_FIELDS.map(({ key, usual }) => {
              const kept = m[key]
              return [
                key,
                kept && options.includes(kept) ? kept : options.includes(usual) ? usual : undefined
              ]
            })
          )
        )
        on.loaded(repos)
      }
    )
  }

  function changeUrl(value: string): void {
    setUrl(value)
    setBadUrl(false)
    boardLoad.cancel()
    if (loaded) {
      boardLoad.set(null)
      on.cleared()
    }
  }

  const missing = STATUS_FIELDS.find((f) => !statusMap[f.key])
  const issue = boardLoad.loading
    ? 'Loading the board…'
    : !board
      ? 'Load the board'
      : missing
        ? `Choose a board status for ${missing.label}`
        : null

  return {
    issue,
    summary: 'Board, statuses chosen',
    saved:
      issue === null ? { source: parseBoardUrl(url), statusMap: statusMap as StatusMap } : null,
    board,
    url,
    statusMap,
    loading: boardLoad.loading,
    error: boardLoad.error,
    badUrl,
    reset: () => boardLoad.set(null),
    load,
    changeUrl,
    setStatus: (key, status) => setStatusMap((m) => ({ ...m, [key]: status }))
  }
}

import { useCallback, useEffect, useState } from 'react'
import type { BoardView } from '../../../shared/api'
import { setStartFailures } from './startFlow'

/** The board of a project, reloaded whenever the main process reports a change. */
export function useBoard(projectId: string | null): {
  view: BoardView | null
  sync: () => Promise<void>
} {
  const [loaded, setLoaded] = useState<{ projectId: string; view: BoardView } | null>(null)

  useEffect(() => {
    if (!projectId) return
    let current = true
    const load = (): void => {
      void window.sandtable.board.get(projectId).then((view) => {
        if (!current) return
        setStartFailures(projectId, view.couldntStart[projectId] ?? [])
        setLoaded({ projectId, view })
      })
    }
    load()
    const off = window.sandtable.board.onChange(load)
    return () => {
      current = false
      off()
    }
  }, [projectId])

  useEffect(() => {
    const watch = (): void =>
      window.sandtable.board.watch(projectId, document.visibilityState === 'visible')
    watch()
    document.addEventListener('visibilitychange', watch)
    return () => document.removeEventListener('visibilitychange', watch)
  }, [projectId])

  const sync = useCallback(
    () => (projectId ? window.sandtable.board.sync(projectId) : Promise.resolve()),
    [projectId]
  )

  return { view: loaded?.projectId === projectId ? loaded.view : null, sync }
}

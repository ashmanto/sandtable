import { useCallback, useEffect, useState } from 'react'
import type { Leftover } from '../../../shared/types'
import { errorMessage } from '@/lib/utils'

/** The leftover sessions, `null` until they load, reloaded on every board change. */
export function useLeftovers(): {
  leftovers: Leftover[] | null
  loadError: string | null
  load: () => Promise<void>
} {
  const [leftovers, setLeftovers] = useState<Leftover[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const load = useCallback(
    (): Promise<void> =>
      window.sandtable.sessions.leftovers().then(
        (l) => {
          setLeftovers(l)
          setLoadError(null)
        },
        (err) => setLoadError(errorMessage(err))
      ),
    []
  )
  useEffect(() => {
    void load()
    return window.sandtable.board.onChange(() => void load())
  }, [load])
  return { leftovers, loadError, load }
}

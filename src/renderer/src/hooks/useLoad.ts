import { useCallback, useEffect, useState } from 'react'
import { errorMessage } from '@/lib/utils'

/** The result of `load`, run while `enabled`, when `deps` change, and on `reload`, ignoring stale responses; data survives a failed reload. */
export function useLoad<T>(
  load: () => Promise<T>,
  deps: unknown[],
  enabled = true
): { data: T | undefined; error: string | null; reload: () => void } {
  const [state, setState] = useState<{ data: T | undefined; error: string | null }>({
    data: undefined,
    error: null
  })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!enabled) return
    let current = true
    load().then(
      (data) => current && setState({ data, error: null }),
      (err) => current && setState((s) => ({ ...s, error: errorMessage(err) }))
    )
    return () => {
      current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller names the reload triggers
  }, [...deps, enabled, attempt])
  const reload = useCallback(() => {
    setState((s) => ({ ...s, error: null }))
    setAttempt((n) => n + 1)
  }, [])
  return { ...state, reload }
}

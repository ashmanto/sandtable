import { useCallback, useState } from 'react'
import type { Line } from '@/lib/cleanUp'
import { errorMessage } from '@/lib/utils'

/** Runs one action at a time and keeps its outcome as a result or error line. */
export function useRun(): {
  error: string | null
  result: string | null
  pending: boolean
  busy: string | null
  clear: () => void
  run: (action: () => Promise<Line | null | void>, busyLabel?: string) => Promise<boolean>
} {
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const clear = useCallback((): void => {
    setError(null)
    setResult(null)
  }, [])
  const run = useCallback(
    async (action: () => Promise<Line | null | void>, busyLabel = ''): Promise<boolean> => {
      clear()
      setBusy(busyLabel)
      try {
        const outcome = await action()
        if (outcome) (outcome.danger ? setError : setResult)(outcome.text)
        return true
      } catch (err) {
        setError(errorMessage(err))
        return false
      } finally {
        setBusy(null)
      }
    },
    [clear]
  )
  return { error, result, pending: busy !== null, busy, clear, run }
}

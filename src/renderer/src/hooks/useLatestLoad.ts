import { useRef, useState } from 'react'
import { errorMessage } from '@/lib/utils'

/** A list loaded on demand, where only the latest load, until cancelled, writes its data, error, and loading. */
export function useLatestLoad<T>(initial: T | null = null): {
  data: T | null
  loading: boolean
  error: string | null
  set: React.Dispatch<React.SetStateAction<T | null>>
  load: (fetch: () => Promise<T>, apply?: (loaded: T) => void) => Promise<void>
  cancel: () => void
} {
  const latest = useRef(0)
  const [data, set] = useState<T | null>(initial)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load(fetch: () => Promise<T>, apply?: (loaded: T) => void): Promise<void> {
    const id = ++latest.current
    setError(null)
    setLoading(true)
    try {
      const loaded = await fetch()
      if (latest.current !== id) return
      set(loaded)
      apply?.(loaded)
    } catch (err) {
      if (latest.current === id) setError(errorMessage(err))
    } finally {
      if (latest.current === id) setLoading(false)
    }
  }

  function cancel(): void {
    latest.current++
    setLoading(false)
    setError(null)
  }

  return { data, loading, error, set, load, cancel }
}

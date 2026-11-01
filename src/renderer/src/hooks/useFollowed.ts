import { useEffect, useState } from 'react'

/** A session's value, loaded by `id` and then following `follow`'s pushes, a push winning over a later load; null while `id` is null. */
export function useFollowed<T>(
  follow: (cb: (sessionId: string, value: T) => void) => () => void,
  load: (sessionId: string) => Promise<T | null>,
  id: string | null
): T | null {
  const [shown, setShown] = useState<{ id: string; value: T } | null>(null)
  useEffect(() => {
    if (id === null) return
    let loading = true
    const unfollow = follow((from, value) => {
      if (from !== id) return
      loading = false
      setShown({ id, value })
    })
    load(id)
      .then((value) => {
        if (loading && value) setShown({ id, value })
      })
      .catch(() => {})
    return () => {
      loading = false
      setShown(null)
      unfollow()
    }
  }, [follow, load, id])
  return id !== null && shown?.id === id ? shown.value : null
}

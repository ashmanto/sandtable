import { useEffect, useState } from 'react'

/** A setting loaded once from the main process, `null` until it loads, and saved on each change. */
export function useSetting<T>(
  load: () => Promise<T>,
  save: (value: T) => Promise<void>
): [T | null, (value: T) => void] {
  const [value, setValue] = useState<T | null>(null)
  useEffect(() => {
    void load().then(setValue)
  }, [load])
  return [
    value,
    (next) => {
      setValue(next)
      void save(next)
    }
  ]
}

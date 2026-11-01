import { useRef } from 'react'

/** Holds an action picked in a menu and runs it once the menu closes, in place of returning focus to its trigger. */
export function useAfterMenu(): {
  later: (action: () => void) => void
  afterMenu: (e: Event) => void
} {
  const next = useRef<(() => void) | null>(null)
  return {
    later: (action) => void (next.current = action),
    afterMenu: (e) => {
      const action = next.current
      if (!action) return
      e.preventDefault()
      next.current = null
      action()
    }
  }
}

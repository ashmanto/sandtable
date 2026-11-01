import { useEffect, useRef, type RefObject } from 'react'

/** A ref to an element that takes focus when `focused` turns true. */
export function useFocus<T extends HTMLElement = HTMLButtonElement>(
  focused: boolean
): RefObject<T | null> {
  const ref = useRef<T>(null)
  useEffect(() => {
    if (focused) ref.current?.focus()
  }, [focused])
  return ref
}

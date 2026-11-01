import { useEffect, useRef, type RefObject } from 'react'
import { motion } from '@/lib/utils'

const rise = (el: HTMLElement): void => {
  if (!el.animate) return
  const { still, easing } = motion('--ease-out-cubic')
  el.animate(
    [
      { opacity: 0, transform: still ? 'none' : 'translateY(6px)' },
      { opacity: 1, transform: 'none' }
    ],
    { duration: 200, easing }
  )
}

/** A ref whose element rises 6 px and fades in when `value` changes; it only fades with reduced motion. */
export function useRiseOnChange<T extends HTMLElement>(value: unknown): RefObject<T | null> {
  const ref = useRef<T>(null)
  const shown = useRef(value)
  useEffect(() => {
    if (shown.current === value) return
    shown.current = value
    if (ref.current) rise(ref.current)
  }, [value])
  return ref
}

/** Scrolls the board card for `key` into view, preferring the copy in the focused element's lane, focuses it, and rises it with a `card-hover` flash; false when no such card is shown. */
export function jumpToCard(key: string): boolean {
  const cards = [...document.querySelectorAll<HTMLElement>(`[data-ticket="${CSS.escape(key)}"]`)]
  const lane = document.activeElement?.closest('section')
  const el = cards.find((c) => lane && c.closest('section') === lane) ?? cards[0]
  if (!el) return false
  el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  el.focus({ preventScroll: true })
  rise(el)
  el.animate?.([{ backgroundColor: 'var(--card-hover)' }, { backgroundColor: 'var(--card)' }], {
    duration: 150,
    easing: 'ease-out'
  })
  return true
}

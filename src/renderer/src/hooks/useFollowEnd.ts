import { useCallback, useRef, useState } from 'react'
import { still } from '@/lib/utils'

const NEAR_END = 40

/** Keeps a scroller at its end while you're there, gliding as it grows, until you scroll up; `away` says you did. */
export function useFollowEnd(): {
  scroller: React.RefObject<HTMLDivElement | null>
  ref: (el: HTMLDivElement | null) => (() => void) | undefined
  follow: () => void
  away: boolean
} {
  const scroller = useRef<HTMLDivElement>(null)
  const toEnd = useRef<(() => void) | null>(null)
  const stuck = useRef(true)
  const [away, setAway] = useState(false)
  const stick = useCallback((on: boolean) => {
    stuck.current = on
    setAway(!on)
  }, [])

  const ref = useCallback(
    (el: HTMLDivElement | null) => {
      scroller.current = el
      if (!el) return
      stick(true)
      let gliding = false
      let jumped = false
      let top = el.scrollTop
      let shown = el.clientHeight > 0
      const left = (): number => el.scrollHeight - el.scrollTop - el.clientHeight
      const atEnd = (): boolean => left() < NEAR_END
      const end = (): void => {
        const far = left()
        gliding = jumped && far > 1 && far <= el.clientHeight && !still()
        if (el.scrollHeight > el.clientHeight) jumped = true
        el.scrollTo({ top: el.scrollHeight, behavior: gliding ? 'smooth' : 'instant' })
        top = el.scrollTop
      }
      toEnd.current = end
      const onScroll = (): void => {
        stick(atEnd() || (stuck.current && el.scrollTop >= top))
        top = el.scrollTop
      }
      const onScrollEnd = (): void => {
        const ours = gliding
        gliding = false
        if (ours && stuck.current && !atEnd()) end()
      }
      const sizes = new ResizeObserver(() => {
        if (shown && el.scrollTop < top && !atEnd()) stick(false)
        else if (!stuck.current && el.clientHeight > 0 && atEnd()) stick(true)
        top = el.scrollTop
        shown = el.clientHeight > 0
        const typing = document.activeElement
        if (typing instanceof HTMLTextAreaElement && el.contains(typing)) return
        if (stuck.current) end()
      })
      const watch = (): void => {
        sizes.disconnect()
        for (const node of [el, ...el.children]) sizes.observe(node)
      }
      const children = new MutationObserver(watch)
      watch()
      children.observe(el, { childList: true })
      el.addEventListener('scroll', onScroll)
      el.addEventListener('scrollend', onScrollEnd)
      return () => {
        sizes.disconnect()
        children.disconnect()
        el.removeEventListener('scroll', onScroll)
        el.removeEventListener('scrollend', onScrollEnd)
        toEnd.current = null
        scroller.current = null
      }
    },
    [stick]
  )

  const follow = useCallback(() => {
    stick(true)
    toEnd.current?.()
  }, [stick])

  return { scroller, ref, follow, away }
}

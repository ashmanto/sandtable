import { useEffect, useRef, useState } from 'react'

/** The matches of `query` in a list, the current one's index, and whether stepping moved to it. */
export type Found = { query: string; ranges: Range[]; at: number; capped: boolean; moved: boolean }

const NONE: Found = { query: '', ranges: [], at: -1, capped: false, moved: false }
const MAX = 1000
const FOLDED = '[data-fold][hidden]'

const textNodes = (root: Node): TreeWalker =>
  document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, (node) =>
    node instanceof Element
      ? node.hasAttribute('data-find-skip')
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_SKIP
      : NodeFilter.FILTER_ACCEPT
  )

const topOf = (range: Range): number => {
  const box = range.getBoundingClientRect()
  if (box.height) return box.top
  return range.startContainer.parentElement?.closest('li')?.getBoundingClientRect().top ?? -Infinity
}

/** Finds `query` case-insensitively in `list`'s text, skipping `data-find-skip` labels, highlights the matches, and opens the folds around the current one. */
export function useFind(
  list: React.RefObject<HTMLElement | null>,
  scroller: React.RefObject<HTMLElement | null>,
  query: string
): [Found, (by: number) => void] {
  const [found, setFound] = useState(NONE)
  const stale = useRef(false)

  useEffect(() => {
    const root = list.current
    const view = scroller.current
    if (!query || !root || !view) return
    const needle = query.toLowerCase()
    const scan = (moved: boolean): void => {
      const ranges: Range[] = []
      const walk = textNodes(root)
      for (let node = walk.nextNode(); node && ranges.length <= MAX; node = walk.nextNode()) {
        const text = (node.textContent ?? '').toLowerCase()
        for (
          let i = text.indexOf(needle);
          i !== -1 && ranges.length <= MAX;
          i = text.indexOf(needle, i + needle.length)
        ) {
          const range = new Range()
          range.setStart(node, i)
          range.setEnd(node, i + needle.length)
          ranges.push(range)
        }
      }
      const capped = ranges.length > MAX
      if (capped) ranges.pop()
      if (moved) {
        const top = view.getBoundingClientRect().top
        const at = Math.max(
          ranges.findIndex((r) => topOf(r) >= top),
          0
        )
        setFound({ query, ranges, at: ranges.length ? at : -1, capped, moved })
        return
      }
      setFound((f) => {
        const was = f.query === query ? f.ranges[f.at] : undefined
        const kept = ranges.findIndex(
          (r) => r.startContainer === was?.startContainer && r.startOffset === was.startOffset
        )
        const at = kept !== -1 ? kept : Math.min(Math.max(f.at, 0), ranges.length - 1)
        return { query, ranges, at, capped, moved }
      })
    }
    scan(true)
    const rescan = (): void => {
      stale.current = !view.checkVisibility()
      if (!stale.current) scan(false)
    }
    const watch = new MutationObserver(rescan)
    watch.observe(root, { childList: true, subtree: true, characterData: true })
    const seen = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting && stale.current) rescan()
    })
    seen.observe(view)
    return () => {
      watch.disconnect()
      seen.disconnect()
    }
  }, [list, scroller, query])

  const shown = query && found.query === query ? found : NONE

  useEffect(() => {
    if (!('highlights' in CSS) || !shown.ranges.length) return
    const all = new Highlight()
    for (const r of shown.ranges) all.add(r)
    CSS.highlights.set('find', all)
    const current = shown.ranges[shown.at]
    if (current) {
      const one = new Highlight()
      one.add(current)
      CSS.highlights.set('find-current', one)
    }
    return () => {
      CSS.highlights.delete('find')
      CSS.highlights.delete('find-current')
    }
  }, [shown])

  useEffect(() => {
    const el = shown.ranges[shown.at]?.startContainer.parentElement
    if (!shown.moved || !el) return
    for (let fold = el.closest(FOLDED); fold; fold = fold.parentElement?.closest(FOLDED) ?? null)
      (fold.previousElementSibling as HTMLElement).click()
    const frame = requestAnimationFrame(() => el.scrollIntoView({ block: 'center' }))
    return () => cancelAnimationFrame(frame)
  }, [shown])

  const step = (by: number): void =>
    setFound((f) => {
      const n = f.ranges.length
      return n ? { ...f, at: (f.at + by + n) % n, moved: true } : f
    })
  return [shown, step]
}

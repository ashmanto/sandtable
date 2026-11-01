import { ChevronDown, ChevronUp, List, X } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { Found } from '@/hooks/useFind'
import { cn, optionId } from '@/lib/utils'
import { Tip } from './Tip'

/** One of your messages: its entry index and first line. */
export type Mine = { at: number; text: string }

/** The find bar that floats over the conversation's top right: a field, the match count, and previous, next, and close buttons. */
export function FindBar({
  inputRef,
  query,
  found,
  onQuery,
  onStep,
  onClose
}: {
  inputRef: React.Ref<HTMLInputElement>
  query: string
  found: Found
  onQuery: (query: string) => void
  onStep: (by: number) => void
  onClose: () => void
}): React.JSX.Element {
  const count = found.ranges.length
  const ready = found.query === query
  const label =
    query && ready
      ? count
        ? `${found.at + 1} of ${count}${found.capped ? '+' : ''}`
        : 'No matches'
      : ''
  const key = `${query}\0${found.at}`
  const [spoken, setSpoken] = useState({ key: '', text: '' })
  if (ready && spoken.key !== key) setSpoken({ key, text: label })
  return (
    <div
      role="search"
      className="absolute top-2 right-4 z-10 flex h-9 origin-top-right animate-in items-center gap-0.5 rounded-card bg-popover pr-1 pl-2.5 shadow-lg ring-1 ring-line-2 duration-150 fade-in-0 zoom-in-95 motion-reduce:animate-none"
    >
      <input
        ref={inputRef}
        autoFocus
        aria-label="Find in conversation"
        placeholder="Find in conversation"
        className="w-50 bg-transparent outline-none placeholder:text-fg-4"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter') {
            e.preventDefault()
            onStep(e.shiftKey ? -1 : 1)
          } else if (e.key === 'Escape') onClose()
        }}
      />
      <span
        aria-hidden
        className={cn(
          'mr-1 min-w-14 text-right text-xs text-fg-3 tabular-nums',
          ready && query && !count && 'text-danger'
        )}
      >
        {label}
      </span>
      <span role="status" className="sr-only">
        {spoken.text}
      </span>
      <Tip label="Previous match" shortcut="⇧↩">
        <Button size="icon-xs" variant="ghost" disabled={!count} onClick={() => onStep(-1)}>
          <ChevronUp />
        </Button>
      </Tip>
      <Tip label="Next match" shortcut="↩">
        <Button size="icon-xs" variant="ghost" disabled={!count} onClick={() => onStep(1)}>
          <ChevronDown />
        </Button>
      </Tip>
      <Tip label="Close" shortcut="Esc">
        <Button size="icon-xs" variant="ghost" onClick={onClose}>
          <X />
        </Button>
      </Tip>
    </div>
  )
}

/** The **Your messages** button and its popover, which scrolls the conversation to the message you pick. */
export function YourMessages({
  mine,
  list,
  scroller
}: {
  mine: Mine[]
  list: React.RefObject<HTMLOListElement | null>
  scroller: React.RefObject<HTMLDivElement | null>
}): React.JSX.Element {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState(0)
  const [current, setCurrent] = useState(-1)
  const shown = mine.filter((m) => m.text.toLowerCase().includes(filter.toLowerCase()))
  const rowOf = (at: number): Element | null | undefined =>
    list.current?.querySelector(`[data-at="${at}"]`)

  useEffect(() => {
    if (open)
      document
        .getElementById(id)
        ?.querySelector('[aria-selected="true"]')
        ?.scrollIntoView({ block: 'nearest' })
  }, [id, open, selected, filter])

  const toggle = (next: boolean): void => {
    if (next) {
      const top = (scroller.current?.getBoundingClientRect().top ?? 0) + 64
      const at = Math.max(
        mine.findLastIndex((m) => (rowOf(m.at)?.getBoundingClientRect().top ?? Infinity) <= top),
        0
      )
      setCurrent(mine[at].at)
      setSelected(at)
      setFilter('')
    }
    setOpen(next)
  }
  const pick = (m: Mine | undefined): void => {
    if (!m) return
    setOpen(false)
    rowOf(m.at)?.scrollIntoView({ block: 'start' })
  }

  return (
    <Popover open={open} onOpenChange={toggle}>
      <Tip label="Your messages">
        <PopoverTrigger asChild>
          <Button
            size="icon-xs"
            variant="ghost"
            className="text-fg-3 aria-expanded:bg-surface-3 aria-expanded:text-fg"
          >
            <List />
          </Button>
        </PopoverTrigger>
      </Tip>
      <PopoverContent
        align="end"
        aria-label="Your messages"
        className="flex max-h-[60vh] w-85 flex-col p-0 ring-1 ring-line-2"
      >
        <Input
          role="combobox"
          aria-label="Filter your messages"
          aria-controls={shown.length ? id : undefined}
          aria-expanded={shown.length > 0}
          aria-autocomplete="list"
          aria-activedescendant={shown[selected] && optionId(id, shown[selected].at)}
          placeholder="Filter your messages"
          className="m-2 mb-1 h-7 w-auto px-2"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value)
            setSelected(0)
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            const by = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
            if (by) {
              e.preventDefault()
              setSelected((s) => Math.min(Math.max(s + by, 0), shown.length - 1))
            } else if (e.key === 'Enter') pick(shown[selected])
          }}
        />
        {shown.length ? (
          <ul role="listbox" id={id} aria-label="Your messages" className="overflow-y-auto p-1">
            {shown.map((m, k) => (
              <li
                key={m.at}
                id={optionId(id, m.at)}
                role="option"
                aria-selected={k === selected}
                aria-current={m.at === current || undefined}
                className={cn(
                  'cursor-default truncate rounded-sm px-1.5 py-1 text-fg-2',
                  k === selected
                    ? 'bg-surface-3 text-fg'
                    : m.at === current && 'bg-neutral-soft text-fg'
                )}
                onMouseMove={() => setSelected(k)}
                onClick={() => pick(m)}
              >
                {m.text}
              </li>
            ))}
          </ul>
        ) : (
          <p role="status" className="p-3 text-fg-3">
            No message matches.
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}

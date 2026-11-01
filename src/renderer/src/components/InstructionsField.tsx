import { Plus } from 'lucide-react'
import { Tabs } from 'radix-ui'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { boardLabels, hasLabel } from '@/lib/labelFilter'
import { onEnter } from '@/lib/utils'
import type { Project } from '../../../shared/types'
import { LabelDot } from './TicketCard'

type Instructions = Project['instructions']

/** Your instructions for a project's ticket sessions: a tab for every ticket and one per label, sharing one field. */
export function InstructionsField({
  value,
  onChange,
  projectId
}: {
  value: Instructions
  onChange: (value: Instructions) => void
  projectId?: string
}): React.JSX.Element {
  const all = value?.all ?? ''
  const labels = value?.labels ?? []
  const [tab, setTab] = useState(-1)
  const [adding, setAdding] = useState(false)
  const [typed, setTyped] = useState('')
  const [suggested, setSuggested] = useState<{ name: string; color: string | null }[]>([])
  const focusField = useRef(false)
  const field = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!projectId) return
    window.sandtable.board.get(projectId).then(
      (v) => setSuggested(boardLabels(v.tickets, [])),
      () => {}
    )
  }, [projectId])

  const names = labels.map((l) => l.label)
  const free = suggested.filter((b) => !hasLabel(names, b.name))
  const colorOf = (label: string): string | null =>
    suggested.find((b) => hasLabel([b.name], label))?.color ?? null
  const current = tab < 0 ? null : labels[tab]

  function open(on: boolean): void {
    setAdding(on)
    if (!on) setTyped('')
  }

  function add(name: string): void {
    const label = name.trim()
    if (!label) return
    const at = names.findIndex((n) => hasLabel([n], label))
    if (at < 0) onChange({ ...value, labels: [...labels, { label, text: '' }] })
    setTab(at < 0 ? labels.length : at)
    focusField.current = true
    open(false)
  }

  return (
    <Tabs.Root value={String(tab)} onValueChange={(v) => setTab(Number(v))}>
      <div className="flex flex-wrap items-center gap-1">
        <Tabs.List aria-label="Instructions for" className="flex flex-wrap gap-1">
          {[{ label: 'Every ticket' }, ...labels].map((l, i) => {
            const color = i > 0 ? colorOf(l.label) : null
            return (
              <Tabs.Trigger
                key={i}
                value={String(i - 1)}
                title={l.label}
                className="highlight flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs text-fg-2 outline-none hover:bg-fg/5 focus-ring data-[state=active]:bg-fg/8 data-[state=active]:text-foreground"
              >
                {color && <LabelDot color={color} />}
                <span className="max-w-40 truncate">{l.label}</span>
              </Tabs.Trigger>
            )
          })}
        </Tabs.List>
        <Popover open={adding} onOpenChange={open}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="xs" aria-label="Add label" className="text-fg-2">
              <Plus />
              Label
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-52 p-1"
            onCloseAutoFocus={(e) => {
              if (!focusField.current) return
              focusField.current = false
              e.preventDefault()
              field.current?.focus()
            }}
          >
            <Input
              aria-label="Label name"
              placeholder="Label name"
              autoComplete="off"
              spellCheck={false}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => onEnter(() => add(typed))(e)}
            />
            {free.length > 0 && (
              <p className="px-2 pt-2 pb-1 text-xs text-fg-3">Labels on this board</p>
            )}
            {free.map((b) => (
              <button
                key={b.name}
                className="highlight flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none hover:bg-surface-3 focus-ring"
                onClick={() => add(b.name)}
              >
                <LabelDot color={b.color} />
                {b.name}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      </div>
      <Tabs.Content value={String(tab)} tabIndex={-1} className="mt-1">
        <Textarea
          ref={field}
          aria-label={
            current ? `Instructions for ${current.label}` : 'Instructions for every ticket'
          }
          className="min-h-24"
          placeholder={
            current
              ? `Added when the ticket has ${current.label}.`
              : 'Added to every ticket session in this project.'
          }
          value={current ? current.text : all}
          onChange={(e) => {
            const text = e.target.value
            onChange(
              current
                ? { ...value, labels: labels.map((l, i) => (i === tab ? { ...l, text } : l)) }
                : { ...value, all: text }
            )
          }}
        />
      </Tabs.Content>
      <span className="mt-1 flex items-center text-xs text-fg-3">
        Sessions get this after Sandtable&apos;s rules. It never goes in the repo.
        {current && (
          <Button
            variant="ghost"
            size="xs"
            title={current.label}
            className="ml-auto text-fg-2"
            onClick={() => {
              onChange({ ...value, labels: labels.filter((_, i) => i !== tab) })
              setTab(-1)
              field.current?.focus()
            }}
          >
            Remove <span className="max-w-40 truncate">{current.label}</span>
          </Button>
        )}
      </span>
    </Tabs.Root>
  )
}

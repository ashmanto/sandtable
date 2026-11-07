import { CircleX } from 'lucide-react'
import { useState } from 'react'
import { badgeClass } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { failureText } from '@/hooks/useOverlapCheck'
import { cn } from '@/lib/utils'
import type { CouldntStart } from '../../../shared/api'
import { shortTime } from '../../../shared/time'
import { skipReason } from '@/lib/runHistory'
import { LastLines } from './SetupBlock'

const linesOf = (e: CouldntStart): string[] => {
  if (e.kind === 'ticket') return [failureText(e), ...(e.lines ?? [])]
  const [first, ...rest] = e.error?.split('\n') ?? []
  return [skipReason({ reason: e.reason, error: first }), ...rest]
}

/** A project's "N couldn't start" line, opening the list of runs that couldn't start and why. */
export function CouldntStartList({
  project,
  entries,
  onOpenTicket,
  onOpenRunHistory
}: {
  project: string
  entries: CouldntStart[]
  onOpenTicket: (ticketKey: string) => void
  onOpenRunHistory: (routineId: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const title = `Couldn't start in ${project}`
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" className="w-full justify-start px-2 font-normal text-fg-2">
          <CircleX aria-hidden className="text-danger" />
          {entries.length} couldn&apos;t start
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="right"
        aria-label={title}
        className="flex max-h-[60vh] w-85 flex-col p-0 ring-1 ring-line-2"
      >
        <h2 className="px-3 pt-2.5 pb-1 text-xs text-fg-3">{title}</h2>
        <ul className="overflow-y-auto p-1">
          {entries.map((e) => {
            const [reason, ...lines] = linesOf(e)
            return (
              <li key={`${e.kind}:${e.kind === 'ticket' ? e.ticketKey : e.routineId}:${e.at}`}>
                <button
                  type="button"
                  className="flex w-full flex-col gap-0.5 rounded-sm px-2 py-1.5 text-left hover:bg-surface-3 focus-visible:bg-surface-3 focus-visible:outline-hidden"
                  onClick={() => {
                    setOpen(false)
                    if (e.kind === 'ticket') onOpenTicket(e.ticketKey)
                    else onOpenRunHistory(e.routineId)
                  }}
                >
                  <span className="flex items-center gap-1.5">
                    <span className={cn(badgeClass, 'bg-neutral-soft text-fg-2')}>
                      {e.kind === 'ticket' ? 'Ticket' : 'Routine'}
                    </span>
                    <span className="truncate font-medium text-fg">{e.name}</span>
                  </span>
                  <span className="text-xs text-fg-2">{reason}</span>
                  <time dateTime={e.at} className="text-xs text-fg-3">
                    {shortTime(e.at)}
                  </time>
                </button>
                {lines.length > 0 && (
                  <div className="px-2 pb-1.5">
                    <LastLines lines={lines} />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

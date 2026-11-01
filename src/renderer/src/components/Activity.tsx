import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useActivity } from '@/hooks/useActivity'
import { runOf, spoken, stepLook, stepText, type Run } from '@/lib/activity'
import { duration } from '@/lib/usage'
import { cn, stop } from '@/lib/utils'
import type { SessionRecord, Step } from '../../../shared/types'

type Props = { session: SessionRecord | undefined }

/** A step's verb and, in monospace, what it acted on. */
export function Words({ step }: { step: Step }): React.JSX.Element {
  return (
    <>
      {stepLook(step).verb} <code className="font-mono">{step.target}</code>
    </>
  )
}

const ago = (at: string, now: number): string => {
  const run = duration(now - Date.parse(at))
  return run === 'under 1m' ? 'just now' : `${run} ago`
}

type TrailProps = { steps: Step[]; now?: number; cut?: boolean }

/** Steps as list items, each with its icon and words and, when it has one, its time. */
function Trail({ steps, now, cut }: TrailProps): React.JSX.Element[] {
  return steps.map((s, i) => {
    const Icon = stepLook(s).icon
    return (
      <li key={i} className="flex items-center gap-2">
        <Icon aria-hidden className="size-3 shrink-0" />
        <span
          title={cut ? stepText(s) : undefined}
          className={cn('min-w-0 flex-1', cut ? 'truncate' : 'wrap-anywhere')}
        >
          <Words step={s} />
        </span>
        {s.at && now !== undefined && (
          <time dateTime={s.at} className="shrink-0 text-fg-3">
            {ago(s.at, now)}
          </time>
        )}
      </li>
    )
  })
}

function Latest({ step, time }: { step: Step; time: Run }): React.JSX.Element {
  const Icon = stepLook(step).icon
  return (
    <>
      <Icon aria-hidden className="size-3 shrink-0 text-blue" />
      <span className="min-w-0 flex-1 truncate">
        <Words step={step} />
      </span>
      {time && (
        <span aria-hidden className="shrink-0 text-fg-3 tabular-nums">
          {time.short}
        </span>
      )}
    </>
  )
}

const named = (step: Step, time: Run): string => `${stepText(step)}${spoken(time)}`
const rowClass = 'flex h-7 items-center gap-2 rounded-lg px-2 text-left text-xs text-fg-2'

type StripProps = {
  row: React.ReactNode
  label?: string
  title?: string
  list?: React.ReactNode
  listLabel: string
  open?: boolean
}

/** The activity strip's inset shell, which setup suggestions share. */
export const insetClass = '-mx-1 flex rounded-lg bg-surface-2 inset-ring inset-ring-border'

/** The inset strip on a card: one row that, given a list, opens it in place; it adopts `open` each time it changes. */
export function Strip({
  row,
  label,
  title,
  list,
  listLabel,
  open: initial = false
}: StripProps): React.JSX.Element {
  const [open, setOpen] = useState(initial)
  const [was, setWas] = useState(initial)
  if (was !== initial) {
    setWas(initial)
    setOpen(initial)
  }
  return (
    <div
      onClick={stop}
      onKeyDown={stop}
      className={cn(insetClass, 'mt-1 flex-col overflow-hidden')}
    >
      {list === undefined ? (
        <div className={rowClass}>{row}</div>
      ) : (
        <>
          <button
            type="button"
            aria-expanded={open}
            aria-label={label}
            title={title}
            onClick={() => setOpen(!open)}
            className={cn(rowClass, 'highlight outline-none hover:bg-surface-3 focus-ring')}
          >
            {row}
            <ChevronRight
              aria-hidden
              className={cn(
                'size-3 shrink-0 text-fg-3 transition-transform duration-(--speed-highlight-out) ease-(--ease-out-quart) motion-reduce:transition-none',
                open && 'rotate-90'
              )}
            />
          </button>
          <div
            aria-hidden={!open}
            className={cn(
              'grid transition-[grid-template-rows] duration-200 ease-(--ease-out-cubic) motion-reduce:transition-none',
              open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
            )}
          >
            <ol
              aria-label={listLabel}
              className={cn(
                'flex min-h-0 flex-col gap-1 overflow-hidden px-2 text-xs text-fg-3',
                open && 'pt-0.5 pb-2'
              )}
            >
              {list}
            </ol>
          </div>
        </>
      )}
    </div>
  )
}

/** A running session's latest step as an inset strip on a card; it opens the earlier steps in place. */
export function ActivityStrip({ session }: Props): React.JSX.Element | null {
  const activity = useActivity(session)
  if (!activity?.steps[0]) return null
  const [latest] = activity.steps
  const { now } = activity
  const time = runOf(activity.since, now)
  const one = activity.steps.length === 1
  return (
    <Strip
      row={
        <>
          <Latest step={latest} time={time} />
          {one && <span className="sr-only">{spoken(time)}</span>}
        </>
      }
      label={`${named(latest, time)}. Show last steps`}
      title={stepText(latest)}
      list={one ? undefined : <Trail steps={activity.steps} now={now} cut />}
      listLabel="Last steps"
    />
  )
}

/** A running session's latest step as a pill for list rows and headers; its tooltip lists the last steps. */
export function ActivityPill({
  session,
  className
}: Props & { className?: string }): React.JSX.Element | null {
  const activity = useActivity(session)
  if (!activity?.steps[0]) return null
  const [latest] = activity.steps
  const { now } = activity
  const time = runOf(activity.since, now)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          tabIndex={0}
          aria-label={named(latest, time)}
          onClick={stop}
          onKeyDown={stop}
          className={cn(
            'highlight flex h-5.5 min-w-0 items-center gap-1.5 rounded-full bg-surface-2 px-2 text-xs text-fg-2 inset-ring inset-ring-border outline-none focus-ring',
            className
          )}
        >
          <Latest step={latest} time={time} />
        </span>
      </TooltipTrigger>
      <TooltipContent align="start" className="min-w-60">
        <p className="mb-1.5 text-fg-3">Last steps</p>
        <ol className="flex flex-col gap-1 text-fg-3 [&>li:first-child]:text-popover-foreground">
          <Trail steps={activity.steps} now={now} />
        </ol>
      </TooltipContent>
    </Tooltip>
  )
}

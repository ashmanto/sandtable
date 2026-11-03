import { Badge } from '@/components/ui/badge'
import { countLabel, stateLook, stateWords, type CardState, type Counted } from '@/lib/card'
import { cn } from '@/lib/utils'
import type { SessionStop } from '../../../shared/types'

export type { CardState }

/** A state as a colored chip with its icon and its name in words; `short` shows Done, session open as Done, `stop` adds a limit's reset time and the failure as a tooltip, and `labelClassName` styles the words. */
export function SessionBadge({
  state,
  stop,
  short = false,
  labelClassName
}: {
  state: CardState
  stop?: SessionStop
  short?: boolean
  labelClassName?: string
}): React.JSX.Element {
  const { icon: Icon, className } = stateLook[state]
  const label = stateWords(state, stop)
  const words =
    short && state === 'doneOpen' ? (
      <>
        Done<span className="sr-only">, session open</span>
      </>
    ) : (
      label
    )
  return (
    <Badge
      className={className}
      title={
        (state === 'limitReached' || state === 'apiError') && stop?.message
          ? stop.message
          : undefined
      }
    >
      <Icon aria-hidden />
      {labelClassName ? <span className={labelClassName}>{words}</span> : words}
    </Badge>
  )
}

/** A state's session count in words, or as its icon and the number labeled in words: "2 running". */
export function SessionCount({
  state,
  count,
  words = false,
  className,
  ...props
}: React.ComponentProps<'span'> & {
  state: Counted
  count: number
  words?: boolean
}): React.JSX.Element {
  const label = countLabel[state](count)
  const { icon: Icon, className: colors } = stateLook[state]
  const chip = cn('inline-flex shrink-0 items-center rounded-full text-xs', colors, className)
  return words ? (
    <span className={cn(chip, 'px-2')}>{label}</span>
  ) : (
    <span
      title={label}
      {...props}
      role="img"
      aria-label={label}
      className={cn(chip, 'gap-0.5 px-1.5')}
    >
      <Icon aria-hidden className="size-3" />
      {count}
    </span>
  )
}

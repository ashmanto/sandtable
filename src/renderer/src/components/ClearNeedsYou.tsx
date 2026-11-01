import { ChevronsUp, CirclePause, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Tip } from './Tip'
import type { SessionRecord } from '../../../shared/types'

type Props = {
  session: SessionRecord
  run: (action: () => Promise<void>) => unknown
  disabled?: boolean
  icon?: boolean
  className?: string
}

function SessionAction({
  session,
  run,
  disabled,
  icon,
  className,
  label,
  Icon,
  action
}: Props & {
  label: string
  Icon: LucideIcon
  action: (id: string) => Promise<void>
}): React.JSX.Element {
  const button = (
    <Button
      variant={icon ? 'ghost' : 'outline'}
      size={icon ? 'icon-xs' : 'xs'}
      className={cn('h-5', className)}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        void run(() => action(session.id))
      }}
    >
      {icon ? <Icon className="size-3.5" /> : label}
    </Button>
  )
  return icon ? (
    <Tip label={session.name ? `${label} for ${session.name}` : label}>{button}</Tip>
  ) : (
    button
  )
}

/** Moves a Needs you session to Idle; renders nothing in any other state or while capped, where RaiseCap takes its place. */
export const ClearNeedsYou = (props: Props): React.JSX.Element | null =>
  props.session.state === 'needsYou' && !props.session.capped ? (
    <SessionAction
      {...props}
      label="Clear Needs you"
      Icon={CirclePause}
      action={(id) => window.sandtable.sessions.clearNeedsYou(id)}
    />
  ) : null

/** Lets a session stopped at its token cap run on; renders nothing unless it's capped. */
export const RaiseCap = (props: Props): React.JSX.Element | null =>
  props.session.capped ? (
    <SessionAction
      {...props}
      label="Raise cap"
      Icon={ChevronsUp}
      action={(id) => window.sandtable.sessions.raiseCap(id)}
    />
  ) : null

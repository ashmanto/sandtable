import { RadioTower } from 'lucide-react'
import { useId } from 'react'
import { Switch } from '@/components/ui/switch'
import { useRun } from '@/hooks/useRun'
import type { SessionRecord } from '../../../shared/types'
import { Tip } from './Tip'

const HOVER =
  'Follow and steer this session from claude.ai or the Claude app on any device signed in to your account. Turning it off restarts Claude Code in the same conversation.'

/** The side panel's Remote Control switch for a session, with why it's disabled on hover. */
export function RemoteToggle({ session }: { session: SessionRecord }): React.JSX.Element {
  const { error, pending, run } = useRun()
  const id = useId()
  const on = !!session.remoteControl
  const why =
    on && session.state === 'running'
      ? 'Wait until the session needs you to turn Remote Control off'
      : !on && session.asking && session.state !== 'finished'
        ? 'Claude is asking you something. Answer it in the terminal first.'
        : undefined
  return (
    <div className="flex flex-col gap-1.5">
      <div title={why ?? HOVER} className="flex items-center justify-between gap-3">
        <span className="flex flex-col">
          <label htmlFor={id} className="text-sm">
            Remote Control
          </label>
          <span id={`${id}-note`} className="text-fg-3">
            {why ?? 'Use this session from claude.ai or the Claude app'}
          </span>
          {!why && (
            <span id={`${id}-restart`} className="sr-only">
              Turning it off restarts Claude Code in the same conversation.
            </span>
          )}
        </span>
        <Switch
          id={id}
          aria-describedby={why ? `${id}-note` : `${id}-note ${id}-restart`}
          checked={on}
          disabled={pending || !!why}
          onCheckedChange={(next) =>
            void run(() => window.sandtable.sessions.setRemoteControl(session.id, next))
          }
        />
      </div>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

/** A card's quiet mark that a session has Remote Control on. */
export function RemoteMark(): React.JSX.Element {
  return (
    <Tip label="Remote Control on">
      <span
        role="img"
        tabIndex={0}
        className="shrink-0 rounded-sm text-fg-3 outline-none focus-ring"
      >
        <RadioTower aria-hidden className="size-3.5" />
      </span>
    </Tip>
  )
}

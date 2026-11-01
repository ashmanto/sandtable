import { ScanSearch } from 'lucide-react'
import { useId } from 'react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useRun } from '@/hooks/useRun'
import { plural } from '@/lib/utils'
import { clock } from '../../../shared/time'
import { AUTO_REVIEW_ROUNDS, type Project, type SessionRecord } from '../../../shared/types'

/** The side panel's Automatic review switch for a ticket session, with the round that runs. */
export function AutoReviewToggle({
  session,
  project,
  onOpenChanges
}: {
  session: SessionRecord
  project: Project
  onOpenChanges?: () => void
}): React.JSX.Element {
  const { error, pending, run } = useRun()
  const id = useId()
  const on = session.autoReview?.on ?? !!project.autoReview
  const round = session.state === 'reviewing' ? session.reviewRounds?.at(-1) : undefined
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="flex flex-col">
          <label htmlFor={id} className="text-sm">
            Automatic review
          </label>
          <span id={`${id}-note`} className="text-fg-3">
            Review the changes when Claude ends its turn with an open pull request
          </span>
        </span>
        <Switch
          id={id}
          aria-describedby={`${id}-note`}
          checked={on}
          disabled={pending}
          onCheckedChange={(next) =>
            void run(() => window.sandtable.sessions.setAutoReview(session.id, next))
          }
        />
      </div>
      {round && (
        <div className="flex flex-col gap-1.5 rounded-card bg-blue-soft p-3">
          <p className="flex items-center gap-1.5 text-sm font-medium text-blue">
            <ScanSearch aria-hidden className="size-3.5 soft-pulse" />
            Reviewing
          </p>
          <p className="text-fg-3">
            Round {round.round} of {AUTO_REVIEW_ROUNDS} · {plural(round.files, 'changed file')} ·
            started {clock(round.startedAt)}. High findings go to Claude when it ends.
          </p>
          {onOpenChanges && (
            <Button size="xs" variant="outline" className="w-fit" onClick={onOpenChanges}>
              Open Changes
            </Button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

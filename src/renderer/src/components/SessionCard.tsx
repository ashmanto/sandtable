import { X } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { useRiseOnChange } from '@/hooks/useRiseOnChange'
import { useLiveUsage } from '@/hooks/useLiveUsage'
import { useRun } from '@/hooks/useRun'
import { cardClass } from '@/lib/card'
import { cleanUp } from '@/lib/cleanUp'
import { cn } from '@/lib/utils'
import { folderRepo, isLive, sessionDir } from '../../../shared/sessions'
import type { SessionRecord } from '../../../shared/types'
import { ActivityStrip } from './Activity'
import { ClearNeedsYou, RaiseCap } from './ClearNeedsYou'
import { RemoteMark } from './RemoteToggle'
import { ModelName } from './ModelChoice'
import { SessionBadge } from './SessionBadge'
import { Tip } from './Tip'
import { CardUsage } from './Usage'

/** Where a session runs: its repo, then "main checkout" or its branch in monospace. */
function SessionPlace({ session }: { session: SessionRecord }): React.JSX.Element {
  const dir = sessionDir(session) ?? ''
  return (
    <span className="flex min-w-0 items-center gap-2 text-xs">
      <span>{folderRepo(session, dir)}</span>
      <span className={cn('truncate', session.branch && 'font-mono')}>
        {session.branch ?? 'main checkout'}
      </span>
    </span>
  )
}

/** A session without a ticket on the board: name, state, repo, and where it runs. */
export function SessionCard({
  session,
  cap,
  onOpen
}: {
  session: SessionRecord
  cap?: number
  onOpen: () => void
}): React.JSX.Element {
  const ref = useRiseOnChange<HTMLDivElement>(session.state)
  const { error, pending, run } = useRun()
  const usage = useLiveUsage(session.id)
  return (
    <div
      data-slot="card"
      ref={ref}
      role="group"
      aria-label={session.name}
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if ((e.key !== 'Enter' && e.key !== ' ') || e.target !== e.currentTarget) return
        e.preventDefault()
        onOpen()
      }}
      className={cn(cardClass, 'w-60 shrink-0')}
    >
      <div className="flex items-center gap-2">
        <p className="min-w-0 truncate leading-snug">{session.name}</p>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <ModelName model={session.model} />
          <SessionBadge state={session.state} stop={session.stop} />
        </span>
        {!session.removedAt && <EndSession session={session} run={run} disabled={pending} />}
      </div>
      <div className="text-muted-foreground">
        <SessionPlace session={session} />
      </div>
      <ActivityStrip session={session} />
      {usage && <CardUsage usage={usage} cap={cap} capped={session.capped} />}
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex items-center gap-1.5 empty:hidden">
        {session.remoteControl && !session.removedAt && <RemoteMark />}
        <ClearNeedsYou session={session} run={run} disabled={pending} />
        <RaiseCap session={session} run={run} disabled={pending} />
      </div>
    </div>
  )
}

function EndSession({
  session,
  run,
  disabled
}: {
  session: SessionRecord
  run: ReturnType<typeof useRun>['run']
  disabled: boolean
}): React.JSX.Element {
  const live = isLive(session)
  const worktree = session.worktrees.length > 0
  const label = live ? 'End session' : 'Remove session'
  const confirm = live
    ? worktree
      ? 'End session and remove worktree'
      : 'End session and remove'
    : worktree
      ? 'Remove worktree'
      : 'Remove from list'
  return (
    <span className="-my-1 shrink-0" onClick={(e) => e.stopPropagation()}>
      <AlertDialog>
        <Tip label={label}>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="size-5 opacity-0 group-focus-within/card:opacity-100 group-hover/card:opacity-100"
              disabled={disabled}
            >
              <X className="size-3.5" />
            </Button>
          </AlertDialogTrigger>
        </Tip>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {label} {session.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {worktree
                ? 'A worktree with uncommitted or unpushed changes is kept.'
                : 'It leaves the Sessions strip and the sidebar.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void run(() => cleanUp(session.id, live, worktree))}
            >
              {confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </span>
  )
}

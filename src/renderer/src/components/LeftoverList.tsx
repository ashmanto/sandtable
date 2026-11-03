import { LoaderCircle, Square, Trash2 } from 'lucide-react'
import { Fragment, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { actionLabels, isLive } from '../../../shared/sessions'
import type { Leftover } from '../../../shared/types'
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
import { useLeftovers } from '@/hooks/useLeftovers'
import { useRun } from '@/hooks/useRun'
import { cleanUp } from '@/lib/cleanUp'
import { cn, errorMessage } from '@/lib/utils'
import { SessionBadge } from './SessionBadge'
import { Problem } from './StepFlow'
import { Tip } from './Tip'

const REASONS = ['Done', 'Off the board', 'Removed project', 'Unknown session'] as const

function reasonOf(l: Leftover): (typeof REASONS)[number] {
  if (l.kind === 'unknown') return 'Unknown session'
  if (l.project === null) return 'Removed project'
  return l.done ? 'Done' : 'Off the board'
}

const KEEPS = 'A worktree with uncommitted or unpushed changes stays.'

function consequence(l: Leftover, live: boolean): string {
  if (l.kind === 'unknown')
    return 'Ends the tmux session. Sandtable has no worktree on record for it.'
  if (l.keepWorktree) return 'Ends the session. Its worktree stays, because a card still uses it.'
  return live
    ? `Ends the session and removes its worktree. ${KEEPS}`
    : `Removes the worktree. ${KEEPS}`
}

const keyOf = (l: Leftover): string => (l.kind === 'unknown' ? l.tmuxName : l.session.id)

async function cleanUpOne(l: Leftover): Promise<string | undefined> {
  if (l.kind === 'unknown') return void (await window.sandtable.sessions.endUnknown(l.tmuxName))
  if (l.keepWorktree) return void (await window.sandtable.sessions.end(l.session.id))
  const line = await cleanUp(l.session.id, isLive(l.session))
  return line.danger ? line.text : undefined
}

/** Every leftover session, each with the cleanup a card would offer, and Clean up all in `allIn` if given. */
export function LeftoverList({
  allIn,
  onPendingChange
}: {
  allIn?: HTMLElement | null
  onPendingChange?: (pending: boolean) => void
}): React.JSX.Element {
  const { leftovers, loadError, load } = useLeftovers()
  const [refused, setRefused] = useState<Record<string, string>>({})
  const [working, setWorking] = useState<string | null>(null)
  const { error, busy, pending, run } = useRun()
  useEffect(() => onPendingChange?.(pending), [pending, onPendingChange])
  const place = (node: React.ReactNode): React.ReactNode =>
    allIn === undefined ? node : allIn && createPortal(node, allIn)

  function act(l: Leftover, busyLabel: string): void {
    setWorking(keyOf(l))
    void run(async () => {
      const reason = await cleanUpOne(l)
      setRefused((r) => ({ ...r, [keyOf(l)]: reason ?? '' }))
      await load()
    }, busyLabel).then(() => setWorking(null))
  }

  function actAll(all: Leftover[]): void {
    setWorking(null)
    void run(async () => {
      for (const l of all) {
        const reason = await cleanUpOne(l).catch(errorMessage)
        setRefused((r) => ({ ...r, [keyOf(l)]: reason ?? '' }))
      }
      await load()
    }, 'Cleaning up')
  }

  return (
    <>
      <p className="text-xs text-fg-2">
        Sessions and worktrees that no card or sidebar row shows, and those of done tickets. Nothing
        is ended or removed until you click.
      </p>
      {leftovers?.length === 0 && <p className="text-fg-2">None. There is nothing to clean up.</p>}
      {leftovers &&
        leftovers.length > 1 &&
        place(
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" className="self-start" disabled={pending}>
                {pending && working === null ? busy : 'Clean up all'}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clean up {leftovers.length} sessions?</AlertDialogTitle>
                <AlertDialogDescription>
                  This ends running sessions and removes their worktrees. A worktree with
                  uncommitted or unpushed changes stays, and its row says why.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => actAll(leftovers)}>
                  Clean up
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      {leftovers && leftovers.length > 0 && (
        <div className="divide-y divide-line rounded-card bg-card">
          {[...leftovers]
            .sort((a, b) => REASONS.indexOf(reasonOf(a)) - REASONS.indexOf(reasonOf(b)))
            .map((l) => {
              const key = keyOf(l)
              const live = l.kind === 'session' && isLive(l.session)
              const [label, busyLabel] =
                l.kind === 'unknown' || l.keepWorktree
                  ? ['End session', 'Ending session']
                  : actionLabels[live ? 'endSession' : 'removeWorktree']
              const busyHere = pending && working === key
              const name = l.kind === 'unknown' ? 'Unknown session' : l.name
              return (
                <div
                  key={key}
                  role="group"
                  aria-label={l.kind === 'unknown' ? `${name} ${l.tmuxName}` : name}
                  className="flex items-center gap-2 py-2.5 pr-2 pl-3"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span
                        className={cn(
                          'max-w-[70%] shrink-0 truncate',
                          (l.kind === 'unknown' || l.session.ticketKey) && 'font-mono'
                        )}
                      >
                        {name}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-fg-2">
                        {l.kind === 'session' && l.title}
                      </span>
                      {l.kind === 'session' && (
                        <SessionBadge
                          state={l.done && live ? 'doneOpen' : l.session.state}
                          stop={l.session.stop}
                        />
                      )}
                    </span>
                    <span className="flex min-w-0 text-xs text-fg-2">
                      {l.kind === 'unknown' ? (
                        <span className="truncate font-mono">{l.tmuxName}</span>
                      ) : (
                        <>
                          <span className="shrink-0 font-medium text-fg">{reasonOf(l)}</span>
                          {[l.project, l.repo].filter(Boolean).map((part) => (
                            <Fragment key={part}>
                              <span className="shrink-0 whitespace-pre"> · </span>
                              <span className="min-w-0 truncate">{part}</span>
                            </Fragment>
                          ))}
                          {l.session.branch && (
                            <>
                              <span className="shrink-0 whitespace-pre"> · </span>
                              <span className="min-w-24 flex-1 basis-0 truncate font-mono">
                                {l.session.branch}
                              </span>
                            </>
                          )}
                        </>
                      )}
                    </span>
                    {refused[key] && <p className="text-xs text-danger">{refused[key]}</p>}
                  </span>
                  <Tip
                    label={`${label}. ${consequence(l, live)}`}
                    aria-label={busyHere ? busyLabel : label}
                  >
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="self-start"
                      disabled={pending}
                      onClick={() => act(l, busyLabel)}
                    >
                      {busyHere ? (
                        <LoaderCircle className="animate-spin motion-reduce:animate-none" />
                      ) : label === 'End session' ? (
                        <Square />
                      ) : (
                        <Trash2 />
                      )}
                    </Button>
                  </Tip>
                </div>
              )
            })}
        </div>
      )}
      {loadError && <Problem title={loadError} />}
      {error && <Problem title={error} />}
    </>
  )
}

import { ChevronDown, Clock, Copy, History, Pencil, Play, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { useAfterMenu } from '@/hooks/useAfterMenu'
import { onRunHistoryAsk, skipReason } from '@/lib/runHistory'
import { stateLook } from '@/lib/card'
import { cardUsage, hasPrice, money, pricedTotal } from '@/lib/usage'
import { cn, errorMessage, plural } from '@/lib/utils'
import { scheduleLabel } from '../../../shared/routines'
import { isLive } from '../../../shared/sessions'
import { shortTime } from '../../../shared/time'
import type {
  Project,
  Routine,
  RoutineRun,
  SessionRecord,
  SessionState
} from '../../../shared/types'
import type { OpenRoutine } from './RoutineEditor'
import { SessionBadge } from './SessionBadge'
import { SheetBar } from './SheetBar'
import { Tip } from './Tip'

const ring = 'outline-none focus-ring'

const startedBy = (run: RoutineRun): string =>
  run.trigger?.kind === 'label'
    ? `Label ${run.trigger.label} on ${run.trigger.ticket}`
    : run.trigger?.kind === 'checks'
      ? `Checks failed on ${run.trigger.ticket}`
      : run.scheduled
        ? 'On schedule'
        : 'Started by you'

const openPill: Partial<Record<SessionState, string>> = {
  running: 'bg-blue-soft text-blue inset-ring-blue/40 hover:bg-blue-soft',
  needsYou: 'bg-amber-soft text-amber hover:bg-amber-soft',
  idle: 'bg-neutral-soft text-fg-2 hover:bg-neutral-soft',
  done: 'bg-added-soft text-added hover:bg-added-soft'
}

/** The board's Routines section: a pill per routine that starts it, with Edit routine, Copy to project, and Run history, and New routine. */
export function Routines({
  project,
  projects,
  routines,
  sessions,
  onRoutine,
  onOpenSession,
  loaded = true
}: {
  project: Project
  projects: Project[]
  loaded?: boolean
  routines: Routine[]
  sessions: SessionRecord[]
  onRoutine: OpenRoutine
  onOpenSession: (sessionId: string) => void
}): React.JSX.Element {
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<{ routine: Routine; opened: number } | null>(null)
  const [shown, setShown] = useState(false)
  const [starting, setStarting] = useState<string[]>([])
  const { later, afterMenu } = useAfterMenu()
  useEffect(
    () =>
      onRunHistoryAsk(project.id, loaded ? routines.map((r) => r.id) : null, (id) => {
        const r = routines.find((x) => x.id === id)!
        setHistory((h) => ({ routine: r, opened: (h?.opened ?? 0) + 1 }))
        setShown(true)
      }),
    [project.id, loaded, routines]
  )
  const start = (r: Routine): void => {
    setError(null)
    setStarting((ids) => [...ids, r.id])
    window.sandtable.routines
      .start(r.id)
      .catch((err) => setError(`Couldn't start ${r.name}: ${errorMessage(err)}`))
      .finally(() => setStarting((ids) => ids.filter((id) => id !== r.id)))
  }
  return (
    <section aria-label="Routines" className="flex flex-col gap-2 p-3 pt-1">
      <h2 className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        Routines
        <span className="text-fg-3">{routines.length}</span>
      </h2>
      <div className="flex flex-wrap gap-1.5">
        {routines.map((r) => {
          const live = sessions.filter((s) => s.routineId === r.id && isLive(s))
          const pending = starting.includes(r.id)
          const open = pending ? undefined : (live.find((s) => s.state !== 'done') ?? live.at(-1))
          const busy = !!open && open.state !== 'done'
          const look = open && stateLook[open.state]
          const status = pending ? 'Starting' : look?.label
          const runs =
            r.schedule &&
            `Runs ${scheduleLabel(r.schedule).replace(/^(Every|Week)/, (w) => w.toLowerCase())}`
          const action = busy
            ? `${r.name}'s last session is still open`
            : open
              ? `Start ${r.name}. Its last run is done`
              : pending
                ? `Starting ${r.name}`
                : `Start ${r.name}`
          return (
            <span
              key={r.id}
              className={cn(
                'inline-flex h-6 items-stretch rounded-full bg-surface text-fg-2 inset-ring inset-ring-line-2 hover:bg-card',
                open && openPill[open.state]
              )}
            >
              <Tip label={runs ? `${action}. ${runs}.` : open && !busy ? `${action}.` : action}>
                <button
                  type="button"
                  aria-disabled={busy || pending || undefined}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-l-full pr-1.5 pl-2.5 [&_svg]:size-3',
                    ring
                  )}
                  onClick={() => !busy && !pending && start(r)}
                >
                  {look ? (
                    <look.icon aria-hidden />
                  ) : (
                    <Play aria-hidden className="text-accent-bright" />
                  )}
                  {r.name}
                  {runs && <Clock role="img" aria-label={runs} className="text-fg-3" />}
                  {status && <span className="text-xs text-fg-3">{status}</span>}
                </button>
              </Tip>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Tip label={`More for ${r.name}`}>
                    <button
                      type="button"
                      className={cn(
                        'inline-flex items-center rounded-r-full pr-2 pl-1 text-fg-3 hover:text-fg',
                        ring
                      )}
                    >
                      <ChevronDown aria-hidden className="size-3" />
                    </button>
                  </Tip>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="min-w-40"
                  onCloseAutoFocus={afterMenu}
                >
                  <DropdownMenuItem onSelect={() => later(() => onRoutine(project, r))}>
                    <Pencil />
                    Edit routine
                  </DropdownMenuItem>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Copy />
                      Copy to project…
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {projects.map((p) => (
                        <DropdownMenuItem
                          key={p.id}
                          onSelect={() =>
                            later(() =>
                              onRoutine(p, undefined, {
                                name: r.name,
                                repo: r.repo,
                                worktree: r.worktree,
                                message: r.message,
                                allow: r.allow,
                                schedule: r.schedule,
                                on: r.on,
                                dailyCap: r.dailyCap,
                                model: r.model,
                                effort: r.effort,
                                copiedFrom: { project: project.name, repo: r.repo }
                              })
                            )
                          }
                        >
                          {p.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuItem
                    onSelect={() =>
                      later(() => {
                        setHistory((h) => ({ routine: r, opened: (h?.opened ?? 0) + 1 }))
                        setShown(true)
                      })
                    }
                  >
                    <History />
                    Run history
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </span>
          )
        })}
        <Tip
          label="Save a way to start a session in one click or on a schedule"
          aria-label={undefined}
        >
          <button
            type="button"
            className={cn(
              'inline-flex h-6 items-center gap-1 rounded-full border border-dashed border-line-2 px-2.5 text-fg-3 hover:border-fg-4 hover:bg-card hover:text-fg-2 [&_svg]:size-3',
              ring
            )}
            onClick={() => onRoutine(project)}
          >
            <Plus aria-hidden />
            New routine
          </button>
        </Tip>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      <Sheet open={shown} onOpenChange={setShown}>
        {history && (
          <RunHistory
            key={history.opened}
            routine={history.routine}
            onOpen={(id) => {
              setShown(false)
              onOpenSession(id)
            }}
          />
        )}
      </Sheet>
    </section>
  )
}

function RunHistory({
  routine,
  onOpen
}: {
  routine: Routine
  onOpen: (sessionId: string) => void
}): React.JSX.Element {
  const [runs, setRuns] = useState<RoutineRun[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    window.sandtable.routines.history(routine.id).then(
      (runs) => live && setRuns(runs),
      (err) => live && setError(`Couldn't read the run history: ${errorMessage(err)}`)
    )
    return () => {
      live = false
    }
  }, [routine.id])
  const ran = runs?.flatMap((r) => (r.kind === 'session' ? [r] : [])) ?? []
  const usage = ran.flatMap((r) => r.usage)
  return (
    <SheetContent aria-describedby={undefined}>
      <SheetBar title={`${routine.name}: run history`} />
      {runs && (
        <p className="flex shrink-0 gap-4 border-b px-4 py-3 text-xs text-fg-2">
          <span>{plural(ran.length, 'run')}</span>
          <span>{runs.length - ran.length} skipped</span>
          {hasPrice(usage) && <span>{money(pricedTotal(usage))} API estimate</span>}
        </p>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-3">
        {error && <p className="text-xs text-danger">{error}</p>}
        {!runs && !error && <p className="text-xs text-fg-3">Loading</p>}
        {runs?.length === 0 && <p className="text-xs text-fg-3">No runs yet</p>}
        <ul className="flex flex-col gap-2">
          {runs?.map((run) => (
            <li
              key={
                run.kind === 'session'
                  ? run.sessionId
                  : `${run.at}-skipped-${run.trigger?.ticket ?? ''}-${run.trigger?.kind ?? ''}`
              }
              className={cn(
                'flex flex-col gap-1 rounded-card px-3 py-2.5 inset-ring inset-ring-border',
                run.kind === 'session' && 'bg-card'
              )}
            >
              <div className="flex items-center gap-2">
                <span>{shortTime(run.at)}</span>
                {run.kind === 'session' ? (
                  <SessionBadge state={run.state} />
                ) : (
                  <Badge className="bg-transparent text-fg-3 ring-1 ring-line-2 ring-inset">
                    <Clock aria-hidden />
                    Skipped
                  </Badge>
                )}
                {run.kind === 'session' && !run.removed && (
                  <Button
                    variant="outline"
                    size="xs"
                    className="ml-auto"
                    onClick={() => onOpen(run.sessionId)}
                  >
                    Open
                  </Button>
                )}
              </div>
              <p className="flex flex-wrap gap-x-2 text-xs text-fg-3">
                <span>{startedBy(run)}</span>
                {run.kind === 'session' && (
                  <>
                    <span className={cn(run.place !== 'main checkout' && 'font-mono')}>
                      {run.place}
                    </span>
                    {cardUsage(run.usage) && <span>{cardUsage(run.usage)}</span>}
                  </>
                )}
              </p>
              {run.kind === 'session' && run.waitingFor && (
                <p className="text-amber">
                  Waiting on <span className="font-mono break-all">{run.waitingFor}</span>
                </p>
              )}
              {run.kind === 'session' && run.warning && (
                <p className="text-danger">{run.warning}</p>
              )}
              {run.kind === 'skipped' ? (
                <p className="whitespace-pre-line text-fg-3">{skipReason(run)}</p>
              ) : (
                run.lastMessage && <p className="line-clamp-2 text-fg-2">{run.lastMessage}</p>
              )}
            </li>
          ))}
        </ul>
      </div>
    </SheetContent>
  )
}

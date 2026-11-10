import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { SetupRun } from '@/hooks/startFlow'
import { runOf, spoken } from '@/lib/activity'
import { cn, stop } from '@/lib/utils'
import { findRepo } from '../../../shared/repo'
import type { Project } from '../../../shared/types'
import { Strip } from './Activity'
import { Spinner } from './StepFlow'

const SHOWN_LINES = 10

/** A worktree setup running or failed before a start, in the overlap check's shape. */
export function SetupBlock({
  progress,
  project,
  startAnyway,
  cancel,
  className
}: SetupRun & { project: Project; className?: string }): React.JSX.Element | null {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  if (!progress) return null
  const failed = progress.state === 'failed'
  const { lines } = progress
  const latest = lines.at(-1)
  const command = findRepo(project.repos, progress.repo)?.setup?.command
  const repo = project.repos.length > 1 ? ` for ${progress.repo.split('/').pop()}` : ''
  const time = failed ? null : runOf(progress.startedAt, now)
  return (
    <div className={cn('flex flex-col gap-1.5 text-xs', className)} onClick={stop}>
      <div role="status" className="flex flex-col gap-1 text-fg-2">
        {failed ? (
          <p className="text-danger">Setup failed: {progress.error}</p>
        ) : (
          <p className="flex min-w-0 items-center gap-1.5">
            <Spinner />
            {command ? (
              <span className="min-w-0 truncate">
                Setting up the worktree{repo}: <code className="font-mono">{command}</code>
              </span>
            ) : (
              `Copying files into the worktree${repo}`
            )}
          </p>
        )}
        {progress.notes.map((n, i) => (
          <p key={i} className="text-fg-3">
            {n}
          </p>
        ))}
      </div>
      {(latest !== undefined || (command && !failed)) && (
        <Strip
          open={failed}
          row={
            <>
              <span
                className={cn(
                  'min-w-0 flex-1 truncate',
                  latest === undefined ? 'text-fg-3' : 'font-mono'
                )}
              >
                {latest ?? 'Waiting for output'}
              </span>
              {time && (
                <span aria-hidden className="shrink-0 text-fg-3 tabular-nums">
                  {time.short}
                </span>
              )}
              {lines.length < 2 && <span className="sr-only">{spoken(time)}</span>}
            </>
          }
          label={`${latest}${spoken(time)}. Show last lines`}
          title={latest}
          list={
            lines.length < 2
              ? undefined
              : lines.slice(-SHOWN_LINES).map((line, i) => (
                  <li key={i} className="font-mono wrap-anywhere">
                    {line}
                  </li>
                ))
          }
          listLabel="Last lines"
        />
      )}
      <div className="flex gap-1.5">
        {failed && startAnyway && (
          <Button variant="outline" size="xs" className="h-5" onClick={startAnyway}>
            Start anyway
          </Button>
        )}
        <Button variant="ghost" size="xs" className="h-5" onClick={cancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/** A failed setup's saved last lines, under the failure. */
export function LastLines({ lines }: { lines: string[] }): React.JSX.Element {
  return (
    <ul aria-label="Last lines" className="font-mono text-xs wrap-anywhere text-fg-3">
      {lines.slice(-SHOWN_LINES).map((line, i) => (
        <li key={i}>{line}</li>
      ))}
    </ul>
  )
}

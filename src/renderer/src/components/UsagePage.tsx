import { useState } from 'react'
import { useLoad } from '@/hooks/useLoad'
import { mergeUsage } from '../../../shared/pricing'
import type { ModelUsage, Project, UsageByWeek, WeekUsage } from '../../../shared/types'
import {
  duration,
  hasPrice,
  hasUnpriced,
  percent,
  throughputByWeek,
  totalTokens,
  weekLabel
} from '@/lib/usage'
import { cn } from '@/lib/utils'
import { ProjectTile } from './ProjectTile'
import { Spinner } from './StepFlow'
import { Estimate, Num, Usage, Worked } from './Usage'
import { BackView } from './ViewHeader'

type Entry = { project?: Project; weeks: WeekUsage[]; usage: ModelUsage[] }

const marked = (usage: ModelUsage[]): boolean => hasPrice(usage) && hasUnpriced(usage)

const Tokens = ({ usage }: { usage: ModelUsage[] }): React.JSX.Element => (
  <Num n={totalTokens(usage)} sr="tokens" />
)

const oneDecimal = new Intl.NumberFormat('en', { maximumFractionDigits: 1 })

const Figure = ({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element => (
  <div>
    <dt className="text-xs text-fg-3">{label}</dt>
    <dd className="tabular-nums">{children}</dd>
  </div>
)

const Bar = ({ share, className }: { share: number; className: string }): React.JSX.Element => (
  <span aria-hidden className={cn('overflow-hidden rounded-full bg-line-2', className)}>
    <span className="block h-full rounded-full bg-fg-3" style={{ width: `${share * 100}%` }} />
  </span>
)

function Body({ projects, rows }: { projects: Project[]; rows: UsageByWeek }): React.JSX.Element {
  const [selected, setSelected] = useState<string | null>(null)
  const entries = rows.projects
    .flatMap(({ projectId, weeks }) => {
      const project = projects.find((p) => p.id === projectId)
      return project ? [{ project, weeks, usage: mergeUsage(weeks.flatMap((w) => w.usage)) }] : []
    })
    .sort((a, b) => totalTokens(b.usage) - totalTokens(a.usage))
  const all = mergeUsage(rows.all.flatMap((w) => w.usage))
  if (!entries.length) return <p className="m-6 text-fg-2">No token use yet</p>

  const allEntry: Entry = { weeks: rows.all, usage: all }
  const shown = entries.find((e) => e.project.id === selected) ?? allEntry
  const most = Math.max(...shown.weeks.map((w) => totalTokens(w.usage)))
  const throughput = throughputByWeek(
    rows.merged.filter((m) => !shown.project || m.projectIds.includes(shown.project.id))
  )
  const item =
    'highlight grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-0.5 rounded-md p-2 text-left outline-none hover:bg-surface-3 focus-ring aria-[current=true]:bg-surface-3 aria-[current=true]:shadow-[inset_0_0_0_1px_var(--line-2)]'

  return (
    <div className="flex min-h-0 flex-1">
      <ul
        aria-label="Projects"
        className="flex w-65 shrink-0 flex-col overflow-y-auto border-r p-2"
      >
        <li>
          <button
            type="button"
            className={item}
            aria-current={shown === allEntry || undefined}
            onClick={() => setSelected(null)}
          >
            <span className="truncate">All projects</span>
            <Tokens usage={all} />
          </button>
        </li>
        {entries.map(({ project, usage }) => (
          <li key={project.id}>
            <button
              type="button"
              className={item}
              aria-current={shown.project === project || undefined}
              onClick={() => setSelected(project.id)}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <ProjectTile name={project.name} icon={project.icon} />
                <span className="truncate">{project.name}</span>
              </span>
              <Tokens usage={usage} />
              <Bar share={totalTokens(usage) / totalTokens(all)} className="col-span-2 h-1" />
              <span className="text-xs text-fg-3">
                {percent(totalTokens(usage), totalTokens(all))} of all use
              </span>
              <Estimate usage={usage} className="text-xs text-fg-3" />
            </button>
          </li>
        ))}
      </ul>
      <div className="min-w-0 flex-1 overflow-y-auto p-6">
        <div className="flex max-w-140 flex-col gap-2">
          <h2 className="text-xs text-fg-3">{shown.project?.name ?? 'All projects'}</h2>
          <Usage usage={shown.usage} workMs={shown.weeks.reduce((n, w) => n + w.workMs, 0)} />
          <h3 id="by-week" className="mt-3 text-xs font-medium text-fg-3">
            By week
          </h3>
          <ul
            aria-labelledby="by-week"
            className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] gap-x-3 divide-y"
          >
            {shown.weeks.map(({ week, usage, workMs }) => (
              <li
                key={week}
                className="col-span-full grid grid-cols-subgrid items-center py-1.5 whitespace-nowrap"
              >
                <span>{weekLabel(week)}</span>
                <Bar share={totalTokens(usage) / most} className="h-1.5" />
                <Tokens usage={usage} />
                <span className="text-right text-fg-2 tabular-nums">
                  {workMs > 0 && (
                    <>
                      <span className="sr-only">Claude worked </span>
                      <Worked ms={workMs} />
                    </>
                  )}
                </span>
                <Estimate usage={usage} />
              </li>
            ))}
          </ul>
          <h3 id="throughput" className="mt-3 text-xs font-medium text-fg-3">
            Throughput
          </h3>
          <p className="text-xs text-fg-3">
            Tickets whose pull request merged after a session started on them, counted when
            Sandtable syncs them in Done, by the week they merged.
          </p>
          {throughput.length ? (
            <ul aria-labelledby="throughput" className="divide-y">
              {throughput.map((w) => (
                <li key={w.week} className="flex flex-col gap-1 py-1.5">
                  <span>{weekLabel(w.week)}</span>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                    <Figure label="Merged">{w.merged}</Figure>
                    <Figure label="Start to merge">
                      <span aria-hidden>
                        {duration(w.median)} median · {duration(w.slowest)} slowest
                      </span>
                      <span className="sr-only">
                        {duration(w.median, true)} median, {duration(w.slowest, true)} slowest
                      </span>
                    </Figure>
                    {hasPrice(w.usage) && (
                      <Figure label="Per ticket">
                        <Estimate usage={w.usage} per={w.merged} />
                      </Figure>
                    )}
                    <Figure label="Needs you per ticket">{oneDecimal.format(w.needsYou)}</Figure>
                  </dl>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-fg-2">No tickets merged from a session yet</p>
          )}
          {[...shown.weeks, ...throughput].some((w) => marked(w.usage)) && (
            <p className="text-xs text-fg-3">* Leaves out tokens from a model with no price.</p>
          )}
        </div>
      </div>
    </div>
  )
}

/** Token use and the API price estimate by project and by week. */
export function UsagePage({
  projects,
  onBack
}: {
  projects: Project[]
  onBack: () => void
}): React.JSX.Element {
  const { data: rows, error } = useLoad(() => window.sandtable.projects.usage(), [])
  return (
    <BackView title="Usage" onBack={onBack}>
      {error ? (
        <p role="alert" className="m-6 text-danger">{`Couldn't read token use: ${error}`}</p>
      ) : !rows ? (
        <p role="status" className="m-6 flex items-center gap-2 text-fg-2">
          <Spinner />
          Reading transcripts…
        </p>
      ) : (
        <Body projects={projects} rows={rows} />
      )}
    </BackView>
  )
}

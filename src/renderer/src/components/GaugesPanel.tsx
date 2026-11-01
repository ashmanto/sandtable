import { ChevronRight, MessagesSquare, SquareTerminal } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useLiveUsage } from '@/hooks/useLiveUsage'
import { useRun } from '@/hooks/useRun'
import { useSessionStatus } from '@/hooks/useSessionStatus'
import { stageLook } from '@/lib/card'
import { useSessionView } from '@/lib/sessionView'
import {
  compact,
  duration,
  hasPrice,
  hasUnpriced,
  money,
  pricedTotal,
  totalTokens
} from '@/lib/usage'
import { cn, plural, textLink, visible } from '@/lib/utils'
import { isPrepared } from '../../../shared/compact'
import { folderRepo, isLive, tokenCapOf } from '../../../shared/sessions'
import {
  CONTEXT_WARN,
  LIMIT_WARN,
  resetsText,
  type LimitWindow,
  type SessionStatus
} from '../../../shared/sessionStatus'
import { clock } from '../../../shared/time'
import {
  modelLabel,
  type ConversationEntry,
  type Project,
  type PullRequestState,
  type SessionRecord,
  type TranscriptFacts
} from '../../../shared/types'
import { ActivityPill } from './Activity'
import { RemoteToggle } from './RemoteToggle'
import { AutoReviewToggle } from './AutoReviewToggle'
import { SandboxLabel } from './SandboxLabel'
import { Tip } from './Tip'
import { Segmented } from './Segmented'
import { CardUsage } from './Usage'

/** What the Gauges panel shows: the session, its project, what its transcript says, whether it's a done ticket's open session, which shows no latest step, and whether to leave out the View switch. */
export type GaugesPanelProps = {
  session: SessionRecord
  project: Project
  facts: TranscriptFacts
  entries: ConversationEntry[]
  onOpenChanges?: () => void
  doneOpen?: boolean
  hideView?: boolean
}

const MODES: Record<string, string> = {
  default: 'Default',
  acceptEdits: 'Accept edits',
  plan: 'Plan',
  bypassPermissions: 'Bypass permissions'
}
const since = (iso: string): number => Date.now() - Date.parse(iso)
const shown = (w: LimitWindow | null): w is LimitWindow => !!w && w.resetsAt > Date.now()
const full = (pct: number): boolean => Math.round(pct) >= CONTEXT_WARN
const near = (s: SessionStatus | null, live: boolean): string | null =>
  s?.contextPct != null && full(s.contextPct)
    ? 'Nearly full'
    : live &&
        [s?.fiveHour ?? null, s?.sevenDay ?? null].some(
          (w) => shown(w) && Math.round(w.pct) >= LIMIT_WARN
        )
      ? 'Near limit'
      : null

function Meter({
  label,
  pct,
  sub,
  warnAt,
  word,
  big
}: {
  label: string
  pct: number
  sub: string
  warnAt: number
  word: string
  big?: boolean
}): React.JSX.Element {
  const n = Math.round(pct)
  const warn = n >= warnAt
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuenow={n}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={[`${n}% used`, sub, warn && word.toLowerCase()].filter(Boolean).join(', ')}
      className="flex flex-col gap-1"
    >
      <div className="flex justify-between gap-2">
        <span>{label}</span>
        <span className={cn('font-medium tabular-nums', big && 'text-sm')}>{n}%</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-surface-3">
        <span
          className={cn('block h-full rounded-full', warn ? 'bg-amber' : 'bg-fg-3')}
          style={{ width: `${Math.min(100, n)}%` }}
        />
      </div>
      <div className="flex justify-between gap-2 text-fg-3 tabular-nums">
        {warn && <span className="text-amber">{word}</span>}
        <span className="ml-auto">{sub}</span>
      </div>
    </div>
  )
}

function Limit({ label, w }: { label: string; w: LimitWindow | null }): React.JSX.Element | null {
  if (!w) return null
  const sub = resetsText(w.resetsAt, new Date())
  if (!shown(w))
    return (
      <div className="flex justify-between gap-2">
        <span>{label}</span>
        <span className="text-fg-3 tabular-nums">{sub}</span>
      </div>
    )
  return <Meter label={label} pct={w.pct} sub={sub} warnAt={LIMIT_WARN} word="Near limit" />
}

function Row({
  title,
  summary,
  open = false,
  children
}: {
  title: string
  summary: string
  open?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(open)
  return (
    <div className="flex flex-col">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        className="-mx-1.5 flex min-w-0 items-center gap-1.5 rounded-md p-1.5 text-left outline-none hover:bg-surface-3 focus-ring"
      >
        <ChevronRight
          aria-hidden
          className={cn('size-3.5 shrink-0 text-fg-3', expanded && 'rotate-90')}
        />
        <span className="font-medium">{title}</span>
        <span className="min-w-0 flex-1 truncate text-right text-fg-3 tabular-nums">{summary}</span>
      </button>
      {expanded && <div className="flex flex-col gap-2 pt-1 pb-2 pl-5">{children}</div>}
    </div>
  )
}

const Kv = ({
  k,
  wrap,
  children
}: {
  k: string
  wrap?: boolean
  children: React.ReactNode
}): React.JSX.Element => (
  <div className="flex justify-between gap-2">
    <span className="shrink-0 text-fg-3">{k}</span>
    <span
      className={cn(
        'min-w-0 text-right text-fg-2 tabular-nums',
        wrap ? 'wrap-anywhere' : 'truncate'
      )}
    >
      {children}
    </span>
  </div>
)

// shortcut: the session's PR list has no mergeable state, so Ready to merge never shows here; add it to PullRequestState when wanted.
const stageOf = (pr: PullRequestState): string =>
  stageLook[
    pr.checks.some((c) => c.state === 'failing')
      ? 'checksFailing'
      : pr.reviewDecision === 'changesRequested'
        ? 'changesRequested'
        : 'open'
  ].label

type Work = {
  files: number
  added: number
  removed: number
  prs: PullRequestState[]
  findings: number
}
const NO_WORK: Work = { files: 0, added: 0, removed: 0, prs: [], findings: 0 }

function useWork(id: string, running: boolean, removed: boolean): Work {
  const [work, setWork] = useState(NO_WORK)
  useEffect(() => {
    let on = true
    const { sessions } = window.sandtable
    void Promise.all([
      removed ? [] : sessions.changes(id).catch(() => []),
      sessions.pullRequests(id).catch(() => []),
      sessions.findings(id).catch(() => ({ findings: [] }))
    ]).then(([repos, prs, f]) => {
      const files = repos.flatMap((r) => r.files)
      const sum = (k: 'added' | 'removed'): number => files.reduce((n, x) => n + x[k], 0)
      if (on)
        setWork({
          files: files.length,
          added: sum('added'),
          removed: sum('removed'),
          prs,
          findings: f.findings.filter((x) => !x.proposed).length
        })
    })
    return () => {
      on = false
    }
  }, [id, running, removed])
  return work
}

type Step = 'prepare' | 'compact'

function Compact({
  session,
  entries
}: {
  session: SessionRecord
  entries: ConversationEntry[]
}): React.JSX.Element {
  const { error, pending, run } = useRun()
  const [sent, setSent] = useState<{ at: number; step: Step } | null>(null)
  const latched = sent && !entries.slice(sent.at).some((e) => e.kind !== 'user')
  const step = latched ? sent.step : isPrepared(entries) ? 'compact' : 'prepare'
  const why = session.asking
    ? 'After you answer Claude'
    : session.state === 'running'
      ? 'After Claude stops working'
      : latched
        ? step === 'compact'
          ? 'Compacting…'
          : 'Sent'
        : null
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Button
          size="xs"
          variant="outline"
          disabled={!!why || pending}
          onClick={() =>
            void run(() => window.sandtable.sessions.compact(session.id, step)).then(
              (ok) => ok && setSent({ at: entries.length, step })
            )
          }
        >
          {step === 'compact' ? 'Compact' : 'Prepare to compact'}
        </Button>
        {why && <span className="text-fg-3">{why}</span>}
      </div>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

function Panel({
  session,
  project,
  facts,
  entries,
  onOpenChanges,
  doneOpen,
  hideView
}: GaugesPanelProps): React.JSX.Element {
  const status = useSessionStatus(session.id)
  const usage = useLiveUsage(session.id)
  const live = isLive(session)
  const work = useWork(session.id, session.state === 'running', !!session.removedAt)
  const all = usage ? totalTokens(usage) : 0
  const priced = !!usage && hasPrice(usage)
  const fallback = !priced && status?.costUsd != null ? money(status.costUsd) : null
  const price = priced ? `${money(pricedTotal(usage))}${hasUnpriced(usage) ? '*' : ''}` : fallback
  const gone = !live && !status
  const elapsed = gone ? null : (status?.durationMs ?? since(session.startedAt))
  const mode =
    live && facts.permissionMode ? (MODES[facts.permissionMode] ?? facts.permissionMode) : null
  const modelName = status?.model ?? (session.model && modelLabel(session.model))
  const model = [modelName, status?.effort && `${status.effort} effort`].filter(Boolean).join(' · ')
  const agents = live
    ? [
        ...entries.flatMap((e) =>
          e.kind === 'tool' && (e.name === 'Task' || e.name === 'Agent') && e.output === null
            ? [[e.name, e.summary]]
            : []
        ),
        ...(status?.background ?? []).map((b) => [b.type, b.description])
      ]
    : []
  const done = facts.todos.filter((t) => t.status === 'completed').length
  const last = facts.compactions.at(-1)
  const filesWord = plural(work.files, 'file')
  const findingsWord = work.findings ? plural(work.findings, 'finding') : 'None'
  const pr = work.prs[0]
  const ctx = status?.contextPct ?? null
  const worktree = session.worktrees.length > 0
  const sandboxed = !!session.sandbox && !session.removedAt
  const folders = worktree ? session.worktrees : session.checkout ? [session.checkout] : []
  const byCount = (one: string, many: string): string => (folders.length > 1 ? many : one)
  const [view, setView] = useSessionView()
  const viewId = useId()

  return (
    <div className="flex flex-col gap-5 text-xs">
      {(!hideView || !session.removedAt) && (
        <div className="flex flex-col gap-3 border-b border-line pb-4">
          {!hideView && (
            <div className="flex flex-col gap-1.5">
              <span id={viewId} className="text-fg-3">
                View
              </span>
              <Segmented
                aria-labelledby={viewId}
                className="w-fit"
                value={view}
                onChange={setView}
                options={[
                  [
                    'conversation',
                    <span key="c" className="flex items-center gap-1.5">
                      <MessagesSquare aria-hidden className="size-3.5" />
                      Conversation
                    </span>,
                    'Conversation'
                  ],
                  [
                    'terminal',
                    <span key="t" className="flex items-center gap-1.5">
                      <SquareTerminal aria-hidden className="size-3.5" />
                      Terminal
                    </span>,
                    'Terminal'
                  ]
                ]}
              />
            </div>
          )}
          {!session.removedAt && <RemoteToggle session={session} />}
          {!session.removedAt && session.ticketKey && (
            <AutoReviewToggle session={session} project={project} onOpenChanges={onOpenChanges} />
          )}
        </div>
      )}
      <ActivityPill session={doneOpen ? undefined : session} className="h-6 w-fit max-w-full" />
      {!live && <p className="text-fg-3">Finished</p>}
      {!gone && (
        <div className="flex flex-col gap-3 rounded-md bg-card p-3">
          {ctx === null ? (
            <p className="text-fg-3">Waiting for Claude&apos;s first reply</p>
          ) : (
            <Meter
              big
              label="Context window"
              pct={ctx}
              sub={
                status?.contextSize
                  ? `${compact(status.contextUsed ?? (status.contextSize * ctx) / 100)} of ${compact(status.contextSize)}`
                  : ''
              }
              warnAt={CONTEXT_WARN}
              word="Nearly full"
            />
          )}
          {live && ctx !== null && full(ctx) && <Compact session={session} entries={entries} />}
          {live && (
            <>
              <Limit label="5-hour limit" w={status?.fiveHour ?? null} />
              <Limit label="7-day limit" w={status?.sevenDay ?? null} />
            </>
          )}
        </div>
      )}
      <div className="flex flex-col">
        <Row
          title="This session"
          summary={[all && compact(all), price, elapsed !== null && duration(elapsed)]
            .filter(Boolean)
            .join(' · ')}
        >
          {usage && (
            <CardUsage usage={usage} cap={tokenCapOf(project, session)} capped={session.capped} />
          )}
          {fallback && <Kv k="Price">{fallback} API estimate</Kv>}
          {elapsed !== null && <Kv k="Elapsed">{duration(elapsed)}</Kv>}
          {status?.apiDurationMs != null && <Kv k="API time">{duration(status.apiDurationMs)}</Kv>}
          <Kv k="Compactions">
            {last ? `${facts.compactions.length} · last at ${clock(last)}` : 'None yet'}
          </Kv>
        </Row>
        {(model || mode) && (
          <Row title="Model" summary={[modelName, mode].filter(Boolean).join(' · ')}>
            {model && <Kv k="Model">{model}</Kv>}
            {mode && <Kv k="Permissions">{mode}</Kv>}
          </Row>
        )}
        <Row
          open
          title="Where"
          summary={[
            worktree ? (session.removedAt ? 'Worktree removed' : 'Worktree') : 'Main checkout',
            sandboxed && 'Sandboxed'
          ]
            .filter(Boolean)
            .join(' · ')}
        >
          {worktree && session.branch && (
            <Kv k="Branch" wrap>
              <span className="font-mono">{visible(session.branch)}</span>
            </Kv>
          )}
          {folders.length > 0 && (
            <>
              <Kv k={byCount('Repo', 'Repos')} wrap>
                {folders.map((f) => folderRepo(session, f)).join(', ')}
              </Kv>
              <div className="flex flex-col gap-0.5">
                <span className="text-fg-3">{byCount('Folder', 'Folders')}</span>
                {folders.map((f) => (
                  <span key={f} className="font-mono text-fg-2 wrap-anywhere">
                    {f}
                  </span>
                ))}
              </div>
            </>
          )}
          {sandboxed && (
            <Kv k="Sandbox" wrap>
              <SandboxLabel session={session} />
            </Kv>
          )}
        </Row>
        <Row
          open
          title="Work"
          summary={[filesWord, pr && `#${pr.number} ${stageOf(pr)}`].filter(Boolean).join(' · ')}
        >
          <Kv k="Files">
            {onOpenChanges ? (
              <button type="button" className={textLink} onClick={onOpenChanges}>
                {filesWord}
              </button>
            ) : (
              filesWord
            )}{' '}
            <span className="text-added">+{work.added}</span>{' '}
            <span className="text-danger">−{work.removed}</span>
          </Kv>
          {work.prs.map((p) => (
            <Kv key={`${p.repo}#${p.number}`} k="Pull request">
              <a href={p.url} target="_blank" rel="noreferrer" className={textLink}>
                #{p.number}
              </a>{' '}
              {stageOf(p)}
            </Kv>
          ))}
          <Kv k="Review findings">
            {onOpenChanges && work.findings ? (
              <button type="button" className={textLink} onClick={onOpenChanges}>
                {findingsWord}
              </button>
            ) : (
              findingsWord
            )}
          </Kv>
        </Row>
        {agents.length > 0 && (
          <Row title="Agents and tasks" summary={`${agents.length} running`}>
            {agents.map(([name, what], i) => (
              <div key={i} className="flex min-w-0 gap-1.5 text-fg-2">
                <span className="shrink-0 font-mono">{visible(name)}</span>
                <span className="min-w-0 truncate text-fg-3">{visible(what)}</span>
              </div>
            ))}
          </Row>
        )}
        {facts.todos.length > 0 && (
          <Row open title="Claude's to-dos" summary={`${done} of ${facts.todos.length}`}>
            {facts.todos.map((t, i) => (
              <p
                key={i}
                className={cn(
                  'text-fg-2',
                  t.status === 'completed' && 'text-fg-3 line-through',
                  t.status === 'in_progress' && 'font-medium text-foreground'
                )}
              >
                {visible(t.content)}
                {t.status !== 'pending' && (
                  <span className="sr-only">
                    {t.status === 'completed' ? ' (done)' : ' (in progress)'}
                  </span>
                )}
              </p>
            ))}
          </Row>
        )}
      </div>
    </div>
  )
}

/** The session's gauges and facts in a 256 px column beside the conversation. */
export function GaugesPanel(props: GaugesPanelProps): React.JSX.Element {
  return (
    <aside aria-label="Session" className="w-64 shrink-0 overflow-y-auto border-l border-line p-4">
      <Panel {...props} />
    </aside>
  )
}

/** The folded panel: a header button with the context use that opens the panel in a popover. */
export function GaugesButton(props: GaugesPanelProps): React.JSX.Element {
  const status = useSessionStatus(props.session.id)
  const ctx = status?.contextPct ?? null
  const word = near(status, isLive(props.session))
  const text = [ctx === null ? 'Session' : `Context ${Math.round(ctx)}%`, word]
    .filter(Boolean)
    .join(' · ')
  return (
    <Popover>
      <Tip label="Session details" aria-label={`${text}, session details`}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs tabular-nums outline-none focus-ring',
              word ? 'bg-amber-soft text-amber' : 'bg-surface-3 text-fg-2'
            )}
          >
            {ctx !== null && (
              <span aria-hidden className="h-1 w-6 overflow-hidden rounded-full bg-line-2">
                <span
                  className={cn('block h-full', word ? 'bg-amber' : 'bg-fg-3')}
                  style={{ width: `${Math.min(100, ctx)}%` }}
                />
              </span>
            )}
            {text}
          </button>
        </PopoverTrigger>
      </Tip>
      <PopoverContent
        aria-label="Session"
        align="end"
        className="max-h-(--radix-popover-content-available-height) overflow-y-auto"
      >
        <Panel {...props} />
      </PopoverContent>
    </Popover>
  )
}

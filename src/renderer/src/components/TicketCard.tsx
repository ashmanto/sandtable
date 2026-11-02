import {
  ChevronDown,
  ChevronRight,
  CornerUpRight,
  ExternalLink,
  GitMerge,
  GitPullRequest
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge, badgeClass } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cardClass, opensIn, prLook, stateLook, shownLabels, stageLook } from '@/lib/card'
import { cleanUp, type Line } from '@/lib/cleanUp'
import { jumpToCard, useRiseOnChange } from '@/hooks/useRiseOnChange'
import { chooseFolder, failureText, useStartFailure } from '@/hooks/useOverlapCheck'
import { useTicketStart } from '@/hooks/useTicketStart'
import { useRun } from '@/hooks/useRun'
import { useLiveUsage } from '@/hooks/useLiveUsage'
import { useUsage } from '@/hooks/useUsage'
import type { DragHandle } from '@/hooks/useTicketDrag'
import { cn, errorMessage, fullTime, shortDate, stop } from '@/lib/utils'
import { areaOf, blockedByText } from '../../../shared/areas'
import { columnFor, statusMapOf } from '../../../shared/columns'
import { canStart, findRepo, issueLabel, ticketLabel } from '../../../shared/repo'
import {
  actionLabels,
  isLive,
  type Elsewhere,
  ticketActions,
  tokenCapOf,
  type TicketAction
} from '../../../shared/sessions'
import type {
  IssueRef,
  PrStage,
  Project,
  SessionRecord,
  SubIssue,
  Ticket
} from '../../../shared/types'
import { ActivityStrip, insetClass } from './Activity'
import { ClearNeedsYou, RaiseCap } from './ClearNeedsYou'
import { ModelChip, ModelName } from './ModelChoice'
import { NoteComposer } from './NoteComposer'
import { OverlapCheck } from './OverlapCheck'
import { SetupHint } from './SetupHint'
import { useSetupHint } from '@/hooks/useSetupHint'
import { RemoteMark } from './RemoteToggle'
import { SessionBadge, type CardState } from './SessionBadge'
import { SessionElsewhere } from './SessionElsewhere'
import { SetupBlock } from './SetupBlock'
import { StartFlow } from './StartFlow'
import { Tip } from './Tip'
import { CardUsage } from './Usage'
import { personName } from '@/lib/assigneeFilter'
import { titleOf } from '@/lib/lanes'
import { StatusIcon } from './StatusIcon'

/** The classes of a card's property chip. */
export const chip =
  'flex h-5 min-w-0 max-w-full items-center gap-1 rounded-full border px-2 text-xs text-fg-2'

/** A GitHub label as a bordered chip: its color dot and its name. */
export function LabelChip({
  label,
  className
}: {
  label: { name: string; color: string }
  className?: string
}): React.JSX.Element {
  return (
    <li
      className={cn(
        'flex min-w-0 items-center gap-1.5 rounded-full border px-2 text-xs text-fg-2',
        className
      )}
    >
      <LabelDot color={label.color} />
      <span className="truncate">{label.name}</span>
    </li>
  )
}

/** A GitHub label's color dot; with no color, only its ring. */
export function LabelDot({ color }: { color: string | null }): React.JSX.Element {
  return (
    <span
      aria-hidden
      className="size-2 shrink-0 rounded-full ring-1 ring-line-2 ring-inset"
      style={color ? { backgroundColor: `#${color}` } : undefined}
    />
  )
}

/** The **Merged** chip, a link to the merged pull request that doesn't open the card under it. */
export function MergedMark({ url }: { url: string }): React.JSX.Element {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      title="Open the merged pull request on GitHub"
      onClick={(e) => e.stopPropagation()}
      className={cn(badgeClass, prLook.merged.className, 'hover:bg-line-2')}
    >
      <GitMerge aria-hidden />
      {prLook.merged.label}
    </a>
  )
}

/** Where the ticket's open pull request stands, as a word in a chip. */
export function PrStageMark({ stage }: { stage: PrStage }): React.JSX.Element {
  const look = stageLook[stage]
  return (
    <Badge className={look.className}>
      <GitPullRequest aria-hidden />
      {look.label}
    </Badge>
  )
}

/** What a parent or sub-issue link needs: the board's tickets and what opening one on it does. */
export type Refs = {
  project: Project
  repo: string
  tickets: Omit<Ticket, 'body'>[]
  onOpenTicket: (ticketKey: string) => void
  stateOf?: (ticketKey: string) => CardState | undefined
}

const refState = (
  issue: IssueRef & { assignee?: string | null },
  { project, tickets }: Refs
): { onBoard: boolean; column: IssueRef['column']; assignee: string | null } => {
  const t = tickets.find((t) => t.key === issue.key)
  const column = t && columnFor(t.status, statusMapOf(project))
  return {
    onBoard: !!t,
    column: column && column !== 'hidden' ? column : issue.column,
    assignee: t ? (t.assignees[0] ? personName(t.assignees[0]) : null) : (issue.assignee ?? null)
  }
}

const external = <ExternalLink aria-hidden className="size-3 shrink-0 text-fg-3" />

function RefLink({
  issue,
  onBoard,
  label,
  refs,
  className,
  children
}: {
  issue: IssueRef
  onBoard: boolean
  label: string
  refs: Refs
  className: string
  children: React.ReactNode
}): React.JSX.Element {
  return onBoard ? (
    <button
      type="button"
      aria-label={label}
      className={className}
      onClick={(e) => {
        e.stopPropagation()
        refs.onOpenTicket(issue.key)
      }}
    >
      {children}
    </button>
  ) : (
    <a
      href={issue.url}
      target="_blank"
      rel="noreferrer"
      aria-label={`${label} (opens ${opensIn(refs.project)})`}
      className={className}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </a>
  )
}

const refRow =
  'highlight flex w-full items-center gap-2 text-left outline-none focus-ring focus-visible:ring-inset'

/** A parent or sub-issue as a row: status icon, key, title, and the column's word and assignee, or, when `compact`, its session state. */
export function RefRow({
  issue,
  refs,
  compact
}: {
  issue: IssueRef | SubIssue
  refs: Refs
  compact?: boolean
}): React.JSX.Element {
  const { onBoard, column, assignee: person } = refState(issue, refs)
  const assignee = !compact && person
  const session = compact ? refs.stateOf?.(issue.key) : undefined
  const state = compact ? session && stateLook[session].label : titleOf(column) || 'Closed'
  const name = issueLabel(issue, refs.repo)
  return (
    <li>
      <RefLink
        issue={issue}
        onBoard={onBoard}
        label={[`${name} ${issue.title}`, state, assignee].filter(Boolean).join(', ')}
        refs={refs}
        className={cn(
          refRow,
          compact
            ? 'h-7 rounded-sm px-1.5 text-xs hover:bg-surface-3'
            : 'h-9 px-3 hover:bg-surface-3'
        )}
      >
        {column === 'hidden' ? (
          <span className="size-3.5 shrink-0" />
        ) : (
          <StatusIcon column={column} />
        )}
        <span className="font-mono text-fg-2">{name}</span>
        <span title={issue.title} className="flex min-w-0 flex-1 items-center gap-1">
          <span className="truncate">{issue.title}</span>
          {!onBoard && external}
        </span>
        {compact ? (
          session && <SessionBadge state={session} />
        ) : (
          <Badge className="bg-neutral-soft text-fg-2">{state}</Badge>
        )}
        {assignee && (
          <Tip label={assignee}>
            <Avatar name={assignee} className="ring-0" />
          </Tip>
        )}
      </RefLink>
    </li>
  )
}

/** A ticket's sub-issues as rows, and a link to the rest when the service listed only some. */
export function RefList({
  ticket,
  refs,
  compact,
  className
}: {
  ticket: Pick<Ticket, 'url' | 'subIssues'>
  refs: Refs
  compact?: boolean
  className: string
}): React.JSX.Element {
  const { total, items } = ticket.subIssues
  return (
    <ul
      className={cn('overflow-hidden', !compact && 'divide-y', className)}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((i) => (
        <RefRow key={i.key} issue={i} refs={refs} compact={compact} />
      ))}
      {items.length < total && (
        <li>
          <a
            href={ticket.url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className={cn(
              refRow,
              'gap-1 text-fg-2',
              compact
                ? 'h-7 rounded-sm px-1.5 text-xs hover:bg-surface-3'
                : 'h-9 px-3 hover:bg-surface-3'
            )}
          >
            {total - items.length} more {opensIn(refs.project)}
            {external}
          </a>
        </li>
      )}
    </ul>
  )
}

/** A sub-issue's link to its parent. */
export function ParentLine({
  parent,
  refs,
  arrow
}: {
  parent: IssueRef
  refs: Refs
  arrow?: boolean
}): React.JSX.Element {
  const { onBoard } = refState(parent, refs)
  const name = issueLabel(parent, refs.repo)
  return (
    <RefLink
      issue={parent}
      onBoard={onBoard}
      label={`Sub-issue of ${name} ${parent.title}`}
      refs={refs}
      className="highlight flex w-fit max-w-full min-w-0 items-center gap-1 rounded-sm text-xs text-fg-3 outline-none hover:text-fg-2 focus-ring"
    >
      {arrow ? (
        <CornerUpRight aria-hidden className="size-3 shrink-0" />
      ) : (
        <span className="shrink-0">Sub-issue of</span>
      )}
      <span className="shrink-0 font-mono">{name}</span>
      <span title={parent.title} className="truncate">
        {parent.title}
      </span>
      {!onBoard && external}
    </RefLink>
  )
}

function Title({ text }: { text: string }): React.JSX.Element {
  const parts = text.split('`')
  return (
    <p className="line-clamp-2 leading-snug wrap-anywhere">
      {parts.map((part, i) =>
        i % 2 === 0 || !part ? (
          part
        ) : i === parts.length - 1 ? (
          `\`${part}`
        ) : (
          <code key={i} className="rounded-sm border px-1 font-mono">
            {part}
          </code>
        )
      )}
    </p>
  )
}

/** A ring filled in the share of sub-issues done. */
export function ProgressRing({
  completed,
  total
}: {
  completed: number
  total: number
}): React.JSX.Element {
  const r = 5
  const length = 2 * Math.PI * r
  return (
    <svg aria-hidden viewBox="0 0 12 12" className="size-3 shrink-0 -rotate-90">
      <circle cx="6" cy="6" r={r} fill="none" strokeWidth="1.5" className="stroke-line-2" />
      <circle
        cx="6"
        cy="6"
        r={r}
        fill="none"
        strokeWidth="1.5"
        stroke="currentColor"
        strokeDasharray={length}
        strokeDashoffset={length * (1 - completed / total)}
      />
    </svg>
  )
}

/** The dashed **Parent** tag on a parent's card or row in its own lane. */
export function ParentTag(): React.JSX.Element {
  return (
    <span className={cn(chip, 'w-fit shrink-0 border-dashed border-line-2 px-1.5 text-fg-3')}>
      Parent
    </span>
  )
}

function Progress({
  completed,
  total,
  open,
  onToggle
}: {
  completed: number
  total: number
  open: boolean
  onToggle: () => void
}): React.JSX.Element {
  return (
    <li className="flex min-w-0">
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${completed}/${total} sub-issues, ${completed} of ${total} done`}
        onClick={(e) => {
          e.stopPropagation()
          onToggle()
        }}
        className={cn(
          chip,
          'highlight outline-none hover:border-line-2 hover:bg-surface-3 focus-ring'
        )}
      >
        <ProgressRing completed={completed} total={total} />
        {completed}/{total} sub-issues
        <ChevronRight
          aria-hidden
          className={cn(
            'size-3 shrink-0 transition-transform duration-150 ease-(--ease-out-quart) motion-reduce:transition-none',
            open && 'rotate-90'
          )}
        />
      </button>
    </li>
  )
}

/** A person as a round avatar with their initial, named by `name`. */
export function Avatar({
  name,
  className,
  ...props
}: React.ComponentProps<'span'> & { name: string }): React.JSX.Element {
  return (
    <span
      role="img"
      aria-label={name}
      {...props}
      className={cn(
        'grid size-4.5 shrink-0 place-items-center overflow-hidden rounded-full bg-line-2 text-xs leading-none whitespace-nowrap text-fg ring-1 ring-card group-hover/card:ring-card-hover',
        className
      )}
    >
      {[...name][0]?.toUpperCase()}
    </span>
  )
}

/** An avatar shown beside the person's written name. */
export function PersonAvatar({ name }: { name: string }): React.JSX.Element {
  return (
    <span aria-hidden>
      <Avatar name={name} className="ring-0" />
    </span>
  )
}

function Assignees({ people }: { people: Ticket['assignees'] }): React.JSX.Element {
  const rest = people.slice(2).map(personName)
  return (
    <span className="flex shrink-0 items-center -space-x-1">
      {people.slice(0, 2).map((p) => (
        <Tip key={p.login} label={personName(p)}>
          <Avatar name={personName(p)} />
        </Tip>
      ))}
      {rest.length > 0 && (
        <Tip label={rest.join(', ')} aria-label={`${rest.length} more: ${rest.join(', ')}`}>
          <span className="pl-1.5 text-xs text-fg-3">+{rest.length}</span>
        </Tip>
      )}
    </span>
  )
}

/** A board card: the ticket at a glance and the one action its state allows. */
export function TicketCard({
  project,
  ticket,
  session,
  state: sessionState,
  done,
  onFolderFixed,
  onOpen,
  onSetUp,
  tickets,
  onOpenTicket,
  stateOf,
  dragHandle,
  parentTag,
  hideParent,
  elsewhere
}: {
  project: Project
  ticket: Omit<Ticket, 'body'>
  session: SessionRecord | undefined
  state: CardState | undefined
  done: boolean
  onFolderFixed: () => void
  onOpen: () => void
  onSetUp: (repo: string) => void
  tickets: Omit<Ticket, 'body'>[]
  onOpenTicket: (ticketKey: string) => void
  stateOf: (ticketKey: string) => CardState | undefined
  dragHandle?: DragHandle
  parentTag?: boolean
  hideParent?: boolean
  elsewhere?: Elsewhere & { onOpen: () => void }
}): React.JSX.Element {
  const { error, result, busy, clear, run } = useRun()
  const failure = useStartFailure(project.id, ticket.key)
  const blocked = failure?.repo
  const state = blocked ? 'cantStart' : sessionState
  const ref = useRiseOnChange<HTMLDivElement>(`${state}:${ticket.updatedAt}`)
  const repo = findRepo(project.repos, ticket.repo)
  const startable = canStart(project.repos, ticket)
  const removed = !!session?.removedAt
  const ticketUsage = useUsage(project.id, ticket.key, session?.id ?? '', done).usage
  const liveUsage = useLiveUsage(session?.id ?? '')
  const labels = shownLabels(ticket)
  const [listing, setListing] = useState(false)
  const refs: Refs = {
    project,
    repo: ticket.repo,
    tickets,
    onOpenTicket: (key) => jumpToCard(key) || onOpenTicket(key),
    stateOf
  }
  const chips =
    ticket.blockedBy.length > 0 ||
    ticket.subIssues.total > 0 ||
    labels.length > 0 ||
    ticket.boardFields.length > 0

  useEffect(() => {
    if (!result) return
    const timer = setTimeout(clear, 3500)
    return () => clearTimeout(timer)
  }, [result, clear])

  const firstAction = ticketActions({
    session,
    done,
    hasRepo: startable,
    blocked: !!blocked,
    elsewhere: !!elsewhere
  })[0]
  const {
    checking,
    setChecking,
    note: { open: noting, show: showNote, button: noteButton, composer },
    overlap,
    setup
  } = useTicketStart({
    projectId: project.id,
    ticketKey: ticket.key,
    run,
    offered: firstAction === 'start',
    startable,
    hint: true,
    repo: repo?.github,
    noteFallback: ref,
    setupFocus: ref,
    onRefine: onOpen
  })

  const setupHint = useSetupHint(project.id, ticket.key)
  const [hintError, setHintError] = useState<string | null>(null)
  const hintRepo = setupHint.hint && findRepo(project.repos, setupHint.hint.repo)

  const action = overlap.check || setup.progress ? undefined : firstAction
  const id = session?.id ?? ''
  const start = (plan?: true): void => {
    setHintError(null)
    setChecking(plan ? { plan } : {})
  }
  const handlers: Record<TicketAction, () => unknown> = {
    chooseFolder: () =>
      blocked &&
      run(() => chooseFolder(project, blocked, onFolderFixed), actionLabels.chooseFolder[1]),
    start: () => start(),
    resume: () => run(() => window.sandtable.sessions.resume(id), actionLabels.resume[1]),
    removeWorktree: () => run(() => cleanUp(id, false), actionLabels.removeWorktree[1]),
    endSession: () => run(() => cleanUp(id, true), actionLabels.endSession[1])
  }
  const message: Line | null = error
    ? { text: error, danger: true }
    : result
      ? { text: result, danger: false }
      : failure
        ? { text: failureText(failure), danger: true }
        : session?.startWarning
          ? { text: session.startWarning, danger: true }
          : hintError
            ? { text: hintError, danger: true }
            : null

  return (
    <>
      <div
        data-slot="card"
        data-ticket={ticket.key}
        tabIndex={0}
        {...dragHandle}
        ref={(el) => {
          ref.current = el
          dragHandle?.ref(el)
        }}
        onClick={onOpen}
        onKeyDown={(e) => {
          dragHandle?.onKeyDown?.(e)
          if (e.key === 'Enter' && e.target === e.currentTarget) onOpen()
        }}
        className={cardClass}
      >
        {ticket.parent && !hideParent && <ParentLine parent={ticket.parent} refs={refs} arrow />}
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-3">
          {parentTag && <ParentTag />}
          <span className="shrink-0 font-mono">{ticketLabel(ticket)}</span>
          {ticket.repo && (
            <span className="min-w-0 truncate" title={ticket.repo}>
              {ticket.repo.split('/').pop()}
            </span>
          )}
          <span className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5">
            {done && ticket.mergedPr && <MergedMark url={ticket.mergedPr} />}
            {!done && ticket.prStage && <PrStageMark stage={ticket.prStage} />}
            {state && session && <ModelName model={session.model} />}
            {state && <SessionBadge state={state} />}
            {ticket.assignees.length > 0 && <Assignees people={ticket.assignees} />}
          </span>
        </div>
        <Title text={ticket.title} />
        {chips && (
          <ul className="mt-1 flex flex-wrap gap-1">
            {ticket.blockedBy.map((b) => (
              <li key={b.key} title={b.title} className={chip}>
                <span className="truncate">{blockedByText(b, ticket.repo)}</span>
              </li>
            ))}
            {ticket.subIssues.total > 0 && (
              <Progress
                {...ticket.subIssues}
                open={listing}
                onToggle={() => setListing((l) => !l)}
              />
            )}
            {labels.map((l) => (
              <LabelChip key={l.name} label={l} className={chip} />
            ))}
            {ticket.boardFields.map((f) => (
              <li
                key={f.name}
                aria-label={`${f.name}: ${f.value}`}
                title={`${f.name}: ${f.value}`}
                className={chip}
              >
                <span className="truncate">{f.value}</span>
              </li>
            ))}
          </ul>
        )}
        {listing && ticket.subIssues.total > 0 && (
          <RefList
            ticket={ticket}
            refs={refs}
            compact
            className={cn(
              insetClass,
              'animate-in flex-col p-1 duration-200 ease-(--ease-out-cubic) fade-in slide-in-from-top-1.5 motion-reduce:slide-in-from-top-0'
            )}
          />
        )}
        <ActivityStrip session={state === 'running' ? session : undefined} />
        {done
          ? ticketUsage && (
              <CardUsage usage={ticketUsage} capped={!!session?.capped && isLive(session)} />
            )
          : session &&
            liveUsage && (
              <CardUsage
                usage={liveUsage}
                cap={tokenCapOf(project, session)}
                capped={session.capped}
              />
            )}
        <p className="flex gap-3 text-xs text-fg-3">
          {(
            [
              ['Created', ticket.createdAt],
              ['Updated', ticket.updatedAt]
            ] as const
          ).map(([word, iso]) => (
            <span key={word}>
              {word}{' '}
              <time dateTime={iso} title={fullTime(iso)}>
                {shortDate(iso)}
              </time>
            </span>
          ))}
        </p>
        {!startable && <p className="text-xs text-danger">Repo not in this project</p>}
        {message && (
          <p className={cn('text-xs', message.danger ? 'text-danger' : 'text-fg-2')}>
            {message.text}
          </p>
        )}
        <OverlapCheck {...overlap} area={areaOf(ticket.labels)} />
        <SetupBlock {...setup} project={project} />
        <SetupHint
          hint={hintRepo && !hintRepo.setup ? setupHint.hint : null}
          onSetUp={(r) => {
            setupHint.dismiss()
            onSetUp(r)
          }}
          onNotNow={() => {
            setupHint
              .notNow()
              .catch((err) => setHintError(`Couldn't hide the hint: ${errorMessage(err)}`))
            ref.current?.focus()
          }}
        />
        {elsewhere && <SessionElsewhere {...elsewhere} done={done} />}
        {noting && action === 'start' ? (
          <NoteComposer {...composer} />
        ) : (
          (action || (session && !removed)) && (
            <div className="flex items-center gap-1.5 empty:hidden">
              {action && (
                <Button
                  variant="outline"
                  size="xs"
                  className="h-5"
                  disabled={busy !== null}
                  onClick={(e) => {
                    e.stopPropagation()
                    void handlers[action]()
                  }}
                >
                  {busy || actionLabels[action][0]}
                </Button>
              )}
              {action === 'start' && (
                <ModelChip
                  project={project}
                  ticketKey={ticket.key}
                  disabled={busy !== null}
                  className="h-5"
                />
              )}
              {action === 'start' && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      ref={noteButton}
                      variant="ghost"
                      size="xs"
                      className="h-5 text-fg-2"
                      disabled={busy !== null}
                      onClick={stop}
                    >
                      Start with…
                      <ChevronDown className="size-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    onClick={stop}
                    onPointerDown={stop}
                    onKeyDown={stop}
                  >
                    <DropdownMenuItem onSelect={showNote}>Start with note</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => start(true)}>
                      Start with planning
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {session?.remoteControl && !removed && <RemoteMark />}
              {session && state === 'needsYou' && (
                <ClearNeedsYou session={session} disabled={busy !== null} run={run} />
              )}
              {session && <RaiseCap session={session} disabled={busy !== null} run={run} />}
            </div>
          )
        )}
      </div>
      {checking && startable && (
        <StartFlow
          project={project}
          ticket={ticket}
          mainRepo={repo}
          session={session}
          onStart={(extra, main, pass) =>
            overlap.begin(extra, main, pass, checking.note, checking.plan)
          }
          onClose={() => setChecking(null)}
        />
      )}
    </>
  )
}

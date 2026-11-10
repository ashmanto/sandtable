import {
  ArrowLeft,
  ChevronDown,
  ExternalLink,
  FileDiff,
  FileText,
  MessageCircleQuestion,
  MessageSquarePlus,
  MessagesSquare,
  NotebookPen,
  Plus
} from 'lucide-react'
import { useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { LucideIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Tip } from './Tip'
import {
  actionLabels,
  elsewhereOf,
  isDoneOpen,
  isLive,
  ticketActions,
  ticketSessions,
  type TicketAction
} from '../../../shared/sessions'
import { cleanUp } from '@/lib/cleanUp'
import { GAUGES_WIDTH, HeaderFrame, NARROW_WIDTH, headerTitle } from '@/lib/headerFrame'
import { chooseFolder, failureText, usePendingAsk, useStartFailure } from '@/hooks/startFlow'
import { useTicketStart } from '@/hooks/useTicketStart'
import { useLoad } from '@/hooks/useLoad'
import { useRun } from '@/hooks/useRun'
import { useLiveConversation } from '@/hooks/useLiveConversation'
import { useUsage } from '@/hooks/useUsage'
import { totalTokens } from '@/lib/usage'
import { cn, fullTime, plural, shortDate } from '@/lib/utils'
import type { BoardView } from '../../../shared/api'
import { areaOf, blockedByText } from '../../../shared/areas'
import { columnFor, statusMapOf } from '../../../shared/columns'
import { instructionsFor } from '../../../shared/instructions'
import { canStart, findRepo, serviceOf, ticketLabel } from '../../../shared/repo'
import { shortTime } from '../../../shared/time'
import {
  TICKET_TABS,
  type Project,
  type Ticket,
  type TicketDetails,
  type TicketTab
} from '../../../shared/types'
import { Changes } from './Changes'
import { ChatPanel } from './ChatPanel'
import { GaugesButton, GaugesPanel, type GaugesPanelProps } from './GaugesPanel'
import { opensIn, prLook } from '@/lib/card'
import {
  Avatar,
  chip,
  LabelChip,
  LabelDot,
  MergedMark,
  ParentLine,
  PrStageMark,
  RefList,
  RefRow,
  type Refs
} from './TicketCard'
import { ClearNeedsYou, RaiseCap } from './ClearNeedsYou'
import { ModelChip } from './ModelChoice'
import { NoteComposer } from './NoteComposer'
import { OverlapCheck } from './OverlapCheck'
import { LastLines, SetupBlock } from './SetupBlock'
import { SessionBadge } from './SessionBadge'
import { SessionElsewhere } from './SessionElsewhere'
import { useAfterMenu } from '@/hooks/useAfterMenu'
import { StartFlow } from './StartFlow'
import { LoadError, Loading, Md } from './TabContent'
import { Usage } from './Usage'
import { SessionConversation } from './SessionConversation'
import { ViewHeader } from './ViewHeader'
import { hasDraft } from '@/lib/ticketDrafts'
import { NewTicketComposer } from './NewTicketComposer'

function Section({
  title,
  children
}: {
  title: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  const id = useId()
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-2">
      <h2 id={id} className="text-xs font-medium text-fg-3">
        {title}
      </h2>
      {children}
    </section>
  )
}

const tabs = (hasSession: boolean, hasWorktree: boolean): TicketTab[] =>
  TICKET_TABS.filter(
    (t) => (hasSession || t !== 'conversation') && (hasWorktree || t !== 'changes')
  )

const fadeIn = 'animate-in duration-180 ease-(--ease-out-cubic) fade-in motion-reduce:animate-none'

const empty = (text: string): React.JSX.Element => <p className="text-fg-2">{text}</p>

type Card = Omit<Ticket, 'body'>

function SubIssues({ ticket, refs }: { ticket: Card; refs: Refs }): React.JSX.Element | null {
  const { completed, total } = ticket.subIssues
  const { project } = refs
  const [adding, setAdding] = useState(() => hasDraft(project.id, ticket.key))
  const addButton = useRef<HTMLButtonElement>(null)
  const add =
    !project.jira &&
    (project.linear || findRepo(project.repos, ticket.repo)) &&
    (adding ? (
      <NewTicketComposer
        project={project}
        parent={ticket}
        onClose={() => {
          flushSync(() => setAdding(false))
          addButton.current?.focus()
        }}
      />
    ) : (
      <Button
        ref={addButton}
        variant="ghost"
        size="xs"
        className="w-fit"
        onClick={() => setAdding(true)}
      >
        <Plus />
        Add sub-issue
      </Button>
    ))
  if (total === 0 && !add) return null
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {total > 0 && (
        <Section title="Sub-issues">
          <div className="flex items-center gap-2 text-xs text-fg-3">
            <span>
              {completed}/{total} done
            </span>
            <div aria-hidden className="h-1 flex-1 overflow-hidden rounded-full bg-line-2">
              <div className="h-full bg-fg-2" style={{ width: `${(completed / total) * 100}%` }} />
            </div>
          </div>
          <RefList ticket={ticket} refs={refs} className="rounded-md border" />
        </Section>
      )}
      {add}
    </div>
  )
}

function Details({
  head,
  details,
  ticket,
  refs,
  usage,
  fallback
}: {
  head: React.ReactNode
  details: TicketDetails | null
  ticket: Card | undefined
  refs: Refs
  usage: ReturnType<typeof useUsage>
  fallback: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="mx-auto grid justify-center gap-x-12 gap-y-8 px-8 py-6 @min-[832px]:grid-cols-[minmax(0,720px)_240px] @min-[832px]:grid-rows-[auto_1fr]">
      {head}
      {details ? (
        <Sections details={details} ticket={ticket} refs={refs} usage={usage} />
      ) : (
        <div className="@min-[832px]:col-start-1">{fallback}</div>
      )}
    </div>
  )
}

function Sections({
  details,
  ticket,
  refs,
  usage
}: {
  details: TicketDetails
  ticket: Card | undefined
  refs: Refs
  usage: ReturnType<typeof useUsage>
}): React.JSX.Element {
  return (
    <>
      <div className={cn(fadeIn, 'order-last flex min-w-0 flex-col gap-8')}>
        {ticket && <SubIssues ticket={ticket} refs={refs} />}
        <Section title="Description">
          {details.body.trim() ? <Md>{details.body}</Md> : empty('No description')}
        </Section>
        <Section title={`Comments ${details.comments.length || ''}`.trim()}>
          {details.comments.length === 0
            ? empty('No comments')
            : details.comments.map((c, i) => (
                <article key={i} className="flex flex-col gap-2 border-t py-3">
                  <header className="flex items-center gap-2">
                    <span aria-hidden>
                      <Avatar name={c.author} />
                    </span>
                    <span className="font-medium">{c.author}</span>
                    <time
                      dateTime={c.createdAt}
                      title={fullTime(c.createdAt)}
                      className="text-xs text-fg-3"
                    >
                      {shortTime(c.createdAt)}
                    </time>
                  </header>
                  <Md>{c.body}</Md>
                </article>
              ))}
        </Section>
      </div>
      <aside
        className={cn(
          fadeIn,
          'flex gap-8 @max-[832px]:*:flex-1 @min-[832px]:col-start-2 @min-[832px]:row-span-2 @min-[832px]:row-start-1 @min-[832px]:flex-col'
        )}
      >
        {ticket?.parent && (
          <Section title="Parent">
            <ul className="overflow-hidden rounded-md border">
              <RefRow issue={ticket.parent} refs={refs} />
            </ul>
          </Section>
        )}
        <Section title="Labels">
          {details.labels.length === 0 ? (
            empty('No labels')
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {details.labels.map((l) => (
                <LabelChip key={l.name} label={l} />
              ))}
            </ul>
          )}
        </Section>
        <Section title="Linked pull requests">
          {details.pullRequests.length === 0 ? (
            empty('No linked pull requests')
          ) : (
            <ul className="flex flex-col">
              {details.pullRequests.map((pr) => {
                const look = prLook[pr.state]
                const Icon = look.icon
                return (
                  <li key={pr.number}>
                    <a
                      href={pr.url}
                      target="_blank"
                      rel="noreferrer"
                      className="highlight -mx-1.5 flex items-center gap-2 rounded-sm px-1.5 py-1 hover:bg-surface-3"
                    >
                      <Icon aria-hidden className="size-3.5 shrink-0 text-fg-3" />
                      <span className="font-mono text-fg-2">#{pr.number}</span>
                      <span className="min-w-0 flex-1 truncate">{pr.title}</span>
                      <Badge className={look.className}>{look.label}</Badge>
                    </a>
                  </li>
                )
              })}
            </ul>
          )}
        </Section>
        {(usage.usage || usage.error) && (
          <Section title="Usage">
            {usage.error ? (
              <p className="text-danger">{`Couldn't read token use: ${usage.error}`}</p>
            ) : usage.usage && totalTokens(usage.usage) > 0 ? (
              <Usage usage={usage.usage} workMs={usage.workMs} />
            ) : (
              empty('No token use yet')
            )}
          </Section>
        )}
      </aside>
    </>
  )
}

function Instructions({
  project,
  labels
}: {
  project: Project
  labels: Ticket['labels']
}): React.JSX.Element | null {
  const [shown, setShown] = useState(false)
  const applies = instructionsFor(project, labels).map(({ label, text }) => ({
    text,
    label: labels.find((l) => l.name.toLowerCase() === label?.toLowerCase())
  }))
  if (applies.length === 0) return null
  return (
    <section
      aria-label="Your instructions"
      className="flex flex-col gap-1.5 border-b px-4 py-1.5 text-xs"
    >
      <div className="flex flex-wrap items-center gap-2 text-fg-2">
        <span>Your instructions:</span>
        {applies.map(({ label }) => (
          <span key={label?.name ?? ''} className="flex items-center gap-1 text-foreground">
            {label && <LabelDot color={label.color} />}
            {label?.name ?? 'Every ticket'}
          </span>
        ))}
        <Button
          variant="ghost"
          size="xs"
          className="ml-auto h-5"
          aria-expanded={shown}
          onClick={() => setShown((s) => !s)}
        >
          {shown ? 'Hide' : 'Show'}
        </Button>
      </div>
      {shown && (
        <dl className="flex flex-col gap-1.5 pb-1">
          {applies.map(({ label, text }) => (
            <div key={label?.name ?? ''} className="grid grid-cols-[96px_1fr] gap-2">
              <dt title={label?.name ?? 'Every ticket'} className="truncate text-fg-2">
                {label?.name ?? 'Every ticket'}
              </dt>
              <dd className="whitespace-pre-wrap">{text}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}

/** A ticket filling the window: its header, then Conversation, Details with the chat panel, and Changes tabs. */
export function TicketView({
  project,
  ticketKey,
  view,
  initialTab,
  onTabChange,
  onBack,
  onOpenTicket,
  projects,
  onOpenElsewhere,
  onProjectSaved
}: {
  project: Project
  ticketKey: string
  view: BoardView
  initialTab?: TicketTab
  onTabChange?: (tab: TicketTab) => void
  onBack: () => void
  onOpenTicket: (ticketKey: string) => void
  projects: Project[]
  onOpenElsewhere: (projectId: string, ticketKey: string) => void
  onProjectSaved: () => void
}): React.JSX.Element {
  const { error, result, pending, run } = useRun()
  const failure = useStartFailure(project.id, ticketKey)
  const blocked = failure?.repo
  const { width } = useContext(HeaderFrame)
  const narrow = width < NARROW_WIDTH
  const folded = width < GAUGES_WIDTH
  const selectedTab = useRef<HTMLButtonElement>(null)
  const [tabFocus, setTabFocus] = useState(0)
  useEffect(() => {
    if (tabFocus) selectedTab.current?.focus()
  }, [tabFocus])
  const [attempt, setAttempt] = useState(0)
  const ticket = view.tickets.find((t) => t.key === ticketKey)
  const refs = { project, repo: ticket?.repo ?? '', tickets: view.tickets, onOpenTicket }
  const sessions = useMemo(
    () => ticketSessions(view.sessions, ticketKey),
    [view.sessions, ticketKey]
  )
  const session = sessions[0]
  const live = !!session && isLive(session)
  const map = statusMapOf(project)
  const done = ticket ? columnFor(ticket.status, map) === 'done' : false
  const doneOpen = !!session && isDoneOpen(session, ticket, map)
  const hasSession = !!session
  const hasWorktree = !!session && session.worktrees.length > 0
  const [tab, setTab] = useState<TicketTab>(
    initialTab && tabs(hasSession, hasWorktree).includes(initialTab)
      ? initialTab
      : live
        ? 'conversation'
        : 'details'
  )
  const [askedTab, setAskedTab] = useState(initialTab)
  if (initialTab !== askedTab) {
    setAskedTab(initialTab)
    if (initialTab && tabs(hasSession, hasWorktree).includes(initialTab)) setTab(initialTab)
  }
  const [picked, setPicked] = useState<string | null>(null)
  const [newest, setNewest] = useState(session?.id)
  if (session?.id !== newest) {
    setNewest(session?.id)
    setPicked(null)
  }
  const shownSession = sessions.find((s) => s.id === picked) ?? session
  const latest = shownSession === session
  const conversation = useLiveConversation(shownSession?.id ?? '')
  const newestConversation = useLiveConversation(
    latest || tab === 'conversation' ? '' : (session?.id ?? '')
  )
  const repo = ticket && findRepo(project.repos, ticket.repo)
  const startable = !!ticket && canStart(project.repos, ticket)
  const away = elsewhereOf(view.elsewhere, projects, ticketKey, session)
  const actions = ticketActions({
    session,
    done,
    hasRepo: startable,
    blocked: !!blocked,
    elsewhere: !!away
  })
  const heading = useRef<HTMLHeadingElement>(null)
  const { later, afterMenu } = useAfterMenu()
  const {
    checking,
    setChecking,
    note: { open: noting, show: showNote, button: noteButton, focusButton, composer },
    overlap,
    setup
  } = useTicketStart({
    projectId: project.id,
    ticketKey,
    run,
    offered: actions.includes('start'),
    startable,
    noteFallback: selectedTab,
    setupFocus: heading
  })
  const synced = JSON.stringify([
    ticket?.labels.map((l) => l.name),
    ticket?.blockedBy.map((b) => b.key)
  ])
  const [chatOpen, setChatOpen] = useState(() => window.innerWidth >= 900)
  const [ask, takeAsk] = usePendingAsk(project.id, ticketKey)
  const [seenAsk, setSeenAsk] = useState<string | null>(null)
  if (ask !== seenAsk) {
    setSeenAsk(ask)
    if (ask) {
      setTab('details')
      setChatOpen(true)
    }
  }
  const [wasLive, setWasLive] = useState(live)
  if (live !== wasLive) {
    setWasLive(live)
    if (live) setTab('conversation')
  }

  useEffect(() => {
    onTabChange?.(tab)
  }, [tab, onTabChange])

  const [changes, setChanges] = useState(0)
  useEffect(
    () =>
      window.sandtable.board.onChange((id) => {
        if (id === project.id) setChanges((n) => n + 1)
      }),
    [project.id]
  )
  const usage = useUsage(project.id, ticketKey, `${attempt}:${synced}:${changes}`)
  const [changedFiles, setChangedFiles] = useState(0)

  const {
    data: details = null,
    error: detailsError,
    reload: retryDetails
  } = useLoad(
    () => window.sandtable.tickets.details(project.id, ticketKey),
    [project.id, ticketKey, attempt, synced]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.metaKey || e.key !== '\\') return
      e.preventDefault()
      e.stopPropagation()
      const ids = tabs(hasSession, hasWorktree)
      setTab((t) => ids[(ids.indexOf(t) + 1) % ids.length])
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [hasSession, hasWorktree])

  const held = !!overlap.check || !!setup.progress
  const failed = failure && !setup.progress && !error ? failure : null
  const danger = error ?? (failed && failureText(failed)) ?? session?.startWarning

  const id = session?.id ?? ''
  const handlers: Record<TicketAction, () => void> = {
    chooseFolder: () => blocked && void run(() => chooseFolder(project, blocked, onProjectSaved)),
    start: () => setChecking({}),
    resume: () => {
      setTab('conversation')
      void run(() => window.sandtable.sessions.resume(id))
    },
    removeWorktree: () => void run(() => cleanUp(id, false)),
    endSession: () => void run(() => cleanUp(id, true))
  }

  const comments = details?.comments.length ?? 0
  const reload = useCallback(() => setAttempt((n) => n + 1), [])
  const showButton = useRef<HTMLButtonElement>(null)
  const hideButton = useRef<HTMLButtonElement>(null)
  const hideChat = useCallback(() => {
    flushSync(() => setChatOpen(false))
    showButton.current?.focus()
  }, [setChatOpen])
  const summarize = (sessionId: string): void => {
    setTab('details')
    setChatOpen(true)
    // The chat panel shows the failure.
    window.sandtable.sessions.summarize(sessionId).catch(() => undefined)
  }
  const actionButtons = (
    <>
      {actions.map((action) => (
        <Button
          key={action}
          variant={action === 'start' || action === 'resume' ? 'default' : 'outline'}
          disabled={pending || held}
          onClick={handlers[action]}
        >
          {actionLabels[action][0]}
        </Button>
      ))}
      {actions.includes('start') && (
        <ModelChip
          project={project}
          ticketKey={ticketKey}
          disabled={pending || held}
          className="h-7 px-3"
        />
      )}
      {actions.includes('start') && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button ref={noteButton} variant="outline" disabled={pending || held}>
              <MessageSquarePlus />
              Start with…
              <ChevronDown className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" onCloseAutoFocus={afterMenu}>
            <DropdownMenuItem onSelect={showNote}>Start with note</DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                later(() => {
                  focusButton()
                  setChecking({ plan: true })
                })
              }
            >
              Start with planning
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  )
  const noteComposer = (className: string): React.ReactNode =>
    noting && <NoteComposer {...composer} className={className} />
  const awayRow = away && (
    <SessionElsewhere
      {...away}
      done={done}
      onOpen={() => onOpenElsewhere(away.project.id, ticketKey)}
      className="mx-0"
    />
  )
  const openChanges = (): void => {
    setTab('changes')
    setTabFocus((n) => n + 1)
  }
  const gaugesOf = (s: typeof session, c: typeof conversation): GaugesPanelProps | undefined =>
    s && {
      session: s,
      project,
      facts: c.facts,
      entries: c.entries ?? [],
      onOpenChanges: s === session && hasWorktree ? openChanges : undefined,
      onProjectSaved,
      doneOpen: isDoneOpen(s, ticket, map)
    }
  const gauges = gaugesOf(shownSession, conversation)
  const newestBase = latest ? gauges : gaugesOf(session, newestConversation)
  const newestGauges = newestBase && {
    ...newestBase,
    hideView: true,
    onOpenChanges: tab !== 'changes' ? newestBase.onOpenChanges : undefined
  }
  const messages =
    conversation.entries?.filter((e) => e.kind === 'user' || e.kind === 'assistant').length ?? 0
  const panes: Record<
    TicketTab,
    {
      icon: LucideIcon
      label: string
      name?: string
      extra?: React.ReactNode
      className: string
      content: React.ReactNode
    }
  > = {
    details: {
      icon: FileText,
      label: 'Details',
      extra: comments > 0 && (
        <span className="text-xs text-fg-3">{plural(comments, 'comment')}</span>
      ),
      className: 'flex',
      content: (
        <>
          <div className="@container min-w-0 flex-1 overflow-y-auto">
            <Details
              head={
                ticket && (
                  <div className="flex min-w-0 flex-col gap-3">
                    {ticket.parent && <ParentLine parent={ticket.parent} refs={refs} />}
                    <h2 className="text-lg/6 font-medium text-balance wrap-anywhere">
                      {ticket.title}
                    </h2>
                    <p className="flex gap-2 text-xs text-fg-3">
                      <span className="font-mono">{ticketLabel(ticket)}</span>
                      {ticket.repo && <span>{ticket.repo.split('/').pop()}</span>}
                      <span>
                        Created{' '}
                        <time dateTime={ticket.createdAt} title={fullTime(ticket.createdAt)}>
                          {shortDate(ticket.createdAt)}
                        </time>
                      </span>
                    </p>
                    {away && tab !== 'conversation' && (
                      <div className="flex flex-col gap-1.5">
                        <p className="text-xs text-fg-3">Session in another project</p>
                        {awayRow}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {tab !== 'conversation' && (noteComposer('w-full') || actionButtons)}
                      <Button asChild variant="outline">
                        <a href={ticket.url} target="_blank" rel="noreferrer">
                          <ExternalLink />
                          Open {opensIn(project)}
                        </a>
                      </Button>
                    </div>
                  </div>
                )
              }
              details={detailsError ? null : details}
              ticket={ticket}
              refs={refs}
              usage={usage}
              fallback={
                detailsError ? (
                  <LoadError
                    text={`Couldn't load the ticket details: ${detailsError}`}
                    onRetry={() => {
                      retryDetails()
                      reload()
                    }}
                    className="m-0"
                  />
                ) : (
                  <Loading label="Loading details" className="p-0" />
                )
              }
            />
          </div>
          {!chatOpen && (
            <div className="flex w-10 shrink-0 justify-center border-l bg-window pt-2">
              <Tip label="Show chat">
                <Button
                  ref={showButton}
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => {
                    flushSync(() => setChatOpen(true))
                    hideButton.current?.focus()
                  }}
                >
                  <MessageCircleQuestion />
                </Button>
              </Tip>
            </div>
          )}
          <ChatPanel
            projectId={project.id}
            ticketKey={ticketKey}
            service={serviceOf(project)}
            active={tab === 'details' && chatOpen}
            hidden={!chatOpen}
            onPosted={reload}
            onHide={hideChat}
            hideRef={hideButton}
            ask={ask}
            takeAsk={takeAsk}
          />
        </>
      )
    },
    conversation: {
      icon: MessagesSquare,
      label: 'Conversation',
      extra: tab !== 'conversation' &&
        (session?.state === 'needsYou' ||
          session?.state === 'reviewing' ||
          session?.state === 'apiError') &&
        !doneOpen && <SessionBadge state={session.state} stop={session.stop} />,
      className: 'flex flex-col',
      content: gauges && (
        <SessionConversation
          key={gauges.session.id}
          session={gauges.session}
          conversation={conversation}
          active={tab === 'conversation'}
          onOpenChanges={gauges.onOpenChanges}
          panel={tab === 'conversation' && !folded && <GaugesPanel {...gauges} />}
          head={
            <div className="flex items-center gap-3">
              {sessions.length > 1 && (
                <Select value={gauges.session.id} onValueChange={setPicked}>
                  <SelectTrigger size="sm" aria-label="Session">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {sessions.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {fullTime(s.startedAt)}
                        <SessionBadge state={s.state} stop={s.stop} />
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <span className="flex-1 text-xs text-fg-3">
                {messages > 0 && plural(messages, 'message')}
              </span>
              {messages > 0 && (
                <Tip label="Summarize session">
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    onClick={() => summarize(gauges.session.id)}
                  >
                    <NotebookPen />
                  </Button>
                </Tip>
              )}
            </div>
          }
          actions={
            tab === 'conversation' && (
              <div className="flex flex-col items-center gap-3">
                {gauges.session.removedAt && (
                  <p className="text-fg-2">
                    The branch stays on GitHub. Start makes a new worktree.
                  </p>
                )}
                {latest && (
                  <>
                    {awayRow}
                    {noteComposer('w-full') || (
                      <div className="flex justify-center gap-2">{actionButtons}</div>
                    )}
                  </>
                )}
              </div>
            )
          }
        />
      )
    },
    changes: {
      icon: FileDiff,
      label: 'Changes',
      ...(hasWorktree &&
        changedFiles > 0 && {
          name: `Changes, ${plural(changedFiles, 'file')} changed`,
          extra: (
            <span aria-hidden className="text-xs text-fg-3 tabular-nums">
              {changedFiles}
            </span>
          )
        }),
      className: 'flex',
      content: session && (
        <Changes
          key={session.id}
          session={session}
          active={tab === 'changes'}
          onCount={setChangedFiles}
        />
      )
    }
  }
  const shown = tabs(hasSession, hasWorktree)

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <ViewHeader>
        <div className="flex flex-1 items-center gap-3">
          <Tip label="Back to board">
            <Button variant="ghost" size="icon-sm" onClick={onBack}>
              <ArrowLeft />
            </Button>
          </Tip>
          <span className="font-mono text-fg-2">{ticket ? ticketLabel(ticket) : ticketKey}</span>
          {ticket && (
            <h1 ref={heading} tabIndex={-1} className={cn(headerTitle, 'outline-none')}>
              {ticket.title}
            </h1>
          )}
          {ticket && narrow && ticket.blockedBy.length > 0 ? (
            <span
              title={ticket.blockedBy.map((b) => blockedByText(b, ticket.repo)).join(', ')}
              className={chip}
            >
              {plural(ticket.blockedBy.length, 'blocker')}
            </span>
          ) : (
            ticket?.blockedBy.map((b) => (
              <span key={b.key} title={b.title} className={chip}>
                {blockedByText(b, ticket.repo)}
              </span>
            ))
          )}
          {done && ticket?.mergedPr && <MergedMark url={ticket.mergedPr} />}
          {!done && ticket?.prStage && <PrStageMark stage={ticket.prStage} />}
        </div>
        {blocked && <SessionBadge state="cantStart" />}
        {session && (
          <>
            {!blocked && (
              <SessionBadge state={doneOpen ? 'doneOpen' : session.state} stop={session.stop} />
            )}
            {!doneOpen && (
              <ClearNeedsYou session={session} run={run} disabled={pending} icon={narrow} />
            )}
            <RaiseCap session={session} run={run} disabled={pending} icon={narrow} />
            {tab !== 'conversation' && newestGauges && <GaugesButton key={tab} {...newestGauges} />}
            {folded && tab === 'conversation' && gauges && <GaugesButton {...gauges} />}
          </>
        )}
      </ViewHeader>
      {result && <p className="px-4 py-1.5 text-xs text-fg-2">{result}</p>}
      {danger && <p className="bg-danger-soft px-4 py-1.5 text-xs text-danger">{danger}</p>}
      {failed?.lines && (
        <div className="px-4 py-1.5">
          <LastLines lines={failed.lines} />
        </div>
      )}
      <OverlapCheck {...overlap} area={areaOf(ticket?.labels ?? [])} className="px-4 py-1.5" />
      <SetupBlock {...setup} project={project} className="px-4 py-1.5" />
      {ticket && <Instructions project={project} labels={ticket.labels} />}
      <div role="tablist" className="flex h-9 shrink-0 items-center gap-2 border-b px-4">
        {shown.map((t) => {
          const { icon: Icon, label, name, extra } = panes[t]
          const button = (
            <button
              key={t}
              ref={tab === t ? selectedTab : undefined}
              role="tab"
              aria-selected={tab === t}
              className={cn(
                'highlight relative flex h-full items-center gap-1.5 px-2 hover:text-foreground',
                tab === t
                  ? 'text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-foreground'
                  : 'text-fg-2'
              )}
              onClick={() => setTab(t)}
            >
              <Icon className="size-3.5" />
              {label}
              {extra}
            </button>
          )
          return name ? (
            <Tip key={t} label={name}>
              {button}
            </Tip>
          ) : (
            button
          )
        })}
        {!narrow && <span className="ml-auto font-mono text-xs text-fg-3">⌘\ to switch</span>}
      </div>
      <div className="relative min-h-0 flex-1">
        {shown.map((t) => (
          <div
            key={t}
            role="tabpanel"
            aria-label={panes[t].label}
            inert={tab !== t}
            className={cn('absolute inset-0', panes[t].className, tab !== t && 'invisible')}
          >
            {panes[t].content}
          </div>
        ))}
      </div>
      {checking && ticket && startable && (
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
    </div>
  )
}

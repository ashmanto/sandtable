import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DropAnimation
} from '@dnd-kit/core'
import {
  BookMarked,
  BrushCleaning,
  CircleDashed,
  CircleUserRound,
  List,
  ListFilter,
  Plus,
  RefreshCw,
  SquareKanban,
  Tag,
  UserRound,
  X
} from 'lucide-react'
import { useEffect, useRef, useState, type ComponentProps } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SheetBar } from './SheetBar'
import { Tip } from './Tip'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { useLeftovers } from '@/hooks/useLeftovers'
import { useTicketDrag } from '@/hooks/useTicketDrag'
import { loadBoardDisplay, saveBoardDisplay, sortTickets } from '@/lib/boardDisplay'
import { loadBoardLayout, saveBoardLayout } from '@/lib/boardLayout'
import {
  boardPeople,
  loadAssigneeFilter,
  NO_ASSIGNEE,
  passesAssignee,
  saveAssigneeFilter
} from '@/lib/assigneeFilter'
import { boardLabels, loadLabelFilter, passes, saveLabelFilter } from '@/lib/labelFilter'
import { filterRepos, loadRepoFilter, passesRepo, saveRepoFilter } from '@/lib/repoFilter'
import { passesSearch } from '@/lib/searchFilter'
import {
  droppedWords,
  inLane,
  laneCells,
  laneId,
  lanesOf,
  NO_PARENT,
  parentLanesOf,
  splitLane,
  nextCellId,
  nextColumn,
  nextGroup,
  nextLaneGroupId,
  placeDrop,
  stepper,
  whereOf,
  type Drop
} from '@/lib/lanes'
import { cn, errorMessage, flip, motion, overRing, plural, ringFade } from '@/lib/utils'
import {
  currentSession,
  elsewhereOf,
  isLive,
  listedSessions,
  tokenCapOf
} from '../../../shared/sessions'
import type { BoardView } from '../../../shared/api'
import { columnFor, COLUMNS as columns, statusMapOf } from '../../../shared/columns'
import { ticketLabel } from '../../../shared/repo'
import { reassign, type BoardColumn, type LaneChange, type Project } from '../../../shared/types'
import { DisplayMenu } from './DisplayMenu'
import { FilterMenu } from './FilterMenu'
import { hasDraft } from '@/lib/ticketDrafts'
import { NewTicketComposer } from './NewTicketComposer'
import type { OpenRoutine } from './RoutineEditor'
import { Routines } from './Routines'
import { LeftoverList } from './LeftoverList'
import { SessionCard } from './SessionCard'
import { LabelDot, PersonAvatar, TicketCard } from './TicketCard'
import type { CardState } from './SessionBadge'
import { ColumnHeading, Swimlanes } from './Swimlanes'
import { DraggableRow, LaneList, rowClass, TicketList, TicketRow } from './TicketList'
import { ViewHeader } from './ViewHeader'

const collisions: CollisionDetection = (args) => {
  const r = args.collisionRect
  const center = r.width && r.height ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null
  return pointerWithin({ ...args, pointerCoordinates: args.pointerCoordinates ?? center })
}

const inOwnLane: CollisionDetection = (args) => {
  const [lane] = splitLane(String(args.active.id))
  return collisions({
    ...args,
    droppableContainers: args.droppableContainers.filter((c) => splitLane(String(c.id))[0] === lane)
  })
}

const measuring = { droppable: { frequency: 100 } }

const newTicketRow = cn(rowClass, 'gap-2 text-fg-3 hover:text-fg-2 [&_svg]:size-3.5')

const placeholder =
  'highlight flex min-h-14 items-center justify-center gap-1.5 rounded-card border border-dashed border-line-2 text-fg-3 outline-none hover:border-fg-4 hover:bg-card hover:text-fg-2 focus-ring [&_svg]:size-3.5'

const views = [
  { id: 'board', title: 'Board', Icon: SquareKanban },
  { id: 'list', title: 'List', Icon: List }
] as const

const instructions = (choose: string): { draggable: string } => ({
  draggable: `To move a ticket, press Space, then ${choose}, and Space again to drop it. Press Escape to cancel.`
})

/** A project's board: its routines, sessions, toolbar, and tickets as columns or a grouped list. */
export function Board({
  project,
  projects,
  view,
  onSync,
  onOpenTicket,
  onOpenElsewhere,
  onProjectSaved,
  onNewSession,
  onDrafted,
  onOpenSession,
  onRoutine,
  onSetUp
}: {
  project: Project
  projects: Project[]
  view: BoardView | null
  onSync: () => Promise<void> | void
  onOpenTicket: (ticketKey: string) => void
  onOpenElsewhere: (projectId: string, ticketKey: string) => void
  onProjectSaved: () => void
  onNewSession: () => void
  onDrafted: (sessionId: string) => void
  onOpenSession: (sessionId: string) => void
  onRoutine: OpenRoutine
  onSetUp: (repo: string) => void
}): React.JSX.Element {
  const [syncing, setSyncing] = useState(false)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [pending, setPending] = useState<
    Record<string, { column: BoardColumn; lane?: LaneChange }>
  >({})
  const [dragging, setDragging] = useState<string | null>(null)
  const [filter, setFilter] = useState(() => loadLabelFilter(project.id))
  const [repos, setRepos] = useState(() => loadRepoFilter(project.id))
  const multiRepo = project.repos.length >= 2
  const [people, setPeople] = useState(() => loadAssigneeFilter(project.id))
  const [search, setSearch] = useState('')
  const searchField = useRef<HTMLInputElement>(null)
  const [me, setMe] = useState<string | null>(null)
  const wantsMe = people.people.includes('@me')
  useEffect(() => {
    if (!wantsMe || me !== null) return
    let live = true
    window.sandtable.projects.me(project.id).then(
      (login) => live && setMe(login),
      () => undefined
    )
    return () => {
      live = false
    }
  }, [wantsMe, me, project.id, view?.syncedAt])
  const [display, setDisplay] = useState(() => loadBoardDisplay(project.id))
  const [layout, setLayout] = useState(() => loadBoardLayout(project.id))
  const [composing, setComposing] = useState(() => hasDraft(project.id))
  const [composerLocked, setComposerLocked] = useState(false)
  const [focus, setFocus] = useState<string | null>(null)
  useEffect(() => {
    if (focus === null) return
    const once = setTimeout(() => setFocus(null))
    return () => clearTimeout(once)
  }, [focus])
  const composerClosed = useRef(false)
  const { leftovers: left, load: loadLeftovers } = useLeftovers()
  const leftovers = left?.length ?? 0
  const [reviewing, setReviewing] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const [allSlot, setAllSlot] = useState<HTMLElement | null>(null)
  const viewError = view?.error ?? null
  const [seenViewError, setSeenViewError] = useState(viewError)
  const [lastError, setLastError] = useState(viewError)
  if (viewError !== seenViewError) {
    setSeenViewError(viewError)
    setLastError(viewError)
  }
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const sync = async (): Promise<void> => {
    setSyncing(true)
    try {
      await onSync()
    } finally {
      setSyncing(false)
    }
  }

  const tickets = view?.tickets ?? []
  const listed = listedSessions(view?.sessions ?? [])
  const map = statusMapOf(project)
  const onBoard = tickets.filter((t) => columnFor(t.status, map) !== 'hidden')
  const everyone = tickets.flatMap((t) => t.assignees)
  const assigned = (t: (typeof tickets)[number]): (typeof tickets)[number] => {
    const lane = pending[t.key]?.lane
    return lane
      ? {
          ...t,
          assignees: reassign(
            t.assignees,
            lane.from,
            everyone.find((a) => a.id === lane.to) ?? null
          )
        }
      : t
  }
  const shown = sortTickets(
    onBoard
      .map(assigned)
      .filter(
        (t) =>
          passes(filter, t) &&
          (!multiRepo || passesRepo(repos, t)) &&
          passesAssignee(people, t, me) &&
          passesSearch(search, t)
      ),
    display
  )
  const error = lastError !== dismissed ? lastError : null
  const placed = (t: (typeof tickets)[number]): BoardColumn | 'hidden' =>
    pending[t.key]?.column ?? columnFor(t.status, map)
  const columnOf = (key: unknown): BoardColumn | 'hidden' | undefined => {
    const t = tickets.find((t) => t.key === key)
    return t && placed(t)
  }
  const numberOf = (key: unknown): string => {
    const t = tickets.find((t) => t.key === key)
    return t ? ticketLabel(t) : String(key)
  }
  const byAssignee = display.group === 'assignee'
  const byParent = display.group === 'parent'
  const byLane = byAssignee || byParent
  const noLane = byParent ? NO_PARENT : NO_ASSIGNEE
  const list = layout.view === 'list'
  const lanes = laneCells(
    byAssignee ? lanesOf(shown) : byParent ? parentLanesOf(shown, onBoard, placed) : [],
    placed
  )
  const laneIds = lanes.map((l) => l.id)
  const nextCell = list ? nextLaneGroupId(laneIds, layout.lanes) : nextCellId(laneIds)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] },
      coordinateGetter: !byLane
        ? list
          ? nextGroup
          : nextColumn
        : stepper(byParent ? inLane(nextCell) : nextCell)
    })
  )
  const nameOf = (lane: string): string => lanes.find((l) => l.id === lane)?.name ?? ''
  const place = (activeId: unknown, overId?: unknown): Drop => {
    const d = placeDrop(
      String(activeId),
      overId === undefined ? undefined : String(overId),
      (key) => columnOf(key) as BoardColumn
    )
    return byParent && d.to !== d.from
      ? placeDrop(String(activeId), undefined, () => d.fromColumn)
      : d
  }
  const words = (d: Drop): string => {
    const t = shown.find((t) => t.key === d.key)
    const keepsOthers = !!t?.assignees.some((a) => a.id !== d.from)
    return droppedWords(d, numberOf(d.key), nameOf, keepsOthers)
  }
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${numberOf(place(active.id).key)}.`,
    onDragOver: ({ active, over }) => {
      const d = over && place(active.id, over.id)
      return d ? `Over ${whereOf(d.to, d.column, nameOf)}.` : undefined
    },
    onDragEnd: ({ active, over }) => words(place(active.id, over?.id)),
    onDragCancel: ({ active }) => `Move canceled. ${words(place(active.id))}`
  }

  const drop = (activeId: string, overId: string | undefined): void => {
    if (!mounted.current) return
    setDragging(null)
    if (overId === undefined) return
    const { key, from, to, column, lane, moves } = place(activeId, overId)
    if (!moves) return
    setPending((p) => ({ ...p, [key]: { column, lane } }))
    const t = shown.find((x) => x.key === key)
    const kept =
      lane?.to === null
        ? laneIds.find((id) => id !== from && t?.assignees.some((a) => a.id === id))
        : undefined
    const into = kept ?? to
    if (into !== null) setFocus(laneId(into, layout.lanes.includes(into) ? '' : key))
    else if (list && layout.collapsed.includes(column)) setFocus(column)
    const handle = t && `${numberOf(key)} ${t.title}`
    void window.sandtable.tickets
      .move(project.id, key, column, lane)
      .then(
        () => false,
        (err) => {
          setDismissed(null)
          setLastError(`Couldn't move ${numberOf(key)}: ${errorMessage(err)}`)
          return true
        }
      )
      .then((failed) => {
        setPending((p) => Object.fromEntries(Object.entries(p).filter(([k]) => k !== key)))
        const here = document.activeElement
        const ours = !here || here === document.body || here.getAttribute('aria-label') === handle
        if (failed && ours && mounted.current) setFocus(activeId)
      })
  }

  const cardState = (t: (typeof tickets)[number]): CardState | undefined => {
    const session = currentSession(view?.sessions ?? [], t.key)
    const done = placed(t) === 'done'
    return session && isLive(session) && done
      ? 'doneOpen'
      : done && session?.state === 'finished'
        ? undefined
        : session?.state
  }
  const cardProps = (t: (typeof tickets)[number]): ComponentProps<typeof TicketCard> => {
    const session = currentSession(view?.sessions ?? [], t.key)
    const done = placed(t) === 'done'
    const away = elsewhereOf(view?.elsewhere ?? [], projects, t.key, session)
    return {
      project,
      ticket: t,
      session,
      state: cardState(t),
      done,
      onFolderFixed: onProjectSaved,
      onOpen: () => dragging === null && onOpenTicket(t.key),
      onSetUp,
      tickets,
      onOpenTicket,
      stateOf: (key) => {
        const ref = tickets.find((x) => x.key === key)
        return ref && cardState(ref)
      },
      elsewhere: away && { ...away, onOpen: () => onOpenElsewhere(away.project.id, t.key) }
    }
  }
  const rowProps = (
    t: (typeof tickets)[number],
    dragId = t.key
  ): ComponentProps<typeof TicketCard> & {
    disabled: boolean
    dragId: string
    focused: boolean
  } => ({
    ...cardProps(t),
    disabled: t.key in pending,
    dragId,
    focused: focus === dragId
  })
  const laneLook = (
    t: (typeof tickets)[number],
    lane: string
  ): { parentTag?: boolean; hideParent?: boolean } =>
    byParent ? (lane === t.key ? { parentTag: true } : { hideParent: true }) : {}
  const dragged = tickets.find((t) => t.key === dragging)
  const draggedLook =
    dragged &&
    laneLook(
      dragged,
      lanes.find((l) => l.cells.some((c) => c.tickets.some((t) => t.key === dragged.key)))?.id ?? ''
    )
  const locked = composing && composerLocked
  const hidesComposer = (l: typeof layout): boolean =>
    byLane ? l.lanes.includes(noLane) : l.collapsed.includes('todo')
  const saveLayout = (l: typeof layout): void => {
    setLayout(l)
    saveBoardLayout(project.id, l)
    const hides = hidesComposer(l) && !hidesComposer(layout)
    if (!locked && (l.view !== layout.view || hides)) setComposing(false)
  }
  const toggleLane = (lane: string): void =>
    saveLayout({
      ...layout,
      lanes: flip(layout.lanes, lane)
    })
  const grouped = columns.map((col) => ({
    ...col,
    tickets: shown.filter((t) => placed(t) === col.id)
  }))
  const newTicket = (className: string): React.ReactNode =>
    composing ? (
      <NewTicketComposer
        project={project}
        onDrafted={(id) => {
          setComposing(false)
          onDrafted(id)
        }}
        onClose={() => {
          composerClosed.current = true
          setComposing(false)
        }}
        onLockChange={setComposerLocked}
      />
    ) : (
      <button
        ref={(el) => {
          if (el && composerClosed.current) el.focus()
          composerClosed.current = false
        }}
        type="button"
        className={className}
        onClick={() => setComposing(true)}
      >
        <Plus />
        New ticket
      </button>
    )
  const cleanUpLabel = `${plural(leftovers, 'session')} to clean up`
  const { still, easing } = motion('--ease-out-quad')
  const dropAnimation: DropAnimation | null = still ? null : { duration: 200, easing }
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <ViewHeader>
        <span className="flex min-w-16 items-center gap-1.5">
          {project.icon && (
            <span aria-hidden className="text-emoji">
              {project.icon}
            </span>
          )}
          <h1 className="min-w-0 truncate font-medium">{project.name}</h1>
        </span>
        <span className="min-w-0 truncate text-xs text-fg-3">
          {project.board
            ? 'GitHub Projects board'
            : project.linear
              ? [
                  `Linear team ${project.linear.team}`,
                  ...project.linear.projects.map((p) => p.name)
                ].join(', ')
              : project.jira
                ? `Jira project ${project.jira.project} (${project.jira.name})`
                : `Issues from ${project.repos.map((r) => r.github.split('/')[1]).join(', ')}`}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          {view?.syncedAt
            ? `Synced ${new Date(view.syncedAt).toLocaleTimeString()}`
            : 'Not synced yet'}
        </span>
        {leftovers > 0 && (
          <Tip label={cleanUpLabel}>
            <Button
              variant="ghost"
              className="bg-danger-soft text-danger hover:bg-danger/15 hover:text-danger dark:hover:bg-danger/25"
              onClick={() => setReviewing(true)}
            >
              <BrushCleaning />
              <span className="rounded-full px-1.5 text-xs ring-1 ring-danger/30 ring-inset">
                {leftovers}
              </span>
            </Button>
          </Tip>
        )}
        <Tip label="Sync">
          <Button
            variant="outline"
            size="icon-sm"

            onClick={() => void sync()}
            disabled={syncing}
          >
            <RefreshCw
              className={syncing ? 'animate-spin motion-reduce:animate-none' : undefined}
            />
          </Button>
        </Tip>
      </ViewHeader>
      {error && (
        <div
          role="alert"
          className="flex items-center gap-3 border-b bg-danger-soft px-4 py-2 text-danger"
        >
          <p className="min-w-0 flex-1">{error}</p>
          <Button variant="ghost" size="sm" onClick={() => setDismissed(error)}>
            Dismiss
          </Button>
        </div>
      )}
      <Sheet
        open={reviewing}
        onOpenChange={(open) => {
          setReviewing(open)
          if (!open) void loadLeftovers()
        }}
      >
        <SheetContent
          aria-describedby={undefined}
          onEscapeKeyDown={(e) => cleaning && e.preventDefault()}
          onInteractOutside={(e) => cleaning && e.preventDefault()}
        >
          <SheetBar title="To clean up" closeDisabled={cleaning}>
            <span ref={setAllSlot} className="flex" />
          </SheetBar>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-3">
            <LeftoverList allIn={allSlot} onPendingChange={setCleaning} />
          </div>
        </SheetContent>
      </Sheet>
      <Routines
        project={project}
        projects={projects}
        routines={view?.routines ?? []}
        sessions={view?.sessions ?? []}
        onRoutine={onRoutine}
        onOpenSession={onOpenSession}
      />
      <section aria-label="Sessions" className="flex flex-col gap-2 px-3 pb-3">
        <h2 className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          Sessions
          <span className="text-fg-3">{listed.length}</span>
        </h2>
        <div className="-m-1 flex gap-2 overflow-x-auto p-1">
          {listed.map((s) => (
            <SessionCard
              key={s.id}
              session={s}
              cap={tokenCapOf(project, s)}
              onOpen={() => onOpenSession(s.id)}
            />
          ))}
          <Tip
            label="Start a Claude Code session that isn't tied to a ticket"
            aria-label={undefined}
          >
            <button
              type="button"
              className={cn(placeholder, 'min-h-[91px] w-60 shrink-0')}
              onClick={onNewSession}
            >
              <Plus />
              New session
            </button>
          </Tip>
        </div>
      </section>
      <div className="mx-3 flex items-center gap-1.5 rounded-card border p-1.5">
        <div
          role="group"
          aria-label="View"
          className="flex gap-0.5 rounded-full bg-neutral-soft p-0.5 ring-1 ring-border ring-inset"
        >
          {views.map(({ id, title, Icon }) => (
            <Tip key={id} label={title}>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-pressed={layout.view === id}
                disabled={locked || dragging !== null}
                className="text-fg-3 hover:bg-transparent hover:text-fg-2 aria-pressed:bg-popover aria-pressed:text-fg aria-pressed:shadow-card [&_svg]:size-3.5"
                onClick={() => saveLayout({ ...layout, view: id })}
              >
                <Icon />
              </Button>
            </Tip>
          ))}
        </div>
        <DisplayMenu
          manualTitle={project.board ? 'Manual' : 'Default'}
          display={display}
          groupLocked={locked || dragging !== null}
          onChange={(d) => {
            if (d.group !== display.group) setComposing(false)
            setDisplay(d)
            saveBoardDisplay(project.id, d)
          }}
        />
        <FilterMenu
          title="Filters"
          icon={<ListFilter />}
          subs={[
            {
              name: 'Labels',
              icon: <Tag />,
              groups: [
                boardLabels(onBoard, filter.labels).map((l) => ({
                  value: l.name,
                  name: l.name,
                  icon: <LabelDot color={l.color} />
                }))
              ],
              empty: 'No labels on these tickets',
              mode: filter.mode,
              checked: filter.labels,
              onChange: (mode, labels) => {
                setFilter({ mode, labels })
                saveLabelFilter(project.id, { mode, labels })
              }
            },
            ...(multiRepo
              ? [
                  {
                    name: 'Repos',
                    icon: <BookMarked />,
                    groups: [filterRepos(project, repos.repos).map((r) => ({ ...r, icon: null }))],
                    mode: repos.mode,
                    checked: repos.repos,
                    onChange: (mode: 'only' | 'hide', checked: string[]) => {
                      setRepos({ mode, repos: checked })
                      saveRepoFilter(project.id, { mode, repos: checked })
                    }
                  }
                ]
              : [])
          ]}
        />
        <FilterMenu
          title="Assignees"
          icon={<UserRound />}
          subs={[
            {
              name: 'Assignees',
              icon: <UserRound />,
              groups: [
                [
                  { value: '@me', name: 'Me', icon: <CircleUserRound /> },
                  { value: NO_ASSIGNEE, name: 'Unassigned', icon: <CircleDashed /> }
                ],
                boardPeople(onBoard, people.people).map((p) => ({
                  value: p.login,
                  name: p.name,
                  icon: <PersonAvatar name={p.name} />
                }))
              ],
              mode: people.mode,
              checked: people.people,
              onChange: (mode, checked) => {
                setPeople({ mode, people: checked })
                saveAssigneeFilter(project.id, { mode, people: checked })
              }
            }
          ]}
        />
        <div className="relative">
          <Input
            ref={searchField}
            type="search"
            aria-label="Search tickets"
            placeholder="Search tickets"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return
              e.stopPropagation()
              setSearch('')
            }}
            className="h-7 w-44 pr-7 text-xs md:text-xs [&::-webkit-search-cancel-button]:hidden"
          />
          {search && (
            <Tip label="Clear search">
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Clear search"
                className="absolute top-1/2 right-1 -translate-y-1/2 text-fg-3"
                onClick={() => {
                  setSearch('')
                  searchField.current?.focus()
                }}
              >
                <X />
              </Button>
            </Tip>
          )}
        </div>
        {shown.length < onBoard.length && (
          <span className="text-xs text-fg-3">
            {onBoard.length - shown.length} hidden by filter
          </span>
        )}
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={byParent ? inOwnLane : collisions}
        measuring={measuring}
        accessibility={{
          announcements,
          screenReaderInstructions: instructions(
            list
              ? 'Up or Down Arrow to choose a group'
              : byAssignee
                ? 'Left or Right Arrow to choose a column and Up or Down Arrow to choose a lane'
                : 'Left or Right Arrow to choose a column'
          )
        }}
        onDragStart={({ active }) => {
          setDragging(place(active.id).key)
          setFocus(null)
        }}
        onDragEnd={({ active, over }) =>
          drop(String(active.id), over ? String(over.id) : undefined)
        }
        onDragCancel={() => setDragging(null)}
      >
        {byLane && list ? (
          <LaneList
            lanes={lanes}
            collapsed={layout.lanes}
            locked={dragging !== null ? laneIds : locked ? [noLane] : []}
            focus={focus}
            row={(t, lane) => (
              <DraggableRow
                key={t.key}
                {...rowProps(t, laneId(lane, t.key))}
                parentTag={laneLook(t, lane).parentTag}
              />
            )}
            trailing={newTicket(newTicketRow)}
            onToggle={toggleLane}
          />
        ) : byLane ? (
          <Swimlanes
            columns={grouped.map((c) => ({ id: c.id, title: c.title, count: c.tickets.length }))}
            lanes={lanes}
            collapsed={layout.lanes}
            locked={dragging !== null ? laneIds : locked ? [noLane] : []}
            focus={focus}
            card={(t, lane) => (
              <DraggableCard
                key={t.key}
                {...rowProps(t, laneId(lane, t.key))}
                {...laneLook(t, lane)}
              />
            )}
            trailing={newTicket(cn(placeholder, 'w-full'))}
            onToggle={toggleLane}
          />
        ) : list ? (
          <TicketList
            groups={grouped.map(({ id, title, tickets }) => ({
              id,
              title,
              rows: tickets.map((t) => rowProps(t)),
              trailing: id === 'todo' && newTicket(newTicketRow)
            }))}
            collapsed={layout.collapsed}
            locked={dragging !== null ? columns.map((c) => c.id) : locked ? ['todo'] : []}
            focus={focus}
            onToggle={(c) =>
              saveLayout({
                ...layout,
                collapsed: flip(layout.collapsed, c) as BoardColumn[]
              })
            }
          />
        ) : (
          <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3">
            {grouped.map((col) => (
              <DropColumn
                key={col.id}
                id={col.id}
                title={col.title}
                count={col.tickets.length}
                trailing={col.id === 'todo' && newTicket(cn(placeholder, 'w-full'))}
              >
                {col.tickets.map((t) => (
                  <DraggableCard key={t.key} {...rowProps(t)} />
                ))}
              </DropColumn>
            ))}
          </div>
        )}
        <DragOverlay dropAnimation={dropAnimation}>
          {dragged &&
            (list ? (
              <div className="pointer-events-none rounded-md bg-popover shadow-md">
                <TicketRow {...cardProps(dragged)} parentTag={draggedLook?.parentTag} />
              </div>
            ) : (
              <div className="pointer-events-none rounded-card shadow-md *:bg-popover">
                <TicketCard {...cardProps(dragged)} {...draggedLook} />
              </div>
            ))}
        </DragOverlay>
      </DndContext>
    </div>
  )
}

function DropColumn({
  id,
  title,
  count,
  trailing,
  children
}: {
  id: BoardColumn
  title: string
  count: number
  trailing?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <section
      ref={setNodeRef}
      aria-label={title}
      className={cn(
        'flex min-h-0 w-[350px] shrink-0 flex-col rounded-card',
        ringFade,
        isOver && overRing
      )}
    >
      <ColumnHeading id={id} title={title} count={count} />
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-2 pr-4 pb-2 pl-3">
          {children}
          {trailing}
        </div>
      </ScrollArea>
    </section>
  )
}

function DraggableCard({
  disabled,
  dragId,
  focused,
  ...props
}: { disabled: boolean; dragId?: string; focused?: boolean } & ComponentProps<
  typeof TicketCard
>): React.JSX.Element {
  const dragHandle = useTicketDrag(props.ticket, disabled, { id: dragId, focused })
  return <TicketCard {...props} dragHandle={dragHandle} />
}

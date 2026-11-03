import { useEffect, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements
} from '@dnd-kit/core'
import {
  ArrowDown,
  ArrowUp,
  ChartColumn,
  ChevronRight,
  Coffee,
  Ellipsis,
  FolderPlus,
  PanelLeft,
  Pencil,
  Plus,
  Repeat,
  Settings,
  Trash2
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ProjectTile } from './ProjectTile'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useLiveUsage } from '@/hooks/useLiveUsage'
import {
  cardUsage,
  compact,
  hasPrice,
  hasUnpriced,
  money,
  pricedTotal,
  SHADES,
  totalTokens
} from '@/lib/usage'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAfterMenu } from '@/hooks/useAfterMenu'
import { countLabel, stateWords, type CardState, type Counted } from '@/lib/card'
import { moveGroup, moveProject, sections, type Section } from '@/lib/projectGroups'
import { dropOf, type Drop } from '@/lib/sidebarDrop'
import type { Nav } from '@/lib/headerFrame'
import { cn, flip, loadSaved, motion, saveSaved } from '@/lib/utils'
import { ClearNeedsYou } from './ClearNeedsYou'
import { SessionBadge, SessionCount } from './SessionBadge'
import { Tip } from './Tip'
import { Estimate, Num, ShareBar } from './Usage'
import type { OpenRoutine } from './RoutineEditor'
import { NavButtons, NeedsYouCount } from './ViewHeader'
import { parseTicketKey, ticketLabel } from '../../../shared/repo'
import { SIDEBAR_WIDTH, sidebarWidth, type SidebarSession } from '../../../shared/api'
import type { Project, ProjectGroup, Routine, SessionRecord } from '../../../shared/types'

/** The sidebar's slide, shared with the panel margin that moves with it. */
export const slide =
  'transition-[margin] duration-(--speed-regular) ease-(--ease-out-quart) motion-reduce:transition-none'

const stateOf = (s: SidebarSession): CardState => (s.done ? 'doneOpen' : s.state)

function SessionButton({
  session: s,
  current,
  onOpen
}: {
  session: SidebarSession
  current: boolean
  onOpen: () => void
}): React.JSX.Element {
  const usage = useLiveUsage(s.id)
  const label = [
    `${s.name} — ${stateWords(stateOf(s), s.stop)}`,
    s.state === 'apiError' && s.stop?.message,
    usage && cardUsage(usage),
    s.capped && 'Reached its token cap'
  ]
    .filter(Boolean)
    .join('\n')
  return (
    <Tip label={label} aria-label={undefined}>
      <button
        type="button"
        onClick={onOpen}
        aria-current={current ? 'page' : undefined}
        className="flex h-full min-w-0 flex-1 flex-col justify-center pl-0.5 text-left"
      >
        <span className="flex w-full items-center gap-2">
          <SessionName session={s} />
          <span className="ml-auto shrink-0">
            <SessionBadge
              state={stateOf(s)}
              stop={s.stop}
              short
              labelClassName="@max-[263px]/sidebar:sr-only"
            />
          </span>
          {stateOf(s) === 'needsYou' && (s.asking || s.capped) && (
            <span className="shrink-0 text-fg-3 @max-[263px]/sidebar:sr-only">
              {s.asking ? 'asking' : 'capped'}
            </span>
          )}
        </span>
      </button>
    </Tip>
  )
}

function SessionName({ session: s }: { session: SessionRecord }): React.JSX.Element {
  return (
    <>
      {s.ticketKey && (
        <span className="shrink-0 font-mono text-fg-3">
          {ticketLabel({ key: s.ticketKey, number: parseTicketKey(s.ticketKey).number })}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{s.name}</span>
    </>
  )
}

function LiveMeter({ sessions }: { sessions: SidebarSession[] }): React.JSX.Element | null {
  const live = useLiveUsage()
  const at = (id: string): number => {
    const i = sessions.findIndex((s) => s.id === id)
    return i < 0 ? sessions.length : i
  }
  const rows = Object.entries(live)
    .map(([id, usage]) => ({
      id,
      s: sessions.find((s) => s.id === id),
      usage,
      tokens: totalTokens(usage)
    }))
    .filter((r) => r.tokens)
    .sort((a, b) => at(a.id) - at(b.id))
  if (!rows.length) return null
  const all = rows.flatMap((r) => r.usage)
  const total = totalTokens(all)
  const priced = hasPrice(all)
  const estimate = priced
    ? `, ${money(pricedTotal(all))} API estimate${hasUnpriced(all) ? ', leaves out a model with no price' : ''}`
    : ''
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          role="group"
          tabIndex={0}
          aria-label={`Live now: ${compact(total)} tokens${estimate}`}
          className="highlight flex flex-col gap-1.5 rounded-md px-2 pt-1 pb-2 text-xs text-fg-2 outline-none focus-ring"
        >
          <p className="flex justify-between gap-2">
            <span>Live now</span>
            <span>
              <Num n={total} />
              {priced && (
                <>
                  {' · '}
                  <Estimate usage={all} />
                </>
              )}
            </span>
          </p>
          <ShareBar parts={rows.map((r) => r.tokens)} className="gap-px" />
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" align="start" className="w-72 max-w-none p-2 whitespace-normal">
        <ul className="flex flex-col gap-1">
          {rows.map(({ id, s, usage, tokens }, i) => (
            <li key={id} className="flex items-center gap-2">
              <span
                aria-hidden
                className={cn('size-2 shrink-0 rounded-full', SHADES[i % SHADES.length])}
              />
              {s ? (
                <SessionName session={s} />
              ) : (
                <span className="min-w-0 flex-1 truncate">Session not on the board</span>
              )}
              <Num n={tokens} className="text-fg-3" />
              <Estimate usage={usage} className="w-13" />
            </li>
          ))}
        </ul>
        <p className="mt-2 text-fg-3">
          Share of tokens across live sessions. API price estimate, not what you paid.
        </p>
      </TooltipContent>
    </Tooltip>
  )
}

const OPEN_KEY = 'sandtable.openProjects'
const COLLAPSED_KEY = 'sandtable.collapsedGroups'

const loadIds = (key: string): string[] =>
  loadSaved<string[]>(key, [], (v) =>
    Array.isArray(v) ? v.filter((id): id is string => typeof id === 'string') : null
  )

type Editing = { group?: string; move?: string }

const dropMark = (place?: Drop['place']): string =>
  cn(
    'relative',
    place === 'before' &&
      'before:absolute before:inset-x-1.5 before:-top-px before:h-0.5 before:rounded-full before:bg-accent',
    place === 'after' &&
      'after:absolute after:inset-x-1.5 after:-bottom-px after:h-0.5 after:rounded-full after:bg-accent',
    place === 'into' && 'bg-accent/15 ring-1 ring-accent ring-inset'
  )

const reveal = 'group-hover:w-5 group-has-focus-visible:w-5 group-has-data-[state=open]:w-5'
const heading = 'flex h-7 items-center gap-1 rounded-full pr-1.5 pl-3 text-xs font-medium text-fg-3'

function DndRow({
  id,
  drag = false,
  mark,
  className,
  children
}: {
  id: string
  drag?: boolean
  mark?: Drop['place']
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  const { setNodeRef, listeners, isDragging } = useDraggable({ id, disabled: !drag })
  const { setNodeRef: setDropRef } = useDroppable({ id })
  return (
    <div
      ref={(el) => {
        setNodeRef(el)
        setDropRef(el)
      }}
      {...listeners}
      onPointerDown={(e) => {
        if (e.currentTarget.contains(e.target as Node)) listeners?.onPointerDown?.(e)
      }}
      className={cn(className, dropMark(mark), isDragging && 'opacity-40')}
    >
      {children}
    </div>
  )
}

function MoreMenu({
  label,
  onCloseAutoFocus,
  children
}: {
  label: string
  onCloseAutoFocus: (e: Event) => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Tip label={label}>
          <Button
            variant="ghost"
            size="icon-xs"
            className={cn('h-5 w-0 overflow-hidden p-0 text-fg-3', reveal)}
          >
            <Ellipsis className="size-3.5" />
          </Button>
        </Tip>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-40" onCloseAutoFocus={onCloseAutoFocus}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function NameField({
  label,
  value = '',
  onDone
}: {
  label: string
  value?: string
  onDone: (name: string, byKey: boolean) => void
}): React.JSX.Element {
  const done = useRef(false)
  const finish = (name: string, byKey = true): void => {
    if (done.current) return
    done.current = true
    onDone(name.trim(), byKey)
  }
  return (
    <Input
      aria-label={label}
      placeholder="Group name"
      defaultValue={value}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => finish(e.currentTarget.value, false)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          finish(e.currentTarget.value)
        }
        if (e.key === 'Escape') finish('')
      }}
      className="h-5.5 rounded-sm px-1.5 text-xs font-medium text-fg shadow-none md:text-xs"
    />
  )
}

/** The app's left sidebar: projects in groups, their live sessions, and app controls. */
export function ProjectSidebar({
  projects,
  groups,
  selectedId,
  needsYou,
  sessions,
  openSessionId,
  openTicketKey,
  onSelect,
  onAdd,
  onEdit,
  onArrange,
  onOpenSession,
  onOpenTicket,
  onNewSession,
  onSettings,
  onUsage,
  onRoutine,
  backForward,
  hidden = false,
  inset = false,
  onHide,
  width = SIDEBAR_WIDTH.default,
  onResize
}: {
  projects: Project[]
  groups: ProjectGroup[]
  selectedId: string | null
  needsYou: Record<string, number>
  sessions: SidebarSession[]
  openSessionId: string | null
  openTicketKey: string | null
  onSelect: (projectId: string) => void
  onAdd: () => void
  onEdit: (projectId: string) => void
  onArrange: (projects: Project[], groups: ProjectGroup[]) => void
  onOpenSession: (projectId: string, sessionId: string) => void
  onOpenTicket: (projectId: string, ticketKey: string) => void
  onNewSession: (projectId: string) => void
  onSettings: () => void
  onUsage: () => void
  onRoutine: OpenRoutine
  backForward?: Nav
  hidden?: boolean
  inset?: boolean
  onHide?: () => void
  width?: number
  onResize?: (width: number) => void
}): React.JSX.Element {
  const resizing = useRef<{ x: number; width: number } | null>(null)
  const [awake, setAwake] = useState(false)
  useEffect(() => {
    const off = window.sandtable.app.onAwake(setAwake)
    void window.sandtable.app.awake().then(setAwake)
    return off
  }, [])
  const [open, setOpen] = useState(() => loadIds(OPEN_KEY))
  const [collapsed, setCollapsed] = useState(() => loadIds(COLLAPSED_KEY))
  const [opened, setOpened] = useState<string | null>(null)
  if (selectedId !== opened && projects.some((p) => p.id === selectedId)) {
    setOpened(selectedId)
    if (selectedId && !open.includes(selectedId)) setOpen([...open, selectedId])
  }
  useEffect(() => saveSaved(OPEN_KEY, open), [open])
  useEffect(() => saveSaved(COLLAPSED_KEY, collapsed), [collapsed])
  const [editing, setEditing] = useState<Editing | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [drop, setDrop] = useState<Drop | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const parts = sections(projects, groups)
  const nav = useRef<HTMLElement>(null)
  const refocus = useRef<string | null>(null)
  useEffect(() => {
    if (!refocus.current) return
    const el = [...(nav.current?.querySelectorAll<HTMLElement>('[data-focus]') ?? [])].find(
      (x) => x.dataset.focus === refocus.current
    )
    if (!el) return
    el.focus()
    refocus.current = null
  })
  const pointerY = useRef(0)
  const { later, afterMenu } = useAfterMenu()
  const [routines, setRoutines] = useState<Routine[]>([])
  const routinesOf = useRef<string | null>(null)

  const save = (name: string, byKey: boolean): void => {
    setEditing(null)
    if (!editing) return
    const added = { id: crypto.randomUUID(), name }
    if (byKey)
      refocus.current = editing.group ? `g:${editing.group}` : name ? `g:${added.id}` : 'new'
    if (!name) return
    if (editing.group)
      return onArrange(
        projects,
        groups.map((g) => (g.id === editing.group ? { ...g, name } : g))
      )
    const next = [...groups, added]
    onArrange(editing.move ? moveProject(projects, next, editing.move, added.id) : projects, next)
  }
  const deleteGroup = (id: string): void => {
    const rest = groups.filter((g) => g.id !== id)
    setCollapsed((c) => c.filter((x) => x !== id))
    refocus.current = 'new'
    onArrange(
      projects
        .filter((p) => p.group === id)
        .reduce((ps, p) => moveProject(ps, rest, p.id, null), projects),
      rest
    )
  }
  const onDrop = (active: string, to: Drop): void => {
    const id = active.slice(2)
    const target = to.id.slice(2)
    const after = to.place === 'after'
    if (active.startsWith('g:')) return onArrange(projects, moveGroup(groups, id, target, after))
    const beside = to.id.startsWith('p:')
    const group = beside
      ? (projects.find((p) => p.id === target)?.group ?? null)
      : to.id.startsWith('u:')
        ? null
        : target
    if (!beside && group) setCollapsed((c) => c.filter((x) => x !== group))
    onArrange(
      moveProject(projects, groups, id, group, beside ? { id: target, after } : undefined),
      groups
    )
  }

  const row = (selected: boolean): string =>
    cn(
      'highlight group flex h-7 items-center gap-1.5 rounded-full pr-1 pl-2 hover:bg-surface-3 has-focus-visible:bg-surface-3 has-data-[state=open]:bg-surface-3',
      selected && 'bg-surface-3'
    )
  const isOpen = (s: SessionRecord): boolean =>
    s.ticketKey
      ? s.projectId === selectedId && s.ticketKey === openTicketKey
      : s.id === openSessionId
  const markOf = (id: string): Drop['place'] | undefined =>
    drop?.id === id ? drop.place : undefined

  const projectRow = (p: Project, siblings: Project[], group: string | null): React.JSX.Element => {
    const count = needsYou[p.id] ?? 0
    const expanded = open.includes(p.id)
    const mine = sessions.filter((s) => s.projectId === p.id)
    const current = p.id === selectedId && !(expanded && sessions.some(isOpen))
    const at = siblings.indexOf(p)
    const chip = (state: Counted, n: number): React.ReactNode =>
      n > 0 && (
        <Tip
          key={state}
          label={[
            countLabel[state](n),
            ...mine.filter((s) => stateOf(s) === state).map((s) => s.name)
          ].join('\n')}
          aria-label={undefined}
        >
          <SessionCount state={state} count={n} title={undefined} tabIndex={0} />
        </Tip>
      )
    const shift = (by: number): void =>
      onArrange(
        moveProject(projects, groups, p.id, group, { id: siblings[at + by].id, after: by > 0 }),
        groups
      )
    return (
      <li key={p.id} className={dropMark(markOf(`p:${p.id}`))}>
        <DndRow id={`p:${p.id}`} drag className={row(current)}>
          <Tip label={`${expanded ? 'Hide' : 'Show'} sessions of ${p.name}`}>
            <button
              type="button"
              aria-expanded={expanded}
              className="grid size-5 shrink-0 place-items-center rounded-full text-fg-3 *:col-start-1 *:row-start-1 hover:text-fg"
              onClick={() => setOpen((o) => flip(o, p.id))}
            >
              <ProjectTile
                name={p.name}
                icon={p.icon}
                className="group-hover:opacity-0 group-has-focus-visible:opacity-0 group-has-data-[state=open]:opacity-0"
              />
              <ChevronRight
                aria-hidden
                className={cn(
                  'size-3.5 opacity-0 transition-transform duration-(--speed-highlight-out) ease-(--ease-out-quart) group-hover:opacity-100 group-has-focus-visible:opacity-100 group-has-data-[state=open]:opacity-100 motion-reduce:transition-none',
                  expanded && 'rotate-90'
                )}
              />
            </button>
          </Tip>
          <button
            type="button"
            onClick={() => onSelect(p.id)}
            data-focus={`p:${p.id}`}
            aria-current={current ? 'page' : undefined}
            className={cn('h-full min-w-0 flex-1 truncate text-left', current && 'font-medium')}
          >
            {p.name}
          </button>
          <MoreMenu label={`More for ${p.name}`} onCloseAutoFocus={afterMenu}>
            <DropdownMenuItem onSelect={() => onEdit(p.id)}>
              <Pencil />
              Edit project
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onNewSession(p.id)}>
              <Plus />
              New session
            </DropdownMenuItem>
            <DropdownMenuSub
              onOpenChange={(on) => {
                if (!on) return
                setRoutines([])
                routinesOf.current = p.id
                window.sandtable.routines
                  .list(p.id)
                  .then((rs) => routinesOf.current === p.id && setRoutines(rs), console.error)
              }}
            >
              <DropdownMenuSubTrigger>
                <Repeat />
                Routines
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-w-64 min-w-40">
                <DropdownMenuItem onSelect={() => later(() => onRoutine(p))}>
                  <Plus />
                  New routine…
                </DropdownMenuItem>
                {routines.length > 0 && <DropdownMenuSeparator />}
                {routines.map((r) => (
                  <DropdownMenuItem key={r.id} onSelect={() => later(() => onRoutine(p, r))}>
                    <span className="truncate">{r.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="pl-8 text-xs text-fg-3">Move to</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              aria-label="Move to"
              value={group ?? ''}
              onValueChange={(to) => {
                if (to === (group ?? '')) return
                setCollapsed((c) => c.filter((x) => x !== to))
                refocus.current = `p:${p.id}`
                onArrange(moveProject(projects, groups, p.id, to || null), groups)
              }}
            >
              {[null, ...groups].map((g) => (
                <DropdownMenuRadioItem key={g?.id ?? ''} value={g?.id ?? ''}>
                  {g?.name ?? 'No group'}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuItem onSelect={() => later(() => setEditing({ move: p.id }))}>
              <FolderPlus />
              New group…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={at === 0} onSelect={() => shift(-1)}>
              <ArrowUp />
              Move up
            </DropdownMenuItem>
            <DropdownMenuItem disabled={at === siblings.length - 1} onSelect={() => shift(1)}>
              <ArrowDown />
              Move down
            </DropdownMenuItem>
          </MoreMenu>
          <span className="flex gap-0.5">
            {chip('needsYou', count)}
            {!expanded &&
              (['running', 'reviewing', 'idle', 'done', 'doneOpen'] as const).map((state) =>
                chip(state, mine.filter((s) => stateOf(s) === state).length)
              )}
          </span>
        </DndRow>
        {expanded && (
          <ul className="flex flex-col gap-px pt-px pl-4">
            {mine.map((s) => (
              <li key={s.id} className={row(isOpen(s))}>
                <SessionButton
                  session={s}
                  current={isOpen(s)}
                  onOpen={() =>
                    s.ticketKey ? onOpenTicket(p.id, s.ticketKey) : onOpenSession(p.id, s.id)
                  }
                />
                {s.state === 'needsYou' && !s.done ? (
                  <ClearNeedsYou
                    session={s}
                    run={(clear) => clear().catch(console.error)}
                    icon
                    className={cn('w-0 overflow-hidden p-0 text-fg-3', reveal)}
                  />
                ) : (
                  <span aria-hidden className="w-0" />
                )}
              </li>
            ))}
            <li>
              <Button
                variant="ghost"
                className="w-full justify-start px-2 text-fg-2"
                onClick={() => onNewSession(p.id)}
              >
                <Plus />
                New session
              </Button>
            </li>
          </ul>
        )}
      </li>
    )
  }

  const groupSection = ({ group: g, projects: members }: Section, at: number): React.ReactNode => {
    if (!g) return null
    const shut = collapsed.includes(g.id)
    const total = members.reduce((n, p) => n + (needsYou[p.id] ?? 0), 0)
    const renaming = editing?.group === g.id
    const mark = markOf(`g:${g.id}`)
    return (
      <section key={g.id} className={cn('mt-3', mark !== 'into' && dropMark(mark))}>
        <DndRow
          id={`g:${g.id}`}
          drag={!renaming}
          mark={mark === 'into' ? mark : undefined}
          className={cn('group', heading)}
        >
          {renaming ? (
            <NameField label="Group name" value={g.name} onDone={save} />
          ) : (
            <h2 className="min-w-0 flex-1">
              <button
                type="button"
                data-focus={`g:${g.id}`}
                aria-expanded={!shut}
                className="flex h-7 max-w-full items-center gap-1"
                onClick={() => setCollapsed((c) => flip(c, g.id))}
              >
                <span className="truncate">{g.name}</span>
                <ChevronRight
                  aria-hidden
                  className={cn(
                    'size-3 shrink-0 opacity-0 transition-transform duration-(--speed-highlight-out) ease-(--ease-out-quart) group-hover:opacity-100 group-has-focus-visible:opacity-100 motion-reduce:transition-none',
                    shut ? 'opacity-100' : 'rotate-90'
                  )}
                />
              </button>
            </h2>
          )}
          <MoreMenu label={`More for ${g.name}`} onCloseAutoFocus={afterMenu}>
            <DropdownMenuItem onSelect={() => later(() => setEditing({ group: g.id }))}>
              <Pencil />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={at === 0}
              onSelect={() =>
                onArrange(projects, moveGroup(groups, g.id, groups[at - 1].id, false))
              }
            >
              <ArrowUp />
              Move up
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={at === groups.length - 1}
              onSelect={() => onArrange(projects, moveGroup(groups, g.id, groups[at + 1].id, true))}
            >
              <ArrowDown />
              Move down
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => deleteGroup(g.id)}>
              <Trash2 />
              Delete group
            </DropdownMenuItem>
          </MoreMenu>
          {shut && total > 0 && <NeedsYouCount count={total} bare className="font-normal" />}
        </DndRow>
        {!shut && (
          <ul aria-label={g.name} className="flex flex-col gap-px px-2">
            {members.map((p) => projectRow(p, members, g.id))}
            {!members.length && (
              <li>
                <DndRow
                  id={`e:${g.id}`}
                  mark={markOf(`e:${g.id}`)}
                  className="flex h-7 items-center rounded-full px-3 text-xs text-fg-4"
                >
                  Drag projects here
                </DndRow>
              </li>
            )}
          </ul>
        )}
      </section>
    )
  }

  const moving = dragging?.startsWith('p:')
    ? projects.find((p) => p.id === dragging.slice(2))
    : undefined
  const movingGroup = dragging?.startsWith('g:')
    ? groups.find((g) => g.id === dragging.slice(2))
    : undefined
  const nameOf = (id: unknown): string => {
    const key = String(id)
    if (key === 'u:') return 'Projects'
    const list: { id: string; name: string }[] = key.startsWith('p:') ? projects : groups
    return list.find((x) => x.id === key.slice(2))?.name ?? ''
  }
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${nameOf(active.id)}.`,
    onDragOver: ({ over }) => (over ? `Over ${nameOf(over.id)}.` : undefined),
    onDragEnd: ({ active, over }) => {
      const to = dropOf(active, over, pointerY.current)
      return to
        ? `Moved ${nameOf(active.id)} ${to.place === 'into' ? 'to' : to.place} ${nameOf(to.id)}.`
        : `${nameOf(active.id)} stays in place.`
    },
    onDragCancel: ({ active }) => `Move canceled. ${nameOf(active.id)} stays in place.`
  }
  const { still, easing } = motion('--ease-out-quad')
  const drawnWidth = (): number => nav.current?.offsetWidth || width
  const endDrag = (): void => {
    setDragging(null)
    setDrop(null)
  }
  return (
    <nav
      ref={nav}
      id="sidebar"
      inert={hidden}
      style={{ width, marginLeft: hidden ? `calc(-1 * min(${width}px, 100vw - 568px))` : 0 }}
      className={cn(
        '@container/sidebar relative flex max-w-[calc(100vw-568px)] shrink-0 flex-col',
        slide
      )}
    >
      <div
        className={cn(
          'drag flex h-13 shrink-0 items-center justify-end px-2 pt-2',
          inset && 'pl-22'
        )}
      >
        {onHide && (
          <Tip label="Hide sidebar" shortcut="⌃⌘S">
            <Button variant="ghost" size="icon-sm" className="text-fg-2" onClick={onHide}>
              <PanelLeft />
            </Button>
          </Tip>
        )}
        {backForward && <NavButtons {...backForward} />}
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={(args) => {
          pointerY.current = args.pointerCoordinates?.y ?? 0
          return pointerWithin(args)
        }}
        accessibility={{ announcements }}
        onDragStart={({ active }) => setDragging(String(active.id))}
        onDragMove={({ active, over }) => {
          const next = dropOf(active, over, pointerY.current)
          setDrop((d) => (d?.id === next?.id && d?.place === next?.place ? d : next))
        }}
        onDragEnd={({ active, over }) => {
          const to = dropOf(active, over, pointerY.current)
          endDrag()
          if (to) onDrop(String(active.id), to)
        }}
        onDragCancel={endDrag}
      >
        <DndRow id="u:" mark={markOf('u:')} className={cn('mt-1 justify-between', heading)}>
          <h2 id="sidebar-projects">Projects</h2>
          <div className="flex items-center">
            <Tip label="New group">
              <Button
                variant="ghost"
                size="icon-xs"
                data-focus="new"
                className="size-5 text-fg-3"
                onClick={() => setEditing({})}
              >
                <FolderPlus className="size-3.5" />
              </Button>
            </Tip>
            <Tip label="Add project">
              <Button variant="ghost" size="icon-xs" className="size-5 text-fg-3" onClick={onAdd}>
                <Plus className="size-3.5" />
              </Button>
            </Tip>
          </div>
        </DndRow>
        <ScrollArea className="min-h-0 flex-1">
          <ul aria-labelledby="sidebar-projects" className="flex flex-col gap-px px-2">
            {parts[0].projects.map((p) => projectRow(p, parts[0].projects, null))}
          </ul>
          {parts.map((part, i) => groupSection(part, i - 1))}
          {editing && !editing.group && (
            <div className={cn('mt-3', heading)}>
              <NameField label="New group name" onDone={save} />
            </div>
          )}
        </ScrollArea>
        <DragOverlay dropAnimation={still ? null : { duration: 200, easing }}>
          {moving && (
            <div className="pointer-events-none flex h-7 items-center gap-1.5 rounded-full bg-popover pr-1 pl-2 shadow-md">
              <ProjectTile name={moving.name} icon={moving.icon} />
              <span className="truncate">{moving.name}</span>
            </div>
          )}
          {movingGroup && (
            <div className={cn('pointer-events-none bg-popover shadow-md', heading)}>
              <span className="truncate">{movingGroup.name}</span>
            </div>
          )}
        </DragOverlay>
      </DndContext>
      <div className="border-t p-2">
        <LiveMeter sessions={sessions} />
        <div role="status">
          {awake && (
            <div className="flex items-center gap-2 px-2 py-1 text-xs text-fg-2">
              <Coffee className="size-3" />
              Keeping your Mac awake
            </div>
          )}
        </div>
        <div className="flex gap-1">
          <Tip label="Settings" shortcut="⌘,">
            <Button variant="ghost" size="icon-sm" className="text-fg-2" onClick={onSettings}>
              <Settings />
            </Button>
          </Tip>
          <Tip label="Usage">
            <Button variant="ghost" size="icon-sm" className="text-fg-2" onClick={onUsage}>
              <ChartColumn />
            </Button>
          </Tip>
        </div>
      </div>
      {onResize && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          aria-controls="sidebar"
          aria-valuenow={width}
          aria-valuemin={SIDEBAR_WIDTH.min}
          aria-valuemax={SIDEBAR_WIDTH.max}
          tabIndex={0}
          className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none outline-none [-webkit-app-region:no-drag] after:absolute after:inset-y-5 after:left-[3px] after:[mask-image:linear-gradient(transparent,black_28px,black_calc(100%-28px),transparent)] after:w-0.5 hover:after:bg-line-2 focus-visible:after:bg-ring"
          onPointerDown={(e) => {
            if (e.button !== 0) return
            e.preventDefault()
            e.currentTarget.setPointerCapture(e.pointerId)
            resizing.current = { x: e.clientX, width: drawnWidth() }
          }}
          onPointerMove={(e) => {
            const start = resizing.current
            if (start) onResize(sidebarWidth(start.width + e.clientX - start.x))
          }}
          onLostPointerCapture={() => (resizing.current = null)}
          onDoubleClick={() => onResize(SIDEBAR_WIDTH.default)}
          onKeyDown={(e) => {
            const step = e.key === 'ArrowLeft' ? -16 : e.key === 'ArrowRight' ? 16 : 0
            if (!step) return
            e.preventDefault()
            onResize(sidebarWidth(drawnWidth() + step))
          }}
        />
      )}
    </nav>
  )
}

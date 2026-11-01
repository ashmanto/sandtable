import { useDroppable } from '@dnd-kit/core'
import { ChevronRight } from 'lucide-react'
import { useFocus } from '@/hooks/useFocus'
import { useTicketDrag, type DragHandle } from '@/hooks/useTicketDrag'
import { elsewhereState, shownLabels } from '@/lib/card'
import { NO_ASSIGNEE } from '@/lib/assigneeFilter'
import { laneId, NO_PARENT, titleOf, type LaneCells } from '@/lib/lanes'
import { cn, fullTime, overRing, ringFade, shortDate } from '@/lib/utils'
import { isTrackerKey, ticketLabel } from '../../../shared/repo'
import type { Elsewhere } from '../../../shared/sessions'
import type { BoardColumn, SessionRecord, Ticket } from '../../../shared/types'
import { ActivityPill } from './Activity'
import { SessionBadge, type CardState } from './SessionBadge'
import { StatusIcon } from './StatusIcon'
import { chip, LabelChip, ParentTag, PersonAvatar, PrStageMark, ProgressRing } from './TicketCard'

type RowProps = {
  ticket: Omit<Ticket, 'body'>
  session: SessionRecord | undefined
  state: CardState | undefined
  done: boolean
  onOpen: () => void
  dragHandle?: DragHandle
  parentTag?: boolean
  elsewhere?: Elsewhere
}

const headerClass =
  'sticky top-0 z-10 mt-2 flex h-9 shrink-0 items-center gap-2 rounded-md px-2 text-left text-xs font-medium text-fg-2 outline-none highlight [--ring-ease:var(--ease-out-quad)] focus-ring'

const tint: Record<BoardColumn, string> = {
  todo: 'bg-[color-mix(in_srgb,var(--color-fg-3)_8%,var(--color-panel))]',
  inProgress: 'bg-[color-mix(in_srgb,var(--color-yellow)_8%,var(--color-panel))]',
  done: 'bg-[color-mix(in_srgb,var(--color-accent)_8%,var(--color-panel))]'
}

/** The classes of a list row, shared by the New ticket row. */
export const rowClass =
  'highlight flex h-9 w-full shrink-0 items-center gap-3 border-b pr-2 pl-7.5 outline-none last:border-b-0 hover:rounded-md hover:bg-surface-3 focus-visible:rounded-md focus-ring'

/** A ticket on one line: number, title, labels, state word, another project's session, and updated date. */
export function TicketRow({
  ticket,
  session,
  state,
  done,
  onOpen,
  dragHandle,
  parentTag,
  elsewhere
}: RowProps): React.JSX.Element {
  const labels = shownLabels(ticket)
  return (
    <div
      tabIndex={0}
      {...dragHandle}
      ref={dragHandle?.ref}
      onClick={onOpen}
      onKeyDown={(e) => {
        dragHandle?.onKeyDown?.(e)
        if (e.key === 'Enter' && e.target === e.currentTarget) onOpen()
      }}
      className={cn(rowClass, 'cursor-default')}
    >
      <span
        className={cn(
          'shrink-0 truncate font-mono text-xs text-fg-3',
          isTrackerKey(ticket.key) ? 'w-16' : 'w-9'
        )}
        title={ticketLabel(ticket)}
      >
        {ticketLabel(ticket)}
      </span>
      {parentTag && <ParentTag />}
      <span className="min-w-0 flex-1 truncate">{ticket.title}</span>
      <ActivityPill session={state === 'running' ? session : undefined} className="max-w-[25%]" />
      {labels.length > 0 && (
        <ul className="flex max-w-[40%] min-w-0 gap-1 overflow-hidden">
          {labels.map((l) => (
            <LabelChip key={l.name} label={l} className={chip} />
          ))}
        </ul>
      )}
      <span className="flex shrink-0 items-center gap-2">
        {!done && ticket.prStage && <PrStageMark stage={ticket.prStage} />}
        {state && <SessionBadge state={state} />}
        {elsewhere && (
          <span className="flex max-w-40 min-w-0 items-center gap-1 text-xs text-fg-3">
            <SessionBadge state={elsewhereState(elsewhere.session, done)} />
            <span className="truncate" title={elsewhere.project.name}>
              in {elsewhere.project.name}
            </span>
          </span>
        )}
        <time
          dateTime={ticket.updatedAt}
          title={fullTime(ticket.updatedAt)}
          className="w-11 text-right text-xs text-fg-3"
        >
          {shortDate(ticket.updatedAt)}
        </time>
      </span>
    </div>
  )
}

type DragRow = RowProps & { disabled: boolean }

/** A row that drags as `dragId` and takes focus when `focused` turns true. */
export function DraggableRow({
  disabled,
  dragId,
  focused,
  ...props
}: DragRow & { dragId?: string; focused?: boolean }): React.JSX.Element {
  const dragHandle = useTicketDrag(props.ticket, disabled, { id: dragId, focused })
  return <TicketRow {...props} dragHandle={dragHandle} />
}

/** A group header's chevron, pointing down while the group is open. */
export function Chevron({ open }: { open: boolean }): React.JSX.Element {
  return (
    <ChevronRight
      aria-hidden
      className={cn(
        'size-3.5 shrink-0 text-fg-3 transition-transform duration-(--speed-highlight-out) ease-(--ease-out-quart) motion-reduce:transition-none',
        open && 'rotate-90'
      )}
    />
  )
}

/** A lane header's text: the person's avatar, name, and count, the parent's status, key, title, and progress, or No parent and its count. */
export function LaneTitle({
  lane
}: {
  lane: Omit<LaneCells<unknown>, 'cells'>
}): React.JSX.Element {
  const p = lane.parent
  const progress = p?.subIssues && p.subIssues.total > 0 && p.subIssues
  if (!p)
    return (
      <>
        <LaneAvatar lane={lane} />
        <span className="min-w-0 truncate">{lane.name}</span>{' '}
        <span className="text-fg-3">{lane.count}</span>
      </>
    )
  return (
    <>
      <StatusIcon column={p.column} />
      <span className="shrink-0 font-mono text-fg-3">{ticketLabel(p)}</span>{' '}
      <span className="min-w-0 truncate">{p.title}</span>
      <span className="sr-only">
        , {titleOf(p.column)}
        {progress && ','}
      </span>{' '}
      {progress && (
        <span className="flex shrink-0 items-center gap-1 text-fg-3">
          <ProgressRing {...progress} />
          {progress.completed}/{progress.total} <span className="sr-only">sub-issues done</span>
        </span>
      )}
    </>
  )
}

function LaneAvatar({ lane }: { lane: { id: string; name: string } }): React.JSX.Element {
  return lane.id === NO_ASSIGNEE || lane.id === NO_PARENT ? (
    <span aria-hidden className="size-4.5 shrink-0 rounded-full border border-dashed border-fg-4" />
  ) : (
    <PersonAvatar name={lane.name} />
  )
}

function Group({
  id,
  title,
  count,
  open,
  disabled,
  focused,
  onToggle,
  children
}: {
  id: BoardColumn
  title: string
  count: number
  open: boolean
  disabled: boolean
  focused: boolean
  onToggle: () => void
  children: React.ReactNode
}): React.JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id })
  const header = useFocus(focused)
  return (
    <section ref={setNodeRef} aria-label={title} className="flex flex-col">
      <button
        ref={header}
        type="button"
        aria-expanded={open}
        disabled={disabled}
        onClick={onToggle}
        className={cn(headerClass, tint[id], isOver && overRing)}
      >
        <Chevron open={open} />
        <StatusIcon column={id} />
        {title} <span className="text-fg-3">{count}</span>
      </button>
      {open && children}
    </section>
  )
}

/** The tickets as rows grouped by status under collapsible headers, each group a drop target. */
export function TicketList({
  groups,
  collapsed,
  locked,
  focus,
  onToggle
}: {
  groups: {
    id: BoardColumn
    title: string
    rows: DragRow[]
    trailing?: React.ReactNode
  }[]
  collapsed: BoardColumn[]
  locked: BoardColumn[]
  focus: string | null
  onToggle: (column: BoardColumn) => void
}): React.JSX.Element {
  return (
    <div className="min-h-0 flex-1 scroll-pt-11 overflow-y-auto px-2 pb-2">
      {groups.map((g) => (
        <Group
          key={g.id}
          id={g.id}
          title={g.title}
          count={g.rows.length}
          open={!collapsed.includes(g.id)}
          disabled={locked.includes(g.id)}
          focused={focus === g.id}
          onToggle={() => onToggle(g.id)}
        >
          {g.rows.map((r) => (
            <DraggableRow key={r.ticket.key} {...r} />
          ))}
          {g.trailing}
        </Group>
      ))}
    </div>
  )
}

type Row = Omit<Ticket, 'body'>
type ListLane = LaneCells<Row>
type RenderRow = (t: Row, lane: string) => React.ReactNode

function SubGroup({
  lane,
  cell,
  row,
  trailing
}: {
  lane: ListLane
  cell: ListLane['cells'][number]
  row: RenderRow
  trailing: React.ReactNode
}): React.JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: laneId(lane.id, cell.id) })
  return (
    <section
      ref={setNodeRef}
      aria-label={`${lane.name}, ${cell.title}`}
      className={cn('flex flex-col rounded-md pb-1', ringFade, isOver && overRing)}
    >
      <h3 className="flex h-7 items-center gap-2 pl-7.5 text-xs font-medium text-fg-3">
        <StatusIcon column={cell.id} />
        {cell.title} <span>{cell.tickets.length}</span>
      </h3>
      {cell.tickets.map((t) => row(t, lane.id))}
      {trailing}
    </section>
  )
}

function LaneGroup({
  lane,
  open,
  disabled,
  focused,
  row,
  trailing,
  onToggle
}: {
  lane: ListLane
  open: boolean
  disabled: boolean
  focused: boolean
  row: RenderRow
  trailing: React.ReactNode
  onToggle: () => void
}): React.JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: laneId(lane.id, ''), disabled: open })
  const headerRef = useFocus(focused)
  return (
    <section aria-label={lane.name} className="flex flex-col">
      <button
        ref={(el) => {
          headerRef.current = el
          setNodeRef(el)
        }}
        type="button"
        aria-expanded={open}
        disabled={disabled}
        onClick={onToggle}
        className={cn(headerClass, 'bg-surface-3', isOver && overRing)}
      >
        <Chevron open={open} />
        <LaneTitle lane={lane} />
      </button>
      {open &&
        lane.cells.map((c) => (
          <SubGroup
            key={c.id}
            lane={lane}
            cell={c}
            row={row}
            trailing={c.id === 'todo' && trailing}
          />
        ))}
    </section>
  )
}

/** The tickets as rows grouped by assignee or parent, then by status. */
export function LaneList({
  lanes,
  collapsed,
  locked,
  focus,
  row,
  trailing,
  onToggle
}: {
  lanes: ListLane[]
  collapsed: string[]
  locked: string[]
  focus: string | null
  row: RenderRow
  trailing: React.ReactNode
  onToggle: (lane: string) => void
}): React.JSX.Element {
  return (
    <div className="min-h-0 flex-1 scroll-pt-11 overflow-y-auto px-2 pb-2">
      {lanes.map((l, i) => (
        <LaneGroup
          key={l.id}
          lane={l}
          open={!collapsed.includes(l.id)}
          disabled={locked.includes(l.id)}
          focused={focus === laneId(l.id, '')}
          row={row}
          trailing={i === lanes.length - 1 && trailing}
          onToggle={() => onToggle(l.id)}
        />
      ))}
    </div>
  )
}

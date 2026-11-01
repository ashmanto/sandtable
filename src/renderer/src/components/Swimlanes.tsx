import { useDndMonitor, useDroppable } from '@dnd-kit/core'
import { useEffect, useRef, useState } from 'react'
import { useFocus } from '@/hooks/useFocus'
import { laneId, splitLane, type LaneCells } from '@/lib/lanes'
import { cn, overRing, ringFade } from '@/lib/utils'
import type { BoardColumn, Ticket } from '../../../shared/types'
import { StatusIcon } from './StatusIcon'
import { Chevron, LaneTitle } from './TicketList'

type Card = Omit<Ticket, 'body'>
type BoardLane = LaneCells<Card>
type Cell = BoardLane['cells'][number]
type RenderCard = (t: Card, lane: string) => React.ReactNode

const grid = 'grid grid-cols-[repeat(3,350px)] gap-3'

/** A board column's heading: its status icon, title, and count. */
export function ColumnHeading({
  id,
  title,
  count
}: {
  id: BoardColumn
  title: string
  count: number
}): React.JSX.Element {
  return (
    <h2 className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground">
      <StatusIcon column={id} />
      {title}
      <span className="text-fg-3">{count}</span>
    </h2>
  )
}

function Count({ lane, cell }: { lane: BoardLane; cell: Cell }): React.JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: laneId(lane.id, cell.id) })
  return (
    <span
      ref={setNodeRef}
      data-slot="lane-count"
      className={cn(
        'flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-fg-3',
        ringFade,
        isOver && overRing
      )}
    >
      <StatusIcon column={cell.id} />
      {cell.tickets.length}
      <span className="sr-only"> {cell.title.toLowerCase()}</span>
    </span>
  )
}

function DropCell({
  lane,
  cell,
  children
}: {
  lane: BoardLane
  cell: Cell
  children: React.ReactNode
}): React.JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: laneId(lane.id, cell.id) })
  return (
    <section
      ref={setNodeRef}
      aria-label={`${lane.name}, ${cell.title}`}
      className={cn('flex min-h-16 flex-col gap-2 rounded-card p-1', ringFade, isOver && overRing)}
    >
      {children}
    </section>
  )
}

function LanePanel({
  lane,
  open,
  focused,
  disabled,
  holding,
  pointer,
  card,
  trailing,
  onToggle
}: {
  lane: BoardLane
  open: boolean
  focused: boolean
  disabled: boolean
  holding: boolean
  pointer: boolean
  card: RenderCard
  trailing: React.ReactNode
  onToggle: () => void
}): React.JSX.Element {
  const header = useFocus(focused)
  const { setNodeRef } = useDroppable({ id: laneId(lane.id, ''), disabled: open || !pointer })
  const [first, ...rest] = lane.cells
  return (
    <section
      aria-label={lane.name}
      className={cn('rounded-card border bg-panel', ringFade, holding && overRing)}
    >
      <div ref={setNodeRef} data-slot="lane-head" className={cn(grid, 'h-10 items-center px-2')}>
        <div className="flex min-w-0 items-center justify-between">
          <button
            ref={header}
            type="button"
            aria-expanded={open}
            disabled={disabled}
            title={lane.name}
            onClick={onToggle}
            className="highlight flex h-7 min-w-0 items-center gap-2 rounded-md px-2 text-xs font-medium text-fg-2 outline-none hover:bg-surface-3 focus-ring"
          >
            <Chevron open={open} />
            <LaneTitle lane={lane} />
          </button>
          {!open && <Count lane={lane} cell={first} />}
        </div>
        {!open && rest.map((c) => <Count key={c.id} lane={lane} cell={c} />)}
      </div>
      {open && (
        <div className={cn(grid, 'px-2 pb-2')}>
          {lane.cells.map((c) => (
            <DropCell key={c.id} lane={lane} cell={c}>
              {c.tickets.map((t) => card(t, lane.id))}
              {c.id === 'todo' && trailing}
            </DropCell>
          ))}
        </div>
      )}
    </section>
  )
}

/** The board grouped by assignee or parent into collapsible lanes under shared column headings. */
export function Swimlanes({
  columns,
  lanes,
  collapsed,
  locked,
  focus,
  card,
  trailing,
  onToggle
}: {
  columns: { id: BoardColumn; title: string; count: number }[]
  lanes: BoardLane[]
  collapsed: string[]
  locked: string[]
  focus: string | null
  card: RenderCard
  trailing: React.ReactNode
  onToggle: (lane: string) => void
}): React.JSX.Element {
  const [pointer, setPointer] = useState(false)
  const pointerRef = useRef(false)
  const [holding, setHolding] = useState<string | null>(null)
  const held = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const hold = (lane: string | null): void => {
    if (lane === held.current) return
    clearTimeout(timer.current)
    held.current = lane
    setHolding(lane)
    if (lane)
      timer.current = setTimeout(() => {
        hold(null)
        onToggle(lane)
      }, 700)
  }
  const drags = (byPointer: boolean): void => {
    pointerRef.current = byPointer
    setPointer(byPointer)
  }
  const end = (): void => {
    hold(null)
    drags(false)
  }
  useDndMonitor({
    onDragStart: ({ activatorEvent }) => drags(!(activatorEvent instanceof KeyboardEvent)),
    onDragOver: ({ over }) => {
      const lane = over && splitLane(String(over.id))[0]
      hold(pointerRef.current && lane && collapsed.includes(lane) ? lane : null)
    },
    onDragEnd: end,
    onDragCancel: end
  })
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="flex w-max min-w-full flex-col gap-2 px-3 pb-3">
        <div className={cn(grid, 'sticky top-0 z-10 bg-panel px-[9px] pt-3')}>
          {columns.map((c) => (
            <ColumnHeading key={c.id} {...c} />
          ))}
        </div>
        {lanes.map((l, i) => (
          <LanePanel
            key={l.id}
            lane={l}
            open={!collapsed.includes(l.id)}
            focused={focus === laneId(l.id, '')}
            disabled={locked.includes(l.id)}
            holding={holding === l.id}
            pointer={pointer}
            card={card}
            trailing={i === lanes.length - 1 && trailing}
            onToggle={() => onToggle(l.id)}
          />
        ))}
      </div>
    </div>
  )
}

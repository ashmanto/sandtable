import { ArrowDownUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import type { BoardDisplay } from '@/lib/boardDisplay'
import { Tip } from './Tip'

const titles = { created: 'Created', updated: 'Updated', label: 'Label' }
const groups = { none: 'None', assignee: 'Assignee', parent: 'Parent' }
const natural = { manual: 'asc', created: 'desc', updated: 'desc', label: 'asc' } as const

/** The board's icon **Display** menu: the lanes to group by, the order of each column's cards, and its direction. */
export function DisplayMenu({
  manualTitle,
  display,
  groupLocked,
  onChange
}: {
  manualTitle: string
  display: BoardDisplay
  groupLocked: boolean
  onChange: (d: BoardDisplay) => void
}): React.JSX.Element {
  const { group, order, dir } = display
  const sorted = order !== 'manual'
  const grouped = group !== 'none' && groups[group]
  const keepOpen = (e: Event): void => e.preventDefault()
  const name = [
    'Display',
    grouped && `grouped by ${grouped}`,
    sorted && `ordered by ${titles[order]}, ${dir === 'desc' ? 'descending' : 'ascending'}`
  ]
    .filter(Boolean)
    .join(', ')
  const text = [grouped, sorted && `${titles[order]} ${dir === 'desc' ? '↓' : '↑'}`]
    .filter(Boolean)
    .join(' · ')
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Tip label={name}>
          <Button variant="ghost" size={text ? 'default' : 'icon-sm'}>
            <ArrowDownUp />
            {text && <span className="text-fg-3">{text}</span>}
          </Button>
        </Tip>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuLabel className="pl-8 text-xs text-fg-3">Group by</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          aria-label="Group by"
          value={group}
          onValueChange={(g) => onChange({ ...display, group: g as BoardDisplay['group'] })}
        >
          {Object.entries(groups).map(([value, title]) => (
            <DropdownMenuRadioItem
              key={value}
              value={value}
              disabled={groupLocked}
              onSelect={keepOpen}
            >
              {title}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="pl-8 text-xs text-fg-3">Order by</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          aria-label="Ordering"
          value={order}
          onValueChange={(o) => {
            const next = o as BoardDisplay['order']
            onChange({ group, order: next, dir: natural[next] })
          }}
        >
          <DropdownMenuRadioItem value="manual" onSelect={keepOpen}>
            {manualTitle}
          </DropdownMenuRadioItem>
          {Object.entries(titles).map(([value, title]) => (
            <DropdownMenuRadioItem key={value} value={value} onSelect={keepOpen}>
              {title}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          aria-label="Direction"
          value={sorted ? dir : ''}
          onValueChange={(d) => onChange({ group, order, dir: d as BoardDisplay['dir'] })}
        >
          <DropdownMenuRadioItem value="asc" disabled={!sorted} onSelect={keepOpen}>
            Ascending
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="desc" disabled={!sorted} onSelect={keepOpen}>
            Descending
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

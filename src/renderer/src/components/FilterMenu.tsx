import { Button } from '@/components/ui/button'
import { Tip } from './Tip'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { hasLabel } from '@/lib/labelFilter'

type Mode = 'only' | 'hide'
type Option = { value: string; name: string; icon: React.ReactNode }

type FilterSub = {
  name: string
  icon: React.ReactNode
  groups: Option[][]
  empty?: string
  mode: Mode
  checked: string[]
  onChange: (mode: Mode, checked: string[]) => void
}

function Choices({ groups, empty, mode, checked, onChange }: FilterSub): React.JSX.Element {
  const toggle = (value: string, on: boolean): void =>
    onChange(mode, on ? [...checked, value] : checked.filter((c) => !hasLabel([value], c)))
  const shown = groups.filter((g) => g.length > 0)
  return (
    <>
      <DropdownMenuRadioGroup value={mode} onValueChange={(m) => onChange(m as Mode, checked)}>
        <DropdownMenuRadioItem value="only" onSelect={(e) => e.preventDefault()}>
          Show only
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="hide" onSelect={(e) => e.preventDefault()}>
          Hide
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
      {shown.length === 0 && empty && <DropdownMenuItem disabled>{empty}</DropdownMenuItem>}
      {shown.map((g, i) => [
        i > 0 && <DropdownMenuSeparator key={`sep-${i}`} />,
        ...g.map((o) => (
          <DropdownMenuCheckboxItem
            key={o.value}
            checked={hasLabel(checked, o.value)}
            onCheckedChange={(on) => toggle(o.value, on)}
            onSelect={(e) => e.preventDefault()}
          >
            {o.icon}
            <span className="truncate">{o.name}</span>
          </DropdownMenuCheckboxItem>
        ))
      ])}
    </>
  )
}

/** A board toolbar filter: an icon-only menu that shows only or hides tickets with the checked values, one submenu per kind when it filters more than one. */
export function FilterMenu({
  title,
  icon,
  subs
}: {
  title: string
  icon: React.ReactNode
  subs: FilterSub[]
}): React.JSX.Element {
  const count = subs.reduce((n, s) => n + s.checked.length, 0)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Tip label={count ? `${title}, ${count} checked` : title}>
          <Button variant="ghost" size="icon-sm">
            {icon}
          </Button>
        </Tip>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {subs.length === 1 ? (
          <Choices {...subs[0]} />
        ) : (
          subs.map((s) => (
            <DropdownMenuSub key={s.name}>
              <DropdownMenuSubTrigger
                aria-label={s.checked.length ? `${s.name}, ${s.checked.length} checked` : undefined}
              >
                {s.icon}
                <span className="flex-1">{s.name}</span>
                {s.checked.length > 0 && (
                  <span className="text-xs text-fg-3">{s.checked.length}</span>
                )}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-56">
                <Choices {...s} />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ))
        )}
        {count > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => subs.forEach((s) => s.onChange(s.mode, []))}>
              Clear filter
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

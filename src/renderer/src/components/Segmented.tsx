import { ToggleGroup } from 'radix-ui'
import { cn } from '@/lib/utils'

/** A pill of equal-width choices, one always on, read as a radio group; a choice's optional third entry is its accessible name. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
  ...aria
}: {
  options: [T, React.ReactNode, string?][]
  value: T
  onChange: (value: T) => void
  className?: string
} & ({ 'aria-labelledby': string } | { 'aria-label': string })): React.JSX.Element {
  return (
    <ToggleGroup.Root
      type="single"
      role="radiogroup"
      {...aria}
      value={value}
      onValueChange={(v: T | '') => {
        if (v) onChange(v)
      }}
      className={cn(
        'grid shrink-0 auto-cols-fr grid-flow-col gap-px rounded-full bg-surface-3 p-0.5',
        className
      )}
    >
      {options.map(([v, label, name]) => (
        <ToggleGroup.Item
          key={v}
          value={v}
          aria-label={name}
          className="highlight rounded-full px-2 py-0.5 text-xs whitespace-nowrap text-fg-2 outline-none hover:text-fg focus-ring data-[state=on]:bg-surface data-[state=on]:text-fg data-[state=on]:shadow-[inset_0_0_0_1px_var(--line-2)]"
        >
          {label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  )
}

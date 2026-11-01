import { cn } from '@/lib/utils'
import type { Project } from '../../../shared/types'

/** A project's 18 px tile: its emoji, or the first letter of its name. */
export function ProjectTile({
  name,
  icon,
  className
}: Pick<Project, 'name' | 'icon'> & { className?: string }): React.JSX.Element {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-4.5 shrink-0 place-items-center rounded-full leading-none',
        icon
          ? 'text-emoji'
          : 'bg-neutral-soft text-xs font-semibold text-fg-2 ring-1 ring-border ring-inset',
        className
      )}
    >
      {icon || [...name][0]?.toUpperCase()}
    </span>
  )
}

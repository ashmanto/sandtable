import { ChevronRight } from 'lucide-react'
import { elsewhereState, stateLook } from '@/lib/card'
import { cn } from '@/lib/utils'
import type { Elsewhere } from '../../../shared/sessions'
import { insetClass } from './Activity'
import { ProjectTile } from './ProjectTile'
import { SessionBadge } from './SessionBadge'

/** Another project's session on the ticket as one inset row that opens it: project, state, and Open. */
export function SessionElsewhere({
  session,
  project,
  done,
  onOpen,
  className
}: Elsewhere & { done: boolean; onOpen: () => void; className?: string }): React.JSX.Element {
  const state = elsewhereState(session, done)
  return (
    <button
      type="button"
      aria-label={`${stateLook[state].label} in ${project.name}. Open the session`}
      onClick={(e) => {
        e.stopPropagation()
        onOpen()
      }}
      className={cn(
        insetClass,
        'highlight items-center gap-2 px-2 py-1.5 text-left text-xs outline-none hover:bg-surface-3 focus-ring',
        className
      )}
    >
      <ProjectTile name={project.name} icon={project.icon} />
      <span className="min-w-0 flex-1 truncate">{project.name}</span>
      <SessionBadge state={state} />
      <span className="flex shrink-0 items-center gap-0.5 text-fg-3">
        Open
        <ChevronRight aria-hidden className="size-3" />
      </span>
    </button>
  )
}

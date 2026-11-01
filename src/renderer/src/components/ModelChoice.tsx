import { ChevronDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useStartModel } from '@/hooks/useOverlapCheck'
import { cn, stop } from '@/lib/utils'
import { MODEL_CHOICES, modelLabel, type Model, type Project } from '../../../shared/types'

/** A session's model, read as "Model: Opus"; nothing for the account default. */
export function ModelName({ model }: { model: Model | undefined }): React.JSX.Element | null {
  if (!model) return null
  return (
    <span className="shrink-0 text-xs text-fg-3">
      <span className="sr-only">Model: </span>
      {modelLabel(model)}
    </span>
  )
}

/** The chip beside Start that shows the model the ticket's session will run, with a menu to change it. */
export function ModelChip({
  project,
  ticketKey,
  disabled,
  className
}: {
  project: Project
  ticketKey: string
  disabled?: boolean
  className?: string
}): React.JSX.Element {
  const [model, pick] = useStartModel(project.id, ticketKey, project.model)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        aria-label={`Model: ${modelLabel(model)}`}
        onClick={stop}
        className={cn(
          'highlight inline-flex shrink-0 items-center gap-0.5 rounded-full bg-fg/5 px-2 text-xs text-fg-2 outline-none hover:bg-fg/8 hover:text-fg focus-ring disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-fg/8',
          className
        )}
      >
        {modelLabel(model)}
        <ChevronDown aria-hidden className="size-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-48"
        onClick={stop}
        onPointerDown={stop}
        onKeyDown={stop}
      >
        <DropdownMenuLabel className="pl-8 text-xs text-fg-3">
          Model for this session
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={model ?? 'default'}
          onValueChange={(v) => pick(v === 'default' ? null : (v as Model))}
        >
          {MODEL_CHOICES.map((m) => (
            <DropdownMenuRadioItem key={m} value={m}>
              {modelLabel(m)}
              {m === (project.model ?? 'default') && (
                <>
                  <span className="sr-only">,</span>
                  <span className="ml-auto text-xs text-fg-3">Project</span>
                </>
              )}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

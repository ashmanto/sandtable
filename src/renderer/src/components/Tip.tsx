import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/** Shows a label, and its shortcut if any, as a tooltip, and names the control with it unless aria-label overrides it. */
export function Tip({
  label,
  shortcut,
  children,
  ...props
}: React.ComponentProps<typeof TooltipTrigger> & {
  label: string
  shortcut?: string
  children: React.ReactElement
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger
        asChild
        aria-label={label}
        {...props}
        onFocus={(e) => {
          props.onFocus?.(e)
          // Focus returned by a menu or moved after a click isn't a reason to show the name.
          if (!e.currentTarget.matches(':focus-visible')) e.preventDefault()
        }}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{shortcut ? `${label} (${shortcut})` : label}</TooltipContent>
    </Tooltip>
  )
}

import * as React from 'react'
import { cn } from '@/lib/utils'
import { Slot } from 'radix-ui'

const base =
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-full text-sm font-medium whitespace-nowrap highlight outline-none focus-visible:border-ring focus-ring disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"

const variants = {
  default: 'bg-fg text-surface hover:bg-fg/85',
  destructive: 'border border-danger/45 text-danger hover:bg-danger/6',
  outline:
    'border bg-background shadow-xs hover:bg-surface-3 hover:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50',
  ghost: 'hover:bg-surface-3 hover:text-foreground'
}

const sizes = {
  default: 'h-7 gap-1.5 px-3 has-[>svg]:px-2.5',
  xs: "h-6 gap-1 rounded-full px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
  sm: 'h-6 gap-1 px-2 has-[>svg]:px-1.5',
  lg: 'h-9 px-4 has-[>svg]:px-3',
  'icon-xs': "size-6 rounded-full [&_svg:not([class*='size-'])]:size-3",
  'icon-sm': 'size-7'
}

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> & {
  variant?: keyof typeof variants
  size?: keyof typeof sizes
  asChild?: boolean
}) {
  const Comp = asChild ? Slot.Root : 'button'

  return (
    <Comp
      data-slot="button"
      className={cn(base, variants[variant], sizes[size], className)}
      {...props}
    />
  )
}

export { Button }

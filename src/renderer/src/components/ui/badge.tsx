import * as React from 'react'
import { cn } from '@/lib/utils'

/** The classes every chip-shaped badge starts from. */
export const badgeClass =
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0 text-xs font-medium whitespace-nowrap highlight focus-visible:border-ring focus-ring aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3'

function Badge({ className, ...props }: React.ComponentProps<'span'>) {
  return <span className={cn(badgeClass, className)} {...props} />
}

export { Badge }

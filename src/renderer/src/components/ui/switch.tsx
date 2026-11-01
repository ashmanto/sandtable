import * as React from 'react'
import { cn } from '@/lib/utils'
import { Switch as SwitchPrimitive } from 'radix-ui'

function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer inline-flex shrink-0 items-center rounded-full border border-transparent shadow-xs transition-[background-color] duration-100 ease-out outline-none focus-visible:border-ring focus-ring disabled:cursor-not-allowed disabled:opacity-50 h-[1.15rem] w-8 data-[state=checked]:bg-primary data-[state=unchecked]:bg-fg-4 dark:data-[state=unchecked]:bg-input/80',
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          'pointer-events-none block rounded-full bg-background ring-0 transition-transform duration-150 ease-out motion-reduce:transition-none size-4 data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0 dark:data-[state=checked]:bg-primary-foreground dark:data-[state=unchecked]:bg-foreground'
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }

import * as React from 'react'
import { cn } from '@/lib/utils'
import { Dialog as SheetPrimitive } from 'radix-ui'

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetClose({ ...props }: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content>) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay data-slot="sheet-overlay" className="fixed inset-0 z-50" />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex h-full w-105 max-w-full flex-col bg-popover shadow-lg outline-none data-[state=closed]:animate-out data-[state=closed]:duration-(--speed-highlight-out) data-[state=closed]:slide-out-to-right data-[state=open]:animate-in data-[state=open]:duration-(--speed-regular) data-[state=open]:ease-(--ease-drawer) data-[state=open]:slide-in-from-right motion-reduce:animate-none!',
          className
        )}
        {...props}
      >
        {children}
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  )
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn('font-medium text-foreground', className)}
      {...props}
    />
  )
}

export { Sheet, SheetClose, SheetContent, SheetTitle }

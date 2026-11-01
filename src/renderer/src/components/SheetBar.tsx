import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SheetClose, SheetTitle } from '@/components/ui/sheet'
import { Tip } from './Tip'

/** A sheet's 44 px header bar: its title, anything passed as children, and Close. */
export function SheetBar({
  title,
  closeDisabled,
  children
}: {
  title: string
  closeDisabled?: boolean
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b pr-2 pl-4">
      <SheetTitle className="min-w-0 flex-1 truncate">{title}</SheetTitle>
      {children}
      <SheetClose asChild>
        <Tip label="Close">
          <Button variant="ghost" size="icon-sm" disabled={closeDisabled}>
            <X />
          </Button>
        </Tip>
      </SheetClose>
    </div>
  )
}

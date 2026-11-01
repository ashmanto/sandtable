import { useContext } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight, PanelLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { HeaderFrame, type Nav } from '@/lib/headerFrame'
import { cn } from '@/lib/utils'
import { SessionCount } from './SessionBadge'
import { Tip } from './Tip'

/** The top row of a view, which also drags the window. */
export function ViewHeader({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { inset, showSidebar, nav, needsYou } = useContext(HeaderFrame)
  return (
    <header
      className={cn(
        'drag flex h-11 shrink-0 items-center gap-3 px-4 whitespace-nowrap',
        inset && 'pl-22'
      )}
    >
      {showSidebar && (
        <>
          <Tip label="Show sidebar" shortcut="⌃⌘S">
            <Button variant="ghost" size="icon-sm" onClick={showSidebar}>
              <PanelLeft />
            </Button>
          </Tip>
          {nav && <NavButtons {...nav} />}
          {needsYou > 0 && <NeedsYouCount count={needsYou} />}
          <HeaderRule />
        </>
      )}
      {children}
    </header>
  )
}

/** Go back and Go forward through the screens you visited, each disabled at its end of the history. */
export function NavButtons({ back, forward }: Nav): React.JSX.Element {
  return (
    <div className="flex shrink-0">
      <Tip label="Go back" shortcut="⌘[">
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-fg-2"
          disabled={!back}
          onClick={back}
        >
          <ChevronLeft />
        </Button>
      </Tip>
      <Tip label="Go forward" shortcut="⌘]">
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-fg-2"
          disabled={!forward}
          onClick={forward}
        >
          <ChevronRight />
        </Button>
      </Tip>
    </div>
  )
}

/** The thin rule between groups of values in a header. */
export function HeaderRule(): React.JSX.Element {
  return <span aria-hidden className="h-5 w-px shrink-0 bg-line" />
}

/** A full-height view with a Back button and its title in the header. */
export function BackView({
  title,
  onBack,
  children
}: {
  title: string
  onBack: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <ViewHeader>
        <Tip label="Back">
          <Button variant="ghost" size="icon-sm" onClick={onBack}>
            <ArrowLeft />
          </Button>
        </Tip>
        <h1 className="font-medium">{title}</h1>
      </ViewHeader>
      {children}
    </div>
  )
}

/** The Needs you count in amber: in words, or `bare` as an icon and the number, labeled in words. */
export function NeedsYouCount({
  count,
  bare = false,
  className
}: {
  count: number
  bare?: boolean
  className?: string
}): React.JSX.Element {
  return <SessionCount state="needsYou" count={count} words={!bare} className={className} />
}

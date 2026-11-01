import { createContext } from 'react'

/** Below this panel width, a header folds two or more outline actions into More actions. */
export const FOLD_WIDTH = 1152

/** Below this panel width, a header shows its secondary controls as icons and folds every outline action. */
export const NARROW_WIDTH = 768

/** Below this panel width, a session view folds its Gauges panel into a header button. */
export const GAUGES_WIDTH = 900

/** Go back and Go forward, each missing at its end of the history. */
export type Nav = { back?: () => void; forward?: () => void }

/** What a view's header needs from the window: room for the window controls, Show sidebar with Back and Forward and the Needs you count while the sidebar is hidden, and the panel's width rounded down to a breakpoint. */
export const HeaderFrame = createContext<{
  inset: boolean
  showSidebar?: () => void
  nav?: Nav
  needsYou: number
  width: number
}>({ inset: false, needsYou: 0, width: Infinity })

/** The panel's width as the most `HeaderFrame` needs: just under the breakpoint it's below, or `Infinity`. */
export const panelWidth = (width: number): number =>
  width < NARROW_WIDTH
    ? NARROW_WIDTH - 1
    : width < GAUGES_WIDTH
      ? GAUGES_WIDTH - 1
      : width < FOLD_WIDTH
        ? FOLD_WIDTH - 1
        : Infinity

/** A header title that truncates first and keeps 48 px; the group it sits in doesn't shrink past its other parts. */
export const headerTitle = 'w-0 min-w-12 max-w-fit grow truncate font-medium'

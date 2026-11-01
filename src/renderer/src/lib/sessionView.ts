import { useSyncExternalStore } from 'react'
import { listenerSet } from './fanOut'
import { loadSaved, saveSaved } from './utils'

/** How a session's Conversation tab shows it: Sandtable's conversation or Claude Code's terminal. */
type SessionView = 'conversation' | 'terminal'

const KEY = 'sessionView'
const { subscribe, changed } = listenerSet()
const read = (): SessionView =>
  loadSaved<SessionView>(KEY, 'conversation', (v) =>
    v === 'conversation' || v === 'terminal' ? v : null
  )
const save = (view: SessionView): void => {
  saveSaved(KEY, view)
  changed()
}

/** The view every session's Conversation tab opens in, saved for the next launch, and its setter. */
export const useSessionView = (): [SessionView, (view: SessionView) => void] => [
  useSyncExternalStore(subscribe, read),
  save
]

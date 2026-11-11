import { useSyncExternalStore } from 'react'
import { listenerSet } from '@/lib/fanOut'
import { same } from '../../../shared/same'
import type { ModelUsage } from '../../../shared/types'

type LiveUsage = Record<string, ModelUsage[]>
let latest: LiveUsage = {}
const publish = (usage: LiveUsage): void => {
  latest = Object.fromEntries(
    Object.entries(usage).map(([id, u]) => [id, same(u, latest[id]) ? latest[id] : u])
  )
  changed()
}

const { subscribe, changed } = listenerSet(() => {
  let open = true
  let pushed = false
  const off = window.sandtable.sessions.onLiveUsage((usage) => {
    pushed = true
    publish(usage)
  })
  void window.sandtable.sessions
    .liveUsage()
    .then((usage) => open && !pushed && publish(usage))
    .catch(() => undefined)
  return () => {
    off()
    open = false
    latest = {}
  }
})

/** Each live session's token use by session ID, or one session's, following pushes, over one subscription shared by every caller. */
export function useLiveUsage(): LiveUsage
export function useLiveUsage(id: string): ModelUsage[] | undefined
export function useLiveUsage(id?: string): LiveUsage | ModelUsage[] | undefined {
  return useSyncExternalStore(subscribe, () => (id === undefined ? latest : latest[id]))
}

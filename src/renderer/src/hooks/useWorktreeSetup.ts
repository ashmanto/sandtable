import { useCallback, useSyncExternalStore } from 'react'
import { listenerSet } from '@/lib/fanOut'
import type { SetupProgress } from '../../../shared/types'

const known = new Map<string, SetupProgress | null>()
const asked = new Set<string>()
let opened = 0
const { subscribe: listen, changed } = listenerSet(() => {
  const off = window.sandtable.setup.onProgress((t, p) => {
    known.set(t, p)
    changed()
  })
  return () => {
    off()
    opened++
    known.clear()
    asked.clear()
  }
})

const watch =
  (target: string) =>
  (listener: () => void): (() => void) => {
    const stop = listen(listener)
    if (!asked.has(target)) {
      asked.add(target)
      const mine = opened
      void window.sandtable.setup
        .progress(target)
        .then((p) => {
          if (opened !== mine || known.has(target)) return
          known.set(target, p)
          changed()
        })
        .catch(() => undefined)
    }
    return stop
  }

/** The worktree setup running or failed for `target`, following pushes over one subscription shared by every caller. */
export function useWorktreeSetup(target: string): SetupProgress | null {
  const subscribe = useCallback((l: () => void) => watch(target)(l), [target])
  return useSyncExternalStore(subscribe, () => known.get(target) ?? null)
}

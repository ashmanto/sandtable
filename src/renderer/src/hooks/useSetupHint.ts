import { useSyncExternalStore } from 'react'
import { listenerSet } from '@/lib/fanOut'
import type { SetupSuggestion } from '../../../shared/types'

/** A Start's hint that the repo's worktrees need a setup. */
export type SetupHint = { repo: string; suggestion: SetupSuggestion }

const hints = new Map<string, SetupHint>()
const asked = new Set<string>()
const { subscribe, changed } = listenerSet()
const set = (key: string, hint: SetupHint | null): void => {
  if (hint) hints.set(key, hint)
  else hints.delete(key)
  changed()
}

/** Asks main for the repo's setup hint at a ticket's Start, once per repo while Sandtable runs. */
export async function checkSetupHint(
  projectId: string,
  ticketKey: string,
  repo: string
): Promise<void> {
  const once = `${projectId}\n${repo}`
  if (asked.has(once)) return
  asked.add(once)
  const suggestion = await window.sandtable.setup.hint(projectId, repo).catch(() => null)
  if (suggestion) set(`${projectId}\n${ticketKey}`, { repo, suggestion })
}

/** The ticket's setup hint, with **Not now**, which hides it for the repo for good, and a dismiss that only hides it here. */
export function useSetupHint(
  projectId: string,
  ticketKey: string
): { hint: SetupHint | null; notNow: () => Promise<void>; dismiss: () => void } {
  const key = `${projectId}\n${ticketKey}`
  const hint = useSyncExternalStore(subscribe, () => hints.get(key) ?? null)
  return {
    hint,
    notNow: async () => {
      if (!hint) return
      set(key, null)
      await window.sandtable.setup.hideHint(projectId, hint.repo)
    },
    dismiss: () => set(key, null)
  }
}

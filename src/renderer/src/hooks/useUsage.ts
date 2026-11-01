import type { ModelUsage } from '../../../shared/types'
import { useLoad } from './useLoad'

/** A ticket's token use by model and Claude's working time, read when `enabled` and again when `reload` changes. */
export function useUsage(
  projectId: string,
  ticketKey: string,
  reload: string,
  enabled = true
): { usage: ModelUsage[] | null; workMs: number; error: string | null } {
  const { data, error } = useLoad(
    () => window.sandtable.tickets.usage(projectId, ticketKey),
    [projectId, ticketKey, reload],
    enabled
  )
  return { usage: error ? null : (data?.usage ?? null), workMs: data?.workMs ?? 0, error }
}

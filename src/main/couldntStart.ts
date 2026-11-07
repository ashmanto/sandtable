import type { CouldntStart } from '../shared/api'
import type { Routine, SessionRecord, SkippedRun, StartFailure } from '../shared/types'

/** Each project's failed ticket starts and the skipped runs after `since` and its routine's last session, newest first. */
export function couldntStartByProject(
  failures: StartFailure[],
  skipped: SkippedRun[],
  routines: Routine[],
  sessions: SessionRecord[],
  titleOf: (projectId: string, ticketKey: string) => string | undefined,
  since: string
): Record<string, CouldntStart[]> {
  const out: Record<string, CouldntStart[]> = {}
  const add = (projectId: string, entry: CouldntStart): void =>
    void (out[projectId] ??= []).push(entry)
  for (const { projectId, ...f } of failures)
    add(projectId, { kind: 'ticket', name: titleOf(projectId, f.ticketKey) ?? f.ticketKey, ...f })
  for (const s of skipped) {
    const r = routines.find((x) => x.id === s.routineId)
    const last = sessions.filter((x) => x.routineId === s.routineId).map((x) => x.startedAt)
    if (!r || s.at < since || last.some((at) => at >= s.at)) continue
    add(r.projectId, {
      kind: 'routine',
      routineId: r.id,
      name: r.name,
      at: s.at,
      reason: s.reason,
      ...(s.error && { error: s.error })
    })
  }
  for (const list of Object.values(out)) list.sort((a, b) => b.at.localeCompare(a.at))
  return out
}

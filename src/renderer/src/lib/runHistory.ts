import { listenerSet } from '@/lib/fanOut'
import type { RoutineRun } from '../../../shared/types'

let asked: { projectId: string; routineId: string } | null = null
const { subscribe, changed } = listenerSet()

/** Asks the project's Routines section to open this routine's Run history, now or when it next shows. */
export function openRunHistory(projectId: string, routineId: string): void {
  asked = { projectId, routineId }
  changed()
}

/** Forgets an unanswered Run history ask unless it's for `shown`, the project whose board shows. */
export function dropRunHistoryAsk(shown: string | null): void {
  if (asked && asked.projectId !== shown) asked = null
}

/** Opens each Run history asked of this project's loaded routines, now and on later asks, and drops an ask for a routine it no longer has. */
export function onRunHistoryAsk(
  projectId: string,
  routineIds: string[] | null,
  open: (routineId: string) => void
): () => void {
  const honor = (): void => {
    if (asked?.projectId !== projectId || !routineIds) return
    const { routineId } = asked
    asked = null
    if (routineIds.includes(routineId)) open(routineId)
  }
  honor()
  return subscribe(honor)
}

/** Why a routine run was skipped, in words. */
export const skipReason = (
  run: Pick<Extract<RoutineRun, { kind: 'skipped' }>, 'reason' | 'error'>
): string =>
  run.reason === 'capped'
    ? 'Daily cap reached'
    : run.reason === 'failed'
      ? `Couldn't start: ${run.error ?? 'unknown error'}`
      : run.reason === 'running'
        ? 'Its last session was still open'
        : 'Sandtable was closed or the Mac was asleep'

import { listenerSet } from '@/lib/fanOut'
import type { RoutineRun } from '../../../shared/types'

let asked: string | null = null
const { subscribe, changed } = listenerSet()

/** Asks the Routines section holding this routine to open its Run history, now or when it next shows. */
export function openRunHistory(routineId: string): void {
  asked = routineId
  changed()
}

/** Hands each asked routine to `take`, now and on every later ask, until `take` returns true for it. */
export function onRunHistoryAsk(take: (routineId: string) => boolean): () => void {
  const honor = (): void => {
    if (asked && take(asked)) asked = null
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

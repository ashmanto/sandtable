import { useState } from 'react'
import { actionLabels } from '../../../shared/sessions'
import { startTicket, useOverlapCheck, useTicketSetup } from './useOverlapCheck'
import { checkSetupHint } from './useSetupHint'
import { useStartNote } from './useStartNote'
import type { useRun } from './useRun'

/** A ticket's Start wiring shared by its card and its view: the check dialog, the note, the overlap check, and the worktree setup. */
export function useTicketStart({
  projectId,
  ticketKey,
  run,
  offered,
  startable,
  hint,
  repo,
  noteFallback,
  setupFocus,
  onRefine
}: {
  projectId: string
  ticketKey: string
  run: ReturnType<typeof useRun>['run']
  offered: boolean
  startable: boolean
  hint?: boolean
  repo?: string
  noteFallback: React.RefObject<HTMLElement | null>
  setupFocus: React.RefObject<HTMLElement | null>
  onRefine?: () => void
}): {
  checking: { note?: string } | null
  setChecking: (checking: { note?: string } | null) => void
  note: Omit<ReturnType<typeof useStartNote>, 'clear'>
  overlap: ReturnType<typeof useOverlapCheck>
  setup: ReturnType<typeof useTicketSetup>
} {
  const [checking, setChecking] = useState<{ note?: string } | null>(null)
  if (checking && !startable) setChecking(null)
  const { clear: clearNote, ...note } = useStartNote(
    offered,
    (n) => setChecking({ note: n }),
    noteFallback
  )
  const start = (
    extraRepos: string[],
    mainRepo?: string,
    text?: string,
    setup?: false
  ): Promise<boolean> =>
    run(async () => {
      if (await startTicket(projectId, ticketKey, extraRepos, mainRepo, text, setup)) clearNote()
    }, actionLabels.start[1])
  const overlap = useOverlapCheck(
    projectId,
    ticketKey,
    (extra, main, text) => {
      const hinted = main ?? repo
      if (hint && hinted) void checkSetupHint(projectId, ticketKey, hinted)
      void start(extra, main, text)
    },
    onRefine
  )
  const setup = useTicketSetup(
    projectId,
    ticketKey,
    (...args) => void start(...args),
    () => setupFocus.current?.focus()
  )
  return { checking, setChecking, note, overlap, setup }
}

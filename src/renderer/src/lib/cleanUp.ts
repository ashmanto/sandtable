/** A result line under a card or the ticket view header; `danger` lines stay, the others clear. */
export type Line = { text: string; danger: boolean }

/** Ends the session first when asked, removes the worktrees or list entry, and words the outcome. */
export async function cleanUp(
  sessionId: string,
  endSession: boolean,
  worktree = true
): Promise<Line> {
  const { sessions } = window.sandtable
  const r = await (endSession
    ? sessions.endAndRemove(sessionId)
    : sessions.removeWorktree(sessionId))
  if (!worktree) return { text: 'Removed from list', danger: false }
  if (r.removed)
    return {
      text: endSession ? 'Session ended and worktree removed' : 'Worktree removed',
      danger: false
    }
  const lead = endSession ? 'Session ended. Kept the worktree' : "Couldn't remove the worktree"
  return { text: `${lead}: ${r.reason}`, danger: true }
}

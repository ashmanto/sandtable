import { columnFor } from './columns'
import type { Project, ProjectRepo, SessionRecord, SessionState, StatusMap } from './types'

/** A card or ticket state: a session state, a done ticket whose session is open, or a failed folder check. */
export type CardState = SessionState | 'doneOpen' | 'cantStart'

/** Each card state's word, as the board shows it. */
export const STATE_LABELS: Record<CardState, string> = {
  needsYou: 'Needs you',
  idle: 'Idle',
  running: 'Running',
  reviewing: 'Reviewing',
  done: 'Done',
  finished: 'Finished',
  limitReached: 'Limit reached',
  apiError: 'API error',
  doneOpen: 'Done, session open',
  cantStart: "Can't start"
}

/** The most bytes of text Sandtable passes to claude as a first message. */
export const MAX_BODY_BYTES = 10000

/** True when `message` is over MAX_BODY_BYTES in UTF-8. */
export const tooLong = (message: string): boolean =>
  new TextEncoder().encode(message).length > MAX_BODY_BYTES

/** True while the session's tmux is running. */
export const isLive = (s: SessionRecord): boolean => s.state !== 'finished'

/** A session's token cap: the larger of its project's cap and its raised cap, or none when the project has no cap. */
export const tokenCapOf = (
  project: Pick<Project, 'tokenCap'> | undefined,
  s: Pick<SessionRecord, 'tokenCap'>
): number | undefined =>
  project?.tokenCap ? Math.max(project.tokenCap, s.tokenCap ?? 0) : undefined

/** The folder a session runs in: its first worktree, or the repo folder. */
export const sessionDir = (s: SessionRecord): string | undefined => s.worktrees[0] ?? s.checkout

/** The project repos a session's worktrees, or its checkout, are in, main first. */
export const sessionRepos = (repos: ProjectRepo[], s: SessionRecord): ProjectRepo[] =>
  (s.checkout ? [s.checkout] : s.worktrees).flatMap(
    (dir) => repos.find((r) => r.path === dir || dir.startsWith(`${r.path}-wt.noindex/`)) ?? []
  )

/** The repo folder's name for a worktree in `<repo>-wt.noindex/`. */
export const repoName = (worktree: string): string =>
  (worktree.split('/').slice(-2, -1)[0] ?? worktree).replace(/-wt\.noindex$/, '')

/** The repo name of one of a session's folders: a worktree's repo, or the checkout folder's name. */
export const folderRepo = (s: SessionRecord, dir: string): string =>
  s.worktrees.length > 0 ? repoName(dir) : (dir.split('/').pop() ?? dir)

/** A ticket's sessions, newest first by start time. */
export const ticketSessions = (sessions: SessionRecord[], ticketKey: string): SessionRecord[] =>
  sessions
    .filter((s) => s.ticketKey === ticketKey)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))

/** The newest session of a ticket, by start time. */
export const currentSession = (
  sessions: SessionRecord[],
  ticketKey: string
): SessionRecord | undefined => ticketSessions(sessions, ticketKey)[0]

/** A live session on a ticket in another project, and that project. */
export type Elsewhere = { session: SessionRecord; project: Project }

/** The newest of another project's live sessions on the ticket, unless it has a live one of its own. */
export function elsewhereOf(
  elsewhere: SessionRecord[],
  projects: Project[],
  ticketKey: string,
  own: SessionRecord | undefined
): Elsewhere | undefined {
  if (own && isLive(own)) return undefined
  const session = currentSession(elsewhere, ticketKey)
  const project = session && projects.find((p) => p.id === session.projectId)
  return session && project ? { session, project } : undefined
}

/** True when the session is still live but its ticket is in Done. */
export const isDoneOpen = (
  session: SessionRecord,
  ticket: { status: string | null } | undefined,
  map: StatusMap
): boolean => isLive(session) && !!ticket && columnFor(ticket.status, map) === 'done'

/** The sessions without a ticket that are still listed: not removed. */
export const listedSessions = (sessions: SessionRecord[]): SessionRecord[] =>
  sessions.filter((s) => !s.ticketKey && !s.removedAt)

/** An action a ticket's card or view offers. */
export type TicketAction = 'chooseFolder' | 'start' | 'resume' | 'removeWorktree' | 'endSession'

/** Each ticket action's button label and the label it reads while it works. */
export const actionLabels: Record<TicketAction, [label: string, busy: string]> = {
  chooseFolder: ['Choose folder…', 'Checking folder'],
  start: ['Start', 'Starting'],
  resume: ['Resume', 'Resuming'],
  removeWorktree: ['Remove worktree', 'Removing'],
  endSession: ['End session and remove worktree', 'Ending session']
}

/** The actions a ticket's state allows, the card's one first, as DESIGN.md lists them; no Start or Resume while another project has a live session on it. */
export function ticketActions({
  elsewhere,
  ...state
}: {
  session: SessionRecord | undefined
  done: boolean
  hasRepo: boolean
  blocked: boolean
  elsewhere?: boolean
}): TicketAction[] {
  const actions = stateActions(state)
  return elsewhere ? actions.filter((a) => a !== 'start' && a !== 'resume') : actions
}

function stateActions({
  session,
  done,
  hasRepo,
  blocked
}: {
  session: SessionRecord | undefined
  done: boolean
  hasRepo: boolean
  blocked: boolean
}): TicketAction[] {
  if (blocked) return ['chooseFolder']
  if (!session || session.removedAt) return hasRepo && !done ? ['start'] : []
  if (isLive(session)) return done ? ['endSession'] : []
  return done ? ['removeWorktree', 'resume'] : ['resume', 'removeWorktree']
}

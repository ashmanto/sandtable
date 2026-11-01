import { existsSync } from 'node:fs'
import type { Leftover, Project, SessionRecord, Ticket } from '../../shared/types'
import { currentSession, folderRepo, isLive, sessionDir, sessionRepos } from '../../shared/sessions'
import { columnFor, statusMapOf } from '../../shared/columns'
import { isTrackerKey, parseTicketKey } from '../../shared/repo'
import type { Orchestrator, OrchestratorDeps } from '../orchestrator'
import { tmuxName } from './tmux'

type LeftoversApi = Pick<Orchestrator, 'leftovers' | 'endUnknown'>

/** Builds the leftover-session list and its unknown-session action over the orchestrator's sessions. */
export function createLeftovers(ctx: {
  deps: Pick<OrchestratorDeps, 'tmux' | 'dataDir'>
  projects: () => Project[]
  sessions: () => SessionRecord[]
  resuming: Set<string>
  starting: Map<string, [ticketKey: string, projectId: string]>
  creating: Set<string>
  shownTicketKeys: () => Map<string, Set<string> | null>
  isShown: (shownKeys: Map<string, Set<string> | null>) => (s: SessionRecord) => boolean
  boardTickets: (project: Project) => Ticket[]
  ticketOf: (s: SessionRecord) => Ticket | undefined
  sharesWorktree: (
    s: Pick<SessionRecord, 'worktrees'>,
    counts: (x: SessionRecord) => boolean
  ) => boolean
}): LeftoversApi {
  const { deps, resuming, starting, creating, shownTicketKeys, isShown, boardTickets } = ctx
  const { ticketOf, sharesWorktree } = ctx

  const unknownTmux = async (): Promise<string[]> => {
    const listed = await deps.tmux.listTmux()
    const known = new Set([
      ...ctx
        .sessions()
        .filter((s) => isLive(s) || resuming.has(s.id))
        .map((s) => s.tmuxName),
      ...[...starting.values()].map(([k, p]) => tmuxName(p, k)),
      ...creating
    ])
    return listed
      .filter((t) => t.name.startsWith('st-') && t.owner === deps.dataDir && !known.has(t.name))
      .map((t) => t.name)
  }

  return {
    async leftovers(): Promise<Leftover[]> {
      const projects = ctx.projects()
      const sessions = ctx.sessions()
      const shownKeys = shownTicketKeys()
      const shown = sessions.filter(isShown(shownKeys))
      const doneIds = new Set(
        projects.flatMap((p) =>
          shownKeys.get(p.id)
            ? boardTickets(p)
                .filter((t) => columnFor(t.status, statusMapOf(p)) === 'done')
                .map(
                  (t) =>
                    currentSession(
                      sessions.filter((s) => s.projectId === p.id),
                      t.key
                    )?.id
                )
            : []
        )
      )
      const sharesShown = (s: SessionRecord): boolean =>
        sharesWorktree(
          s,
          (x) =>
            shown.includes(x) &&
            !x.removedAt &&
            !(s.ticketKey && x.projectId === s.projectId && x.ticketKey === s.ticketKey)
        )
      const left = sessions.filter(
        (s) =>
          (!shown.includes(s) || doneIds.has(s.id)) &&
          (isLive(s) || (!s.removedAt && s.worktrees.some((w) => existsSync(w)) && !sharesShown(s)))
      )
      return [
        ...left.map((s): Leftover => ({
          kind: 'session',
          session: s,
          project: projects.find((p) => p.id === s.projectId)?.name ?? null,
          name: s.ticketKey ?? s.name ?? '',
          repo:
            s.ticketKey && !isTrackerKey(s.ticketKey)
              ? parseTicketKey(s.ticketKey).repo
              : (s.ticketKey &&
                  sessionRepos(projects.find((p) => p.id === s.projectId)?.repos ?? [], s)[0]
                    ?.github) ||
                folderRepo(s, sessionDir(s) ?? ''),
          title: ticketOf(s)?.title ?? null,
          done: doneIds.has(s.id),
          keepWorktree: isLive(s) && sharesShown(s)
        })),
        ...(await unknownTmux()).map((n): Leftover => ({ kind: 'unknown', tmuxName: n }))
      ]
    },

    async endUnknown(name: string): Promise<void> {
      if (!(await unknownTmux()).includes(name)) throw new Error('Unknown session')
      await deps.tmux.killTmux(name)
      if (await deps.tmux.hasTmux(name)) throw new Error("Couldn't end the session")
    }
  }
}

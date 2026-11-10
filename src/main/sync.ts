import type {
  BoardColumn,
  LaneChange,
  Project,
  ProjectRepo,
  Routine,
  SessionRecord,
  StartFailure,
  Ticket,
  TicketDetails
} from '../shared/types'
import { reassign } from '../shared/types'
import { currentSession, isLive, sessionRepos } from '../shared/sessions'
import { columnFor, statusMapOf } from '../shared/columns'
import { findRepo, sameRepo } from '../shared/repo'
import { daysBefore } from '../shared/visibleTickets'
import { mergedFor, prsNaming, type MergedPr } from './github/merged'
import type { Orchestrator, OrchestratorDeps } from './orchestrator'
import type { Tracker } from './tracker'

const STALE_MS = 30 * 60_000

/** A project's last synced tickets, when they synced, and the sync's error. */
export type Synced = { tickets: Ticket[]; syncedAt: string | null; error: string | null }
type MoveFields = Pick<Ticket, 'status' | 'doneAt' | 'assignees'>
type Lane = { from: string | null; person: Ticket['assignees'][number] | null }
type Move = {
  projectId: string
  ticket: Ticket
  before: MoveFields
  after: Partial<MoveFields>
  lanes: Lane[]
  written: Partial<MoveFields>
  writtenLanes: Lane[]
  settledAt: number | null
  writing: Promise<void>
}

const moveFields = (t: Ticket): MoveFields => ({
  status: t.status,
  doneAt: t.doneAt,
  assignees: t.assignees
})

const REPO_LABEL = /^repo:\s*(.+)$/i

function labeledRepo(repos: ProjectRepo[], t: Ticket): ProjectRepo | undefined {
  for (const { name } of t.labels) {
    const want = REPO_LABEL.exec(name)?.[1].trim()
    if (!want) continue
    const named = repos.filter((r) => sameRepo(r.github.split('/')[1], want))
    const repo = findRepo(repos, want) ?? (named.length === 1 ? named[0] : undefined)
    if (repo) return repo
  }
  return undefined
}

/** What the sync module reads from the orchestrator. */
export type SyncContext = {
  deps: Pick<OrchestratorDeps, 'mergedPullRequests'>
  now: () => Date
  projects: () => Project[]
  sessions: () => SessionRecord[]
  routines: () => Routine[]
  startFailures: () => StartFailure[]
  setStartFailures: (failures: StartFailure[]) => void
  synced: Map<string, Synced>
  mergedPrs: Map<string, MergedPr[]>
  projectById: (id: string) => Project
  trackerFor: (p: Project) => Tracker
  stampOf: (p: Project) => Promise<string | null>
  tracked: (p: Project) => boolean
  keepDoneDaysOf: (p: Project) => number
  persist: () => Promise<void>
  persistCache: () => void
  changed: (projectId: string) => void
  clearFixedFolders: (p: Project) => Promise<boolean>
  ticketId: (projectId: string, ticketKey: string) => string
  syncedTicket: (projectId: string, ticketKey: string) => Ticket
  onSync: (
    projectId: string,
    before: { tickets: Ticket[]; syncedAt: string } | null,
    after: Ticket[]
  ) => void
  autoOn: (s: SessionRecord) => boolean
  autoPrFindings: (s: SessionRecord) => Promise<void>
}

/** Ticket syncs, the merge scan, and card moves. */
export type SyncApi = Pick<Orchestrator, 'watch'> & {
  sync(projectId: string): Promise<string | null>
  joinSync(projectId: string): Promise<string | null>
  syncWatched(timed?: boolean): Promise<unknown>
  visible(): boolean
  moveTicket(
    project: Project,
    ticketKey: string,
    column: BoardColumn,
    failure: (t: Ticket) => string,
    reopen?: boolean,
    lane?: LaneChange
  ): Promise<void>
  detailsOf(project: Project, key: string): Promise<TicketDetails>
  setError(projectId: string, error: string): void
  resetSource(projectId: string): void
  writing(projectId: string, ticketKey: string): Promise<void> | undefined
}

/** Builds the sync module, which owns the pending moves and the open-project and visibility flags. */
export function createSync(ctx: SyncContext): SyncApi {
  const {
    deps,
    now,
    synced,
    mergedPrs,
    projectById,
    trackerFor,
    stampOf,
    tracked,
    keepDoneDaysOf,
    persist,
    persistCache,
    changed,
    clearFixedFolders,
    ticketId,
    syncedTicket,
    onSync,
    autoOn,
    autoPrFindings
  } = ctx
  const stamps = new Map<string, { stamp: string; at: number }>()
  const moves = new Map<string, Move>()
  const appliedSync = new Map<string, number>()

  const sync = async (projectId: string): Promise<string | null> => {
    let failed: string | null = null
    try {
      const project = projectById(projectId)
      const startedAt = now().getTime()
      const stamp = await stampOf(project)
      const truncated: string[] = []
      const problem = (message: string): void => void truncated.push(message)
      const tickets = await trackerFor(project).tickets(
        closedSince(project),
        syncKeys(project),
        problem
      )
      const merged = project.jira ? await scanMerges(project, tickets, problem) : undefined
      if (tracked(project)) placeRepos(project, tickets)
      if (startedAt < (appliedSync.get(projectId) ?? -Infinity)) return null
      if (!ctx.projects().some((p) => p.id === projectId)) return null
      appliedSync.set(projectId, startedAt)
      stampMerges(project, tickets, merged?.complete)
      for (const [id, m] of moves) {
        if (m.projectId !== projectId) continue
        if (m.settledAt !== null && m.settledAt < startedAt) {
          moves.delete(id)
          continue
        }
        const fresh = tickets.find((t) => t.key === m.ticket.key)
        if (!fresh) continue
        m.ticket = fresh
        m.before = moveFields(fresh)
        if (m.lanes.length) m.after.assignees = relane(project, fresh.assignees, m.lanes)
        if (m.writtenLanes.length)
          m.written.assignees = relane(project, fresh.assignees, m.writtenLanes)
        Object.assign(fresh, m.after)
      }
      const before = synced.get(projectId)
      synced.set(projectId, {
        tickets,
        syncedAt: new Date(startedAt).toISOString(),
        error: truncated.join(' ') || null
      })
      if (!truncated.length) {
        const keys = new Set(tickets.map((t) => t.key))
        const startFailures = ctx.startFailures()
        const kept = startFailures.filter((f) => f.projectId !== projectId || keys.has(f.ticketKey))
        if (kept.length < startFailures.length) {
          ctx.setStartFailures(kept)
          void persist().catch(() => undefined)
        }
      }
      void clearFixedFolders(project).then((cleared) => {
        if (!cleared) return
        void persist().catch(() => undefined)
        changed(projectId)
      })
      if (merged) mergedPrs.set(projectId, merged.prs)
      persistCache()
      onSync(
        projectId,
        before?.syncedAt ? { tickets: before.tickets, syncedAt: before.syncedAt } : null,
        tickets
      )
      autoFindings(projectId)
      if (stamp !== null) stamps.set(projectId, { stamp, at: startedAt })
    } catch (err) {
      failed = (err as Error).message
      setError(projectId, failed)
    }
    changed(projectId)
    return failed
  }
  // shortcut: one GitHub pull request read per live auto-on session per sync; gate on the ticket's PR if that costs too much.
  const autoFindings = (projectId: string): void => {
    for (const s of ctx.sessions())
      if (
        s.projectId === projectId &&
        s.ticketKey &&
        s.branch &&
        isLive(s) &&
        !s.removedAt &&
        autoOn(s)
      )
        void autoPrFindings(s).catch(() => undefined)
  }
  const running = new Map<string, Promise<string | null>>()
  /** Starts a sync, or reuses the project's running one; a caller that just wrote calls sync instead. */
  const joinSync = (projectId: string): Promise<string | null> => {
    const known = running.get(projectId)
    if (known) return known
    const next = sync(projectId).finally(() => running.delete(projectId))
    running.set(projectId, next)
    return next
  }
  const stampMerges = (project: Project, tickets: Ticket[], complete = true): void => {
    let stamped = false
    for (const t of tickets) {
      const { mergedAt } = t
      if (!t.notPlanned && columnFor(t.status, statusMapOf(project)) !== 'done') continue
      for (const s of ctx.sessions()) {
        if (s.projectId !== project.id || s.ticketKey !== t.key) continue
        if (t.notPlanned) {
          if (!s.mergedAt && (!s.removedAt || s.noMerge)) continue
          delete s.mergedAt
          if (s.removedAt) s.noMerge = true
        } else if (s.mergedAt) continue
        else if (mergedAt && Date.parse(s.startedAt) < Date.parse(mergedAt)) s.mergedAt = mergedAt
        else if (complete && s.removedAt && !s.noMerge) s.noMerge = true
        else continue
        stamped = true
      }
    }
    if (stamped) void persist().catch(() => undefined)
  }
  const setError = (projectId: string, error: string): void => {
    stamps.delete(projectId)
    const current = synced.get(projectId) ?? { tickets: [], syncedAt: null, error: null }
    synced.set(projectId, { ...current, error })
  }
  const closedSince = (p: Project): string => daysBefore(now(), keepDoneDaysOf(p)).toISOString()
  const scanMerges = async (
    project: Project,
    tickets: Ticket[],
    problem: (message: string) => void
  ): Promise<{ prs: MergedPr[]; complete: boolean }> => {
    const unknown = syncSessions(project).filter((s) => !s.mergedAt && !s.noMerge)
    const since = [closedSince(project), ...unknown.map((s) => s.startedAt)]
      .map((d) => new Date(d).toISOString())
      .sort()[0]
    let complete = true
    const missed = (message: string): void => {
      complete = false
      problem(message)
    }
    const lists = await Promise.all(
      project.repos.map((r) =>
        deps.mergedPullRequests(r.github, since, missed).catch((err: Error) => {
          missed(`Couldn't read the merged pull requests of ${r.github}: ${err.message}`)
          return []
        })
      )
    )
    const prs = lists.flat()
    for (const t of tickets) Object.assign(t, mergedFor(t.key, prs))
    return { prs, complete }
  }
  const detailsOf = async (project: Project, key: string): Promise<TicketDetails> => {
    const details = await trackerFor(project).details(key)
    if (!project.jira) return details
    const pullRequests = prsNaming(key, mergedPrs.get(project.id) ?? []).map((pr) => ({
      number: pr.number,
      title: pr.title,
      url: pr.url,
      state: 'merged' as const
    }))
    return { ...details, pullRequests }
  }
  const syncSessions = (project: Project): SessionRecord[] =>
    ctx
      .sessions()
      .filter(
        (s) =>
          s.projectId === project.id && s.ticketKey && (!s.removedAt || (!s.mergedAt && !s.noMerge))
      )
  const syncKeys = (project: Project): string[] => [
    ...new Set(syncSessions(project).map((s) => s.ticketKey!))
  ]
  const placeRepos = (project: Project, tickets: Ticket[]): void => {
    const projectSessions = ctx.sessions().filter((s) => s.projectId === project.id)
    for (const t of tickets) {
      const last = currentSession(projectSessions, t.key)
      t.repo =
        (project.repos.length === 1
          ? project.repos[0]
          : (labeledRepo(project.repos, t) ?? (last && sessionRepos(project.repos, last)[0]))
        )?.github ?? ''
    }
  }
  const lanePerson = (project: Project, ticket: Ticket, { from, to }: LaneChange): Lane => {
    const has = ticket.assignees
    if (from === null ? has.length > 0 : !has.some((a) => a.id === from))
      throw new Error('Ticket is not in that lane')
    const person =
      to === null
        ? null
        : synced
            .get(project.id)
            ?.tickets.flatMap((t) => t.assignees)
            .find((a) => a.id === to)
    if (person === undefined) throw new Error('Unknown assignee')
    return { from, person }
  }
  const relane = (
    project: Project,
    assignees: Ticket['assignees'],
    lanes: Lane[]
  ): Ticket['assignees'] =>
    lanes.reduce<Ticket['assignees']>(
      (as, { from, person }) =>
        tracked(project) ? (person ? [person] : []) : reassign(as, from, person),
      assignees
    )
  const moveTicket = async (
    project: Project,
    ticketKey: string,
    column: BoardColumn,
    failure: (t: Ticket) => string,
    reopen = true,
    lane?: LaneChange
  ): Promise<void> => {
    const projectId = project.id
    const ticket = syncedTicket(projectId, ticketKey)
    const id = ticketId(projectId, ticketKey)
    const prev = moves.get(id)
    if (prev?.settledAt === null) throw new Error('Ticket is already moving')
    const map = statusMapOf(project)
    const columnMoves = columnFor(ticket.status, map) !== column
    const moved = lane && lanePerson(project, ticket, lane)
    const laneMoves = moved !== undefined && moved.from !== lane?.to
    if (!columnMoves && !laneMoves) return
    const columnFields = columnMoves
      ? { status: map[column], doneAt: column === 'done' ? now().toISOString() : null }
      : {}
    const m: Move = {
      projectId,
      ticket,
      before: moveFields(ticket),
      after: {
        ...prev?.after,
        ...columnFields,
        ...(laneMoves && { assignees: relane(project, ticket.assignees, [moved]) })
      },
      lanes: [...(prev?.lanes ?? []), ...(laneMoves ? [moved] : [])],
      written: { ...prev?.after },
      writtenLanes: prev?.lanes ?? [],
      settledAt: null,
      writing: Promise.resolve()
    }
    moves.set(id, m)
    Object.assign(ticket, m.after)
    changed(projectId)
    let assigneeTried = false
    const write = (async () => {
      if (columnMoves) {
        await trackerFor(project).setColumn(ticket, columnFor(m.before.status, map), column, reopen)
        Object.assign(m.written, columnFields)
      }
      if (lane && laneMoves) {
        assigneeTried = true
        await trackerFor(project).setAssignee(ticket, lane.from, lane.to)
      }
    })()
    m.writing = write.catch(() => undefined)
    try {
      await write
      m.settledAt = now().getTime()
    } catch (err) {
      if (synced.get(projectId)?.tickets.find((t) => t.key === ticketKey) === m.ticket)
        Object.assign(m.ticket, m.before, m.written)
      if (moves.get(id) === m) {
        if (Object.keys(m.written).length > 0) {
          m.after = m.written
          m.lanes = m.writtenLanes
          m.settledAt = now().getTime()
        } else moves.delete(id)
      }
      const message = `${failure(ticket)}: ${(err as Error).message}`
      setError(projectId, message)
      changed(projectId)
      if (assigneeTried && !tracked(project))
        void sync(projectId).then((failed) => {
          if (failed !== null) return
          setError(projectId, message)
          changed(projectId)
        })
      throw err
    }
    persistCache()
    changed(projectId)
  }
  let openId: string | null = null
  let visible = true
  const timedSync = async (project: Project): Promise<string | null> => {
    const stamp = await stampOf(project)
    const last = stamps.get(project.id)
    if (stamp !== null && last?.stamp === stamp && now().getTime() - last.at < STALE_MS) {
      autoFindings(project.id)
      return null
    }
    return joinSync(project.id)
  }
  const syncWatched = (timed = false): Promise<unknown> =>
    Promise.all(
      ctx
        .projects()
        .filter(
          (p) =>
            p.id === openId ||
            ctx.sessions().some((s) => s.projectId === p.id && isLive(s)) ||
            ctx.routines().some((r) => r.projectId === p.id && r.on)
        )
        .map((p) => (timed ? timedSync(p) : joinSync(p.id)))
    )

  return {
    sync,
    joinSync,
    syncWatched,
    visible: () => visible,
    moveTicket,
    detailsOf,
    setError,
    resetSource(projectId: string): void {
      for (const [id, m] of moves) if (m.projectId === projectId) moves.delete(id)
      appliedSync.set(projectId, now().getTime())
    },
    writing: (projectId: string, ticketKey: string): Promise<void> | undefined =>
      moves.get(ticketId(projectId, ticketKey))?.writing,
    /** Records the project whose board is open and whether the window shows; syncs what just came into view. */
    watch(projectId: string | null, shown: boolean): void {
      const appeared = shown && !visible
      const switched = projectId !== openId
      openId = projectId
      visible = shown
      if (appeared) void syncWatched()
      else if (shown && switched && projectId) void joinSync(projectId)
    }
  }
}

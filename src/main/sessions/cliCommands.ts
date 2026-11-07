import { columnFor } from '../../shared/columns'
import { messageOf } from '../../shared/errors'
import { isTrackerKey, ticketLabel } from '../../shared/repo'
import {
  currentSession,
  isLive,
  previousExtras,
  sessionRepos,
  STATE_LABELS
} from '../../shared/sessions'
import type {
  ChatState,
  ConversationEntry,
  Overlap,
  Project,
  SessionRecord,
  SessionState,
  StartCheck,
  StatusMap,
  Ticket
} from '../../shared/types'
import type { CliHandler } from './cli'

const WAIT_DEFAULT_SEC = 540
const WAIT_MAX_SEC = 3600
const WAIT_ENDS: SessionState[] = ['finished', 'limitReached', 'apiError', 'idle']
const START_CAP = 5

const refuse = (text: string): { code: 1; text: string } => ({ code: 1, text })

/** The ticket `arg` names (`#12`, `owner/name#12`, or `APP-12`, any case), or the refusal text. */
export function resolveTicket(tickets: Ticket[], arg: string): Ticket | string {
  const want = arg.toLowerCase()
  const found = tickets.filter((t) =>
    want.startsWith('#')
      ? !isTrackerKey(t.key) && `#${t.number}` === want
      : t.key.toLowerCase() === want
  )
  if (found.length > 1)
    return `${arg} matches ${found.map((t) => t.key).join(' and ')}; use the full key`
  return found[0] ?? `No ticket ${arg} in this project`
}

/** The word `status` prints for a ticket and its newest session. */
export function stateWord(s: SessionRecord | undefined, ticket: Ticket, map: StatusMap): string {
  const done = columnFor(ticket.status, map) === 'done'
  if (!s) return done ? 'Done' : 'No session'
  if (isLive(s)) {
    if (s.asking) return 'Needs you (asking)'
    return done ? STATE_LABELS.doneOpen : STATE_LABELS[s.state]
  }
  return done ? 'Done' : STATE_LABELS[s.state]
}

/** The `sandtable` commands for a ticket session, answered from the orchestrator's state. */
export function createCliCommands(ctx: {
  sessions: () => SessionRecord[]
  synced: Map<string, { tickets: Ticket[] }>
  projectById: (id: string) => Project
  statusMapOf: (p: Project) => StatusMap
  transcriptOf: (s: SessionRecord) => Promise<ConversationEntry[] | null>
  chat: (projectId: string, ticketKey: string) => Promise<ChatState>
  pending: (sessionId: string) => boolean
  busy: (projectId: string, ticketKey: string) => boolean
  onChange: (cb: (projectId: string) => void) => () => void
  checkStart: (projectId: string, ticketKey: string) => Promise<StartCheck>
  checkReady: (projectId: string, ticketKey: string) => Promise<string[]>
  overlap: (projectId: string, ticketKey: string, exclude: string[]) => Promise<Overlap[]>
  start: (
    callerId: string,
    projectId: string,
    ticketKey: string,
    extraRepos: string[],
    mainRepo?: string
  ) => Promise<void>
  resume: (callerId: string, sessionId: string) => Promise<void>
}): { run: CliHandler } {
  const inFlight = new Map<string, number>()
  const startingTickets = new Set<string>()
  const startFor = async (caller: SessionRecord, found: Ticket): Promise<string> => {
    const { projectId } = caller
    const label = ticketLabel(found)
    const ours = (): SessionRecord[] => ctx.sessions().filter((x) => x.projectId === projectId)
    const all = ours()
    const newest = currentSession(
      all.filter((x) => !x.removedAt),
      found.key
    )
    if (newest && !isLive(newest)) {
      await ctx.resume(caller.id, newest.id)
      return `Resumed ${label} on ${newest.branch}`
    }
    const check = await ctx.checkStart(projectId, found.key)
    if (check.triage)
      throw new Error(
        `${label} needs an area label first. Ask the user to start it in Sandtable, which offers triage.`
      )
    if (check.problems.length) throw new Error(check.problems.join('\n'))
    if (check.ready) {
      const gaps = await ctx.checkReady(projectId, found.key)
      if (gaps.length)
        throw new Error([`The readiness check found gaps in ${label}:`, ...gaps].join('\n'))
    }
    const mine = ctx
      .sessions()
      .flatMap((x) => (x.startedBy === caller.id && isLive(x) && x.ticketKey) || [])
    const overlaps = await ctx.overlap(projectId, found.key, [
      ...new Set([caller.ticketKey!, ...mine])
    ])
    if (overlaps.length)
      throw new Error(
        [
          `${label} overlaps work in progress:`,
          ...overlaps.map((o) => `${ticketLabel(o)} ${o.title}: ${o.reason}`)
        ].join('\n')
      )
    const repos = ctx.projectById(projectId).repos
    const mainRepo = found.repo || sessionRepos(repos, caller)[0]?.github
    const before = currentSession(all, found.key)
    await ctx.start(
      caller.id,
      projectId,
      found.key,
      previousExtras(repos, before, mainRepo),
      mainRepo
    )
    const branch = currentSession(ours(), found.key)?.branch
    return branch ? `Started ${label} on ${branch}` : `Started ${label}`
  }

  const run: CliHandler = async (callerId, command, arg, timeoutSec, signal) => {
    const caller = ctx.sessions().find((s) => s.id === callerId)
    if (!caller?.ticketKey) return refuse('Not a Sandtable ticket session')
    const found = resolveTicket(ctx.synced.get(caller.projectId)?.tickets ?? [], arg)
    if (typeof found === 'string') return refuse(found)
    if (found.key === caller.ticketKey)
      return refuse("A session can't use sandtable on its own ticket")
    if (command === 'start') {
      const tickets = ctx.synced.get(caller.projectId)?.tickets ?? []
      const map = ctx.statusMapOf(ctx.projectById(caller.projectId))
      const open = (x: SessionRecord): boolean =>
        columnFor(tickets.find((t) => t.key === x.ticketKey)?.status ?? null, map) !== 'done'
      const live = ctx
        .sessions()
        .filter((x) => x.startedBy === callerId && isLive(x) && open(x)).length
      const pending = inFlight.get(callerId) ?? 0
      if (live + pending >= START_CAP)
        return refuse(
          `This session already started ${START_CAP} live sessions. Wait for one to finish.`
        )
      const ticketId = `${caller.projectId}\n${found.key}`
      if (startingTickets.has(ticketId)) return refuse(`${ticketLabel(found)} is already starting`)
      inFlight.set(callerId, pending + 1)
      startingTickets.add(ticketId)
      try {
        return { code: 0, text: await startFor(caller, found) }
      } catch (err) {
        return refuse(messageOf(err))
      } finally {
        inFlight.set(callerId, (inFlight.get(callerId) ?? 1) - 1)
        startingTickets.delete(ticketId)
      }
    }
    const label = ticketLabel(found)
    const current = (): SessionRecord | undefined =>
      currentSession(
        ctx.sessions().filter((x) => x.projectId === caller.projectId && !x.removedAt),
        found.key
      )
    const s = current()
    const startingNow = (now: SessionRecord | undefined): boolean =>
      !(now && isLive(now)) &&
      (startingTickets.has(`${caller.projectId}\n${found.key}`) ||
        ctx.busy(caller.projectId, found.key))
    if (command === 'wait') {
      const map = ctx.statusMapOf(ctx.projectById(caller.projectId))
      const look = (): { text: string; ready: boolean } => {
        const now = current()
        const t =
          ctx.synced.get(caller.projectId)?.tickets.find((x) => x.key === found.key) ?? found
        const starting = startingNow(now)
        const text = starting ? 'Starting' : stateWord(now, t, map)
        const ready =
          !starting &&
          (!now ||
            !isLive(now) ||
            columnFor(t.status, map) === 'done' ||
            WAIT_ENDS.includes(now.state) ||
            (now.state === 'needsYou' && !ctx.pending(now.id)))
        return { text, ready }
      }
      const first = look()
      if (first.ready) return { code: 0, text: first.text }
      if (signal?.aborted) return { code: 3, text: first.text }
      return new Promise((resolve) => {
        const finish = (reply: { code: 0 | 3; text: string }): void => {
          clearTimeout(timer)
          off()
          signal?.removeEventListener('abort', hangUp)
          resolve(reply)
        }
        const hangUp = (): void => finish({ code: 3, text: look().text })
        signal?.addEventListener('abort', hangUp)
        const timer = setTimeout(
          hangUp,
          Math.min(timeoutSec || WAIT_DEFAULT_SEC, WAIT_MAX_SEC) * 1000
        )
        const off = ctx.onChange((projectId) => {
          if (projectId !== caller.projectId) return
          const { text, ready } = look()
          if (ready) finish({ code: 0, text })
        })
      })
    }
    if (command === 'status') {
      const map = ctx.statusMapOf(ctx.projectById(caller.projectId))
      return { code: 0, text: startingNow(s) ? 'Starting' : stateWord(s, found, map) }
    }
    if (!s) return refuse(`${label} has no session`)
    if (command === 'info') {
      return { code: 0, text: [s.branch ?? '', ...s.worktrees].join('\n') }
    }
    const { chat } = await ctx.chat(caller.projectId, found.key)
    const saved = chat?.summary && !isLive(s) ? chat.draft : undefined
    const last = (await ctx.transcriptOf(s))?.findLast((e) => e.kind === 'assistant')
    const text = saved ?? (last && 'text' in last ? last.text : undefined)
    return text ? { code: 0, text } : refuse(`${label} has no message yet`)
  }
  return { run }
}

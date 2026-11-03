import { randomUUID } from 'node:crypto'
import type {
  ConversationEntry,
  Project,
  ProjectRepo,
  Routine,
  RoutineInput,
  RoutineRun,
  RunTrigger,
  Schedule,
  SessionRecord,
  SkippedRun,
  Ticket
} from '../../shared/types'
import { DEFAULT_DAILY_CAP, dueTimes, routineProblem } from '../../shared/routines'
import { isLive } from '../../shared/sessions'
import { shortTime } from '../../shared/time'
import { daysBefore } from '../../shared/visibleTickets'
import { messageOf } from '../../shared/errors'
import type { Orchestrator } from '../orchestrator'
import type { serial } from '../store'
import { pendingTool } from './conversation'
import { transcriptUsage } from './usage'

const START_WINDOW_MS = 2 * 60_000
const CLOCK_SLACK_MS = 5 * 60_000

const triggerLine = (trigger: RunTrigger, t: Ticket): string =>
  trigger.kind === 'label'
    ? `Started because ${t.key} got the label ${trigger.label}: ${t.title} (${t.url})`
    : `Started because the pull request checks of ${t.key} are failing: ${t.title} (${t.url})`

const sameSchedule = (a?: Schedule, b?: Schedule): boolean =>
  a?.time === b?.time && [...(a?.days ?? [])].sort().join() === [...(b?.days ?? [])].sort().join()

type RoutinesApi = Pick<
  Orchestrator,
  'listRoutines' | 'saveRoutine' | 'removeRoutine' | 'startRoutine' | 'routineHistory'
>

/** Builds routines and their schedules over the orchestrator's stored routines and sessions. */
export function createRoutines(ctx: {
  now: () => Date
  routines: () => Routine[]
  setRoutines: (next: Routine[]) => void
  skippedRuns: () => SkippedRun[]
  setSkippedRuns: (next: SkippedRun[]) => void
  sessions: () => SessionRecord[]
  resuming: Set<string>
  stopped: () => boolean
  persist: () => Promise<void>
  changed: (projectId: string) => void
  projectById: (id: string) => Project
  repoOf: (project: Project, github: string) => ProjectRepo
  reading: ReturnType<typeof serial>
  transcriptOf: (s: SessionRecord) => Promise<ConversationEntry[] | null>
  transcriptFiles: (
    mine: (x: { projectId: string; ticketKey?: string }) => boolean
  ) => Promise<string[]>
  createSession: (
    picked: Project,
    github: string,
    worktree: boolean,
    opts: {
      name: (startedAt: string) => string
      prompt?: string
      routineId?: string
      allow?: string[]
      scheduled?: boolean
      trigger?: RunTrigger
    }
  ) => Promise<string>
}): RoutinesApi & {
  runSchedules: () => Promise<void>
  onSync: (projectId: string, before: Ticket[] | null, after: Ticket[]) => void
} {
  const {
    now,
    resuming,
    persist,
    changed,
    projectById,
    repoOf,
    reading,
    transcriptOf,
    transcriptFiles,
    createSession
  } = ctx

  const startingRoutines = new Set<string>()
  const routineBusy = (r: Routine): boolean =>
    startingRoutines.has(r.id) ||
    ctx
      .sessions()
      .some(
        (s) => s.routineId === r.id && ((isLive(s) && s.state !== 'done') || resuming.has(s.id))
      )
  const startRoutine = async (
    r: Routine,
    opts: { scheduled?: boolean; trigger?: RunTrigger; prompt?: string } = {}
  ): Promise<string> => {
    if (routineBusy(r)) throw new Error(`${r.name}'s last session is still open`)
    startingRoutines.add(r.id)
    try {
      return await createSession(projectById(r.projectId), r.repo, r.worktree, {
        name: (startedAt) => `${r.name}, ${shortTime(startedAt)}`,
        prompt: opts.prompt ?? r.message,
        routineId: r.id,
        allow: r.allow,
        scheduled: opts.scheduled,
        ...(opts.trigger && { trigger: opts.trigger })
      })
    } finally {
      startingRoutines.delete(r.id)
    }
  }

  const runSchedules = async (): Promise<void> => {
    const at = now()
    const toStart: { id: string; at: Date }[] = []
    let dirty = false
    for (const r of ctx.routines()) {
      if (!r.schedule) continue
      const through = new Date(r.scheduledThrough ?? at)
      if (through.getTime() - at.getTime() > CLOCK_SLACK_MS) {
        r.scheduledThrough = at.toISOString()
        dirty = true
        continue
      }
      const after = new Date(Math.max(through.getTime(), daysBefore(at, 7).getTime()))
      const due = dueTimes(r.schedule, after, at)
      if (!due.length) continue
      const newest = due[due.length - 1]
      const startNow = at.getTime() - newest.getTime() <= START_WINDOW_MS ? newest : undefined
      for (const t of due) if (t !== startNow) skipRun(r, t, 'closed')
      if (startNow && routineBusy(r)) skipRun(r, startNow, 'running')
      else if (startNow) toStart.push({ id: r.id, at: startNow })
      r.scheduledThrough = at.toISOString()
      dirty = true
    }
    if (dirty) await persist()
    for (const { id, at: t } of toStart) {
      const r = ctx.routines().find((x) => x.id === id)
      if (ctx.stopped() || !r) continue
      startInBackground(r, t, { scheduled: true })
    }
  }
  const startInBackground = (
    r: Routine,
    t: Date,
    opts: { scheduled?: boolean; trigger?: RunTrigger; prompt?: string }
  ): void =>
    void startRoutine(r, opts).catch((err) => {
      console.error(`Starting the routine ${r.name} failed`, err)
      if (!ctx.routines().some((x) => x.id === r.id)) return
      if (routineBusy(r)) skipRun(r, t, 'running', undefined, opts.trigger)
      else skipRun(r, t, 'failed', messageOf(err), opts.trigger)
      void persist().catch(() => undefined)
      changed(r.projectId)
    })
  const skipRun = (
    r: Routine,
    t: Date,
    reason: SkippedRun['reason'],
    error?: string,
    trigger?: RunTrigger
  ): void =>
    void ctx.skippedRuns().push({
      routineId: r.id,
      at: t.toISOString(),
      reason,
      ...(error && { error }),
      ...(trigger && { trigger })
    })

  const eventsOf = (r: Routine, before: Ticket | undefined, t: Ticket): RunTrigger[] => {
    const label = r.on?.label?.toLowerCase()
    const has = (x: Ticket | undefined): boolean =>
      !!x?.labels.some((l) => l.name.toLowerCase() === label)
    return [
      ...(r.on?.label && has(t) && !has(before)
        ? [{ kind: 'label' as const, label: r.on.label, ticket: t.key }]
        : []),
      ...(r.on?.checksFail && t.prStage === 'checksFailing' && before?.prStage !== 'checksFailing'
        ? [{ kind: 'checks' as const, ticket: t.key }]
        : [])
    ]
  }
  const startsToday = (r: Routine, at: Date): number => {
    const today = at.toDateString()
    const sameDay = (iso: string): boolean => new Date(iso).toDateString() === today
    return (
      ctx.sessions().filter((s) => s.routineId === r.id && s.trigger && sameDay(s.startedAt))
        .length +
      ctx
        .skippedRuns()
        .filter((x) => x.routineId === r.id && x.trigger && x.reason === 'failed' && sameDay(x.at))
        .length
    )
  }
  const onSync = (projectId: string, before: Ticket[] | null, after: Ticket[]): void => {
    if (!before || ctx.stopped()) return
    const at = now()
    let dirty = false
    for (const r of ctx.routines()) {
      if (r.projectId !== projectId || !r.on) continue
      for (const t of after)
        for (const trigger of eventsOf(
          r,
          before.find((x) => x.key === t.key),
          t
        )) {
          if (routineBusy(r)) skipRun(r, at, 'running', undefined, trigger)
          else if (startsToday(r, at) >= (r.dailyCap ?? DEFAULT_DAILY_CAP))
            skipRun(r, at, 'capped', undefined, trigger)
          else {
            startInBackground(r, at, {
              trigger,
              prompt: `${r.message}\n\n${triggerLine(trigger, t)}`
            })
            continue
          }
          dirty = true
        }
    }
    if (dirty) {
      void persist().catch(() => undefined)
      changed(projectId)
    }
  }

  return {
    runSchedules,
    onSync,

    listRoutines: async (projectId: string): Promise<Routine[]> =>
      ctx.routines().filter((r) => r.projectId === projectId),

    async saveRoutine(input: RoutineInput): Promise<Routine> {
      const project = projectById(input.projectId)
      const others = ctx.routines().filter((r) => r.projectId === project.id)
      const problem = routineProblem(input, others, project.name)
      if (problem) throw new Error(problem)
      const repo = repoOf(project, input.repo)
      const old = input.id === undefined ? undefined : others.find((r) => r.id === input.id)
      if (input.id !== undefined && !old) throw new Error('Unknown routine')
      const { worktree, message, schedule } = input
      const allow = input.allow?.map((rule) => rule.trim()).filter(Boolean) ?? []
      const on = {
        ...(input.on?.label && { label: input.on.label.trim() }),
        ...(input.on?.checksFail === true && { checksFail: true as const })
      }
      const triggered = Object.keys(on).length > 0
      const routine: Routine = {
        id: old?.id ?? randomUUID(),
        projectId: project.id,
        name: input.name.trim(),
        repo: repo.github,
        worktree,
        message,
        ...(allow.length > 0 && { allow }),
        ...(schedule && { schedule: { days: [...schedule.days], time: schedule.time } }),
        ...(triggered && { on }),
        ...(triggered && input.dailyCap !== undefined && { dailyCap: input.dailyCap }),
        scheduledThrough:
          old && sameSchedule(old.schedule, schedule) ? old.scheduledThrough : now().toISOString()
      }
      const routines = ctx.routines()
      ctx.setRoutines(old ? routines.map((r) => (r === old ? routine : r)) : [...routines, routine])
      await persist()
      changed(project.id)
      return routine
    },

    async removeRoutine(id: string): Promise<void> {
      const r = ctx.routines().find((x) => x.id === id)
      ctx.setRoutines(ctx.routines().filter((x) => x.id !== id))
      ctx.setSkippedRuns(ctx.skippedRuns().filter((x) => x.routineId !== id))
      await persist()
      if (r) changed(r.projectId)
    },

    async startRoutine(id: string): Promise<string> {
      const r = ctx.routines().find((x) => x.id === id)
      if (!r) throw new Error('Unknown routine')
      return startRoutine(r)
    },

    routineHistory: (id: string): Promise<RoutineRun[]> =>
      reading(async () => {
        const history: RoutineRun[] = ctx
          .skippedRuns()
          .filter((x) => x.routineId === id)
          .map((x) => ({
            kind: 'skipped',
            at: x.at,
            scheduled: true,
            reason: x.reason,
            ...(x.error && { error: x.error }),
            ...(x.trigger && { trigger: x.trigger })
          }))
        for (const s of ctx.sessions().filter((x) => x.routineId === id)) {
          const entries = await transcriptOf(s)
          const last = entries?.findLast((e) => e.kind === 'assistant')
          const waitingFor = s.asking && entries && pendingTool(entries)
          history.push({
            kind: 'session',
            at: s.startedAt,
            scheduled: !!s.scheduled,
            sessionId: s.id,
            state: s.state,
            removed: !!s.removedAt,
            place: s.branch ?? 'main checkout',
            usage: await transcriptUsage(await transcriptFiles((x) => x === s)),
            lastMessage: last?.kind === 'assistant' ? last.text : null,
            ...(waitingFor && { waitingFor }),
            ...(s.startWarning && { warning: s.startWarning }),
            ...(s.trigger && { trigger: s.trigger })
          })
        }
        return history.sort((a, b) => b.at.localeCompare(a.at))
      })
  }
}

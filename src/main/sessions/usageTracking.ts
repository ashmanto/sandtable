import { mkdir, rm, writeFile } from 'node:fs/promises'
import type {
  MergedTicket,
  ModelUsage,
  Project,
  ProjectUsage,
  SessionRecord,
  SessionState,
  TicketUsage,
  UsageByWeek
} from '../../shared/types'
import { isLive, tokenCapOf } from '../../shared/sessions'
import { same } from '../../shared/same'
import { tokenCount } from '../../shared/pricing'
import type { Orchestrator, OrchestratorDeps } from '../orchestrator'
import type { Run, serial } from '../store'
import { keepCached, transcriptTotals, transcriptUsage, weeklyUsage } from './usage'

type UsageApi = Pick<
  Orchestrator,
  'onLiveUsage' | 'liveUsage' | 'raiseCap' | 'usage' | 'usageByWeek'
>

/** Builds live usage, the token cap, and usage totals over the orchestrator's sessions and runs. */
export function createUsageTracking(ctx: {
  deps: Pick<OrchestratorDeps, 'events'>
  projects: () => Project[]
  sessions: () => SessionRecord[]
  runs: () => Run[]
  settingsDir: string
  capFile: (id: string) => string
  persist: () => Promise<void>
  changed: (projectId: string) => void
  subscribe: <T>(set: Set<T>, cb: T) => () => void
  projectById: (id: string) => Project
  sessionById: (id: string) => SessionRecord
  sync: (projectId: string) => Promise<string | null>
  notifyNeedsYou: (s: SessionRecord, project: Project, fresh: Promise<unknown>) => void
  setState: (s: SessionRecord, next: SessionState) => void
  activityFiles: Map<string, string>
  sessionFiles: (s: SessionRecord, found: Map<string, string>) => Promise<string[]>
  transcriptFiles: (
    mine: (x: { projectId: string; ticketKey?: string }) => boolean
  ) => Promise<string[]>
  reading: ReturnType<typeof serial>
}): UsageApi & { readLiveUsage: () => Promise<void> } {
  const { deps, settingsDir, capFile, persist, changed, subscribe, projectById, sessionById } = ctx
  const { sync, notifyNeedsYou, setState, activityFiles, sessionFiles, transcriptFiles } = ctx
  const { reading } = ctx
  const liveUsageListeners = new Set<(usage: Record<string, ModelUsage[]>) => void>()
  let liveUsage: Record<string, ModelUsage[]> = {}
  let scanning: Promise<UsageByWeek> | null = null

  const tokensOf = (usage: ModelUsage[]): number => usage.reduce((n, u) => n + tokenCount(u), 0)
  const checkCap = async (s: SessionRecord, used: number): Promise<void> => {
    const project = ctx.projects().find((p) => p.id === s.projectId)
    const cap = tokenCapOf(project, s)
    const over = !!cap && used >= cap
    if (!isLive(s) || over === !!s.capped) return
    if (project && over) {
      await mkdir(settingsDir, { recursive: true })
      await writeFile(capFile(s.id), '')
      s.capped = true
      const fresh = s.state === 'needsYou' && sync(s.projectId).catch(() => null)
      if (fresh) notifyNeedsYou(s, project, fresh)
      else if (isLive(s)) setState(s, 'needsYou')
    } else {
      await rm(capFile(s.id), { force: true })
      delete s.capped
    }
    void persist().catch(() => undefined)
    changed(s.projectId)
  }
  const readLiveUsage = async (): Promise<void> => {
    const next: Record<string, ModelUsage[]> = {}
    for (const s of ctx.sessions().filter(isLive)) {
      const usage = await sessionFiles(s, activityFiles)
        .then(transcriptUsage)
        .catch(() => null)
      if (!usage) continue
      next[s.id] = usage
      await checkCap(s, tokensOf(usage)).catch((err) =>
        console.error(`Sandtable could not check the token cap of session ${s.id}`, err)
      )
    }
    if (same(next, liveUsage)) return
    liveUsage = next
    liveUsageListeners.forEach((cb) => cb(next))
  }

  return {
    readLiveUsage,

    onLiveUsage: (cb: (usage: Record<string, ModelUsage[]>) => void) =>
      subscribe(liveUsageListeners, cb),
    liveUsage: (): Record<string, ModelUsage[]> => liveUsage,

    async raiseCap(sessionId: string): Promise<void> {
      const s = sessionById(sessionId)
      if (!s.capped) throw new Error('Session is not capped')
      const { tokenCap } = projectById(s.projectId)
      const used = tokensOf(await transcriptUsage(await sessionFiles(s, activityFiles)))
      if (tokenCap) s.tokenCap = used + tokenCap
      await rm(capFile(s.id), { force: true })
      delete s.capped
      await persist()
      changed(s.projectId)
    },

    usage: (projectId: string, ticketKey: string): Promise<TicketUsage> =>
      reading(async () => {
        projectById(projectId)
        const files = await transcriptFiles(
          (x) => x.projectId === projectId && x.ticketKey === ticketKey
        )
        return transcriptTotals(files)
      }),

    usageByWeek: (): Promise<UsageByWeek> =>
      (scanning ??= reading(async () => {
        const byProject: ProjectUsage[] = []
        const every = new Set<string>()
        for (const { id } of ctx.projects()) {
          const files = await transcriptFiles((x) => x.projectId === id)
          for (const f of files) every.add(f)
          const weeks = await weeklyUsage(files)
          if (weeks.length) byProject.push({ projectId: id, weeks })
        }
        const merged: MergedTicket[] = []
        const stamped = ctx
          .sessions()
          .filter(
            (s) => s.ticketKey && s.mergedAt && ctx.projects().some((p) => p.id === s.projectId)
          )
        for (const { ticketKey, mergedAt } of stamped) {
          if (merged.some((m) => m.ticketKey === ticketKey && m.mergedAt === mergedAt)) continue
          const mine = stamped.filter((x) => x.ticketKey === ticketKey && x.mergedAt === mergedAt)
          const projectIds = [...new Set(mine.map((x) => x.projectId))]
          const newest = !stamped.some((x) => x.ticketKey === ticketKey && x.mergedAt! > mergedAt!)
          let needsYou = 0
          for (const x of mine) needsYou += await deps.events.countNeedsYou(x.eventsFile)
          const files = await transcriptFiles(
            (x) =>
              mine.includes(x as SessionRecord) ||
              (newest &&
                ctx.runs().includes(x as Run) &&
                x.ticketKey === ticketKey &&
                projectIds.includes(x.projectId))
          )
          merged.push({
            projectIds,
            ticketKey: ticketKey!,
            startedAt: mine.map((x) => x.startedAt).sort()[0],
            mergedAt: mergedAt!,
            needsYou,
            usage: await transcriptUsage(files)
          })
        }
        const all = await weeklyUsage([...every])
        keepCached(every)
        return { all, projects: byProject, merged }
      }).finally(() => (scanning = null)))
  }
}

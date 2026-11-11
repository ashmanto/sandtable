import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type {
  Effort,
  Model,
  Project,
  ProjectRepo,
  Routine,
  RunTrigger,
  SessionRecord,
  SessionState,
  StartFailure,
  Ticket,
  TicketDraft
} from '../shared/types'
import { EFFORTS, MODELS } from '../shared/types'
import { sandboxDomains } from '../shared/sandbox'
import { branchName } from './git/branchName'
import { ownGitDir, worktreePath } from './git/worktree'
import { linearProjectIn, repoOf } from './tracker'
import { currentSession, isLive, sessionDir, sessionRepos, tooLong } from '../shared/sessions'
import { columnFor, statusMapOf } from '../shared/columns'
import {
  folderErrorRepo,
  isTrackerKey,
  parseTicketKey,
  serviceOf,
  ticketLabel
} from '../shared/repo'
import { instructionsFor } from '../shared/instructions'
import { shortTime } from '../shared/time'
import {
  claudeArgs,
  draftPrompt,
  agentSockets,
  hookSettings,
  sandboxSettings,
  STATUS_SCRIPT,
  GATE_SCRIPT,
  openingPrompt,
  sessionRules,
  fitBytes,
  MAX_NOTE_BYTES
} from './sessions/claudeLaunch'
import { hasStarted } from './sessions/hookEvents'
import type { createSetupRuns } from './sessions/setupRuns'
import { tmuxName } from './sessions/tmux'
import { SETUP_CANCELLED, SETUP_FAILED } from '../shared/worktreeSetup'
import { messageOf } from '../shared/errors'
import type { Orchestrator, OrchestratorDeps } from './orchestrator'
import type { SyncApi } from './sync'

const POLL_MS = 3_000
const SCHEDULE_MS = 30_000
const EARLY_EXIT_MS = 10_000
const START_EVENT_MS = 30_000
const NOT_STARTED =
  "Claude Code hasn't started. It's probably waiting for you to trust this folder: open the terminal to answer it."

/** Wraps a tick so a call while the last one still runs is skipped. */
export const unlessBusy = (tick: () => Promise<unknown>): (() => void) => {
  let busy = false
  return () => {
    if (busy) return
    busy = true
    void tick()
      .catch((err) => console.error(err))
      .finally(() => (busy = false))
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The message for work on a worktree that is being removed. */
export const REMOVING = 'Wait until the worktree is removed'

/** A ticket key's label, such as #147. */
export const labelOf = (ticketKey: string): string =>
  ticketLabel({
    key: ticketKey,
    number: isTrackerKey(ticketKey) ? 0 : parseTicketKey(ticketKey).number
  })

/** A ticket key's last path part. */
export const shortName = (ticketKey: string): string => ticketKey.split('/').pop() ?? ticketKey

const checkoutRepo = (repos: ProjectRepo[], s: SessionRecord): string =>
  (sessionRepos(repos, s)[0] ?? repos[0])?.github ?? ''

const fetchWarning = (github: string, fetchError?: string): string | undefined =>
  fetchError &&
  `Couldn't update ${github} from GitHub, so this branch starts from your local copy: ${fetchError}`

type SetupRuns = ReturnType<typeof createSetupRuns>

/** What the launch module reads from the orchestrator. */
export type LaunchContext = {
  deps: Pick<
    OrchestratorDeps,
    | 'dataDir'
    | 'claudeDir'
    | 'claudeDirSet'
    | 'remoteControl'
    | 'claude'
    | 'tmux'
    | 'events'
    | 'git'
  >
  now: () => Date
  sessions: () => SessionRecord[]
  routines: () => Routine[]
  startFailures: () => StartFailure[]
  setStartFailures: (failures: StartFailure[]) => void
  setupPending: () => string[]
  synced: Map<string, { tickets: Ticket[] }>
  starting: Map<string, [ticketKey: string, projectId: string]>
  startingSetups: Set<string>
  creating: Set<string>
  resuming: Set<string>
  missedConversations: Map<string, Set<string>>
  stoppers: (() => void)[]
  cliServer: ReturnType<NonNullable<OrchestratorDeps['cli']>> | undefined
  setupRuns: Pick<
    SetupRuns,
    | 'pend'
    | 'unpend'
    | 'skipSetups'
    | 'runSetups'
    | 'keep'
    | 'removeKept'
    | 'removeTree'
    | 'showSetup'
    | 'assertNoSetup'
    | 'setupProgress'
  >
  sync: Pick<SyncApi, 'writing' | 'moveTicket'>
  projectById: (id: string) => Project
  repoPathsOf: (s: SessionRecord) => string[]
  checkFolders: (repos: ProjectRepo[]) => Promise<void>
  sharesWorktree: (
    s: Pick<SessionRecord, 'worktrees'>,
    counts: (x: SessionRecord) => boolean
  ) => boolean
  syncedTicket: (projectId: string, ticketKey: string) => Ticket
  assertNoLiveSession: (projectId: string, ticketKey: string) => void
  assertFreeTmux: (name: string, self?: string) => void
  sameSource: (a: string, b: string) => boolean
  beingRemoved: (worktrees: string[]) => boolean
  ticketId: (projectId: string, ticketKey: string) => string
  persist: () => Promise<void>
  persistCache: () => void
  changed: (projectId: string) => void
  setState: (s: SessionRecord, next: SessionState, warning?: string) => void
  setAsking: (s: SessionRecord, asking: boolean) => void
  shownState: (s: SessionRecord, state: SessionState) => SessionState
  lastStateOf: (s: SessionRecord) => Promise<SessionState | null>
  conversationFiles: (s: SessionRecord) => Promise<{ id: string; file: string }[]>
  syncGate: (s: SessionRecord) => Promise<void>
  runSchedules: () => Promise<void>
  readActivities: () => Promise<void>
  readLiveUsage: () => Promise<void>
  liveTick: () => Promise<void>
}

/** Session launches, relaunches, the start flow, and the tmux poll. */
export type LaunchApi = Pick<Orchestrator, 'create'> & {
  startFor(startedBy: string | undefined, ...args: Parameters<Orchestrator['start']>): Promise<void>
  relaunch(s: SessionRecord, dir: string): Promise<void>
  folderOf(s: SessionRecord): string
  goneError(s: SessionRecord): Error
  createSession(
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
      model?: Model | null
      effort?: Effort | null
      setupId?: string
      setup?: false
    }
  ): Promise<string>
  startPollingTmux(): () => void
  pollTmux(): Promise<void>
  pollingTmux(): boolean
  startBy: Map<string, number>
  startedSince(s: SessionRecord): Promise<boolean>
  notStarted(s: SessionRecord): boolean
  assertModel(m: unknown): void
  assertEffort(e: unknown): void
  settingsDir: string
  eventsDir: string
  gateScript: string
  draftsDir: string
  capFile(id: string): string
  gateFile(id: string): string
  statusFile(id: string): string
  imagesDir(id: string): string
  notesFile(id: string): string
  treesOf(worktrees: string[], repoPaths: string[]): Promise<[string, string][]>
}

/** Builds the launch module, which owns the launch counts, start deadlines, and the tmux poll. */
export function createLaunch(ctx: LaunchContext): LaunchApi {
  const {
    deps,
    now,
    synced,
    starting,
    startingSetups,
    creating,
    resuming,
    missedConversations,
    stoppers,
    cliServer,
    projectById,
    repoPathsOf,
    checkFolders,
    sharesWorktree,
    syncedTicket,
    assertNoLiveSession,
    assertFreeTmux,
    sameSource,
    beingRemoved,
    ticketId,
    persist,
    persistCache,
    changed,
    setState,
    setAsking,
    shownState,
    lastStateOf,
    conversationFiles,
    syncGate,
    runSchedules,
    readActivities,
    readLiveUsage,
    liveTick
  } = ctx
  const {
    pend,
    unpend,
    skipSetups,
    runSetups,
    keep,
    removeKept,
    removeTree,
    showSetup,
    assertNoSetup,
    setupProgress
  } = ctx.setupRuns
  const { writing, moveTicket } = ctx.sync
  const settingsDir = join(deps.dataDir, 'settings')
  const eventsDir = join(deps.dataDir, 'events')
  const statusScript = join(deps.dataDir, 'statusline.sh')
  const gateScript = join(deps.dataDir, 'gate.sh')
  const gateFile = (id: string): string => join(settingsDir, `${id}.gate`)
  const treesOf = (worktrees: string[], repoPaths: string[]): Promise<[string, string][]> =>
    Promise.all(worktrees.map(async (w) => [(await ownGitDir(w, repoPaths)) ?? '', w]))
  const statusFile = (id: string): string => join(deps.dataDir, 'status', `${id}.json`)
  const imagesDir = (id: string): string => join(deps.dataDir, 'images', id)
  const notesFile = (id: string): string => join(deps.dataDir, 'notes', `${id}.md`)
  const draftsDir = join(deps.dataDir, 'drafts')
  const remoteControlOf = (p: Project): boolean => p.remoteControl ?? deps.remoteControl()
  const npmCache = join(homedir(), 'Library', 'Caches', 'Sandtable', 'npm')
  const sandboxOf = (p: Project): string[] | undefined =>
    p.sandbox ? sandboxDomains(p) : undefined
  const assertModel = (m: unknown): void => {
    if (m !== undefined && !MODELS.includes(m as Model)) throw new Error('Not a model')
  }
  const assertSetupChoice = (setup: unknown): void => {
    if (setup !== undefined && setup !== false) throw new Error('Not a setup choice')
  }
  const modelOf = (p: Project, choice: Model | null | undefined): Model | undefined => {
    const model = choice === undefined ? p.model : (choice ?? undefined)
    assertModel(model)
    return model
  }
  const assertEffort = (e: unknown): void => {
    if (e !== undefined && !EFFORTS.includes(e as Effort)) throw new Error('Not an effort')
  }
  const effortOf = (p: Project, choice: Effort | null | undefined): Effort | undefined => {
    const effort = choice === undefined ? p.effort : (choice ?? undefined)
    assertEffort(effort)
    return effort
  }
  const launches = new Map<string, number>()
  const launchedAt = new Map<string, number>()
  const startBy = new Map<string, number>()
  const startFrom = new Map<string, number>()
  const startedSince = (s: SessionRecord): Promise<boolean> =>
    hasStarted(s.eventsFile, startFrom.get(s.id))
  const notStarted = (s: SessionRecord): boolean => !!s.startWarning?.endsWith(NOT_STARTED)
  const launch = async (
    id: string,
    tmux: string,
    cwd: string,
    rules: Parameters<typeof sessionRules>[0],
    opts: Omit<Parameters<typeof claudeArgs>[0], 'settingsFile' | 'rules'> & {
      allow?: string[]
      sandbox?: string[]
      repoPaths?: string[]
    },
    dir: string = deps.claudeDir
  ): Promise<string> => {
    const eventsFile = join(eventsDir, `${id}.jsonl`)
    const settingsFile = join(settingsDir, `${id}.json`)
    const cliSocket =
      rules.ticket !== undefined ? await cliServer?.open(id).catch(() => undefined) : undefined
    try {
      return await launchWith(id, tmux, cwd, rules, opts, dir, eventsFile, settingsFile, cliSocket)
    } catch (err) {
      if (cliSocket) await cliServer?.close(id)
      throw err
    }
  }
  const launchWith = async (
    id: string,
    tmux: string,
    cwd: string,
    rules: Parameters<typeof sessionRules>[0],
    opts: Parameters<typeof launch>[4],
    dir: string,
    eventsFile: string,
    settingsFile: string,
    cliSocket: string | undefined
  ): Promise<string> => {
    await mkdir(eventsDir, { recursive: true })
    await mkdir(settingsDir, { recursive: true })
    await mkdir(join(deps.dataDir, 'status'), { recursive: true })
    for (const [file, text] of [
      [statusScript, STATUS_SCRIPT],
      [gateScript, GATE_SCRIPT]
    ]) {
      const temp = `${file}.${randomUUID()}`
      await writeFile(temp, text)
      await rename(temp, file)
    }
    await writeFile(
      settingsFile,
      JSON.stringify(
        hookSettings(
          eventsFile,
          capFile(id),
          statusFile(id),
          statusScript,
          [
            ...(opts.allow ?? []),
            ...(cliSocket ? ['Bash(sandtable:*)'] : []),
            `Read(/${imagesDir(id)}/**)`,
            `Read(/${notesFile(id)})`,
            `Edit(/${notesFile(id)})`
          ],
          opts.sandbox &&
            sandboxSettings(
              opts.sandbox,
              deps.dataDir,
              [...agentSockets(), ...(cliSocket ? [cliSocket] : [])],
              npmCache
            ),
          rules.ticket !== undefined && rules.worktree
            ? {
                script: gateScript,
                file: gateFile(id),
                trees: await treesOf([cwd, ...opts.addDirs], opts.repoPaths ?? [])
              }
            : undefined
        )
      )
    )
    const args = claudeArgs({
      ...opts,
      settingsFile,
      rules: sessionRules({ ...rules, cli: !!cliSocket })
    })
    const inherit = dir === deps.claudeDir && !deps.claudeDirSet
    startFrom.set(id, (await stat(eventsFile).catch(() => null))?.size ?? 0)
    await deps.tmux.startTmux(
      tmux,
      cwd,
      [...(inherit ? ['/usr/bin/env', '-u', 'CLAUDE_CONFIG_DIR'] : []), deps.claude.bin, ...args],
      inherit && !cliSocket
        ? undefined
        : {
            ...(!inherit && { CLAUDE_CONFIG_DIR: dir }),
            ...(cliSocket && {
              SANDTABLE_SOCKET: cliSocket,
              PATH: `${dirname(cliSocket)}:${(await deps.tmux.globalPath().catch(() => undefined)) ?? process.env.PATH ?? ''}`
            })
          },
      deps.dataDir
    )
    startBy.set(id, now().getTime() + START_EVENT_MS)
    return eventsFile
  }
  const launchNew = async (
    project: Project,
    id: string,
    tmux: string,
    cwd: string,
    rules: Parameters<typeof sessionRules>[0],
    opts: Omit<Parameters<typeof launch>[4], 'remoteControl' | 'model' | 'effort' | 'sandbox'>,
    choice: { model?: Model | null; effort?: Effort | null },
    sandboxed: boolean
  ): Promise<
    Pick<
      SessionRecord,
      'eventsFile' | 'remoteControl' | 'claudeDir' | 'model' | 'effort' | 'sandbox'
    >
  > => {
    const model = modelOf(project, choice.model)
    const effort = effortOf(project, choice.effort)
    const remoteControl = remoteControlOf(project)
    const sandbox = sandboxed ? sandboxOf(project) : undefined
    const eventsFile = await launch(
      id,
      tmux,
      cwd,
      rules,
      {
        ...opts,
        remoteControl,
        model,
        effort,
        sandbox,
        repoPaths: project.repos.map((r) => r.path)
      },
      project.claudeDir
    )
    launchedAt.set(id, now().getTime())
    return {
      eventsFile,
      remoteControl,
      claudeDir: project.claudeDir,
      ...(model && { model }),
      ...(effort && { effort }),
      ...(sandbox && { sandbox: { allowedDomains: sandbox } })
    }
  }
  const goneError = (s: SessionRecord): Error =>
    new Error(
      !s.ticketKey
        ? "The session's folder is gone. Remove it from the list."
        : s.removedAt
          ? 'The worktree was removed; use Start'
          : 'The worktree is gone; use Remove worktree, then Start'
    )
  const folderOf = (s: SessionRecord): string => {
    const dir = sessionDir(s)
    if (s.removedAt || !dir || !existsSync(dir)) throw goneError(s)
    return dir
  }
  const relaunch = async (s: SessionRecord, dir: string): Promise<void> => {
    try {
      launches.set(s.id, (launches.get(s.id) ?? 0) + 1)
      launchedAt.set(s.id, now().getTime())
      delete s.startWarning
      assertModel(s.model)
      assertEffort(s.effort)
      const project = projectById(s.projectId)
      const conversationId = (await conversationFiles(s)).pop()?.id ?? s.id
      const sandbox = s.routineId ? undefined : sandboxOf(project)
      const ticket =
        s.ticketKey && !isTrackerKey(s.ticketKey) ? parseTicketKey(s.ticketKey) : undefined
      await launch(
        s.id,
        s.tmuxName,
        dir,
        {
          repo: ticket?.repo ?? checkoutRepo(project.repos, s),
          ticket: s.ticketKey && labelOf(s.ticketKey),
          worktree: s.worktrees.length > 0,
          routine: !!s.routineId,
          board: project.board,
          linear: project.linear,
          jira: project.jira,
          yours: s.ticketKey
            ? instructionsFor(
                project,
                synced.get(s.projectId)?.tickets.find((t) => t.key === s.ticketKey)?.labels ?? []
              )
            : undefined
        },
        {
          sessionId: conversationId,
          name: s.name ?? shortName(s.ticketKey ?? ''),
          addDirs: s.worktrees.slice(1),
          resume: true,
          remoteControl: s.remoteControl,
          model: s.model,
          effort: s.effort,
          allow: s.trigger ? undefined : ctx.routines().find((r) => r.id === s.routineId)?.allow,
          sandbox,
          repoPaths: repoPathsOf(s)
        },
        s.claudeDir
      )
      if (sandbox) s.sandbox = { allowedDomains: sandbox }
      else delete s.sandbox
      await syncGate(s)
    } finally {
      resuming.delete(s.id)
    }
    missedConversations.delete(s.id)
    setAsking(s, false)
    s.state = shownState(s, 'needsYou')
    await persist()
    changed(s.projectId)
  }

  const createSession: LaunchApi['createSession'] = async (picked, github, worktree, opts) => {
    modelOf(picked, opts.model)
    effortOf(picked, opts.effort)
    const repo = repoOf(picked, github)
    await checkFolders([repo])
    const id = randomUUID()
    const target = opts.setupId ?? id
    assertNoSetup(target)
    const branch = worktree ? `session-${target.slice(0, 8)}` : undefined
    const made = branch ? await deps.git.ensureWorktree(repo.path, branch) : undefined
    if (opts.setupId && made && sharesWorktree({ worktrees: [made.path] }, (x) => !x.removedAt))
      throw new Error(`Another session uses ${branch}`)
    const leftover = !!made && (made.created || ctx.setupPending().includes(made.path))
    if (made) await pend(repo, made)
    if (made && opts.setup === false) skipSetups(target)
    else if (made)
      await runSetups(target, [{ repo, worktree: made.path, created: made.created }]).catch(
        async (err: unknown) => {
          const cancelled = err instanceof Error && err.message === SETUP_CANCELLED
          if (opts.setupId && !cancelled) {
            keep(target, made.path, repo.path)
            throw err
          }
          await removeKept(made.path, repo.path)
          if (opts.setupId) throw err
          const lines = setupProgress(target)?.lines.slice(-5) ?? []
          showSetup(target, null)
          throw new Error([messageOf(err), ...lines].join('\n'))
        }
      )
    const tmux = tmuxName(picked.id, `session-${id}`)
    try {
      const project = projectById(picked.id)
      const { board, linear, jira } = project
      const startedAt = now().toISOString()
      const name = opts.name(startedAt)
      creating.add(tmux)
      const launched = await launchNew(
        project,
        id,
        tmux,
        made?.path ?? repo.path,
        { repo: repo.github, worktree, routine: !!opts.routineId, board, linear, jira },
        {
          sessionId: id,
          name,
          addDirs: [],
          allow: opts.allow,
          ...(opts.prompt !== undefined && { prompt: opts.prompt })
        },
        { model: opts.model, effort: opts.effort },
        !opts.routineId
      ).finally(() => creating.delete(tmux))
      ctx.sessions().push({
        id,
        projectId: project.id,
        name,
        tmuxName: tmux,
        ...(made ? { branch, worktrees: [made.path] } : { worktrees: [], checkout: repo.path }),
        ...launched,
        startedAt,
        ...(opts.prompt === undefined ? { state: 'idle', unprompted: true } : { state: 'running' }),
        startWarning: fetchWarning(repo.github, made?.fetchError),
        ...(opts.routineId && { routineId: opts.routineId }),
        ...(opts.scheduled && { scheduled: true as const }),
        ...(opts.trigger && { trigger: opts.trigger })
      })
    } catch (err) {
      if (made && leftover) await removeTree(made.path, [repo.path]).catch(() => undefined)
      throw err
    }
    if (made && opts.setup === false) await unpend([made.path])
    await persist()
    changed(picked.id)
    return id
  }

  const pollTmux = async (): Promise<void> => {
    const launched = new Map(launches)
    const watched = ctx.sessions().filter(isLive)
    const names = new Set((await deps.tmux.listTmux()).map((t) => t.name))
    for (const s of watched)
      if (
        isLive(s) &&
        !names.has(s.tmuxName) &&
        (await deps.tmux.hasTmux(s.tmuxName).catch(() => null)) === false &&
        launches.get(s.id) === launched.get(s.id)
      )
        setState(
          s,
          'finished',
          now().getTime() - (launchedAt.get(s.id) ?? -Infinity) < EARLY_EXIT_MS
            ? "Claude exited right after it started. Run claude in the session's folder to see why."
            : undefined
        )
    await checkStarts()
  }
  const checkStarts = async (): Promise<void> => {
    for (const [id, by] of startBy) {
      const s = ctx.sessions().find((x) => x.id === id)
      if (!s || !isLive(s)) startBy.delete(id)
      else if (notStarted(s) && (await startedSince(s))) {
        startBy.delete(id)
        if (!isLive(s)) continue
        const earlier = s.startWarning!.slice(0, -NOT_STARTED.length).trimEnd()
        if (earlier) s.startWarning = earlier
        else delete s.startWarning
        setAsking(s, await deps.events.readAsking(s.eventsFile))
        setState(s, (await lastStateOf(s)) ?? (s.unprompted ? 'idle' : 'running'))
        void persist().catch(() => undefined)
        changed(s.projectId)
      } else if (by <= now().getTime() && !notStarted(s)) {
        if (await startedSince(s)) startBy.delete(id)
        else if (isLive(s)) {
          s.startWarning = s.startWarning ? `${s.startWarning} ${NOT_STARTED}` : NOT_STARTED
          setAsking(s, true)
          setState(s, 'needsYou')
          void persist().catch(() => undefined)
          changed(s.projectId)
        }
      }
    }
  }
  const capFile = (id: string): string => join(settingsDir, `${id}.capped`)
  let pollingTmux = false
  const startPollingTmux = (): (() => void) => {
    pollingTmux = true
    const schedule = unlessBusy(runSchedules)
    const poll = unlessBusy(pollTmux)
    const watchLive = unlessBusy(liveTick)
    const readSteps = unlessBusy(async () => {
      await readActivities()
      await readLiveUsage()
    })
    const timers = [
      setInterval(() => {
        poll()
        readSteps()
        watchLive()
      }, POLL_MS),
      setInterval(schedule, SCHEDULE_MS)
    ]
    stoppers.push(() => timers.forEach(clearInterval))
    return schedule
  }

  return {
    relaunch,
    folderOf,
    goneError,
    createSession,
    startPollingTmux,
    pollTmux,
    pollingTmux: () => pollingTmux,
    startBy,
    startedSince,
    notStarted,
    assertModel,
    assertEffort,
    settingsDir,
    eventsDir,
    gateScript,
    draftsDir,
    capFile,
    gateFile,
    statusFile,
    imagesDir,
    notesFile,
    treesOf,

    async startFor(
      startedBy: string | undefined,
      projectId: string,
      ticketKey: string,
      extraRepos: string[] = [],
      mainRepo?: string,
      note?: string,
      choice?: Model | null,
      setup?: false,
      plan?: true
    ): Promise<void> {
      if (note !== undefined && typeof note !== 'string') throw new Error('Not a note')
      assertSetupChoice(setup)
      if (plan !== undefined && plan !== true) throw new Error('Not a plan choice')
      let project = projectById(projectId)
      modelOf(project, choice)
      const ticket = syncedTicket(projectId, ticketKey)
      if (columnFor(ticket.status, statusMapOf(project)) === 'done')
        throw new Error("This ticket is done, so it can't start")
      assertNoLiveSession(projectId, ticketKey)
      assertFreeTmux(tmuxName(projectId, ticketKey))
      starting.set(ticketId(projectId, ticketKey), [ticketKey, projectId])
      const target = `${projectId}\n${ticketKey}`
      let picked = false
      let launched = false
      try {
        if (!ticket.repo && !mainRepo) throw new Error('Choose the repo for this ticket')
        const main = repoOf(project, mainRepo || ticket.repo)
        const extras = extraRepos.map((r) => repoOf(project, r))
        if (extras.includes(main)) throw new Error('Extra repo is the main repo')
        const repos = [...new Set([main, ...extras])]
        picked = true
        ctx.setStartFailures(
          ctx.startFailures().filter((f) => f.projectId !== projectId || f.ticketKey !== ticketKey)
        )
        const mine = ctx.sessions().filter((s) => s.projectId === projectId)
        const branch =
          currentSession(mine, ticketKey)?.branch ??
          branchName(
            isTrackerKey(ticketKey) ? ticketKey.toLowerCase() : ticket.number,
            ticket.title
          )
        if (
          beingRemoved([
            ...repos.map((r) => worktreePath(r.path, branch)),
            ...mine.filter((s) => s.ticketKey === ticketKey).flatMap((s) => s.worktrees)
          ])
        )
          throw new Error(REMOVING)
        await checkFolders(repos)
        const settled = await Promise.allSettled(
          repos.map(async (r) => {
            const m = await deps.git.ensureWorktree(r.path, branch)
            await pend(r, m)
            return m
          })
        )
        const made = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
        const repoPaths = repos.map((r) => r.path)
        const removeCreated = async (): Promise<void> => {
          for (const m of made.filter((m) => m.created))
            await removeTree(m.path, repoPaths).catch(() => undefined)
        }
        const failed = settled.find((r) => r.status === 'rejected')
        if (failed) {
          await removeCreated()
          throw failed.reason
        }
        if (
          made.some((m) =>
            sharesWorktree(
              { worktrees: [m.path] },
              (x) =>
                !x.removedAt && (x.ticketKey !== ticketKey || !sameSource(projectId, x.projectId))
            )
          )
        ) {
          await removeCreated()
          throw new Error(`Another ticket's session uses ${branch}`)
        }
        const worktrees = made.map((m) => m.path)
        if (setup === false) skipSetups(target)
        else
          await runSetups(
            target,
            made.map((m, i) => ({ repo: repos[i], worktree: m.path, created: m.created }))
          )
        const id = randomUUID()
        const name = tmuxName(projectId, ticketKey)
        try {
          project = projectById(projectId)
          const warning = made
            .map((m, i) => fetchWarning(repos[i].github, m.fetchError))
            .filter(Boolean)
            .join(' ')
          const fields = await launchNew(
            project,
            id,
            name,
            worktrees[0],
            {
              repo: main.github,
              ticket: ticketLabel(ticket),
              worktree: true,
              board: project.board,
              linear: project.linear,
              jira: project.jira,
              yours: instructionsFor(project, ticket.labels)
            },
            {
              sessionId: id,
              name: shortName(ticketKey),
              addDirs: worktrees.slice(1),
              prompt: openingPrompt(ticket, serviceOf(project), note),
              ...(plan && { permissionMode: 'plan' as const })
            },
            { model: choice },
            true
          )
          ctx.sessions().push({
            id,
            projectId,
            ticketKey,
            tmuxName: name,
            branch,
            worktrees,
            ...fields,
            startedAt: now().toISOString(),
            state: 'running',
            startWarning: warning || undefined,
            ...(note?.trim() && { note: fitBytes(note.trim(), MAX_NOTE_BYTES) }),
            ...(startedBy && { startedBy })
          })
        } catch (err) {
          await removeCreated()
          throw err
        }
        launched = true
        await syncGate(ctx.sessions().at(-1)!)
        if (setup === false) await unpend(worktrees)
        ticket.repo = main.github
        const fresh = synced.get(projectId)?.tickets.find((t) => t.key === ticketKey)
        if (fresh) fresh.repo = main.github
        persistCache()
        await persist()
        changed(projectId)

        await writing(projectId, ticketKey)
        const latest = synced.get(projectId)?.tickets.find((t) => t.key === ticketKey)
        if (latest && columnFor(latest.status, statusMapOf(project)) === 'done') return
        await moveTicket(
          project,
          ticketKey,
          'inProgress',
          () => "Started, but couldn't set In Progress",
          false
        ).catch(() => undefined)
      } catch (err) {
        const reason = messageOf(err)
        if (launched || !picked) throw err
        if (!reason.startsWith(SETUP_CANCELLED)) {
          const lines = reason.startsWith(SETUP_FAILED) ? setupProgress(target)?.lines : []
          ctx.startFailures().push({
            projectId,
            ticketKey,
            at: now().toISOString(),
            reason,
            repo: folderErrorRepo(reason),
            ...(lines?.length && { lines })
          })
        }
        void persist().catch(() => undefined)
        changed(projectId)
        throw err
      } finally {
        starting.delete(ticketId(projectId, ticketKey))
      }
    },

    async create(
      projectId: string,
      github: string,
      worktree: boolean,
      draft?: TicketDraft,
      firstMessage?: string,
      model?: Model | null,
      setupId?: string,
      setup?: false,
      effort?: Effort | null
    ): Promise<string> {
      if (firstMessage && tooLong(firstMessage)) throw new Error('Shorten the first message')
      if (setupId !== undefined && (typeof setupId !== 'string' || !UUID.test(setupId)))
        throw new Error('Not a setup ID')
      assertSetupChoice(setup)
      const project = projectById(projectId)
      const { linear, jira } = project
      const linearProject = draft && linear && linearProjectIn(linear, draft.linearProject)
      const repo = repoOf(project, github)
      if (setupId && startingSetups.has(setupId)) throw new Error('The session is already starting')
      if (setupId) startingSetups.add(setupId)
      try {
        return await createSession(project, repo.github, worktree && !draft, {
          name: (startedAt) => (draft ? 'New ticket' : shortTime(startedAt)),
          prompt: draft
            ? draftPrompt(
                linear ? { linear, projectId: linearProject } : jira ? { jira } : repo.github,
                draft
              )
            : firstMessage?.trim() || undefined,
          model,
          effort,
          setupId,
          setup
        })
      } finally {
        if (setupId) startingSetups.delete(setupId)
      }
    }
  }
}

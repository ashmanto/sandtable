import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { appendFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { basename, dirname, join } from 'node:path'
import type { BoardView, SidebarSession } from '../shared/api'
import type { BackgroundTask, SessionStatus } from '../shared/sessionStatus'
import type {
  Account,
  Activity,
  BoardColumn,
  BoardSource,
  Chat,
  ChatState,
  ConversationChunk,
  ConversationEntry,
  Finding,
  FindingPatch,
  FindingsState,
  NewFinding,
  ComposerDraft,
  PullRequestState,
  LaneChange,
  LastView,
  Leftover,
  JiraAccount,
  LinearTeam,
  LinearWorkspace,
  Effort,
  Model,
  ModelUsage,
  UsageByWeek,
  Overlap,
  Project,
  ProjectGroup,
  ProjectRepo,
  RemoveResult,
  RepoChanges,
  Routine,
  RoutineChatReply,
  RoutineChatTurn,
  RoutineInput,
  RoutineRun,
  SessionCommand,
  SessionRecord,
  SessionState,
  SessionStop,
  SetupProgress,
  SetupSuggestion,
  Step,
  SkippedRun,
  StartFailure,
  StartCheck,
  Ticket,
  TicketDetails,
  TicketDraft,
  TicketUsage,
  Triage
} from '../shared/types'
import type { PromptAnswer, SessionPrompt } from '../shared/prompt'
import { appName, isApp } from '../shared/editors'
import { createCliServer, type CliHandler } from './sessions/cli'
import { WT_SUFFIX } from './git/worktree'
import type { AreasClient } from './github/areas'
import { boardError, type BoardClient } from './github/board'
import type { RepoIssuesClient } from './github/repoIssues'
import type { LinearClient } from './linear/client'
import type { JiraClient } from './jira/client'
import type { JiraCredentials } from './jira/credentials'
import type { MergedPr } from './github/merged'
import { repoOf, trackerOf, type Tracker } from './tracker'
import { parseBoardUrl } from '../shared/boardUrl'
import { APPLIED_BUT, AREA_PREFIX, areaOf, overlapCandidates, startProblems } from '../shared/areas'
import { sections } from '../shared/projectGroups'
import { isDoneOpen, isLive, listedSessions, sessionDir } from '../shared/sessions'
import { compactText, prepareText } from '../shared/compact'
import { sessionDraft } from '../shared/drafts'
import { IMAGE_TYPES, imageProblem, withImages } from '../shared/images'
import { columnFor, REPO_STATUS, statusMapOf } from '../shared/columns'
import {
  CREATED,
  findRepo,
  folderError,
  sameRepo,
  serviceOf,
  sameTicketSource,
  ticketLabel,
  ticketSource
} from '../shared/repo'
import { DEFAULT_KEEP_DONE_DAYS, daysBefore, visibleTickets } from '../shared/visibleTickets'
import { oneLine, withoutUnsafe, schemaArgs } from './sessions/claudeLaunch'
import { readActivity, readStop, type Stopped } from './sessions/activity'
import { findConversation, parseConversation, readLastEntries } from './sessions/conversation'
import { commandsOf } from './sessions/commands'
import {
  answerKeys,
  choicesOf,
  pendingPrompt,
  suggestionOf,
  untouched,
  type Key
} from './sessions/prompt'
import {
  ANSWERED_EVENT,
  conversationIds,
  IDLE_EVENT,
  readAgentRequests,
  STOPPED_EVENT
} from './sessions/hookEvents'
import { OVERLAP_SCHEMA, overlapPrompt, parseOverlap } from './sessions/overlap'
import { parseReadiness, READINESS_QUESTION, READINESS_SCHEMA } from './sessions/readiness'
import { chatPrompt, type PrintRun } from './sessions/chat'
import { createRoutineChat } from './sessions/routineChat'
import { parseTriage, TRIAGE_SCHEMA, triagePrompt, usableArea } from './sessions/triage'
import { createLiveView } from './sessions/liveView'
import { createReviewLoop } from './sessions/reviewLoop'
import { createSetupRuns } from './sessions/setupRuns'
import { couldntStartByProject } from './couldntStart'
import { createRoutines } from './sessions/routines'
import { createUsageTracking } from './sessions/usageTracking'
import { createJiraSignIn } from './sessions/jiraSignIn'
import { createLeftovers } from './sessions/leftovers'
import { createCliCommands } from './sessions/cliCommands'
import { createTicketChat } from './sessions/ticketChat'
import { createSync, type Synced } from './sync'
import { createProjects } from './projects'
import { createLaunch, labelOf, REMOVING, shortName, unlessBusy } from './launch'
import { tmuxName, typeIntoTmux } from './sessions/tmux'
import { accountEnv, stopChildren } from './env/tools'
import { copyPaths, ignoredProblem, runSetup, stopSetups, suggestSetup } from './env/worktreeSetup'
import { draftFile } from './drafts'
import { serial, type Run, type Store } from './store'
import type { SyncCache, SyncCacheStore } from './syncCache'
import { messageOf } from '../shared/errors'

const SYNC_MS = 60_000
const NOTIFY_WAIT_MS = 10_000
const STOP_READS = 4
const STOP_RETRY_MS = 500

const DATA_URL = /^data:([\w/+.-]+);base64,/
const typeOf = (bytes: Buffer): string => {
  const head = bytes.subarray(0, 12).toString('latin1')
  if (head.startsWith('\x89PNG\r\n\x1a\n')) return 'image/png'
  if (head.startsWith('\xff\xd8\xff')) return 'image/jpeg'
  if (head.startsWith('GIF8')) return 'image/gif'
  return head.startsWith('RIFF') && head.endsWith('WEBP') ? 'image/webp' : ''
}
const imageOf = (url: string): { ext: string; bytes: Buffer } => {
  const head = DATA_URL.exec(url)
  const bytes = Buffer.from(head ? url.slice(head[0].length) : '', 'base64')
  const type = typeOf(bytes)
  const problem = imageProblem(head?.[1] ?? '', bytes.length) ?? imageProblem(type, bytes.length)
  if (problem) throw new Error(problem)
  return { ext: IMAGE_TYPES[type], bytes }
}

async function transcriptsIn(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const nested = await Promise.all(
    entries.map((e) =>
      e.isDirectory()
        ? transcriptsIn(join(dir, e.name))
        : e.isFile() && e.name.endsWith('.jsonl')
          ? [join(dir, e.name)]
          : []
    )
  )
  return nested.flat()
}

export type OrchestratorDeps = {
  cli?: (handle: CliHandler) => ReturnType<typeof createCliServer>
  store: Store
  cache: SyncCacheStore
  board: BoardClient
  repoIssues: RepoIssuesClient
  areas: AreasClient
  linear(workspace?: string): LinearClient
  linearWorkspaces(): Promise<LinearWorkspace[]>
  jira(site: string): JiraClient
  jiraCredentials: Pick<JiraCredentials, 'save' | 'sites'>
  jiraClientWith(site: string, email: string, token: string): JiraClient
  mergedPullRequests(
    repo: string,
    since: string,
    truncated?: (message: string) => void
  ): Promise<MergedPr[]>
  githubStamp(board: BoardSource | undefined, repos: string[]): Promise<string>
  ticketDetails(repo: string, number: number): Promise<TicketDetails>
  postComment(repo: string, number: number, body: string): Promise<void>
  githubViewer(): Promise<string>
  githubReposOf(path: string): Promise<string[]>
  pullRequests(repo: string, branch: string): Promise<PullRequestState[]>
  fingerprint(script: string, trees: [string, string][]): Promise<string>
  failedLog(repo: string, jobId: number): Promise<string>
  /** Opens a folder in Finder, or in the app; resolves to an error message, or '' when it opened. */
  openFolder(folder: string, app?: string): Promise<string>
  git: {
    ensureWorktree(
      repoPath: string,
      branch: string
    ): Promise<{ path: string; created: boolean; fetchError?: string }>
    removeWorktree(path: string, repoPaths: string[]): Promise<RemoveResult>
    checkRemovable(
      path: string,
      repoPaths: string[]
    ): Promise<{ removable: true; repoPath: string } | { removed: false; reason: string }>
    changes(worktree: string, repoPaths: string[]): Promise<Omit<RepoChanges, 'worktree'>>
  }
  setup: {
    problem: typeof ignoredProblem
    copy: typeof copyPaths
    run: typeof runSetup
    suggest: typeof suggestSetup
  }
  tmux: {
    startTmux(
      name: string,
      cwd: string,
      command: string[],
      env?: Record<string, string>,
      owner?: string
    ): Promise<void>
    globalPath(): Promise<string | undefined>
    hasTmux(name: string): Promise<boolean>
    listTmux(): Promise<{ name: string; owner: string }[]>
    killTmux(name: string): Promise<void>
    pasteTmux(name: string, text: string): Promise<void>
    enterTmux(name: string): Promise<void>
    escapeTmux(name: string): Promise<void>
    keysTmux(name: string, keys: Key[]): Promise<void>
    captureTmux(name: string, colors?: boolean): Promise<string>
  }
  claude: {
    bin: string
    print(
      cwd: string,
      args: string[],
      env?: Record<string, string>,
      timeoutMs?: number,
      live?: { signal?: AbortSignal; onStdout?: (chunk: string) => void; input?: string }
    ): Promise<{ stdout: string; stderr: string; code: number }>
  }
  events: {
    watchEvents(
      dir: string,
      onChange: (sessionId: string, state: SessionState | null, asking: boolean) => void,
      ids: { seed: string[]; live: () => string[] }
    ): () => void
    readLastState(file: string): Promise<SessionState | null>
    readAsking(file: string): Promise<boolean>
    readBackground(file: string): Promise<BackgroundTask[]>
    countNeedsYou(file: string): Promise<number>
  }
  notify: (title: string, body: string, onClick: () => void) => void
  draft: (key: string) => Promise<ComposerDraft | null>
  remoteControl(): boolean
  dataDir: string
  claudeDir: string
  claudeDirSet: boolean
  now?: () => Date
}

/** The main-process operations behind `window.sandtable`. */
export type Orchestrator = {
  reconnect(tmuxAvailable?: boolean): Promise<void>
  watchTmux(): Promise<void>
  stop(): void
  flush(): Promise<void>
  anyRunning(): boolean
  needsYouCount(): number
  /** Opens the waiting sidebar session after `current`, or the first one, on its tab. */
  openNextNeedsYou(current: LastView | null): void
  onChange(cb: (projectId: string) => void): () => void
  onOpen(cb: (view: LastView) => void): () => void
  onActivity(cb: (sessionId: string, activity: Activity) => void): () => void
  /** Each status-line update, with the account the session runs as, named '' when it's no longer added. */
  onStatus(cb: (sessionId: string, status: SessionStatus, account: Account) => void): () => void
  onConversation(cb: (sessionId: string, chunk: ConversationChunk) => void): () => void
  status(sessionId: string): Promise<SessionStatus | null>
  watchConversation(sessionId: string): Promise<ConversationChunk>
  unwatchConversation(sessionId: string): Promise<void>
  /** Closes every conversation watch, for when the renderer that held them is gone. */
  unwatchAll(): void
  activity(sessionId: string): Activity | null
  onLiveUsage(cb: (usage: Record<string, ModelUsage[]>) => void): () => void
  liveUsage(): Record<string, ModelUsage[]>
  raiseCap(sessionId: string): Promise<void>
  listProjects(): Promise<Project[]>
  saveProject(p: Project): Promise<void>
  /** Sets only the project's editor app on its saved copy, without a sync. */
  setEditor(projectId: string, app: string): Promise<void>
  listGroups(): Promise<ProjectGroup[]>
  arrangeProjects(groups: ProjectGroup[], order: { id: string; group?: string }[]): Promise<void>
  removeProject(id: string): Promise<void>
  listAccounts(): Promise<Account[]>
  addAccount(a: Account): Promise<void>
  removeAccount(dir: string): Promise<void>
  usedAccounts(): Account[]
  linearTeams(workspace?: string): Promise<LinearTeam[]>
  linearWorkspaces(): Promise<LinearWorkspace[]>
  usedLinearWorkspaces(): string[]
  usedJiraSites(): string[]
  jiraAccounts(): Promise<JiraAccount[]>
  jiraSignIn(site: string, email: string, token: string): Promise<JiraAccount>
  jiraProjects(site: string): Promise<{ key: string; name: string }[]>
  jiraBoards(site: string, project: string): Promise<{ id: number; name: string }[]>
  statusOptions(url: string): Promise<string[]>
  boardRepos(url: string): Promise<string[]>
  me(projectId: string): Promise<string>
  resetViewers(): void
  getBoard(projectId: string): Promise<BoardView>
  sync(projectId: string): Promise<void>
  watch(projectId: string | null, visible: boolean): void
  session(id: string): SessionRecord | undefined
  checkStart(projectId: string, ticketKey: string): Promise<StartCheck>
  checkOverlap(projectId: string, ticketKey: string): Promise<Overlap[]>
  checkReady(projectId: string, ticketKey: string): Promise<string[]>
  triage(projectId: string, ticketKey: string): Promise<Triage>
  applyTriage(projectId: string, ticketKey: string, t: Triage): Promise<void>
  chat(projectId: string, ticketKey: string): Promise<ChatState>
  sendChat(projectId: string, ticketKey: string, text: string): Promise<Chat>
  draftComment(projectId: string, ticketKey: string, mine?: string): Promise<string>
  saveDraft(projectId: string, ticketKey: string, draft: string): Promise<void>
  postComment(projectId: string, ticketKey: string, body: string): Promise<void>
  discardDraft(projectId: string, ticketKey: string): Promise<void>
  clearChat(projectId: string, ticketKey: string): Promise<void>
  stopChat(projectId: string, ticketKey: string): Promise<void>
  onChatSteps(cb: (projectId: string, ticketKey: string, steps: Step[]) => void): () => void
  start(
    projectId: string,
    ticketKey: string,
    extraRepos?: string[],
    mainRepo?: string,
    note?: string,
    model?: Model | null,
    setup?: false,
    plan?: true
  ): Promise<void>
  create(
    projectId: string,
    repo: string,
    worktree: boolean,
    draft?: TicketDraft,
    firstMessage?: string,
    model?: Model | null,
    setupId?: string,
    setup?: false,
    effort?: Effort | null
  ): Promise<string>
  setupProgress(target: string): SetupProgress | null
  cancelSetup(target: string): Promise<void>
  suggestSetup(path: string): Promise<SetupSuggestion | null>
  setupHint(projectId: string, repo: string): Promise<SetupSuggestion | null>
  hideSetupHint(projectId: string, repo: string): Promise<void>
  onSetupProgress(cb: (target: string, progress: SetupProgress | null) => void): () => void
  firstMessage(sessionId: string): Promise<string>
  listRoutines(projectId: string): Promise<Routine[]>
  saveRoutine(input: RoutineInput): Promise<Routine>
  chatRoutine(turn: RoutineChatTurn): Promise<RoutineChatReply>
  stopRoutineChat(runId: string): Promise<void>
  onRoutineChatSteps(cb: (runId: string, steps: Step[]) => void): () => void
  removeRoutine(id: string): Promise<void>
  startRoutine(id: string): Promise<string>
  routineHistory(id: string): Promise<RoutineRun[]>
  createTicket(
    projectId: string,
    where: string,
    title: string,
    body: string,
    parent?: string
  ): Promise<string>
  rename(sessionId: string, name: string): Promise<void>
  changes(sessionId: string): Promise<RepoChanges[]>
  /** Opens one of the session's folders in Finder or the project's editor. */
  openFolder(sessionId: string, folder: string, how: 'finder' | 'editor'): Promise<void>
  findings(sessionId: string): Promise<FindingsState>
  addFinding(sessionId: string, f: NewFinding): Promise<Finding>
  updateFinding(sessionId: string, id: string, patch: FindingPatch): Promise<void>
  removeFinding(sessionId: string, id: string): Promise<void>
  sendFindings(sessionId: string, ids: string[]): Promise<void>
  review(sessionId: string): Promise<number>
  pullRequests(sessionId: string): Promise<PullRequestState[]>
  addCheck(sessionId: string, repo: string, jobId: number, name: string): Promise<Finding>
  addThread(sessionId: string, repo: string, threadId: string): Promise<Finding>
  setAutoReview(sessionId: string, on: boolean): Promise<void>
  summarize(sessionId: string): Promise<void>
  end(sessionId: string): Promise<void>
  clearNeedsYou(sessionId: string): Promise<void>
  move(projectId: string, ticketKey: string, column: BoardColumn, lane?: LaneChange): Promise<void>
  details(projectId: string, ticketKey: string): Promise<TicketDetails>
  usage(projectId: string, ticketKey: string): Promise<TicketUsage>
  usageByWeek(): Promise<UsageByWeek>
  resume(sessionId: string): Promise<void>
  setRemoteControl(sessionId: string, on: boolean): Promise<void>
  send(sessionId: string, text: string, images?: string[]): Promise<string>
  image(sessionId: string, path: string): Promise<string>
  interrupt(sessionId: string): Promise<void>
  compact(sessionId: string, step: 'prepare' | 'compact'): Promise<void>
  prompt(sessionId: string): Promise<SessionPrompt | null>
  commands(sessionId: string): Promise<SessionCommand[]>
  suggestion(sessionId: string): Promise<string | null>
  answer(sessionId: string, shown: SessionPrompt, answer: PromptAnswer): Promise<void>
  removeWorktree(sessionId: string): Promise<RemoveResult>
  endAndRemove(sessionId: string): Promise<RemoveResult>
  leftovers(): Promise<Leftover[]>
  endUnknown(name: string): Promise<void>
}

const tracked = (p: Project): boolean => serviceOf(p) !== 'GitHub'

/** Ties projects, board sync, worktrees, and Claude Code sessions together. */
export function createOrchestrator(deps: OrchestratorDeps): Orchestrator {
  const now = deps.now ?? (() => new Date())
  let projects: Project[] = []
  let groups: ProjectGroup[] = []
  let sessions: SessionRecord[] = []
  let accounts: Account[] = []
  let chats: Chat[] = []
  let runs: Run[] = []
  let findings: Finding[] = []
  let routines: Routine[] = []
  let skippedRuns: SkippedRun[] = []
  let startFailures: StartFailure[] = []
  let setupPending: string[] = []
  let setupHintsOff: string[] = []
  const transcriptFolders = new Map<string, string>()
  const runFiles = new Map<string, string | null>()
  const checkoutFiles = new Map<string, string>()
  const missedConversations = new Map<string, Set<string>>()
  const runsInFlight = new Set<string>()
  const synced = new Map<string, Synced>()
  const stampOf = (p: Project): Promise<string | null> =>
    tracked(p)
      ? Promise.resolve(null)
      : deps
          .githubStamp(
            p.board?.source,
            p.repos.map((r) => r.github)
          )
          .catch(() => null)
  const viewers = new Map<string, Promise<string>>()
  const mergedPrs = new Map<string, MergedPr[]>()
  const trackerFor = (p: Project): Tracker => trackerOf(p, deps)
  const changeListeners = new Set<(projectId: string) => void>()
  const openListeners = new Set<(view: LastView) => void>()
  const activityListeners = new Set<(sessionId: string, activity: Activity) => void>()
  const activities = new Map<string, Activity>()
  const activityFiles = new Map<string, string>()
  const stoppers: (() => void)[] = []
  const cliServer = deps.cli?.((...args) => cliCommands.run(...args))
  if (cliServer) stoppers.push(() => void cliServer.closeAll())
  const write = serial()
  const writeCache = serial()
  const reading = serial()

  const persist = (): Promise<void> => {
    const next = write(() =>
      deps.store.save({
        projects,
        groups,
        sessions,
        accounts,
        chats,
        runs,
        findings,
        routines,
        skippedRuns,
        startFailures,
        setupPending,
        setupHintsOff
      })
    )
    next.catch((err) => console.error('Saving the store failed', err))
    return next
  }
  const persistCache = (): void => {
    const cache: SyncCache = {}
    for (const [id, s] of synced)
      if (s.syncedAt) cache[id] = { tickets: s.tickets, syncedAt: s.syncedAt }
    writeCache(() => deps.cache.save(cache)).catch((err) =>
      console.error('Saving the sync cache failed', err)
    )
  }
  const changed = (projectId: string): void => changeListeners.forEach((cb) => cb(projectId))
  const subscribe = <T>(set: Set<T>, cb: T): (() => void) => {
    set.add(cb)
    return () => set.delete(cb)
  }

  const projectById = (id: string): Project => {
    const p = projects.find((x) => x.id === id)
    if (!p) throw new Error('Unknown project')
    return p
  }
  const ticketRepo = (project: Project, github: string): ProjectRepo => {
    const repo =
      findRepo(project.repos, github) ?? (tracked(project) ? project.repos[0] : undefined)
    if (!repo) throw new Error('Repo not in this project')
    return repo
  }
  const sharesWorktree = (
    s: Pick<SessionRecord, 'worktrees'>,
    counts: (x: SessionRecord) => boolean
  ): boolean =>
    sessions.some((x) => x !== s && counts(x) && x.worktrees.some((w) => s.worktrees.includes(w)))
  const sessionById = (id: string): SessionRecord => {
    const s = sessions.find((x) => x.id === id)
    if (!s) throw new Error('Unknown session')
    return s
  }
  const assertCurrent = (s: SessionRecord): void => {
    projectById(s.projectId)
    if (!sessions.includes(s)) throw new Error('Unknown session')
    if (s.removedAt) throw new Error('The worktree was removed')
  }
  const repoPathsOf = (s: SessionRecord): string[] => [
    ...new Set([
      ...(projects.find((p) => p.id === s.projectId)?.repos.map((r) => r.path) ?? []),
      ...s.worktrees
        .map(dirname)
        .flatMap((d) => (d.endsWith(WT_SUFFIX) ? [d.slice(0, -WT_SUFFIX.length)] : []))
    ])
  ]
  const changesOf = async (sessionId: string): Promise<RepoChanges[]> => {
    const s = sessionById(sessionId)
    if (s.removedAt) throw new Error('The worktree was removed')
    const repoPaths = repoPathsOf(s)
    return Promise.all(
      s.worktrees.map(async (worktree) => {
        try {
          if (!existsSync(worktree)) throw new Error(`The worktree at ${worktree} is gone`)
          return { worktree, ...(await deps.git.changes(worktree, repoPaths)) }
        } catch (err) {
          return {
            worktree,
            base: '',
            files: [],
            error: messageOf(err)
          }
        }
      })
    )
  }

  const starting = new Map<string, [ticketKey: string, projectId: string]>()
  const ticketId = (projectId: string, ticketKey: string): string => `${projectId} ${ticketKey}`
  const startingSetups = new Set<string>()
  const checking = new Map<string, [ticketKey: string, projectId: string]>()
  // shortcut: in memory, so a restart checks a passed ticket once more; persist it if that costs too much.
  const passedReady = new Map<string, string>()
  const readyText = (t: Ticket): string => `${t.title}\n${t.body}`
  const resuming = new Set<string>()
  const commandLists = new Map<string, Promise<SessionCommand[]>>()
  const removing = new Set<string>()
  const beingRemoved = (worktrees: string[]): boolean => worktrees.some((w) => removing.has(w))
  const stillStarting = async (s: SessionRecord): Promise<boolean> =>
    resuming.has(s.id) || notStarted(s) || (startBy.has(s.id) && !(await startedSince(s)))
  const assertSendable = async (s: SessionRecord): Promise<void> => {
    if (await stillStarting(s)) throw new Error('The session is still starting.')
    if (!isLive(s)) throw new Error("The session isn't running. Resume it to send.")
    if (s.asking || (await deps.events.readAsking(s.eventsFile)))
      throw new Error('Claude is asking you something. Answer it in the terminal first.')
  }
  const creating = new Set<string>()
  const sending = new Set<string>()
  const sameSource = (a: string, b: string): boolean => {
    const [x, y] = [a, b].map((id) => projects.find((p) => p.id === id))
    return !x || !y || sameTicketSource(x, y)
  }
  const assertNoLiveSession = (projectId: string, ticketKey: string): void => {
    const holds = (otherId: string, key: string | undefined): boolean =>
      key === ticketKey && sameSource(projectId, otherId)
    const inName = (id: string): string => {
      const name = projects.find((p) => p.id === id)?.name
      return name ? ` in ${name}` : ''
    }
    const start = [...starting.values()].find(([k, p]) => holds(p, k))
    if (start) throw new Error(`Ticket is already starting${inName(start[1])}`)
    const live = sessions.find(
      (s) => holds(s.projectId, s.ticketKey) && (isLive(s) || resuming.has(s.id))
    )
    if (live) throw new Error(`Ticket already has a live session${inName(live.projectId)}`)
  }
  const assertFreeTmux = (name: string, self?: string): void => {
    if (
      sessions.some(
        (s) => s.id !== self && s.tmuxName === name && (isLive(s) || resuming.has(s.id))
      ) ||
      [...starting.values()].some(([k, p]) => tmuxName(p, k) === name)
    )
      throw new Error(`Another session already uses the tmux name ${name}`)
  }

  const keepDoneDaysOf = (p: Project): number => p.keepDoneDays ?? DEFAULT_KEEP_DONE_DAYS
  const ticketOf = (s: SessionRecord): Ticket | undefined =>
    synced.get(s.projectId)?.tickets.find((x) => x.key === s.ticketKey)
  const boardTickets = (project: Project): Ticket[] =>
    visibleTickets(
      (synced.get(project.id)?.tickets ?? []).filter(
        (t) => tracked(project) || findRepo(project.repos, t.repo)
      ),
      sessions.filter((s) => s.projectId === project.id),
      (t) => columnFor(t.status, statusMapOf(project)) === 'done',
      now(),
      keepDoneDaysOf(project)
    )
  const doneOpen = (s: SessionRecord): boolean => {
    const p = projects.find((x) => x.id === s.projectId)
    return !!p && isDoneOpen(s, ticketOf(s), statusMapOf(p))
  }
  const waiting = (s: SessionRecord): boolean =>
    (s.state === 'needsYou' || s.state === 'apiError') && !doneOpen(s)

  const sidebarList = (): SidebarSession[] => {
    const onBoard = isShown(shownTicketKeys())
    return sessions
      .flatMap<SidebarSession>((s) =>
        !s.ticketKey
          ? listedSessions([s])
          : isLive(s) && onBoard(s)
            ? [
                {
                  ...s,
                  name: ticketOf(s)?.title ?? s.ticketKey,
                  ...(doneOpen(s) && { done: true as const })
                }
              ]
            : []
      )
      .sort((a, b) => Number(!!a.done) - Number(!!b.done))
  }
  const waitingList = (listed = sidebarList()): SidebarSession[] => {
    const order = new Map(
      sections(projects, groups)
        .flatMap((s) => s.projects)
        .map((p, i) => [p.id, i])
    )
    return listed
      .filter((s) => waiting(s) && order.has(s.projectId))
      .sort((a, b) => order.get(a.projectId)! - order.get(b.projectId)!)
  }

  const setAsking = (s: SessionRecord, asking: boolean): void => {
    if (asking) s.asking = true
    else delete s.asking
  }

  const shownTicketKeys = (): Map<string, Set<string> | null> =>
    new Map(
      projects.map((p) => [
        p.id,
        synced.get(p.id)?.syncedAt
          ? new Set(
              boardTickets(p)
                .filter((t) => columnFor(t.status, statusMapOf(p)) !== 'hidden')
                .map((t) => t.key)
            )
          : null
      ])
    )
  const isShown =
    (shownKeys: Map<string, Set<string> | null>) =>
    (s: SessionRecord): boolean => {
      if (!shownKeys.has(s.projectId)) return false
      if (!s.ticketKey) return !s.removedAt
      const keys = shownKeys.get(s.projectId)
      return !keys || keys.has(s.ticketKey)
    }

  const shownState = (s: SessionRecord, state: SessionState): SessionState =>
    s.capped
      ? state === 'running' || state === 'done'
        ? 'needsYou'
        : state
      : s.routineId && state === 'needsYou' && !s.asking
        ? 'done'
        : state === 'needsYou' && !s.asking && reviewLoop.inRound(s.id)
          ? 'reviewing'
          : state

  const heldNeedsYou = new Map<string, Promise<unknown>>()
  const open = (view: LastView) => () => openListeners.forEach((cb) => cb(view))

  const notifyNeedsYou = (s: SessionRecord, project: Project, fresh: Promise<unknown>): void => {
    const { ticketKey } = s
    const reason =
      (s.capped && 'Reached its token cap') ||
      (s.state === 'apiError' && ['API error', s.stop?.message].filter(Boolean).join(': '))
    if (!ticketKey)
      return deps.notify(
        `Needs you: ${s.name}`,
        reason || project.name,
        open({ projectId: s.projectId, sessionId: s.id })
      )
    if (reviewLoop.pending(s.id) && !s.asking && !s.capped)
      return void heldNeedsYou.set(s.id, fresh)
    let timer: ReturnType<typeof setTimeout> | undefined
    const limit = new Promise((resolve) => (timer = setTimeout(resolve, NOTIFY_WAIT_MS)))
    void Promise.race([fresh, limit]).then(() => {
      clearTimeout(timer)
      if (!waiting(s)) return
      deps.notify(
        `Needs you: ${shortName(ticketKey)}`,
        reason || (ticketOf(s)?.title ?? ticketKey),
        open({ projectId: s.projectId, ticketKey })
      )
    })
  }

  const setState = (s: SessionRecord, next: SessionState, warning?: string): void => {
    const state = shownState(s, next)
    if (s.state === state) return
    s.state = state
    if (state !== 'limitReached' && state !== 'apiError') delete s.stop
    if (state === 'running') reviewLoop.leaveRound(s.id)
    if (state === 'finished') {
      void cliServer?.close(s.id)
      commandLists.delete(s.id)
      eventCounts.delete(s.id)
      setAsking(s, false)
      if (warning) s.startWarning = warning
      else delete s.startWarning
    }
    void persist().catch(() => undefined)
    changed(s.projectId)
    if (state === 'finished' && s.ticketKey && !resuming.has(s.id))
      void summarize(s.id, true).catch(() => undefined)
    const project = projects.find((p) => p.id === s.projectId)
    if (!['needsYou', 'apiError', 'done', 'reviewing'].includes(state) || !project) return
    const fresh = joinSync(s.projectId).catch(() => null)
    if (state === 'done') return
    if (state !== 'apiError') void reviewLoop.autoRound(s)
    notifyNeedsYou(s, project, fresh)
  }

  const failedState = async (
    s: SessionRecord,
    reads = STOP_READS
  ): Promise<{ state: SessionState; stop: SessionStop }> => {
    let stop: Stopped | null = null
    for (let read = 0; read < reads && !stop; read++) {
      if (read) await new Promise((resolve) => setTimeout(resolve, STOP_RETRY_MS))
      const file = (await conversationFiles(s).catch(() => [])).at(-1)?.file
      stop = file ? await readStop(file).catch(() => null) : null
    }
    const { limit, ...rest } = stop ?? { limit: false, message: '' }
    return { state: limit ? 'limitReached' : 'apiError', stop: rest }
  }
  const lastStateOf = async (s: SessionRecord): Promise<SessionState | null> => {
    const last = await deps.events.readLastState(s.eventsFile)
    if (last !== 'apiError') return last
    const { state, stop } = await failedState(s, 1)
    s.stop = stop
    return state
  }
  const eventCounts = new Map<string, number>()

  const onEvent = (sessionId: string, state: SessionState | null, asking: boolean): void => {
    void liveView.eventSeen(sessionId)
    const s = sessions.find((x) => x.id === sessionId)
    if (!s || !isLive(s)) return
    const count = (eventCounts.get(s.id) ?? 0) + (state ? 1 : 0)
    eventCounts.set(s.id, count)
    const askingChanged = !!s.asking !== asking
    setAsking(s, asking)
    if (state === 'apiError')
      void failedState(s).then(({ state: next, stop }) => {
        if (eventCounts.get(s.id) !== count || !isLive(s)) return
        s.stop = stop
        if (s.state !== next) return setState(s, next)
        void persist().catch(() => undefined)
        changed(s.projectId)
      })
    else if (state && shownState(s, state) !== s.state) setState(s, state)
    else if (askingChanged) {
      void persist().catch(() => undefined)
      changed(s.projectId)
    }
  }

  const readActivities = async (): Promise<void> => {
    const running = sessions.filter((s) => s.state === 'running')
    for (const id of activities.keys()) if (!running.some((s) => s.id === id)) activities.delete(id)
    for (const s of running) {
      const latest = (await conversationFiles(s, activityFiles).catch(() => [])).pop()
      const next = latest && (await readActivity(latest.file).catch(() => null))
      if (!next || JSON.stringify(next) === JSON.stringify(activities.get(s.id))) continue
      activities.set(s.id, next)
      activityListeners.forEach((cb) => cb(s.id, next))
    }
  }

  const removeWorktree = async (sessionId: string): Promise<RemoveResult> => {
    const s = sessionById(sessionId)
    if (isLive(s) || resuming.has(s.id)) throw new Error('End the session first')
    if (sharesWorktree(s, (x) => isLive(x) || resuming.has(x.id)))
      return { removed: false, reason: 'Another session uses this worktree' }
    if (beingRemoved(s.worktrees)) throw new Error(REMOVING)
    const startingOf = (x: SessionRecord): boolean =>
      [...starting.values()].some(([k]) => k === x.ticketKey)
    if (startingOf(s) || sharesWorktree(s, startingOf))
      throw new Error('Wait until the ticket starts')
    const existing = s.worktrees.filter((w) => existsSync(w))
    const repoPaths = repoPathsOf(s)
    existing.forEach((w) => removing.add(w))
    try {
      for (const wt of existing) {
        const check = await deps.git.checkRemovable(wt, repoPaths)
        if (!('removable' in check)) return check
      }
      for (const wt of existing) {
        const res = await removeTree(wt, repoPaths)
        if (!res.removed) return res
      }
    } finally {
      existing.forEach((w) => removing.delete(w))
    }
    s.removedAt = now().toISOString()
    delete s.startWarning
    await persist()
    await rm(statusFile(s.id), { force: true }).catch(() => {})
    await rm(imagesDir(s.id), { recursive: true, force: true }).catch(() => {})
    await rm(notesFile(s.id), { force: true }).catch(() => {})
    for (const part of ['text', 'images'] as const)
      await rm(draftFile(draftsDir, sessionDraft(s.id), part), { force: true }).catch(() => {})
    changed(s.projectId)
    return { removed: true }
  }

  const end = async (sessionId: string): Promise<void> => {
    const s = sessionById(sessionId)
    await deps.tmux.killTmux(s.tmuxName)
    if (await deps.tmux.hasTmux(s.tmuxName)) throw new Error("Couldn't end the session")
    setState(s, 'finished')
  }

  const clearFixedFolders = async (p: Project): Promise<boolean> => {
    const checked = startFailures.filter((f) => f.projectId === p.id && f.repo)
    const fixed: string[] = []
    for (const repo of new Set(checked.map((f) => f.repo!))) {
      const r = findRepo(p.repos, repo)
      const remotes = r ? await deps.githubReposOf(r.path).catch(() => []) : []
      if (!r || remotes.some((g) => sameRepo(g, repo))) fixed.push(repo)
    }
    const left = startFailures.filter((f) => !checked.includes(f) || !fixed.includes(f.repo!))
    const cleared = left.length < startFailures.length
    startFailures = left
    return cleared
  }

  const checkFolders = async (repos: ProjectRepo[]): Promise<void> => {
    for (const r of repos)
      if (!(await deps.githubReposOf(r.path)).some((g) => sameRepo(g, r.github)))
        throw new Error(folderError(r.github))
  }

  const conversationDir = (s: SessionRecord): string => s.claudeDir ?? deps.claudeDir
  const conversationFiles = async (
    s: SessionRecord,
    found?: Map<string, string>
  ): Promise<{ id: string; file: string }[]> => {
    const files: { id: string; file: string }[] = []
    for (const id of await conversationIds(s.eventsFile, s.id)) {
      if (missedConversations.get(s.id)?.has(id)) continue
      const file = found?.get(id) ?? (await findConversation(conversationDir(s), id))
      if (!file) {
        if (s.state === 'finished')
          missedConversations.set(s.id, (missedConversations.get(s.id) ?? new Set()).add(id))
        continue
      }
      found?.set(id, file)
      files.push({ id, file })
    }
    return files
  }

  const sessionFiles = async (s: SessionRecord, found: Map<string, string>): Promise<string[]> =>
    (
      await Promise.all(
        (await conversationFiles(s, found)).map(async ({ id, file }) => [
          file,
          ...(await transcriptsIn(join(dirname(file), id)))
        ])
      )
    ).flat()

  const transcriptFiles = async (
    mine: (x: { projectId: string; ticketKey?: string }) => boolean
  ): Promise<string[]> => {
    const files = new Set<string>()
    for (const s of sessions.filter(mine)) {
      if (s.checkout && !s.worktrees.length) {
        for (const f of await sessionFiles(s, checkoutFiles)) files.add(f)
        continue
      }
      const folder =
        transcriptFolders.get(s.id) ??
        (await conversationFiles(s)).map((c) => dirname(c.file)).pop()
      if (!folder) continue
      transcriptFolders.set(s.id, folder)
      for (const f of await transcriptsIn(folder)) files.add(f)
    }
    for (const r of runs.filter(mine)) {
      let file = runFiles.get(r.id)
      if (file === undefined) {
        file = await findConversation(r.claudeDir, r.id)
        if (file || !runsInFlight.has(r.id)) runFiles.set(r.id, file)
      }
      if (file) files.add(file)
    }
    return [...files]
  }

  const INITIALIZE =
    '{"type":"control_request","request_id":"commands","request":{"subtype":"initialize"}}\n'
  const printClaude = async (
    label: string,
    slow: string,
    cwd: string,
    args: string[],
    dir: string | undefined,
    live: {
      timeoutMs?: number
      signal?: AbortSignal
      onStdout?: (chunk: string) => void
      input?: string
    } = {}
  ): Promise<string> => {
    const { timeoutMs = 180_000, ...streaming } = live
    const startedAt = Date.now()
    const { stdout, stderr, code } = await deps.claude.print(
      cwd,
      args,
      accountEnv(dir, deps.claudeDir),
      timeoutMs,
      streaming
    )
    if (live.signal?.aborted) throw new Error(`${label} stopped`)
    if (code === -1 && Date.now() - startedAt >= timeoutMs) throw new Error(slow)
    if (code === -1 && !stdout) {
      if (/\b(ENOENT|EACCES)\b/.test(stderr))
        throw new Error(`${label} couldn't start claude: ${stderr.trim()}`)
      throw new Error(`${label} failed: claude stopped: ${stderr.trim()}`)
    }
    if (code !== 0 && !stdout.trim())
      throw new Error(`${label} failed: ${stderr.trim() || `claude exited with code ${code}`}`)
    return stdout
  }

  const recordRun = async (
    projectId: string,
    ticketKey: string,
    id: string = randomUUID()
  ): Promise<string> => {
    const run = {
      projectId,
      ticketKey,
      claudeDir: projectById(projectId).claudeDir ?? deps.claudeDir,
      id
    }
    runs = [...runs, run]
    runsInFlight.add(id)
    try {
      await persist()
    } catch (err) {
      runs = runs.filter((r) => r !== run)
      runsInFlight.delete(id)
      throw err
    }
    return id
  }

  const printRun: PrintRun = async (
    projectId,
    ticketKey,
    label,
    cwd,
    argsFor,
    timeoutMs = 180_000
  ) => {
    const { claudeDir } = projectById(projectId)
    const id = await recordRun(projectId, ticketKey)
    return printClaude(
      label,
      `${label} didn't finish within ${timeoutMs / 60_000} minutes`,
      cwd,
      argsFor(id),
      claudeDir,
      { timeoutMs }
    ).finally(() => runsInFlight.delete(id))
  }

  const syncedTicket = (projectId: string, ticketKey: string): Ticket => {
    const ticket = synced.get(projectId)?.tickets.find((t) => t.key === ticketKey)
    if (!ticket) throw new Error('Unknown ticket')
    return ticket
  }
  const {
    sync,
    joinSync,
    syncWatched,
    visible,
    moveTicket,
    detailsOf,
    resetSource,
    writing,
    watch
  } = createSync({
    deps,
    now,
    projects: () => projects,
    sessions: () => sessions,
    routines: () => routines,
    startFailures: () => startFailures,
    setStartFailures: (failures) => {
      startFailures = failures
    },
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
    onSync: (...a) => onSync(...a),
    autoOn: (s) => reviewLoop.autoOn(s),
    autoPrFindings: (s) => reviewLoop.autoPrFindings(s)
  })
  const candidatesFor = (projectId: string, ticket: Ticket, exclude: string[] = []): Ticket[] => {
    const tickets = synced.get(projectId)?.tickets ?? []
    const map = statusMapOf(projectById(projectId))
    const busy = overlapCandidates(ticket, tickets, [
      ...[...starting.values(), ...checking.values()].flatMap(([key, p]) =>
        p === projectId ? [key] : []
      ),
      ...sessions.flatMap((s) =>
        s.projectId === projectId && s.ticketKey && isLive(s) && !doneOpen(s) ? [s.ticketKey] : []
      ),
      ...tickets.flatMap((t) => (columnFor(t.status, map) === 'inProgress' ? [t.key] : []))
    ])
    return busy.filter((t) => !exclude.includes(t.key))
  }

  const transcriptOf = async (s: SessionRecord): Promise<ConversationEntry[] | null> => {
    let entries: ConversationEntry[] | null = null
    for (const { file } of await conversationFiles(s)) {
      const parsed = parseConversation(await readFile(file, 'utf8'))
      entries = entries ? [...entries, { kind: 'user', text: '/clear' }, ...parsed] : parsed
    }
    return entries
  }

  const latestEntries = async (s: SessionRecord): Promise<ConversationEntry[]> => {
    const latest = (await conversationFiles(s)).at(-1)
    return latest ? readLastEntries(latest.file) : []
  }

  const promptNow = async (s: SessionRecord, pane?: string): Promise<SessionPrompt | null> =>
    pendingPrompt(
      await latestEntries(s),
      pane ?? (await deps.tmux.captureTmux(s.tmuxName)),
      await readAgentRequests(s.eventsFile)
    )

  const liveView = createLiveView({
    statusDir: join(deps.dataDir, 'status'),
    sessions: () => sessions,
    sessionById,
    conversationFiles,
    readBackground: deps.events.readBackground,
    subscribe
  })
  stoppers.push(liveView.stop)

  const { summarize, ...ticketChat } = createTicketChat({
    deps,
    synced,
    chats: () => chats,
    setChats: (next) => (chats = next),
    persist,
    changed,
    projectById,
    sessionById,
    ticketRepo,
    checkFolders,
    syncedTicket,
    detailsOf,
    trackerFor,
    labelOf,
    transcriptOf,
    printClaude,
    subscribe,
    recordRun,
    printRun,
    runsInFlight
  })
  const cliCommands = createCliCommands({
    sessions: () => sessions,
    synced,
    projectById,
    statusMapOf,
    latestEntries,
    chat: ticketChat.chat,
    pending: (id) => reviewLoop.pending(id),
    busy: (projectId, ticketKey) =>
      [...starting.values(), ...checking.values()].some(
        ([key, p]) => key === ticketKey && p === projectId
      ),
    onChange: (cb) => subscribe(changeListeners, cb),
    checkStart: (projectId, ticketKey) => api.checkStart(projectId, ticketKey),
    checkReady: (projectId, ticketKey) => api.checkReady(projectId, ticketKey),
    overlap: (projectId, ticketKey, exclude) => api.overlapFor(projectId, ticketKey, exclude),
    start: (callerId, ...args) => api.startFor(callerId, ...args),
    resume: (callerId, sessionId) => api.resumeFor(callerId, sessionId)
  })
  const routineChat = createRoutineChat({
    deps,
    projectById,
    repoOf,
    checkFolders,
    printClaude,
    subscribe,
    recordRun,
    runsInFlight
  })
  const reviewLoop = createReviewLoop({
    deps,
    now,
    findings: () => findings,
    setFindings: (next) => (findings = next),
    persist,
    changed,
    sessionById,
    projectById,
    assertCurrent,
    assertSendable,
    sending,
    changesOf,
    labelOf,
    printRun,
    ticketOf,
    serviceOf: (s) => serviceOf(projectById(s.projectId)),
    notifyWaiting: (s, ticketKey, body) => {
      if (doneOpen(s)) return
      deps.notify(
        `Review: ${shortName(ticketKey)}`,
        body,
        open({ projectId: s.projectId, ticketKey, tab: 'changes' })
      )
    },
    entryCount: (sessionId) => liveView.entryCount(sessionId),
    fingerprint: async (s) =>
      deps.fingerprint(gateScript, await treesOf(s.worktrees, repoPathsOf(s))),
    gateFile: (id) => gateFile(id),
    roundStarted: (s, ticketKey) => {
      if (s.state !== 'needsYou' || s.asking || s.capped) return false
      s.state = 'reviewing'
      if (!doneOpen(s))
        try {
          deps.notify(
            `Reviewing: ${shortName(ticketKey)}`,
            ticketOf(s)?.title ?? ticketKey,
            open({ projectId: s.projectId, ticketKey, tab: 'changes' })
          )
        } catch (err) {
          console.error('Sandtable could not notify that a review round started', err)
        }
      return true
    },
    roundEnded: (s, quiet) => {
      const project = projects.find((p) => p.id === s.projectId)
      const fresh = heldNeedsYou.get(s.id)
      heldNeedsYou.delete(s.id)
      if (fresh && quiet && project) notifyNeedsYou(s, project, fresh)
    }
  })

  const {
    showSetup,
    unpend,
    pend,
    skipSetups,
    removeTree,
    removeKept,
    keep,
    assertNoSetup,
    runSetups,
    savedRepo,
    ...setupApi
  } = createSetupRuns({
    deps,
    now,
    setupPending: () => setupPending,
    setSetupPending: (next) => (setupPending = next),
    setupHintsOff: () => setupHintsOff,
    setSetupHintsOff: (next) => (setupHintsOff = next),
    persist,
    projectById,
    repoOf,
    checkFolders,
    subscribe
  })

  const {
    relaunch,
    folderOf,
    goneError,
    createSession,
    startFor,
    create,
    startPollingTmux,
    pollTmux,
    pollingTmux,
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
    treesOf
  } = createLaunch({
    deps,
    now,
    sessions: () => sessions,
    routines: () => routines,
    startFailures: () => startFailures,
    setStartFailures: (failures) => {
      startFailures = failures
    },
    setupPending: () => setupPending,
    synced,
    starting,
    startingSetups,
    creating,
    resuming,
    missedConversations,
    stoppers,
    cliServer,
    setupRuns: {
      pend,
      unpend,
      skipSetups,
      runSetups,
      keep,
      removeKept,
      removeTree,
      showSetup,
      assertNoSetup,
      setupProgress: setupApi.setupProgress
    },
    sync: { writing, moveTicket },
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
    syncGate: (s) => reviewLoop.syncGate(s),
    runSchedules: () => runSchedules(),
    readActivities,
    readLiveUsage: () => readLiveUsage(),
    liveTick: liveView.tick
  })

  const { allAccounts, ...projectsApi } = createProjects({
    deps,
    projects: () => projects,
    setProjects: (next) => (projects = next),
    groups: () => groups,
    setGroups: (next) => (groups = next),
    accounts: () => accounts,
    setAccounts: (next) => (accounts = next),
    sessions: () => sessions,
    synced,
    mergedPrs,
    projectById,
    savedRepo,
    persist,
    persistCache,
    changed,
    clearFixedFolders,
    resetSource,
    assertModel,
    assertEffort,
    syncGate: (s) => reviewLoop.syncGate(s),
    sync
  })

  let stopped = false
  const { runSchedules, onSync, ...routinesApi } = createRoutines({
    now,
    routines: () => routines,
    setRoutines: (next) => (routines = next),
    skippedRuns: () => skippedRuns,
    setSkippedRuns: (next) => (skippedRuns = next),
    sessions: () => sessions,
    resuming,
    stopped: () => stopped,
    persist,
    changed,
    projectById,
    repoOf,
    reading,
    transcriptOf,
    transcriptFiles,
    createSession
  })

  const { readLiveUsage, ...usageApi } = createUsageTracking({
    deps,
    projects: () => projects,
    sessions: () => sessions,
    runs: () => runs,
    settingsDir,
    capFile,
    persist,
    changed,
    subscribe,
    projectById,
    sessionById,
    sync,
    notifyNeedsYou,
    setState,
    activityFiles,
    sessionFiles,
    transcriptFiles,
    reading
  })

  const jiraSignIn = createJiraSignIn({ deps, projects: () => projects, viewers })

  const leftoversApi = createLeftovers({
    deps,
    projects: () => projects,
    sessions: () => sessions,
    resuming,
    starting,
    creating,
    shownTicketKeys,
    isShown,
    boardTickets,
    ticketOf,
    sharesWorktree
  })

  let loaded: Promise<void> | undefined
  const load = async (tmuxAvailable: boolean): Promise<void> => {
    const data = await deps.store.load()
    projects = data.projects
    groups = data.groups
    sessions = data.sessions
    for (const s of sessions) {
      if (s.state === 'reviewing') s.state = 'needsYou'
      for (const r of s.reviewRounds ?? [])
        if (!r.endedAt)
          Object.assign(r, {
            endedAt: now().toISOString(),
            error: 'Sandtable quit during this review.'
          })
    }
    accounts = data.accounts
    chats = data.chats
    runs = data.runs
    routines = data.routines
    skippedRuns = data.skippedRuns
    startFailures = data.startFailures
    setupPending = data.setupPending
    setupHintsOff = data.setupHintsOff
    findings = data.findings.filter((f) => {
      const s = sessions.find((x) => x.id === f.sessionId)
      return !!s && projects.some((p) => p.id === s.projectId)
    })
    const repoPaths = projects.flatMap((p) => p.repos.map((r) => r.path))
    for (const wt of setupPending.filter(
      (p) => basename(p).startsWith('session-') && !sessions.some((s) => s.worktrees.includes(p))
    )) {
      if (!existsSync(wt)) {
        await unpend([wt])
        continue
      }
      try {
        const res = await removeTree(wt, repoPaths)
        if (!res.removed) throw new Error(res.reason)
      } catch (err) {
        console.error(`Sandtable could not remove the leftover worktree ${wt}`, err)
      }
    }
    const cache = await deps.cache.load()
    for (const p of projects) {
      const c = cache[p.id]
      if (c) synced.set(p.id, { tickets: c.tickets, syncedAt: c.syncedAt, error: null })
    }
    stoppers.push(
      deps.events.watchEvents(eventsDir, onEvent, {
        seed: sessions.filter((s) => !s.removedAt).map((s) => s.id),
        live: () => sessions.filter(isLive).map((s) => s.id)
      })
    )
    if (tmuxAvailable)
      for (const s of sessions.filter(isLive)) {
        const alive = await deps.tmux.hasTmux(s.tmuxName).catch(() => null)
        if (alive === null) break
        if (!alive) {
          s.state = 'finished'
          delete s.startWarning
        } else if (s.ticketKey) await cliServer?.open(s.id).catch(() => undefined)
        setAsking(s, alive && (notStarted(s) || (await deps.events.readAsking(s.eventsFile))))
        if (alive) s.state = shownState(s, (await lastStateOf(s)) ?? s.state)
        if (s.state !== 'limitReached' && s.state !== 'apiError') delete s.stop
        if (alive && notStarted(s)) startBy.set(s.id, now().getTime())
      }
    await persist()
    const syncTimer = setInterval(
      unlessBusy(async () => visible() && syncWatched(true)),
      SYNC_MS
    )
    stoppers.push(() => clearInterval(syncTimer))
    if (tmuxAvailable) startPollingTmux()()
    void syncWatched()
  }

  const api: Orchestrator & {
    startFor: (
      startedBy: string | undefined,
      ...args: Parameters<Orchestrator['start']>
    ) => Promise<void>
    resumeFor: (startedBy: string | undefined, sessionId: string) => Promise<void>
    overlapFor: (projectId: string, ticketKey: string, exclude: string[]) => Promise<Overlap[]>
  } = {
    /** Loads the store, reattaches recorded sessions, and starts watching events, syncing, and polling tmux. */
    reconnect(tmuxAvailable = true): Promise<void> {
      return (loaded = load(tmuxAvailable))
    },

    /** Once the store has loaded, reconciles sessions against tmux now and starts polling it, if not already polling. */
    async watchTmux(): Promise<void> {
      const ok = await loaded?.then(
        () => true,
        () => false
      )
      if (!ok || pollingTmux()) return
      const schedule = startPollingTmux()
      await pollTmux()
      schedule()
    },

    /** Stops the event watcher, the timers, and the programs still running. */
    stop(): void {
      stopped = true
      stoppers.splice(0).forEach((stop) => stop())
      stopChildren()
      stopSetups()
    },

    /** Resolves once every store and cache write queued so far has settled. */
    flush: async () => {
      await Promise.all([write.flush(), writeCache.flush()])
    },

    anyRunning: () => pollingTmux() && sessions.some((s) => s.state === 'running'),
    needsYouCount: () => waitingList().length,
    openNextNeedsYou: (current) => {
      const list = waitingList()
      if (!list.length) return
      const at = list.findIndex((s) =>
        current?.sessionId
          ? s.id === current.sessionId
          : !!current?.ticketKey &&
            s.ticketKey === current.ticketKey &&
            sameSource(current.projectId, s.projectId)
      )
      if (at >= 0 && list.length === 1) return
      const s = list[(at + 1) % list.length]
      open(
        s.ticketKey
          ? {
              projectId: s.projectId,
              ticketKey: s.ticketKey,
              tab: s.reviewRounds?.at(-1)?.waiting ? 'changes' : 'conversation'
            }
          : { projectId: s.projectId, sessionId: s.id }
      )()
    },

    onChange: (cb: (projectId: string) => void) => subscribe(changeListeners, cb),
    onOpen: (cb: (view: LastView) => void) => subscribe(openListeners, cb),
    onActivity: (cb: (sessionId: string, activity: Activity) => void) =>
      subscribe(activityListeners, cb),
    activity: (sessionId: string): Activity | null => activities.get(sessionId) ?? null,
    onStatus: (cb) =>
      liveView.onStatus((id, status) => {
        const s = sessions.find((x) => x.id === id)
        const dir = s ? conversationDir(s) : deps.claudeDir
        cb(id, status, allAccounts().find((a) => a.dir === dir) ?? { name: '', dir })
      }),
    onConversation: liveView.onConversation,
    status: liveView.status,
    watchConversation: liveView.watchConversation,
    unwatchConversation: liveView.unwatchConversation,
    unwatchAll: liveView.unwatchAll,
    listProjects: async (): Promise<Project[]> => projects,

    listGroups: async (): Promise<ProjectGroup[]> => groups,
    ...projectsApi,

    async removeProject(id: string): Promise<void> {
      projects = projects.filter((x) => x.id !== id)
      chats = chats.filter((c) => c.projectId !== id)
      runs = runs.filter((r) => r.projectId !== id)
      startFailures = startFailures.filter((f) => f.projectId !== id)
      skippedRuns = skippedRuns.filter(
        (x) => routines.find((r) => r.id === x.routineId)?.projectId !== id
      )
      routines = routines.filter((r) => r.projectId !== id)
      findings = findings.filter(
        (f) => sessions.find((x) => x.id === f.sessionId)?.projectId !== id
      )
      setupHintsOff = setupHintsOff.filter((k) => !k.startsWith(`${id}\n`))
      synced.delete(id)
      mergedPrs.delete(id)
      await persist()
      changed(id)
    },

    linearTeams: (workspace?: string): Promise<LinearTeam[]> => deps.linear(workspace).teams(),

    linearWorkspaces: (): Promise<LinearWorkspace[]> => deps.linearWorkspaces(),

    usedLinearWorkspaces: (): string[] => [
      ...new Set(projects.flatMap((p) => (p.linear?.workspace ? [p.linear.workspace] : [])))
    ],

    async statusOptions(url: string): Promise<string[]> {
      const src = parseBoardUrl(url)
      const field = await deps.board.statusField(src).catch((err: unknown) => {
        throw boardError(src, err)
      })
      return field.options.map((o) => o.name)
    },

    async boardRepos(url: string): Promise<string[]> {
      const src = parseBoardUrl(url)
      const tickets = await deps.board.tickets(src, REPO_STATUS).catch((err: unknown) => {
        throw boardError(src, err)
      })
      return [...new Set(tickets.map((t) => t.repo))]
    },

    me(projectId: string): Promise<string> {
      const project = projectById(projectId)
      const key = ticketSource(project)
      const cached = viewers.get(key)
      if (cached) return cached
      const login: Promise<string> = trackerFor(project)
        .viewer()
        .catch((err) => {
          if (viewers.get(key) === login) viewers.delete(key)
          throw err
        })
      viewers.set(key, login)
      return login
    },

    resetViewers: () => viewers.clear(),

    async getBoard(projectId: string): Promise<BoardView> {
      const needsYou: Record<string, number> = {}
      const listed = sidebarList()
      for (const s of waitingList(listed)) needsYou[s.projectId] = (needsYou[s.projectId] ?? 0) + 1
      const { tickets, syncedAt, error } = synced.get(projectId) ?? {
        tickets: [],
        syncedAt: null,
        error: null
      }
      const project = projects.find((p) => p.id === projectId)
      const shown = project ? boardTickets(project) : tickets
      const keys = new Set(shown.map((t) => t.key))
      return {
        tickets: shown.map(({ body, ...t }) => t),
        sessions: sessions.filter((s) => s.projectId === projectId),
        elsewhere: sessions.filter(
          (s) =>
            isLive(s) &&
            s.projectId !== projectId &&
            projects.some((p) => p.id === s.projectId) &&
            sameSource(projectId, s.projectId) &&
            !!s.ticketKey &&
            keys.has(s.ticketKey)
        ),
        sidebarSessions: listed,
        syncedAt,
        error,
        needsYou,
        routines: routines.filter((r) => r.projectId === projectId),
        couldntStart: couldntStartByProject(
          startFailures,
          skippedRuns,
          routines,
          sessions,
          (id, key) => synced.get(id)?.tickets.find((t) => t.key === key)?.title,
          daysBefore(now(), 7).toISOString()
        )
      }
    },

    sync: async (projectId: string): Promise<void> => void (await joinSync(projectId)),

    watch,

    session: (id: string): SessionRecord | undefined => sessions.find((s) => s.id === id),

    details: async (projectId: string, ticketKey: string): Promise<TicketDetails> =>
      detailsOf(projectById(projectId), ticketKey),

    async checkStart(projectId: string, ticketKey: string): Promise<StartCheck> {
      const ticket = syncedTicket(projectId, ticketKey)
      return {
        triage: !areaOf(ticket.labels),
        problems: startProblems(ticket),
        overlap: candidatesFor(projectId, ticket).map((t) => ({
          key: t.key,
          number: t.number,
          title: t.title
        })),
        ready:
          projectById(projectId).readyCheck !== false &&
          passedReady.get(`${projectId}\n${ticketKey}`) !== readyText(ticket)
      }
    },

    async checkReady(projectId: string, ticketKey: string): Promise<string[]> {
      assertNoLiveSession(projectId, ticketKey)
      const project = projectById(projectId)
      const ticket = syncedTicket(projectId, ticketKey)
      const repo = ticketRepo(project, ticket.repo)
      await checkFolders([repo])
      checking.set(ticketId(projectId, ticketKey), [ticketKey, projectId])
      try {
        const { body, comments } = await detailsOf(project, ticketKey)
        const stdout = await printRun(projectId, ticketKey, 'Readiness check', repo.path, (id) =>
          schemaArgs(
            READINESS_SCHEMA,
            chatPrompt({ ...ticket, body }, comments, READINESS_QUESTION, serviceOf(project)),
            id
          )
        )
        const gaps = parseReadiness(stdout)
        if (!gaps.length) passedReady.set(`${projectId}\n${ticketKey}`, readyText(ticket))
        return gaps
      } finally {
        checking.delete(ticketId(projectId, ticketKey))
      }
    },

    checkOverlap: (projectId: string, ticketKey: string): Promise<Overlap[]> =>
      api.overlapFor(projectId, ticketKey, []),

    async overlapFor(projectId: string, ticketKey: string, exclude: string[]): Promise<Overlap[]> {
      assertNoLiveSession(projectId, ticketKey)
      const project = projectById(projectId)
      const ticket = syncedTicket(projectId, ticketKey)
      const candidates = candidatesFor(projectId, ticket, exclude)
      if (!candidates.length) return []
      const repo = ticketRepo(project, ticket.repo)
      await checkFolders([repo])
      checking.set(ticketId(projectId, ticketKey), [ticketKey, projectId])
      try {
        const stdout = await printRun(projectId, ticketKey, 'Overlap check', repo.path, (id) =>
          schemaArgs(OVERLAP_SCHEMA, overlapPrompt(ticket, candidates, serviceOf(project)), id)
        )
        return parseOverlap(stdout, candidates)
      } finally {
        checking.delete(ticketId(projectId, ticketKey))
      }
    },

    async triage(projectId: string, ticketKey: string): Promise<Triage> {
      const project = projectById(projectId)
      const tickets = synced.get(projectId)?.tickets ?? []
      const ticket = syncedTicket(projectId, ticketKey)
      const repo = ticketRepo(project, ticket.repo)
      await checkFolders([repo])
      const areas = await trackerFor(project).areas(ticket)
      const open = tickets
        .filter(
          (t) =>
            t.key !== ticketKey &&
            (tracked(project) || sameRepo(t.repo, ticket.repo)) &&
            ['todo', 'inProgress'].includes(columnFor(t.status, statusMapOf(project))) &&
            !ticket.blockedBy.some((b) => b.key === t.key) &&
            !t.blockedBy.some((b) => b.key === ticket.key)
        )
        .map((t) => ({ key: t.key, number: t.number, title: t.title, area: areaOf(t.labels) }))
      const stdout = await printRun(projectId, ticketKey, 'Triage', repo.path, (id) =>
        schemaArgs(TRIAGE_SCHEMA, triagePrompt(ticket, areas, open, serviceOf(project)), id)
      )
      return parseTriage(stdout, areas, open, ticket.number, serviceOf(project))
    },

    ...ticketChat,
    ...routineChat,

    async applyTriage(projectId: string, ticketKey: string, t: Triage): Promise<void> {
      const project = projectById(projectId)
      const listed = synced.get(projectId)?.tickets.find((x) => x.key === ticketKey)?.blockedBy
      const unwritten = {
        ...t,
        blockedBy: t.blockedBy.filter((b) => !listed?.some((l) => l.key === b.key))
      }
      if (!t.area.startsWith(AREA_PREFIX))
        throw new Error(`"${t.area}" doesn't start with ${AREA_PREFIX}`)
      if (!t.newAreas.every((a) => usableArea(a, serviceOf(project))))
        throw new Error("A new area label can't be used")
      const known = new Set((synced.get(projectId)?.tickets ?? []).map((x) => x.key))
      if (!t.blockedBy.every((b) => known.has(b.key)))
        throw new Error('Blocker not in this project')
      let failed: string | null
      try {
        await trackerFor(project).applyTriage(ticketKey, unwritten)
      } finally {
        failed = await sync(projectId)
      }
      if (failed) throw new Error(`${APPLIED_BUT} couldn't refresh the board: ${failed}`)
    },

    start: (...args) => api.startFor(undefined, ...args),

    startFor,

    create,

    ...setupApi,

    async firstMessage(sessionId: string): Promise<string> {
      const first = (await transcriptOf(sessionById(sessionId)))?.find((e) => e.kind === 'user')
      return first?.kind === 'user' ? first.text : ''
    },

    ...routinesApi,

    async createTicket(
      projectId: string,
      where: string,
      title: string,
      body: string,
      parent?: string
    ): Promise<string> {
      const project = projectById(projectId)
      const trimmed = title.trim()
      if (!trimmed) throw new Error('Enter a title')
      const key = await trackerFor(project)
        .create(trimmed, body, where, parent)
        .catch(async (err: Error) => {
          if (err?.message?.startsWith(CREATED)) await sync(projectId)
          throw err
        })
      const failed = await sync(projectId)
      if (failed) throw new Error(`${CREATED} ${key}, but couldn't refresh the board: ${failed}`)
      return key
    },

    async rename(sessionId: string, name: string): Promise<void> {
      const s = sessionById(sessionId)
      if (s.ticketKey) throw new Error('Only a session without a ticket can be renamed')
      const trimmed = name.trim()
      if (!trimmed) throw new Error('Enter a name')
      s.name = trimmed
      await persist()
      changed(s.projectId)
    },

    summarize: (sessionId: string) => summarize(sessionId),

    end,

    async clearNeedsYou(sessionId: string): Promise<void> {
      const s = sessionById(sessionId)
      if (s.state !== 'needsYou' && s.state !== 'apiError') return
      if (s.capped) throw new Error('Raise its token cap first.')
      if (notStarted(s))
        throw new Error("Answer Claude Code's folder trust prompt in the terminal first.")
      await appendFile(s.eventsFile, IDLE_EVENT + '\n')
    },

    async move(
      projectId: string,
      ticketKey: string,
      column: BoardColumn,
      lane?: LaneChange
    ): Promise<void> {
      const project = projectById(projectId)
      if (!['todo', 'inProgress', 'done'].includes(column)) throw new Error('Unknown column')
      const laneId = (v: unknown): boolean => v === null || (typeof v === 'string' && v !== '')
      if (lane !== undefined && !(laneId(lane?.from) && laneId(lane?.to)))
        throw new Error('Unknown lane')
      await moveTicket(
        project,
        ticketKey,
        column,
        (t) => `Couldn't move ${ticketLabel(t)}`,
        true,
        lane
      )
    },

    resume: (sessionId: string): Promise<void> => api.resumeFor(undefined, sessionId),

    async resumeFor(startedBy: string | undefined, sessionId: string): Promise<void> {
      const s = sessionById(sessionId)
      assertFreeTmux(s.tmuxName, s.id)
      if (beingRemoved(s.worktrees)) throw new Error(REMOVING)
      const dir = folderOf(s)
      if (resuming.has(s.id)) throw new Error('Session is already resuming')
      if (s.ticketKey) assertNoLiveSession(s.projectId, s.ticketKey)
      else if (isLive(s)) throw new Error('Session is already running')
      resuming.add(s.id)
      await relaunch(s, dir)
      if (s.startedBy === startedBy) return
      if (startedBy) s.startedBy = startedBy
      else delete s.startedBy
      await persist()
    },

    async setRemoteControl(sessionId: string, on: boolean): Promise<void> {
      const s = sessionById(sessionId)
      if (resuming.has(s.id)) throw new Error('Session is already resuming')
      if (!!s.remoteControl === on) return
      if (s.state === 'finished') {
        s.remoteControl = on
        await persist()
        return changed(s.projectId)
      }
      if (on) {
        if (sending.has(s.id)) throw new Error('Already sending')
        await assertSendable(s)
        if (!!s.remoteControl === on) return
        if (sending.has(s.id)) throw new Error('Already sending')
        s.remoteControl = true
        resuming.add(s.id)
        let pasted = false
        try {
          await typeIntoTmux(
            deps.tmux,
            s.tmuxName,
            `/remote-control ${oneLine(s.name ?? shortName(s.ticketKey ?? ''))}`,
            async () => {
              pasted = true
              await persist()
              changed(s.projectId)
            }
          )
        } catch (err) {
          if (!pasted) {
            s.remoteControl = false
            await persist()
          }
          throw err
        } finally {
          resuming.delete(s.id)
        }
        return
      }
      if (s.state === 'running')
        throw new Error('Wait until the session needs you to turn Remote Control off')
      const dir = folderOf(s)
      resuming.add(s.id)
      await end(sessionId).catch((err) => {
        resuming.delete(s.id)
        throw err
      })
      s.remoteControl = on
      await relaunch(s, dir)
    },

    async send(sessionId: string, text: string, images: string[] = []): Promise<string> {
      const s = sessionById(sessionId)
      const message = withoutUnsafe(text).trim()
      const decoded = images.map(imageOf)
      if (!message && !decoded.length) throw new Error('Type a message first.')
      if (sending.has(s.id)) throw new Error('Already sending')
      sending.add(s.id)
      try {
        await assertSendable(s)
        const dir = imagesDir(s.id)
        if (decoded.length) await mkdir(dir, { recursive: true })
        const paths: string[] = []
        for (const { ext, bytes } of decoded) {
          paths.push(join(dir, `${randomUUID()}.${ext}`))
          await writeFile(paths[paths.length - 1], bytes)
        }
        let pasted = false
        const typed = withImages(paths, message)
        await typeIntoTmux(deps.tmux, s.tmuxName, typed, () => {
          pasted = true
        }).catch(async (err: unknown) => {
          if (!pasted) await Promise.all(paths.map((p) => rm(p, { force: true })))
          throw err
        })
        return typed
      } finally {
        sending.delete(s.id)
      }
    },

    async image(sessionId: string, path: string): Promise<string> {
      const s = sessionById(sessionId)
      const type = Object.keys(IMAGE_TYPES).find((t) => path.endsWith(`.${IMAGE_TYPES[t]}`))
      if (dirname(path) !== imagesDir(s.id) || !type)
        throw new Error("That isn't one of this session's images.")
      return `data:${type};base64,${(await readFile(path)).toString('base64')}`
    },

    async interrupt(sessionId: string): Promise<void> {
      const s = sessionById(sessionId)
      if (sending.has(s.id)) throw new Error('Already sending')
      await assertSendable(s)
      if (s.state !== 'running') throw new Error("Claude isn't working.")
      await deps.tmux.escapeTmux(s.tmuxName)
      await appendFile(s.eventsFile, STOPPED_EVENT + '\n')
    },

    async prompt(sessionId: string): Promise<SessionPrompt | null> {
      const s = sessionById(sessionId)
      if (!isLive(s) || !s.asking || (await stillStarting(s))) return null
      return promptNow(s)
    },

    async commands(sessionId: string): Promise<SessionCommand[]> {
      const s = sessionById(sessionId)
      if (!isLive(s)) throw new Error("The session isn't running.")
      if (await stillStarting(s)) throw new Error('The session is still starting.')
      let list = commandLists.get(s.id)
      if (!list) {
        list = printClaude(
          'Listing commands',
          "Claude Code didn't list its commands within 30 seconds",
          sessionDir(s)!,
          ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'],
          s.claudeDir,
          { timeoutMs: 30_000, input: INITIALIZE }
        ).then(commandsOf)
        list.catch(() => commandLists.get(s.id) === list && commandLists.delete(s.id))
        commandLists.set(s.id, list)
      }
      return list
    },

    async suggestion(sessionId: string): Promise<string | null> {
      const s = sessionById(sessionId)
      const busy = s.state === 'running' || s.asking || sending.has(s.id)
      if (!isLive(s) || busy || (await stillStarting(s))) return null
      const pane = await deps.tmux.captureTmux(s.tmuxName, true).catch(() => '')
      return suggestionOf(pane)
    },

    async answer(sessionId: string, shown: SessionPrompt, answer: PromptAnswer): Promise<void> {
      const s = sessionById(sessionId)
      if (sending.has(s.id)) throw new Error('Already sending')
      sending.add(s.id)
      try {
        if (await stillStarting(s)) throw new Error('The session is still starting.')
        if (!isLive(s) || !s.asking) throw new Error("Claude isn't asking anything.")
        const pane = await deps.tmux.captureTmux(s.tmuxName)
        const prompt = await promptNow(s, pane)
        const same = (p: SessionPrompt | null): boolean =>
          JSON.stringify(p) === JSON.stringify(shown)
        if (!prompt || !same(prompt) || !untouched(prompt, pane))
          throw new Error('The terminal has moved on from this question. Answer it there.')
        await deps.tmux.keysTmux(s.tmuxName, answerKeys(prompt, answer))
        if (prompt.kind !== 'permission') return
        // Claude Code fires no hook when a subagent's next request shows, or when none is left.
        if (prompt.agent) {
          let gone = 0
          for (let i = 0; i < 20 && gone < 3; i++) {
            await delay(100)
            const now = await deps.tmux.captureTmux(s.tmuxName)
            const next = await promptNow(s, now)
            if (next && !same(next)) break
            gone = choicesOf(now) ? 0 : gone + 1
          }
          if (gone === 3) await appendFile(s.eventsFile, ANSWERED_EVENT + '\n')
        } else if (answer.kind === 'choice' && /^No\b/.test(answer.label))
          await appendFile(s.eventsFile, STOPPED_EVENT + '\n')
      } finally {
        sending.delete(s.id)
      }
    },

    async compact(sessionId: string, step: 'prepare' | 'compact'): Promise<void> {
      const s = sessionById(sessionId)
      if (step !== 'prepare' && step !== 'compact') throw new Error('Not a compact step')
      if (sending.has(s.id)) throw new Error('Already sending')
      sending.add(s.id)
      try {
        await assertSendable(s)
        if (s.state === 'running') throw new Error('Wait until Claude stops working.')
        await mkdir(dirname(notesFile(s.id)), { recursive: true })
        const text = (step === 'prepare' ? prepareText : compactText)(notesFile(s.id))
        await typeIntoTmux(deps.tmux, s.tmuxName, text)
      } finally {
        sending.delete(s.id)
      }
    },

    removeWorktree,

    changes: changesOf,

    async openFolder(sessionId, folder, how) {
      const s = sessionById(sessionId)
      if (s.removedAt) throw new Error('The worktree was removed')
      const folders = s.worktrees.length ? s.worktrees : s.checkout ? [s.checkout] : []
      if (!folders.includes(folder)) throw new Error("Not this session's folder")
      if (!existsSync(folder)) throw goneError(s)
      const app = how === 'editor' ? projectById(s.projectId).editor : undefined
      if (how === 'editor' && !isApp(app)) throw new Error('No editor chosen')
      if (app && !existsSync(app))
        throw new Error(
          `${appName(app)} isn't at ${app}; choose another on the project's Review step`
        )
      const error = await deps.openFolder(folder, app)
      if (error) throw new Error(error)
    },

    ...reviewLoop,
    ...usageApi,
    ...jiraSignIn,
    ...leftoversApi,

    async endAndRemove(sessionId: string): Promise<RemoveResult> {
      await end(sessionId)
      return removeWorktree(sessionId)
    }
  }
  return api
}

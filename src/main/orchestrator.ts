import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { appendFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
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
  JiraProject,
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
  RunTrigger,
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
import { EFFORTS, MODELS, reassign, withGroup } from '../shared/types'
import { appName, isApp } from '../shared/editors'
import { isSandboxDomain, sandboxDomains } from '../shared/sandbox'
import { createCliServer, type CliHandler } from './sessions/cli'
import { branchName } from './git/branchName'
import { ownGitDir, worktreePath, WT_SUFFIX } from './git/worktree'
import type { AreasClient } from './github/areas'
import { boardError, type BoardClient } from './github/board'
import type { RepoIssuesClient } from './github/repoIssues'
import type { LinearClient } from './linear/client'
import { isJiraProjectKey, type JiraClient } from './jira/client'
import type { JiraCredentials } from './jira/credentials'
import { assertSite } from './jira/rest'
import { mergedFor, prsNaming, type MergedPr } from './github/merged'
import { linearProjectIn, repoOf, trackerOf, type Tracker } from './tracker'
import { parseBoardUrl } from '../shared/boardUrl'
import { APPLIED_BUT, AREA_PREFIX, areaOf, overlapCandidates, startProblems } from '../shared/areas'
import { sections } from '../shared/projectGroups'
import {
  currentSession,
  isDoneOpen,
  isLive,
  listedSessions,
  sessionDir,
  sessionRepos,
  tooLong
} from '../shared/sessions'
import { compactText, prepareText } from '../shared/compact'
import { sessionDraft } from '../shared/drafts'
import { IMAGE_TYPES, imageProblem, withImages } from '../shared/images'
import { columnFor, REPO_STATUS, statusMapOf } from '../shared/columns'
import {
  CREATED,
  findRepo,
  folderError,
  folderErrorRepo,
  isTrackerKey,
  parseTicketKey,
  sameRepo,
  serviceOf,
  sameTicketSource,
  ticketLabel,
  ticketSource
} from '../shared/repo'
import {
  instructionsBytes,
  instructionsFor,
  keptInstructions,
  MAX_INSTRUCTIONS_BYTES
} from '../shared/instructions'
import { shortTime } from '../shared/time'
import { TOKEN_CAPS } from '../shared/pricing'
import { DEFAULT_KEEP_DONE_DAYS, daysBefore, visibleTickets } from '../shared/visibleTickets'
import {
  claudeArgs,
  draftPrompt,
  agentSockets,
  hookSettings,
  sandboxSettings,
  STATUS_SCRIPT,
  GATE_SCRIPT,
  oneLine,
  withoutUnsafe,
  openingPrompt,
  schemaArgs,
  sessionRules,
  fitBytes,
  MAX_NOTE_BYTES
} from './sessions/claudeLaunch'
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
  hasStarted,
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
import { tmuxName, typeIntoTmux } from './sessions/tmux'
import { accountEnv, stopChildren } from './env/tools'
import { copyPaths, ignoredProblem, runSetup, stopSetups, suggestSetup } from './env/worktreeSetup'
import { SETUP_CANCELLED, SETUP_FAILED } from '../shared/worktreeSetup'
import { draftFile } from './drafts'
import { serial, type Run, type Store } from './store'
import type { SyncCache, SyncCacheStore } from './syncCache'
import { messageOf } from '../shared/errors'

const SYNC_MS = 60_000
const STALE_MS = 30 * 60_000
const POLL_MS = 3_000
const NOTIFY_WAIT_MS = 10_000
const STOP_READS = 4
const STOP_RETRY_MS = 500
const SCHEDULE_MS = 30_000
const EARLY_EXIT_MS = 10_000
const START_EVENT_MS = 30_000
const NOT_STARTED =
  "Claude Code hasn't started. It's probably waiting for you to trust this folder: open the terminal to answer it."

const unlessBusy = (tick: () => Promise<unknown>): (() => void) => {
  let busy = false
  return () => {
    if (busy) return
    busy = true
    void tick()
      .catch((err) => console.error(err))
      .finally(() => (busy = false))
  }
}
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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

type Synced = { tickets: Ticket[]; syncedAt: string | null; error: string | null }
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

const labelOf = (ticketKey: string): string =>
  ticketLabel({
    key: ticketKey,
    number: isTrackerKey(ticketKey) ? 0 : parseTicketKey(ticketKey).number
  })

const shortName = (ticketKey: string): string => ticketKey.split('/').pop() ?? ticketKey

const checkoutRepo = (repos: ProjectRepo[], s: SessionRecord): string =>
  (sessionRepos(repos, s)[0] ?? repos[0])?.github ?? ''

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

const sourceOf = (p: Project): string =>
  JSON.stringify([
    p.board?.source.url,
    p.linear?.team,
    p.linear?.projects.map((x) => x.id),
    p.linear?.workspace,
    p.jira?.site,
    p.jira?.project,
    p.jira?.board?.id
  ])

const tracked = (p: Project): boolean => serviceOf(p) !== 'GitHub'

function savedInstructions(x: unknown): Project['instructions'] {
  if (x === undefined) return undefined
  if (typeof x !== 'object' || x === null) throw new Error('Not instructions')
  const { all, labels = [] } = x as { all?: unknown; labels?: unknown }
  if (
    (all !== undefined && typeof all !== 'string') ||
    !Array.isArray(labels) ||
    labels.some((l) => typeof l?.label !== 'string' || typeof l?.text !== 'string')
  )
    throw new Error('Not instructions')
  const out = keptInstructions({ ...(all !== undefined && { all }), labels })
  const bytes = instructionsBytes(out)
  if (bytes > MAX_INSTRUCTIONS_BYTES)
    throw new Error(
      `Your instructions are ${bytes.toLocaleString('en-US')} bytes; the limit is ${MAX_INSTRUCTIONS_BYTES.toLocaleString('en-US')}`
    )
  return out
}

const fetchWarning = (github: string, fetchError?: string): string | undefined =>
  fetchError &&
  `Couldn't update ${github} from GitHub, so this branch starts from your local copy: ${fetchError}`

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
  const stamps = new Map<string, { stamp: string; at: number }>()
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
  const moves = new Map<string, Move>()
  const appliedSync = new Map<string, number>()
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
  const REMOVING = 'Wait until the worktree is removed'
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
  const launches = new Map<string, number>()
  const launchedAt = new Map<string, number>()
  const startBy = new Map<string, number>()
  const startFrom = new Map<string, number>()
  const startedSince = (s: SessionRecord): Promise<boolean> =>
    hasStarted(s.eventsFile, startFrom.get(s.id))
  const notStarted = (s: SessionRecord): boolean => !!s.startWarning?.endsWith(NOT_STARTED)
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
      if (!projects.some((p) => p.id === projectId)) return null
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
        const kept = startFailures.filter((f) => f.projectId !== projectId || keys.has(f.ticketKey))
        if (kept.length < startFailures.length) {
          startFailures = kept
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
    for (const s of sessions)
      if (
        s.projectId === projectId &&
        s.ticketKey &&
        s.branch &&
        isLive(s) &&
        !s.removedAt &&
        reviewLoop.autoOn(s)
      )
        void reviewLoop.autoPrFindings(s).catch(() => undefined)
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
      for (const s of sessions) {
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
  const assertJira = async (jira: JiraProject): Promise<void> => {
    assertSite(jira.site)
    if (!isJiraProjectKey(jira.project)) throw new Error('Not a Jira project key')
    if (typeof jira.name !== 'string' || /[\r\n]/.test(jira.name))
      throw new Error('Not a Jira project name')
    const { board } = jira
    if (
      board !== undefined &&
      (typeof board !== 'object' ||
        board === null ||
        !Number.isInteger(board.id) ||
        board.id <= 0 ||
        typeof board.name !== 'string' ||
        /[\r\n]/.test(board.name))
    )
      throw new Error('Not a Jira board')
    if (!(await deps.jiraCredentials.sites()).some((a) => a.site === jira.site))
      throw new Error(`No Jira account for ${jira.site}; add one in Add project`)
  }
  const syncSessions = (project: Project): SessionRecord[] =>
    sessions.filter(
      (s) =>
        s.projectId === project.id && s.ticketKey && (!s.removedAt || (!s.mergedAt && !s.noMerge))
    )
  const syncKeys = (project: Project): string[] => [
    ...new Set(syncSessions(project).map((s) => s.ticketKey!))
  ]
  const placeRepos = (project: Project, tickets: Ticket[]): void => {
    const projectSessions = sessions.filter((s) => s.projectId === project.id)
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
      projects
        .filter(
          (p) =>
            p.id === openId ||
            sessions.some((s) => s.projectId === p.id && isLive(s)) ||
            routines.some((r) => r.projectId === p.id && r.on)
        )
        .map((p) => (timed ? timedSync(p) : joinSync(p.id)))
    )

  const pollTmux = async (): Promise<void> => {
    const launched = new Map(launches)
    const watched = sessions.filter(isLive)
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
      const s = sessions.find((x) => x.id === id)
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
  const capFile = (id: string): string => join(settingsDir, `${id}.capped`)
  let pollingTmux = false
  const startPollingTmux = (): (() => void) => {
    pollingTmux = true
    const schedule = unlessBusy(runSchedules)
    const poll = unlessBusy(pollTmux)
    const watchLive = unlessBusy(liveView.tick)
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
  const added = (): Account[] => accounts.filter((a) => a.dir !== deps.claudeDir)
  const allAccounts = (): Account[] => [{ name: 'Default', dir: deps.claudeDir }, ...added()]
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
          allow: s.trigger ? undefined : routines.find((r) => r.id === s.routineId)?.allow,
          sandbox,
          repoPaths: repoPathsOf(s)
        },
        s.claudeDir
      )
      if (sandbox) s.sandbox = { allowedDomains: sandbox }
      else delete s.sandbox
      await reviewLoop.syncGate(s)
    } finally {
      resuming.delete(s.id)
    }
    missedConversations.delete(s.id)
    setAsking(s, false)
    s.state = shownState(s, 'needsYou')
    await persist()
    changed(s.projectId)
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
    gateFile,
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

  const createSession = async (
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
  ): Promise<string> => {
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
    const leftover = !!made && (made.created || setupPending.includes(made.path))
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
          const lines = setupApi.setupProgress(target)?.lines.slice(-5) ?? []
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
      sessions.push({
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
      unlessBusy(async () => visible && syncWatched(true)),
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
      if (!ok || pollingTmux) return
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

    anyRunning: () => pollingTmux && sessions.some((s) => s.state === 'running'),
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

    async saveProject(project: Project): Promise<void> {
      if ([project.board, project.linear, project.jira].filter(Boolean).length > 1)
        throw new Error('Pick one ticket source')
      const workspace = project.linear?.workspace
      if (workspace !== undefined && !/^[A-Za-z0-9._-]+$/.test(workspace))
        throw new Error('Not a Linear workspace')
      if (project.linear && !/^[A-Za-z0-9_]+$/.test(project.linear.team))
        throw new Error('Not a Linear team')
      if (project.linear?.projects.some((p) => !/^[A-Za-z0-9-]+$/.test(p.id)))
        throw new Error('Not a Linear project')
      if (project.jira) await assertJira(project.jira)
      if (project.tokenCap !== undefined && !TOKEN_CAPS.includes(project.tokenCap))
        throw new Error('Not a token cap')
      assertModel(project.model)
      assertEffort(project.effort)
      if (project.editor !== undefined && typeof project.editor !== 'string')
        throw new Error('Not an editor')
      if (!isApp(project.editor)) delete project.editor
      if (project.sandbox !== undefined && project.sandbox !== true)
        throw new Error('Not a sandbox choice')
      if (project.sandboxDomains !== undefined && !Array.isArray(project.sandboxDomains))
        throw new Error('Not a domain list')
      for (const d of project.sandboxDomains ?? [])
        if (typeof d !== 'string' || !isSandboxDomain(d))
          throw new Error(`Not a domain: ${String(d)}`)
      const saved = projects.find((x) => x.id === project.id)?.repos ?? []
      const repos = await Promise.all(
        project.repos.map((r) => savedRepo(r, findRepo(saved, r.github)))
      )
      const { instructions, ...plain } = { ...project, repos }
      const kept = savedInstructions(instructions)
      const checked: Project = kept ? { ...plain, instructions: kept } : plain
      const { claudeDir, ...rest } = checked
      const p: Project =
        accounts.some((a) => a.dir === claudeDir) || accountEnv(claudeDir, deps.claudeDir)
          ? checked
          : rest
      if (p.claudeDir && !accounts.some((a) => a.dir === p.claudeDir))
        throw new Error(`Add the account for ${p.claudeDir} on Settings first`)
      const i = projects.findIndex((x) => x.id === p.id)
      const resourced = i >= 0 && sourceOf(projects[i]) !== sourceOf(p)
      projects =
        i < 0
          ? [...projects, withGroup(p, undefined)]
          : projects.with(i, withGroup(p, projects[i].group))
      const cleared = await clearFixedFolders(p)
      await persist()
      if (cleared) changed(p.id)
      for (const s of sessions) if (s.projectId === p.id) await reviewLoop.syncGate(s)
      if (resourced) {
        synced.delete(p.id)
        mergedPrs.delete(p.id)
        for (const [id, m] of moves) if (m.projectId === p.id) moves.delete(id)
        appliedSync.set(p.id, now().getTime())
        persistCache()
      }
      void sync(p.id)
    },

    async setEditor(projectId, app) {
      if (!isApp(app)) throw new Error('Not an editor')
      const p = projectById(projectId)
      projects = projects.map((x) => (x === p ? { ...p, editor: app } : x))
      await persist()
    },

    listGroups: async (): Promise<ProjectGroup[]> => groups,

    /** Replaces the groups and reorders projects to `order`; unlisted projects keep their order at the end. */
    async arrangeProjects(
      next: ProjectGroup[],
      order: { id: string; group?: string }[]
    ): Promise<void> {
      const byId = new Map(projects.map((p) => [p.id, p]))
      const valid = next
        .filter((g) => typeof g?.id === 'string' && typeof g.name === 'string')
        .map(({ id, name }) => ({ id, name }))
      const known = new Set(valid.map((g) => g.id))
      const placed = order.flatMap(({ id, group }) => {
        const p = byId.get(id)
        if (!p) return []
        byId.delete(id)
        return [withGroup(p, typeof group === 'string' ? group : undefined)]
      })
      groups = valid.filter((g, i) => valid.findIndex((x) => x.id === g.id) === i)
      projects = [...placed, ...byId.values()].map((p) =>
        withGroup(p, p.group && known.has(p.group) ? p.group : undefined)
      )
      await persist()
    },

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

    listAccounts: async (): Promise<Account[]> => allAccounts(),

    async addAccount(a: Account): Promise<void> {
      const name = a.name.trim()
      const typed = a.dir.trim()
      if (!name) throw new Error('Enter a name')
      if (!typed) throw new Error('Enter a folder')
      const expanded = typed.startsWith('~/') ? homedir() + typed.slice(1) : typed
      if (!isAbsolute(expanded)) throw new Error('Enter a full path, starting with / or ~/')
      const dir = resolve(expanded)
      if (dir === homedir() || dir === '/')
        throw new Error(`${dir} can't be an account's folder. Use a folder such as ~/.claude-work.`)
      const all = allAccounts()
      if (all.some((x) => x.name.toLowerCase() === name.toLowerCase()))
        throw new Error(`An account named ${name} already exists`)
      const owner = all.find((x) => resolve(x.dir) === dir)
      if (owner) throw new Error(`${owner.name} already uses ${dir}`)
      accounts = [...accounts, { name, dir }]
      await persist()
    },

    async removeAccount(dir: string): Promise<void> {
      if (dir === deps.claudeDir) throw new Error("Default can't be removed")
      const account = accounts.find((a) => a.dir === dir)
      if (!account) throw new Error('Unknown account')
      const users = projects.filter((p) => p.claudeDir === dir).map((p) => p.name)
      if (users.length)
        throw new Error(
          `${users.join(', ')} ${users.length === 1 ? 'uses' : 'use'} ${account.name}. Pick another account for ${users.length === 1 ? 'it' : 'them'} first.`
        )
      accounts = accounts.filter((a) => a !== account)
      await persist()
    },

    usedAccounts: (): Account[] =>
      added().filter((a) => projects.some((p) => p.claudeDir === a.dir)),

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

    /** Records the project whose board is open and whether the window shows; syncs what just came into view. */
    watch(projectId: string | null, shown: boolean): void {
      const appeared = shown && !visible
      const switched = projectId !== openId
      openId = projectId
      visible = shown
      if (appeared) void syncWatched()
      else if (shown && switched && projectId) void joinSync(projectId)
    },

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
        startFailures = startFailures.filter(
          (f) => f.projectId !== projectId || f.ticketKey !== ticketKey
        )
        const mine = sessions.filter((s) => s.projectId === projectId)
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
          const launched = await launchNew(
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
          sessions.push({
            id,
            projectId,
            ticketKey,
            tmuxName: name,
            branch,
            worktrees,
            ...launched,
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
        await reviewLoop.syncGate(sessions.at(-1)!)
        if (setup === false) await unpend(worktrees)
        ticket.repo = main.github
        const fresh = synced.get(projectId)?.tickets.find((t) => t.key === ticketKey)
        if (fresh) fresh.repo = main.github
        persistCache()
        await persist()
        changed(projectId)

        await moves.get(ticketId(projectId, ticketKey))?.writing
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
          const lines = reason.startsWith(SETUP_FAILED) ? setupApi.setupProgress(target)?.lines : []
          startFailures.push({
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
    },

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

import type {
  Account,
  Activity,
  BoardColumn,
  Chat,
  ChatState,
  ComposerDraft,
  ConversationChunk,
  Finding,
  FindingPatch,
  FindingsState,
  NewFinding,
  PullRequestState,
  LaneChange,
  LastView,
  JiraAccount,
  LinearTeam,
  LinearWorkspace,
  Leftover,
  Model,
  ModelUsage,
  UsageByWeek,
  NotificationSettings,
  Overlap,
  Project,
  ProjectGroup,
  RemoveResult,
  RepoChanges,
  Routine,
  RoutineChatReply,
  RoutineChatTurn,
  RoutineInput,
  RoutineRun,
  SessionCommand,
  SessionRecord,
  SetupProgress,
  SetupSuggestion,
  StartCheck,
  Step,
  Ticket,
  Theme,
  TicketDetails,
  TicketDraft,
  TicketRef,
  TicketUsage,
  ToolCheck,
  Triage
} from './types'
import type { PromptAnswer, SessionPrompt } from './prompt'
import type { SessionStatus } from './sessionStatus'

/** A session the sidebar lists; `done` marks Done, session open. */
export type SidebarSession = SessionRecord & { done?: true }

/** A project's board: the last synced tickets, all its sessions, Needs-you counts per project ID, and its routines in save order. */
export type BoardView = {
  tickets: Omit<Ticket, 'body'>[]
  sessions: SessionRecord[]
  /** Other projects' live sessions on this board's tickets, matched by ticket source and key. */
  elsewhere: SessionRecord[]
  /** Every project's sessions the sidebar lists, Done, session open last; a ticket session's name is its ticket's title. */
  sidebarSessions: SidebarSession[]
  syncedAt: string | null
  error: string | null
  needsYou: Record<string, number>
  routines: Routine[]
}

/** Whether the sidebar is hidden, its width, and whether the window is in full screen. */
export type WindowFrame = { sidebarHidden: boolean; sidebarWidth: number; fullScreen: boolean }

/** The sidebar's width range and default, in px. */
export const SIDEBAR_WIDTH = { min: 180, default: 224, max: 400 }

/** `width` rounded into the sidebar's range, or the default when it isn't a number. */
export const sidebarWidth = (width: unknown): number =>
  typeof width === 'number' && Number.isFinite(width)
    ? Math.round(Math.min(Math.max(width, SIDEBAR_WIDTH.min), SIDEBAR_WIDTH.max))
    : SIDEBAR_WIDTH.default

/** The API the preload script exposes to the renderer as `window.sandtable`. */
export type SandtableApi = {
  projects: {
    list(): Promise<Project[]>
    save(p: Project): Promise<void>
    remove(id: string): Promise<void>
    groups(): Promise<ProjectGroup[]>
    arrange(groups: ProjectGroup[], order: { id: string; group?: string }[]): Promise<void>
    statusOptions(url: string): Promise<string[]>
    boardRepos(url: string): Promise<string[]>
    /** The signed-in login on the project's ticket source: GitHub, the Linear workspace, or the Jira site. */
    me(projectId: string): Promise<string>
    linearTeams(workspace?: string): Promise<LinearTeam[]>
    linearWorkspaces(): Promise<LinearWorkspace[]>
    /** The saved Jira accounts, without their tokens. */
    jiraAccounts(): Promise<JiraAccount[]>
    /** Checks a Jira site, email, and API token with Jira, then saves them; the token never comes back. */
    jiraSignIn(site: string, email: string, token: string): Promise<JiraAccount>
    jiraProjects(site: string): Promise<{ key: string; name: string }[]>
    jiraBoards(site: string, project: string): Promise<{ id: number; name: string }[]>
    pickFolder(): Promise<{ path: string; repos: string[] } | null>
    /** Each project's token use by week, leaving out projects without any. */
    usage(): Promise<UsageByWeek>
  }
  accounts: {
    list(): Promise<Account[]>
    add(a: Account): Promise<void>
    remove(dir: string): Promise<void>
    folders(): Promise<string[]>
    signedIn(dir: string): Promise<boolean | null>
  }
  board: {
    get(projectId: string): Promise<BoardView>
    sync(projectId: string): Promise<void>
    watch(projectId: string | null, visible: boolean): void
    onChange(cb: (projectId: string) => void): () => void
  }
  tickets: {
    start(
      projectId: string,
      ticketKey: string,
      extraRepos?: string[],
      mainRepo?: string,
      note?: string,
      model?: Model | null,
      setup?: false
    ): Promise<void>
    checkStart(projectId: string, ticketKey: string): Promise<StartCheck>
    checkOverlap(projectId: string, ticketKey: string): Promise<Overlap[]>
    checkReady(projectId: string, ticketKey: string): Promise<string[]>
    triage(projectId: string, ticketKey: string): Promise<Triage>
    applyTriage(projectId: string, ticketKey: string, t: Triage): Promise<void>
    chat(projectId: string, ticketKey: string): Promise<ChatState>
    sendChat(projectId: string, ticketKey: string, text: string): Promise<Chat>
    /** Drafts a comment from the chat, or rewrites `mine`, your draft, using the ticket and the chat. */
    draftComment(projectId: string, ticketKey: string, mine?: string): Promise<string>
    saveDraft(projectId: string, ticketKey: string, draft: string): Promise<void>
    postComment(projectId: string, ticketKey: string, body: string): Promise<void>
    discardDraft(projectId: string, ticketKey: string): Promise<void>
    clearChat(projectId: string, ticketKey: string): Promise<void>
    /** Stops Claude's running chat answer or draft for the ticket; it does nothing when none runs. */
    stopChat(projectId: string, ticketKey: string): Promise<void>
    /** Calls `cb` with every step so far each time Claude takes a step in a ticket's chat turn. */
    onChatSteps(cb: (projectId: string, ticketKey: string, steps: Step[]) => void): () => void
    /** Files an issue in `where`: a repo, on a Linear project the chosen Linear project's ID, or '' in a Jira project; with `parent`, as a sub-issue of that ticket key. */
    create(
      projectId: string,
      where: string,
      title: string,
      body: string,
      parent?: string
    ): Promise<string>
    /** Moves a ticket to `column` and, with `lane`, from one assignee lane to another. */
    move(
      projectId: string,
      ticketKey: string,
      column: BoardColumn,
      lane?: LaneChange
    ): Promise<void>
    details(projectId: string, ticketKey: string): Promise<TicketDetails>
    usage(projectId: string, ticketKey: string): Promise<TicketUsage>
  }
  sessions: {
    resume(sessionId: string): Promise<void>
    removeWorktree(sessionId: string): Promise<RemoveResult>
    endAndRemove(sessionId: string): Promise<RemoveResult>
    /** Starts a session without a ticket; a non-blank `firstMessage` is its prompt. */
    create(
      projectId: string,
      repo: string,
      worktree: boolean,
      draft?: TicketDraft,
      firstMessage?: string,
      model?: Model | null,
      setupId?: string,
      setup?: false
    ): Promise<string>
    /** The text of the session's first message, or '' without a transcript. */
    firstMessage(sessionId: string): Promise<string>
    rename(sessionId: string, name: string): Promise<void>
    /** A running session's latest steps, or null when it isn't running or has none yet. */
    activity(sessionId: string): Promise<Activity | null>
    /** Calls `cb` when a running session's latest steps change. */
    onActivity(cb: (sessionId: string, activity: Activity) => void): () => void
    /** The session's latest status-line facts with its running background tasks, or null before Claude Code wrote any. */
    status(sessionId: string): Promise<SessionStatus | null>
    /** Calls `cb` when a live session's status-line facts or background tasks change. */
    onStatus(cb: (sessionId: string, status: SessionStatus) => void): () => void
    /** The last entries of the session's conversation; a live session's later changes come through `onConversation` until the last unwatch. */
    watchConversation(sessionId: string): Promise<ConversationChunk>
    unwatchConversation(sessionId: string): Promise<void>
    /** Calls `cb` with each change to a watched conversation, indexed into the entries `watchConversation` returned. */
    onConversation(cb: (sessionId: string, chunk: ConversationChunk) => void): () => void
    /** Each live session's token use so far, by session ID. */
    liveUsage(): Promise<Record<string, ModelUsage[]>>
    /** Calls `cb` with every live session's token use when any of it changes. */
    onLiveUsage(cb: (usage: Record<string, ModelUsage[]>) => void): () => void
    /** Lets a session stopped at its token cap use another project cap's worth of tokens. */
    raiseCap(sessionId: string): Promise<void>
    /** Each of the session's worktrees' changes against the merge base with the default branch. */
    changes(sessionId: string): Promise<RepoChanges[]>
    /** The session's findings and AI review proposals. */
    findings(sessionId: string): Promise<FindingsState>
    addFinding(sessionId: string, f: NewFinding): Promise<Finding>
    updateFinding(sessionId: string, id: string, patch: FindingPatch): Promise<void>
    removeFinding(sessionId: string, id: string): Promise<void>
    /** Pastes the chosen unsent findings into the session's terminal as one message and marks them sent. */
    sendFindings(sessionId: string, ids: string[]): Promise<void>
    /** Runs a read-only AI review of the session's changes, replacing the undecided proposals. */
    review(sessionId: string): Promise<number>
    /** The open pull request for the session's branch in each of its worktrees' repos. */
    pullRequests(sessionId: string): Promise<PullRequestState[]>
    /** Adds a failing check of the session's pull request, with its failed log, as a finding once. */
    addCheck(sessionId: string, repo: string, jobId: number, name: string): Promise<Finding>
    /** Adds an open thread of the session's pull request as a finding once. */
    addThread(sessionId: string, repo: string, threadId: string): Promise<Finding>
    /** Turns the session's automatic review on, starting its rounds over, or off. */
    setAutoReview(sessionId: string, on: boolean): Promise<void>
    /** Drafts a summary of a ticket session into its ticket's chat draft. */
    summarize(sessionId: string): Promise<void>
    /** Types a message into the live session's terminal and presses Enter, with each image data URL saved and mentioned before it, and returns what it typed. */
    send(sessionId: string, text: string, images?: string[]): Promise<string>
    /** One of the session's sent images, as a data URL. */
    image(sessionId: string, path: string): Promise<string>
    /** Presses Escape in the live session to stop Claude's current turn. */
    interrupt(sessionId: string): Promise<void>
    /** Types the message that asks Claude to write notes before compacting, or the /compact that keeps them. */
    compact(sessionId: string, step: 'prepare' | 'compact'): Promise<void>
    /** What Claude waits on you to answer in the live session, or null when the question card can't show it. */
    prompt(sessionId: string): Promise<SessionPrompt | null>
    /** The slash commands the live session offers, less the ones that open a panel in the terminal. */
    commands(sessionId: string): Promise<SessionCommand[]>
    /** The next message Claude Code suggests in the live session's prompt, or null when it shows none. */
    suggestion(sessionId: string): Promise<string | null>
    /** Types the keys that give your answer to `shown`, after checking Claude still asks it and the terminal shows it untouched. */
    answer(sessionId: string, shown: SessionPrompt, answer: PromptAnswer): Promise<void>
    end(sessionId: string): Promise<void>
    setRemoteControl(sessionId: string, on: boolean): Promise<void>
    clearNeedsYou(sessionId: string): Promise<void>
    leftovers(): Promise<Leftover[]>
    endUnknown(tmuxName: string): Promise<void>
  }
  routines: {
    list(projectId: string): Promise<Routine[]>
    save(input: RoutineInput): Promise<Routine>
    remove(id: string): Promise<void>
    /** Starts the routine as a session without a ticket and returns its ID. */
    start(id: string): Promise<string>
    /** The routine's sessions and skipped times, newest first. */
    history(id: string): Promise<RoutineRun[]>
    /** Sends one message to Claude in the routine editor's chat and returns its reply and any proposed routine. */
    chat(turn: RoutineChatTurn): Promise<RoutineChatReply>
    /** Stops the routine chat turn with this `runId`; it does nothing when none runs. */
    stopChat(runId: string): Promise<void>
    /** Calls `cb` with every step so far each time Claude takes a step in a routine chat turn. */
    onChatSteps(cb: (runId: string, steps: Step[]) => void): () => void
  }
  setup: {
    /** The worktree setup running or failed for `target`: `<projectId>\n<ticketKey>`, or a new session's setup ID. */
    progress(target: string): Promise<SetupProgress | null>
    /** Stops the target's setup; after a new session's setup failed, also tries to remove its worktree. */
    cancel(target: string): Promise<void>
    /** The setup the checkout in `path` seems to need, or null when it has nothing to suggest. */
    suggest(path: string): Promise<SetupSuggestion | null>
    /** The repo's suggested setup for a Start's hint, or null when it has a setup, nothing to suggest, or **Not now** hid it. */
    hint(projectId: string, repo: string): Promise<SetupSuggestion | null>
    /** Hides the repo's setup hint for good. */
    hideHint(projectId: string, repo: string): Promise<void>
    /** Calls `cb` each time a target's setup progress changes, with null once it is over. */
    onProgress(cb: (target: string, progress: SetupProgress | null) => void): () => void
  }
  terminal: {
    open(sessionId: string, cols: number, rows: number): Promise<void>
    write(sessionId: string, data: string): void
    resize(sessionId: string, cols: number, rows: number): void
    close(sessionId: string): void
    onData(cb: (sessionId: string, data: string) => void): () => void
  }
  app: {
    onOpen(cb: (view: LastView) => void): () => void
    pendingOpen(): Promise<LastView | 'settings' | null>
    tools(): Promise<ToolCheck>
    theme(): Promise<Theme>
    setTheme(theme: Theme): Promise<void>
    keepAwake(): Promise<boolean>
    setKeepAwake(on: boolean): Promise<void>
    notifications(): Promise<NotificationSettings>
    setNotifications(settings: NotificationSettings): Promise<void>
    openNotificationSettings(): Promise<void>
    remoteControl(): Promise<boolean>
    setRemoteControl(on: boolean): Promise<void>
    awake(): Promise<boolean>
    onAwake(cb: (active: boolean) => void): () => void
    onSettings(cb: () => void): () => void
    lastView(): Promise<LastView | null>
    saveView(view: LastView): void
    frame(): Promise<WindowFrame>
    onFrame(cb: (frame: WindowFrame) => void): () => void
    onSwipe(cb: (direction: string) => void): () => void
    setSidebarHidden(hidden: boolean): void
    setSidebarWidth(width: number): void
    setStartFailures(tickets: TicketRef[]): void
    /** The unsent composer draft saved under `key`, or null when there is none. */
    draft(key: string): Promise<ComposerDraft | null>
    /** Saves each part of the draft under `key` that `patch` has, removing an empty one. */
    saveDraft(key: string, patch: Partial<ComposerDraft>): void
  }
}

type Group = keyof SandtableApi
type Channel = { [G in Group]: `${G}.${keyof SandtableApi[G] & string}` }[Group]

/** The `SandtableApi` method a `group.method` channel stands for. */
export type ApiMethod<C extends Channel> = C extends `${infer G extends Group}.${infer M}`
  ? M extends keyof SandtableApi[G]
    ? SandtableApi[G][M]
    : never
  : never

/** A channel the renderer invokes and awaits. */
export type InvokeChannel = {
  [C in Channel]: ApiMethod<C> extends (...args: never[]) => Promise<unknown> ? C : never
}[Channel]

/** A channel the main process pushes on, named after the `on*` method that listens to it. */
export type PushChannel = Extract<Channel, `${string}.on${string}`>

/** The arguments a push channel's listener receives. */
export type PushArgs<C extends PushChannel> = Parameters<Parameters<ApiMethod<C>>[0]>

/** A fire-and-forget channel the renderer sends on. */
export type SendChannel = Exclude<Channel, InvokeChannel | PushChannel>

/** The main-process handler for each invoke and send channel, typed from its `SandtableApi` method. */
export type Handlers = {
  [C in InvokeChannel | SendChannel]: (
    ...args: Parameters<ApiMethod<C>>
  ) => Awaited<ReturnType<ApiMethod<C>>> | ReturnType<ApiMethod<C>>
}

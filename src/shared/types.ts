/** Where a project's tickets come from. */
export type BoardSource = {
  url: string
  ownerType: 'user' | 'org'
  owner: string
  number: number
}

/** The board's option names for the three statuses Sandtable understands. */
export type StatusMap = { todo: string; inProgress: string; done: string }

/** A project's GitHub repo, `owner/name`, and the local folder picked for it. */
export type ProjectRepo = {
  github: string
  path: string
  setup?: { copy?: string[]; command?: string }
}

/** A worktree setup Sandtable suggests from the main checkout: ignored settings files and a lockfile's command. */
export type SetupSuggestion = { copy: string[]; command?: string }

/** A worktree setup's live state: the repo it runs in, skipped-copy notes, and the command's last lines. */
export type SetupProgress = {
  repo: string
  state: 'running' | 'failed'
  notes: string[]
  lines: string[]
  error?: string
  startedAt: string
}

/** A Claude Code account: a name and the folder Claude Code reads it from through `CLAUDE_CONFIG_DIR`. */
export type Account = { name: string; dir: string }

/** The models a project or session can choose, as Claude Code aliases that follow its latest model. */
export const MODELS = ['fable', 'opus', 'sonnet', 'haiku'] as const

/** A Claude Code model alias, passed as `--model`. */
export type Model = (typeof MODELS)[number]

/** The model controls' choices, with `default` for Account default. */
export const MODEL_CHOICES: (Model | 'default')[] = ['default', ...MODELS]

const choiceLabel = (c: string | null | undefined): string =>
  c && c !== 'default' ? c[0].toUpperCase() + c.slice(1) : 'Account default'

/** A model's name, such as "Opus", or "Account default" for none. */
export const modelLabel = (m: Model | 'default' | null | undefined): string => choiceLabel(m)

/** The effort levels a project, session, or routine can choose, passed as `--effort`. */
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

/** A Claude Code effort level. */
export type Effort = (typeof EFFORTS)[number]

/** The effort controls' choices, with `default` for Account default. */
export const EFFORT_CHOICES: (Effort | 'default')[] = ['default', ...EFFORTS]

/** An effort's name, such as "High" or "Extra high", or "Account default" for none. */
export const effortLabel = (e: Effort | 'default' | null | undefined): string =>
  e === 'xhigh' ? 'Extra high' : choiceLabel(e)

/** A project: its repos, ticket source, and per-project session settings. */
export type Project = {
  id: string
  name: string
  repos: ProjectRepo[]
  board?: { source: BoardSource; statusMap: StatusMap }
  linear?: { team: string; projects: { id: string; name: string }[]; workspace?: string }
  jira?: JiraProject
  remoteControl?: boolean
  claudeDir?: string
  model?: Model
  effort?: Effort
  editor?: string
  group?: string
  icon?: string
  keepDoneDays?: number
  tokenCap?: number
  readyCheck?: false
  autoReview?: true
  sandbox?: true
  sandboxDomains?: string[]
  instructions?: { all?: string; labels?: { label: string; text: string }[] }
}

/** A Jira Cloud project, by site such as `acme.atlassian.net`, key such as `INF`, and name, and the board whose backlog Sandtable hides. */
export type JiraProject = {
  site: string
  project: string
  name: string
  board?: { id: number; name: string }
}

/** A saved Jira sign-in: the site and the email its API token belongs to. */
export type JiraAccount = { site: string; email: string }

/** A Linear workspace the CLI is signed in to, by slug, and whether it is the CLI's default. */
export type LinearWorkspace = { slug: string; organization: string; default: boolean }

/** A Linear team, by key such as `APP`, and the Linear projects it is part of. */
export type LinearTeam = { key: string; name: string; projects: { id: string; name: string }[] }

/** A named section of projects in the sidebar. */
export type ProjectGroup = { id: string; name: string }

/** A copy of `project` in `group`, or with no `group` key when it's undefined. */
export function withGroup(project: Project, group: string | undefined): Project {
  const copy = { ...project }
  delete copy.group
  return group ? { ...copy, group } : copy
}

/** A drop in another assignee lane: the lanes' assignee IDs, null for No assignee. */
export type LaneChange = { from: string | null; to: string | null }

/** The assignees after a lane change on GitHub: without `from`, with `person` added once. */
export function reassign<P extends { id: string }>(
  assignees: P[],
  from: string | null,
  person: P | null
): P[] {
  const kept = assignees.filter((a) => a.id !== from)
  return person && !kept.some((a) => a.id === person.id) ? [...kept, person] : kept
}

/** A board item; `key` is `owner/name#number` or a Linear or Jira key such as `DEMO-123`. */
export type Ticket = {
  key: string
  itemId: string
  number: number
  title: string
  body: string
  url: string
  repo: string
  status: string | null
  doneAt: string | null
  labels: { name: string; color: string }[]
  assignees: { id: string; login: string; name: string | null }[]
  createdAt: string
  updatedAt: string
  parent: ParentRef | null
  subIssues: { completed: number; total: number; items: SubIssue[] }
  boardFields: { name: string; value: string }[]
  blockedBy: { key: string; number: number; title: string; repo: string }[]
  mergedPr: string | null
  mergedAt: string | null
  prStage: PrStage | null
  notPlanned?: true
}

/** A parent or sub-issue as a ticket names it, with `column` from its issue state. */
export type IssueRef = {
  key: string
  number: number
  title: string
  repo: string
  url: string
  column: Column
}

/** A ticket's parent, with its sub-issue counts where the service gives them. */
type ParentRef = IssueRef & { subIssues?: { completed: number; total: number } }

/** A sub-issue as named on its parent; `assignee` is the first assignee's login or name. */
export type SubIssue = IssueRef & { assignee: string | null }

/** What the ticket view shows for an issue, fetched when it opens. */
export type TicketDetails = {
  body: string
  labels: { name: string; color: string }[]
  comments: { author: string; createdAt: string; body: string }[]
  pullRequests: {
    number: number
    title: string
    url: string
    state: 'open' | 'merged' | 'closed'
  }[]
}

export type SessionState =
  'running' | 'needsYou' | 'reviewing' | 'idle' | 'done' | 'finished' | 'limitReached' | 'apiError'

/** Why a session's turn failed: Claude Code's one-line message and, for a plan limit, its reset time in ms since the epoch. */
export type SessionStop = { message: string; resetsAt?: number }

/** What the Start check found. */
export type StartCheck = {
  triage: boolean
  problems: string[]
  overlap: { key: string; number: number; title: string }[]
  ready: boolean
}

/** An in-progress ticket Claude found really overlaps the one you start, and why. */
export type Overlap = { key: string; number: number; title: string; reason: string }

/** A repo label whose name starts with `area:`. */
export type Area = { name: string; description: string }

/** What you typed in New ticket for a session to draft from; `linearProject` is the chosen Linear project's ID. */
export type TicketDraft = { title: string; body: string; linearProject?: string }

/** What Claude proposed for an unlabeled ticket: its area, any new areas, and its open blockers. */
export type Triage = {
  area: string
  newAreas: Area[]
  blockedBy: { key: string; number: number; title: string }[]
  reason: string
}

/** A Claude Code session, with or without a ticket; `sandbox` holds the domains its sandbox allowed at its last start or resume. */
export type SessionRecord = {
  id: string
  projectId: string
  ticketKey?: string
  name?: string
  /** The note you wrote when you started the ticket, for its reviews. */
  note?: string
  tmuxName: string
  branch?: string
  worktrees: string[]
  checkout?: string
  eventsFile: string
  startedAt: string
  state: SessionState
  stop?: SessionStop
  asking?: true
  removedAt?: string
  mergedAt?: string
  noMerge?: true
  startWarning?: string
  unprompted?: true
  remoteControl?: boolean
  claudeDir?: string
  model?: Model
  effort?: Effort
  routineId?: string
  /** The session whose `sandtable start` started or last resumed this one. */
  startedBy?: string
  scheduled?: true
  trigger?: RunTrigger
  tokenCap?: number
  capped?: true
  sandbox?: { allowedDomains: string[] }
  autoReview?: AutoReview
  reviews?: ReviewCount
  reviewRounds?: ReviewRound[]
}

/** An automatic review round; `at` is the absolute conversation entry index it started at. */
export type ReviewRound = {
  at?: number
  round: number
  startedAt: string
  files: number
  endedAt?: string
  found?: number
  sent?: number
  waiting?: number
  error?: string
}

/** How many Claude reviews of a session finished, and when the last one did. */
type ReviewCount = { count: number; at: string }

/** The most review rounds an automatic review runs. */
export const AUTO_REVIEW_ROUNDS = 3

/** A session's automatic review: its override of the project setting, the rounds run, the hash of the diff last reviewed, why it stopped, and the pull request checks, threads, and conflicts already added. */
export type AutoReview = {
  on?: boolean
  rounds: number
  reviewed?: string
  stopped?: 'clean' | 'rounds'
  added?: string[]
  fingerprint?: string
  gateFrom?: number
  held?: true
}

/** When a routine runs: days as `Date.getDay()` and a 24-hour "HH:MM" local time. */
export type Schedule = { days: number[]; time: string }

/** The events that start a routine: a ticket getting `label`, or a ticket's pull request checks starting to fail. */
export type RoutineEvents = { label?: string; checksFail?: true }

/** The event that started a routine's run; `ticket` is the ticket key. */
export type RunTrigger =
  { kind: 'label'; label: string; ticket: string } | { kind: 'checks'; ticket: string }

/** A saved way to start a session without a ticket; `repo` is `owner/name`, `allow` the permission rules its sessions use without asking, `scheduledThrough` the ISO time the timer last checked it up to, and `dailyCap` the most event starts a day. */
export type Routine = {
  id: string
  projectId: string
  name: string
  repo: string
  worktree: boolean
  message: string
  allow?: string[]
  schedule?: Schedule
  scheduledThrough?: string
  on?: RoutineEvents
  dailyCap?: number
  model?: Model | null
  effort?: Effort | null
}

/** A routine as the form saves it, with no `id` when it is new. */
export type RoutineInput = Pick<
  Routine,
  | 'projectId'
  | 'name'
  | 'repo'
  | 'worktree'
  | 'message'
  | 'allow'
  | 'schedule'
  | 'on'
  | 'dailyCap'
  | 'model'
  | 'effort'
> & {
  id?: string
}

/** A routine Claude proposes in the routine chat, or the form's fields it sees; `schedule` is null when it runs only by hand. */
export type RoutineProposal = {
  name: string
  repo: string
  worktree: boolean
  message: string
  allow: string[]
  schedule: Schedule | null
}

/** The project name and repo of the routine a copy came from. */
export type RoutineSource = { project: string; repo: string }

/** One message to the routine chat, with no `conversationId` on the first turn. */
export type RoutineChatTurn = {
  projectId: string
  conversationId?: string
  repo: string
  message: string
  form: RoutineProposal
  copiedFrom?: RoutineSource
  /** The ID the renderer picks for this turn, to hear its steps and stop it. */
  runId: string
}

/** Claude's answer in the routine chat, with the whole routine when it proposes one. */
export type RoutineChatReply = { conversationId: string; reply: string; routine?: RoutineProposal }

/** A scheduled or event run that didn't start: Sandtable was closed, its last session was open, the daily cap was reached, or the start failed with `error`. */
export type SkippedRun = {
  routineId: string
  at: string
  reason: 'closed' | 'running' | 'failed' | 'capped'
  error?: string
  trigger?: RunTrigger
}

/** A ticket's last failed Start, kept until it starts, leaves the board, or its folder passes the check; `repo` is the repo whose folder failed it, `lines` a failed setup's last lines. */
export type StartFailure = {
  projectId: string
  ticketKey: string
  at: string
  reason: string
  repo: string | null
  lines?: string[]
}

/** One run in a routine's history: a skipped time or a session, where `place` is its branch or "main checkout", `waitingFor` the tool it stopped to ask permission for, and `warning` its start warning. */
export type RoutineRun = { at: string; scheduled: boolean; trigger?: RunTrigger } & (
  | { kind: 'skipped'; reason: SkippedRun['reason']; error?: string }
  | {
      kind: 'session'
      sessionId: string
      state: SessionState
      removed: boolean
      place: string
      usage: ModelUsage[]
      lastMessage: string | null
      waitingFor?: string
      warning?: string
    }
)

/** A session no card or sidebar row shows, or an `st-` tmux session this Sandtable started with no record. */
export type Leftover =
  | {
      kind: 'session'
      session: SessionRecord
      project: string | null
      name: string
      repo: string
      title: string | null
      done: boolean
      keepWorktree: boolean
    }
  | { kind: 'unknown'; tmuxName: string }

/** Whether a worktree was removed, and why not when it wasn't. */
export type RemoveResult = { removed: true } | { removed: false; reason: string }

export type Column = 'todo' | 'inProgress' | 'done' | 'hidden'

/** A column a card can sit in: every column but hidden. */
export type BoardColumn = Exclude<Column, 'hidden'>

/** Which programs were found, where, and whether claude (Default and each account), gh, the optional linear, and the optional acli's Jira login are signed in. */
export type ToolCheck = {
  ok: boolean
  missing: ('tmux' | 'claude' | 'gh' | 'git' | 'linear' | 'acli')[]
  paths: Record<string, string>
  claudeSignedIn: boolean | null
  accounts: (Account & { signedIn: boolean | null })[]
  gh: { loggedIn: boolean; scopes: string[] | null } | null
  linear: boolean | null
  linearWorkspaces: { slug: string; signedIn: boolean | null }[]
  jira: boolean | null
  jiraSites: { site: string; signedIn: boolean | null }[]
}

/** The Appearance setting: follow the Mac, or force light or dark. */
export type Theme = 'system' | 'light' | 'dark'

/** What a **Needs you** notification does, and the plan-limit percent that notifies, or `null` for off. */
export type NotificationSettings = {
  notify: boolean
  sound: boolean
  quietWhenFocused: boolean
  limitPct: number | null
}

/** One line of a diff hunk, with its line number on the side it exists on. */
export type DiffLine = {
  kind: 'context' | 'added' | 'removed'
  text: string
  old?: number
  new?: number
}

/** One file of a worktree's diff; `hunks` is empty for a binary file or one over the line cap. */
export type FileDiff = {
  path: string
  oldPath?: string
  change: 'added' | 'modified' | 'deleted' | 'renamed'
  added: number
  removed: number
  binary?: boolean
  tooLarge?: boolean
  hunks: { header: string; lines: DiffLine[] }[]
}

/** A session worktree's changes against the merge base with `base`, or why they couldn't be read. */
export type RepoChanges = { worktree: string; base: string; files: FileDiff[]; error?: string }

/** The tabs of the ticket view, in order. */
export const TICKET_TABS = ['conversation', 'details', 'changes'] as const

/** A tab of the ticket view. */
export type TicketTab = (typeof TICKET_TABS)[number]

type ChatMessage = { role: 'user' | 'assistant'; text: string }

/** A ticket's `claude -p` conversation, the account folder and repo folder it runs in, and its comment draft. */
export type Chat = {
  projectId: string
  ticketKey: string
  conversationId: string
  claudeDir: string
  cwd: string
  messages: ChatMessage[]
  draft?: string
  /** Set while the draft is a session summary rather than a sum-up of the chat. */
  summary?: true
}

/** A ticket's saved chat, whether Claude is answering or summarizing a session, and the last summary's error. */
export type ChatState = {
  chat: Chat | null
  answering: boolean
  summarizing?: true
  failed?: string
}

/** A slash command a live session offers, as the composer's palette lists it. */
export type SessionCommand = {
  name: string
  description: string
  argumentHint: string
  source: string
  aliases: string[]
}

/** An image attached in a session's composer, as a data URL. */
export type DraftImage = { id: string; name: string; size: number; url: string }

/** A composer's unsent text and images. */
export type ComposerDraft = { text: string; images: DraftImage[] }

/** One step of a Claude Code conversation, as the Conversation tab shows it. */
export type ConversationEntry =
  | { kind: 'user' | 'assistant'; text: string; stopped?: true }
  | {
      kind: 'tool'
      name: string
      summary: string
      input: string
      output: string | null
      error: boolean
    }
  | { kind: 'compact'; at: string; trigger: 'manual' | 'auto' }
  | { kind: 'command'; name: string; args: string; output: string | null }

/** One item of a session's to-do list. */
export type Todo = { content: string; status: 'pending' | 'in_progress' | 'completed' }
/** What a transcript says beyond its entries: the latest to-dos, permission mode, and compaction times (ISO). */
export type TranscriptFacts = {
  todos: Todo[]
  permissionMode: string | null
  compactions: string[]
}

/** A conversation update: entries from index `from` replace the renderer's, and the latest facts; `missing` when a session that isn't live has no file. */
export type ConversationChunk = {
  from: number
  /** How many earlier entries Sandtable left out, when any. */
  start?: number
  entries: ConversationEntry[]
  facts: TranscriptFacts
  missing?: true
}

/** One tool call in a session's transcript: the tool's name, what it acted on, and when. */
export type Step = { tool: string; target: string; at: string | null }
/** A running session's latest steps, newest first (at most 5), and when its current turn's prompt was sent. */
export type Activity = { steps: Step[]; since: string | null }

/** The project, and optionally the ticket and its tab or the session without a ticket, the window last showed. */
export type LastView = {
  projectId: string
  ticketKey?: string
  tab?: TicketTab
  sessionId?: string
}

/** One model's token use across a ticket's transcripts, with what it would cost on the API in USD. */
export type ModelUsage = {
  model: string
  name: string | null
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
  price: number | null
}

/** A ticket's usage by model and the milliseconds Claude spent running turns in its sessions. */
export type TicketUsage = { usage: ModelUsage[]; workMs: number }

/** One week's usage by model and Claude's working time; `week` is its local Monday as "2026-10-26". */
export type WeekUsage = { week: string; usage: ModelUsage[]; workMs: number }

/** A project's usage by week, newest first. */
export type ProjectUsage = { projectId: string; weeks: WeekUsage[] }

/** One merge of a ticket and the sessions, in any project, that led to it. */
export type MergedTicket = {
  projectIds: string[]
  ticketKey: string
  startedAt: string
  mergedAt: string
  needsYou: number
  usage: ModelUsage[]
}

/** Usage by week across all projects, counting a message once, each project's own, and the merged tickets. */
export type UsageByWeek = { all: WeekUsage[]; projects: ProjectUsage[]; merged: MergedTicket[] }

/** A thing to fix in a session's work: your line comment, an AI review's, a failing check, a PR thread, or a PR conflict. */
export type Finding = {
  id: string
  sessionId: string
  source: 'you' | 'review' | 'check' | 'thread' | 'conflict'
  text: string
  worktree?: string
  path?: string
  start?: number
  end?: number
  anchor?: string
  severity?: 'high' | 'medium' | 'low'
  review?: number
  title?: string
  author?: string
  ref?: string
  log?: string
  proposed?: true
  checked: boolean
  sentAt?: string
}

/** A finding you add from a diff line. */
export type NewFinding = Pick<
  Finding,
  'source' | 'text' | 'worktree' | 'path' | 'start' | 'end' | 'anchor'
>
/** What you can change on a finding: its checkbox, or keeping a proposal. */
export type FindingPatch = { checked?: boolean; kept?: true }

/** A session's findings and proposals, whether an AI review is running, its review count, the last review's error, its automatic review when on or turned off for it, and whether that review runs. */
export type FindingsState = {
  findings: Finding[]
  reviewing: boolean
  reviews?: ReviewCount
  reviewError?: string
  auto?: AutoReview
  autoReviewing?: true
  gate?: 'held' | 'capped' | 'open'
}

/** An open pull request for a session's branch, with its review decision, checks, and unresolved threads. */
export type PullRequestState = {
  repo: string
  number: number
  title: string
  url: string
  reviewDecision: 'approved' | 'changesRequested' | 'reviewRequired' | null
  stage: PrStage
  mergeable: string
  checks: { name: string; state: 'passing' | 'failing' | 'pending'; jobId?: number; url?: string }[]
  threads: {
    id: string
    path: string
    line: number | null
    startLine: number | null
    anchor: string | null
    author: string
    body: string
    url: string
  }[]
}

/** Where an open pull request stands, as the card and ticket header word says it. */
export type PrStage = 'open' | 'conflicts' | 'checksFailing' | 'changesRequested' | 'readyToMerge'

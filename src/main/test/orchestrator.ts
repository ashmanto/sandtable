import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { expect, vi, type Mock } from 'vitest'
import type {
  Account,
  BoardSource,
  Chat,
  Finding,
  Project,
  Routine,
  SessionRecord,
  SessionState,
  SkippedRun,
  StartFailure,
  Ticket
} from '../../shared/types'
import { tempDirs } from './tempDirs'
import { emptyStore, type StoreData } from '../store'
import { createOrchestrator, type OrchestratorDeps } from '../orchestrator'
import type { SyncCache } from '../syncCache'
import type { LinearClient } from '../linear/client'
import type { JiraClient } from '../jira/client'

/** The test file's mkdtemp. */
export const tempDir = tempDirs()

/** A fresh empty folder standing in for a worktree. */
export const tempWorktree = (): string => tempDir('st-wt-')

/** A GitHub Projects board source. */
export const source: BoardSource = {
  url: 'https://github.com/users/octo/projects/2',
  ownerType: 'user',
  owner: 'octo',
  number: 2
}

/** A board project with two repos. */
export const project: Project = {
  id: 'p1',
  name: 'Shop',
  repos: [
    { github: 'octo/shop', path: '/repos/shop' },
    { github: 'octo/shop-web', path: '/repos/shop-web' }
  ],
  board: { source, statusMap: { todo: 'Todo', inProgress: 'In Progress', done: 'Done' } }
}

/** A Jira project on the test site. */
export const jiraProject: Project = {
  id: 'p1',
  name: 'Shop',
  repos: project.repos,
  jira: { site: 'acme.atlassian.net', project: 'INF', name: 'Internal' }
}

/** The same project with no board. */
export const repoProject: Project = { id: 'p1', name: 'Shop', repos: project.repos }

/** A board ticket, with overrides. */
export const ticket = (over: Partial<Ticket> = {}): Ticket => ({
  key: 'octo/shop#147',
  itemId: 'item-147',
  number: 147,
  title: 'Dark mode toggle',
  body: 'Add a toggle.',
  url: 'https://github.com/octo/shop/issues/147',
  repo: 'octo/shop',
  status: 'Todo',
  doneAt: null,
  labels: [],
  assignees: [],
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z',
  parent: null,
  subIssues: { completed: 0, total: 0, items: [] },
  boardFields: [],
  blockedBy: [],
  mergedPr: null,
  mergedAt: null,
  prStage: null,
  ...over
})

/** A ticket session record, with overrides. */
export const session = (over: Partial<SessionRecord> = {}): SessionRecord => ({
  id: 's1',
  projectId: 'p1',
  ticketKey: 'octo/shop#147',
  tmuxName: 'st-p1-octo-shop-147',
  branch: '147-dark-mode-toggle',
  worktrees: ['/repos/shop-wt.noindex/147-dark-mode-toggle'],
  eventsFile: '/data/events/s1.jsonl',
  startedAt: '2026-10-24T00:00:00.000Z',
  state: 'running',
  ...over
})

/** A Linear client of mocks. */
export const fakeLinear = (
  tickets: Ticket[] = []
): { [K in keyof LinearClient]: Mock<LinearClient[K]> } => ({
  teams: vi.fn<LinearClient['teams']>(async () => [{ key: 'APP', name: 'Apps', projects: [] }]),
  tickets: vi.fn<LinearClient['tickets']>(async () => structuredClone(tickets)),
  setColumn: vi.fn<LinearClient['setColumn']>(async () => undefined),
  setAssignee: vi.fn<LinearClient['setAssignee']>(async () => undefined),
  details: vi.fn<LinearClient['details']>(async () => ({
    body: 'Linear body',
    labels: [],
    comments: [],
    pullRequests: []
  })),
  postComment: vi.fn<LinearClient['postComment']>(async () => undefined),
  create: vi.fn<LinearClient['create']>(async () => 'APP-1'),
  viewer: vi.fn<LinearClient['viewer']>(async () => 'linear-me'),
  areas: vi.fn<LinearClient['areas']>(async () => [
    { name: 'area: sessions', description: 'Sessions' }
  ]),
  applyTriage: vi.fn<LinearClient['applyTriage']>(async () => undefined)
})

const fakeJira = (tickets: Ticket[] = []): { [K in keyof JiraClient]: Mock<JiraClient[K]> } => {
  const client = {
    projects: vi.fn<JiraClient['projects']>(async () => [{ key: 'INF', name: 'Internal' }]),
    tickets: vi.fn<JiraClient['tickets']>(async () => structuredClone(tickets)),
    setColumn: vi.fn<JiraClient['setColumn']>(async () => undefined),
    setAssignee: vi.fn<JiraClient['setAssignee']>(async () => undefined),
    details: vi.fn<JiraClient['details']>(async () => ({
      body: 'Jira body',
      labels: [],
      comments: [],
      pullRequests: []
    })),
    postComment: vi.fn<JiraClient['postComment']>(async () => undefined),
    create: vi.fn<JiraClient['create']>(async () => 'INF-1'),
    viewer: vi.fn<JiraClient['viewer']>(async () => 'jira-me'),
    boards: vi.fn<JiraClient['boards']>(async () => [{ id: 379, name: 'INF board' }]),
    areas: vi.fn<JiraClient['areas']>(async () => [{ name: 'area:sessions', description: '' }]),
    applyTriage: vi.fn<JiraClient['applyTriage']>(async () => undefined),
    forBoard: vi.fn<JiraClient['forBoard']>()
  }
  client.forBoard.mockReturnValue(client)
  return client
}

/** An orchestrator over fake deps and an in-memory store. */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function setup(
  opts: {
    tickets?: Ticket[]
    sessions?: SessionRecord[]
    cache?: SyncCache
    projects?: unknown[]
    folders?: Record<string, string[]>
    remoteControl?: boolean
    accounts?: Account[]
    claudeDirSet?: boolean
    chats?: Chat[]
    findings?: Finding[]
    routines?: Routine[]
    skippedRuns?: SkippedRun[]
    startFailures?: StartFailure[]
    setupPending?: string[]
    cli?: boolean
  } = {}
) {
  const dataDir = tempDir('st-orch-')
  const claudeDir = tempDir('st-claude-')
  let saved: StoreData = {
    ...emptyStore(),
    projects: (opts.projects ?? [project]) as Project[],
    sessions: opts.sessions ?? [],
    ...(opts.accounts && { accounts: opts.accounts }),
    ...(opts.chats && { chats: opts.chats }),
    ...(opts.findings && { findings: opts.findings }),
    ...(opts.routines && { routines: opts.routines }),
    ...(opts.skippedRuns && { skippedRuns: opts.skippedRuns }),
    ...(opts.startFailures && { startFailures: opts.startFailures }),
    ...(opts.setupPending && { setupPending: opts.setupPending })
  }
  const folders = opts.folders ?? {
    '/repos/shop': ['octo/shop'],
    '/repos/shop-web': ['octo/shop-web']
  }
  let cached: SyncCache = opts.cache ?? {}
  let inFlight = 0
  let maxInFlight = 0
  let onEvent: (id: string, s: SessionState | null, asking: boolean) => void = () => undefined
  const live = new Set<string>()
  const owners = new Map<string, string>()
  const lastState = new Map<string, SessionState | null>()
  const askingFiles = new Set<string>()
  const linear = fakeLinear(opts.tickets)
  const jira = fakeJira(opts.tickets)
  const cli = {
    open: vi.fn(async (id: string) => `/cli/${id}.sock`),
    close: vi.fn<(id: string) => Promise<void>>(async () => undefined),
    closeAll: vi.fn(async () => undefined)
  }
  const deps = {
    ...(opts.cli && { cli: vi.fn<NonNullable<OrchestratorDeps['cli']>>(() => cli) }),
    store: {
      load: vi.fn(async () => structuredClone(saved)),
      save: vi.fn(async (d: StoreData) => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        const copy = structuredClone(d)
        await new Promise((r) => setImmediate(r))
        saved = copy
        inFlight--
      })
    },
    cache: {
      load: vi.fn(async () => structuredClone(cached)),
      save: vi.fn(async (c: SyncCache) => void (cached = structuredClone(c)))
    },
    board: {
      statusField: vi.fn(async () => ({
        projectId: 'P',
        fieldId: 'F',
        options: [
          { id: '1', name: 'Todo' },
          { id: '2', name: 'In Progress' }
        ]
      })),
      tickets: vi.fn<OrchestratorDeps['board']['tickets']>(async () => opts.tickets ?? [ticket()]),
      setStatus: vi.fn(async () => undefined),
      addItem: vi.fn<OrchestratorDeps['board']['addItem']>(async () => 'PVTI_9')
    },
    repoIssues: {
      tickets: vi.fn<OrchestratorDeps['repoIssues']['tickets']>(async () => opts.tickets ?? []),
      setColumn: vi.fn<OrchestratorDeps['repoIssues']['setColumn']>(async () => undefined),
      reopen: vi.fn<OrchestratorDeps['repoIssues']['reopen']>(async () => undefined),
      setAssignee: vi.fn<OrchestratorDeps['repoIssues']['setAssignee']>(async () => undefined),
      create: vi.fn<OrchestratorDeps['repoIssues']['create']>(async () => ({
        id: 'I_9',
        number: 9
      }))
    },
    ticketDetails: vi.fn<OrchestratorDeps['ticketDetails']>(async () => ({
      body: 'b',
      labels: [],
      comments: [],
      pullRequests: []
    })),
    postComment: vi.fn<OrchestratorDeps['postComment']>(async () => undefined),
    githubViewer: vi.fn<OrchestratorDeps['githubViewer']>(async () => 'octo'),
    linear: vi.fn<OrchestratorDeps['linear']>(() => linear),
    linearWorkspaces: vi.fn<OrchestratorDeps['linearWorkspaces']>(async () => [
      { slug: 'acme', organization: 'Acme', default: true }
    ]),
    jira: vi.fn<OrchestratorDeps['jira']>(() => jira),
    jiraCredentials: {
      save: vi.fn<OrchestratorDeps['jiraCredentials']['save']>(async () => undefined),
      sites: vi.fn<OrchestratorDeps['jiraCredentials']['sites']>(async () => [
        { site: 'acme.atlassian.net', email: 'me@example.com' }
      ])
    },
    jiraClientWith: vi.fn<OrchestratorDeps['jiraClientWith']>(() => jira),
    mergedPullRequests: vi.fn<OrchestratorDeps['mergedPullRequests']>(async () => []),
    githubStamp: vi.fn<OrchestratorDeps['githubStamp']>(async () => 'same'),
    githubReposOf: vi.fn(async (path: string) => folders[path] ?? []),
    pullRequests: vi.fn<OrchestratorDeps['pullRequests']>(async () => []),
    fingerprint: vi.fn<OrchestratorDeps['fingerprint']>(async () => 'tree\n'),
    failedLog: vi.fn<OrchestratorDeps['failedLog']>(async () => 'Error: expected 1'),
    openFolder: vi.fn<OrchestratorDeps['openFolder']>(async () => ''),
    git: {
      ensureWorktree: vi.fn<OrchestratorDeps['git']['ensureWorktree']>(async (repo, branch) => ({
        path: `${repo}-wt.noindex/${branch}`,
        created: true
      })),
      removeWorktree: vi.fn<OrchestratorDeps['git']['removeWorktree']>(async () => ({
        removed: true
      })),
      checkRemovable: vi.fn<OrchestratorDeps['git']['checkRemovable']>(async () => ({
        removable: true,
        repoPath: '/repos/shop'
      })),
      changes: vi.fn<OrchestratorDeps['git']['changes']>()
    },
    setup: {
      problem: vi.fn<OrchestratorDeps['setup']['problem']>(async () => null),
      copy: vi.fn<OrchestratorDeps['setup']['copy']>(async () => []),
      run: vi.fn<OrchestratorDeps['setup']['run']>(async () => ({ code: 0, lines: [] })),
      suggest: vi.fn<OrchestratorDeps['setup']['suggest']>(async () => null)
    },
    tmux: {
      startTmux: vi.fn<OrchestratorDeps['tmux']['startTmux']>(
        async (name, _cwd, _cmd, _env, owner) => {
          live.add(name)
          if (owner !== undefined) owners.set(name, owner)
        }
      ),
      globalPath: vi.fn<OrchestratorDeps['tmux']['globalPath']>(async () => undefined),
      hasTmux: vi.fn(async (name: string) => live.has(name)),
      listTmux: vi.fn(async () =>
        [...live].map((name) => ({ name, owner: owners.get(name) ?? dataDir }))
      ),
      killTmux: vi.fn(async (name: string) => void live.delete(name)),
      pasteTmux: vi.fn<OrchestratorDeps['tmux']['pasteTmux']>(async () => undefined),
      enterTmux: vi.fn<OrchestratorDeps['tmux']['enterTmux']>(async () => undefined),
      escapeTmux: vi.fn<OrchestratorDeps['tmux']['escapeTmux']>(async () => undefined),
      keysTmux: vi.fn<OrchestratorDeps['tmux']['keysTmux']>(async () => undefined),
      captureTmux: vi.fn<OrchestratorDeps['tmux']['captureTmux']>(async () => '')
    },
    areas: {
      list: vi.fn<OrchestratorDeps['areas']['list']>(async () => [
        { name: 'area: sessions', description: 'Sessions' }
      ]),
      apply: vi.fn<OrchestratorDeps['areas']['apply']>(async () => undefined)
    },
    claude: {
      bin: '/bin/claude',
      print: vi.fn<OrchestratorDeps['claude']['print']>(async () => ({
        stdout: JSON.stringify({
          is_error: false,
          structured_output: { area: 'area: sessions', newAreas: [], blockedBy: [30], reason: 'r' }
        }),
        stderr: '',
        code: 0
      }))
    },
    events: {
      watchEvents: vi.fn<OrchestratorDeps['events']['watchEvents']>((_dir, cb) => {
        onEvent = cb
        return () => undefined
      }),
      readLastState: vi.fn(async (file: string) => lastState.get(file) ?? null),
      readAsking: vi.fn(async (file: string) => askingFiles.has(file)),
      readBackground: vi.fn<OrchestratorDeps['events']['readBackground']>(async () => []),
      countNeedsYou: vi.fn<OrchestratorDeps['events']['countNeedsYou']>(async () => 0)
    },
    notify: vi.fn<OrchestratorDeps['notify']>(),
    draft: vi.fn<OrchestratorDeps['draft']>(async () => null),
    remoteControl: vi.fn(() => opts.remoteControl ?? false),
    claudeDirSet: opts.claudeDirSet ?? true,
    dataDir,
    claudeDir,
    now: vi.fn(() => new Date('2026-10-24T12:00:00.000Z'))
  } satisfies OrchestratorDeps
  const orch = createOrchestrator(deps)
  return {
    orch,
    deps,
    cli,
    linear,
    jira,
    live,
    owners,
    lastState,
    askingFiles,
    dataDir,
    claudeDir,
    emit: (id: string, s: SessionState | null, asking = false) => onEvent(id, s, asking),
    saved: () => saved,
    cached: () => cached,
    maxInFlight: () => maxInFlight
  }
}

/** A claude print that reports a kill after ms. */
export const timedOut = (ms: number) => async () => {
  const late = Date.now() + ms
  const spy = vi.spyOn(Date, 'now').mockImplementationOnce(() => {
    spy.mockRestore()
    return late
  })
  return { stdout: '', stderr: 'killed by SIGKILL', code: -1 }
}

/** Waits a few event-loop turns. */
export const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r))
}

const repoSettings = '{ "permissions": { "allow": ["Bash(ls)"] } }\n'

/** Worktrees that each hold a repo .claude/settings.json. */
export const worktreesWithSettings = (n: number): string[] =>
  Array.from({ length: n }, tempWorktree).map((wt) => {
    mkdirSync(join(wt, '.claude'))
    writeFileSync(join(wt, '.claude', 'settings.json'), repoSettings)
    return wt
  })

/** Expects each worktree's .claude to hold only the untouched repo settings. */
export const expectSettingsUntouched = (wts: string[]): void => {
  for (const wt of wts) {
    expect(readFileSync(join(wt, '.claude', 'settings.json'), 'utf8')).toBe(repoSettings)
    expect(readdirSync(join(wt, '.claude'))).toEqual(['settings.json'])
  }
}

/** A transcript line of an Opus reply with input tokens. */
export const opusLine = (id: string, input: number, at?: Date): string =>
  JSON.stringify({
    type: 'assistant',
    timestamp: at?.toISOString(),
    message: { id, model: 'claude-opus-5-5', usage: { input_tokens: input } }
  })

/** Writes a transcript file, making its folder. */
export const writeTranscript = (file: string, text: string): void => {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text + '\n')
}

/** Writes a one-line transcript for the run that the claude args name. */
export const runTranscript = (claudeDir: string, args: string[], input: number): void => {
  const flag = args.includes('--resume') ? '--resume' : '--session-id'
  const id = args[args.indexOf(flag) + 1]
  const folder = join(claudeDir, 'projects', 'runs')
  mkdirSync(folder, { recursive: true })
  appendFileSync(join(folder, `${id}.jsonl`), opusLine(`run-${input}`, input) + '\n')
}

/** The input tokens of a ticket's usage in project p1. */
export const inputOf = async (t: ReturnType<typeof setup>, key: string): Promise<number> =>
  (await t.orch.usage('p1', key)).usage.reduce((sum, u) => sum + u.input, 0)

/** A stream-json line where Claude reads the file at path. */
export const readLine = (path: string): string =>
  JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: path } }] }
  }) + '\n'

/** A claude print that writes stdout and resolves only once its run is stopped. */
export const untilStopped =
  (stdout: string): OrchestratorDeps['claude']['print'] =>
  (_cwd, _args, _env, _timeoutMs, live) =>
    new Promise((resolve) => {
      live?.onStdout?.(stdout)
      live?.signal?.addEventListener('abort', () =>
        resolve({ stdout, stderr: 'The operation was aborted', code: -1 })
      )
    })

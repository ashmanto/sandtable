import { vi } from 'vitest'
import type { BoardView, SandtableApi } from '../../../shared/api'
import type { Project, SessionRecord, Ticket } from '../../../shared/types'

export const project: Project = {
  id: 'p1',
  name: 'Shop',
  repos: [
    { github: 'octo/shop', path: '/Users/me/projects/shop' },
    { github: 'octo/shop-web', path: '/Users/me/projects/shop-web' }
  ],
  board: {
    source: {
      url: 'https://github.com/users/octo/projects/2',
      ownerType: 'user',
      owner: 'octo',
      number: 2
    },
    statusMap: { todo: 'Todo', inProgress: 'In Progress', done: 'Done' }
  }
}

export const linearProject: Project = {
  id: 'p1',
  name: 'Shop',
  repos: project.repos,
  linear: { team: 'APP', projects: [{ id: 'lp1', name: 'Launch' }] }
}

/** The same project taking its tickets from Jira project INF on acme.atlassian.net. */
export const jiraProject: Project = {
  id: 'p1',
  name: 'Shop',
  repos: project.repos,
  jira: { site: 'acme.atlassian.net', project: 'INF', name: 'Internal' }
}

/** A Linear issue `APP-<number>` with no repo resolved yet. */
export const linearTicket = (number: number, over: Partial<Ticket> = {}): Ticket =>
  ticket(number, {
    key: `APP-${number}`,
    repo: '',
    url: `https://linear.app/octo/issue/APP-${number}`,
    status: 'unstarted',
    ...over
  })

export function ticket(number: number, over: Partial<Ticket> = {}): Ticket {
  const repo = over.repo ?? 'octo/shop'
  return {
    key: `${repo}#${number}`,
    itemId: `item-${number}`,
    number,
    title: `Ticket ${number}`,
    body: '',
    url: `https://github.com/${repo}/issues/${number}`,
    repo,
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
  }
}

export function session(ticketKey: string, over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: `s-${ticketKey}`,
    projectId: 'p1',
    ticketKey,
    tmuxName: 'tmux',
    branch: 'branch',
    worktrees: ['/tmp/wt'],
    eventsFile: '/tmp/events',
    startedAt: '2026-10-24T10:00:00.000Z',
    state: 'running',
    ...over
  }
}

export function adhoc(over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 'a1',
    projectId: 'p1',
    name: 'Oct 24, 10:00',
    tmuxName: 'tmux',
    worktrees: [],
    checkout: '/Users/me/projects/shop',
    eventsFile: '/tmp/events',
    startedAt: '2026-10-24T10:00:00.000Z',
    state: 'running',
    ...over
  }
}

export function boardView(over: Partial<BoardView> = {}): BoardView {
  return {
    tickets: [],
    sessions: [],
    elsewhere: [],
    sidebarSessions: [],
    syncedAt: null,
    error: null,
    needsYou: {},
    routines: [],
    ...over
  }
}

/** Installs a fake `window.sandtable` whose methods are mocks; returns it. */
export function fakeSandtable(): SandtableApi {
  const api = {
    projects: {
      list: vi.fn(async () => [project]),
      save: vi.fn(async () => {}),
      setEditor: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
      groups: vi.fn(async () => []),
      arrange: vi.fn(async () => {}),
      statusOptions: vi.fn(async () => []),
      me: vi.fn(async () => 'me'),
      boardRepos: vi.fn(async () => []),
      linearTeams: vi.fn(async () => []),
      linearWorkspaces: vi.fn(async () => []),
      jiraAccounts: vi.fn<SandtableApi['projects']['jiraAccounts']>(async () => []),
      jiraSignIn: vi.fn<SandtableApi['projects']['jiraSignIn']>(),
      jiraProjects: vi.fn<SandtableApi['projects']['jiraProjects']>(async () => []),
      jiraBoards: vi.fn<SandtableApi['projects']['jiraBoards']>(async () => []),
      pickFolder: vi.fn<SandtableApi['projects']['pickFolder']>(async () => null),
      pickEditor: vi.fn<SandtableApi['projects']['pickEditor']>(async () => null),
      usage: vi.fn<SandtableApi['projects']['usage']>(async () => ({
        all: [],
        projects: [],
        merged: []
      }))
    },
    accounts: {
      list: vi.fn<SandtableApi['accounts']['list']>(async () => [
        { name: 'Default', dir: '/Users/me/.claude' }
      ]),
      add: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
      folders: vi.fn<SandtableApi['accounts']['folders']>(async () => []),
      signedIn: vi.fn<SandtableApi['accounts']['signedIn']>(async () => true)
    },
    board: {
      get: vi.fn(async () => boardView()),
      sync: vi.fn(async () => {}),
      watch: vi.fn(),
      onChange: vi.fn(() => () => {})
    },
    tickets: {
      start: vi.fn(async () => {}),
      checkStart: vi.fn(async () => ({ triage: false, problems: [], overlap: [], ready: false })),
      checkOverlap: vi.fn(async () => []),
      checkReady: vi.fn(async () => []),
      triage: vi.fn(async () => ({
        area: 'area: sessions',
        newAreas: [],
        blockedBy: [],
        reason: ''
      })),
      applyTriage: vi.fn(async () => {}),
      chat: vi.fn<SandtableApi['tickets']['chat']>(async () => ({ chat: null, answering: false })),
      sendChat: vi.fn<SandtableApi['tickets']['sendChat']>(async (projectId, ticketKey, text) => ({
        projectId,
        ticketKey,
        conversationId: 'c1',
        claudeDir: '/claude',
        cwd: '/repos/r',
        messages: [{ role: 'user', text }]
      })),
      draftComment: vi.fn(async () => ''),
      saveDraft: vi.fn(async () => {}),
      postComment: vi.fn(async () => {}),
      discardDraft: vi.fn(async () => {}),
      clearChat: vi.fn(async () => {}),
      stopChat: vi.fn(async () => {}),
      onChatSteps: vi.fn(() => () => {}),
      create: vi.fn(async () => 'octo/shop#9'),
      move: vi.fn(async () => {}),
      details: vi.fn(async () => ({
        body: '',
        labels: [],
        comments: [],
        pullRequests: []
      })),
      usage: vi.fn<SandtableApi['tickets']['usage']>(async () => ({ usage: [], workMs: 0 }))
    },
    sessions: {
      resume: vi.fn(async () => {}),
      removeWorktree: vi.fn<SandtableApi['sessions']['removeWorktree']>(async () => ({
        removed: true
      })),
      endAndRemove: vi.fn<SandtableApi['sessions']['endAndRemove']>(async () => ({
        removed: true
      })),
      create: vi.fn(async () => 'a1'),
      firstMessage: vi.fn<SandtableApi['sessions']['firstMessage']>(async () => ''),
      rename: vi.fn(async () => {}),
      activity: vi.fn<SandtableApi['sessions']['activity']>(async () => null),
      onActivity: vi.fn(() => () => {}),
      status: vi.fn<SandtableApi['sessions']['status']>(async () => null),
      onStatus: vi.fn(() => () => {}),
      watchConversation: vi.fn<SandtableApi['sessions']['watchConversation']>(async () => ({
        from: 0,
        entries: [],
        facts: { todos: [], permissionMode: null, compactions: [] }
      })),
      unwatchConversation: vi.fn<SandtableApi['sessions']['unwatchConversation']>(async () => {}),
      onConversation: vi.fn(() => () => {}),
      liveUsage: vi.fn<SandtableApi['sessions']['liveUsage']>(async () => ({})),
      onLiveUsage: vi.fn(() => () => {}),
      raiseCap: vi.fn<SandtableApi['sessions']['raiseCap']>(async () => undefined),
      changes: vi.fn<SandtableApi['sessions']['changes']>(async () => []),
      openFolder: vi.fn<SandtableApi['sessions']['openFolder']>(async () => undefined),
      findings: vi.fn<SandtableApi['sessions']['findings']>(async () => ({
        findings: [],
        reviewing: false
      })),
      addFinding: vi.fn<SandtableApi['sessions']['addFinding']>(),
      updateFinding: vi.fn(async () => {}),
      removeFinding: vi.fn(async () => {}),
      sendFindings: vi.fn(async () => {}),
      review: vi.fn(async () => 1),
      pullRequests: vi.fn<SandtableApi['sessions']['pullRequests']>(async () => []),
      addCheck: vi.fn<SandtableApi['sessions']['addCheck']>(),
      addThread: vi.fn<SandtableApi['sessions']['addThread']>(),
      setAutoReview: vi.fn(async () => {}),
      summarize: vi.fn(async () => {}),
      end: vi.fn(async () => {}),
      setRemoteControl: vi.fn(async () => {}),
      send: vi.fn<SandtableApi['sessions']['send']>(async (_id, text) => text),
      image: vi.fn(async () => 'data:image/png;base64,cG5n'),
      interrupt: vi.fn(async () => {}),
      compact: vi.fn(async () => {}),
      prompt: vi.fn(async () => null),
      commands: vi.fn(async () => []),
      suggestion: vi.fn(async () => null),
      answer: vi.fn(async () => {}),
      clearNeedsYou: vi.fn(async () => {}),
      leftovers: vi.fn<SandtableApi['sessions']['leftovers']>(async () => []),
      endUnknown: vi.fn(async () => {})
    },
    routines: {
      list: vi.fn<SandtableApi['routines']['list']>(async () => []),
      save: vi.fn<SandtableApi['routines']['save']>(async (input) => ({ id: 'r1', ...input })),
      remove: vi.fn(async () => {}),
      start: vi.fn<SandtableApi['routines']['start']>(async () => 'a1'),
      history: vi.fn<SandtableApi['routines']['history']>(async () => []),
      chat: vi.fn<SandtableApi['routines']['chat']>(async () => ({
        conversationId: 'rc1',
        reply: ''
      })),
      stopChat: vi.fn(async () => {}),
      onChatSteps: vi.fn(() => () => {})
    },
    setup: {
      progress: vi.fn<SandtableApi['setup']['progress']>(async () => null),
      cancel: vi.fn<SandtableApi['setup']['cancel']>(async () => undefined),
      suggest: vi.fn<SandtableApi['setup']['suggest']>(async () => null),
      hint: vi.fn<SandtableApi['setup']['hint']>(async () => null),
      hideHint: vi.fn<SandtableApi['setup']['hideHint']>(async () => undefined),
      onProgress: vi.fn(() => () => {})
    },
    terminal: {
      open: vi.fn(async () => {}),
      write: vi.fn(),
      resize: vi.fn(),
      close: vi.fn(),
      onData: vi.fn(() => () => {})
    },
    app: {
      onOpen: vi.fn(() => () => {}),
      pendingOpen: vi.fn<SandtableApi['app']['pendingOpen']>(async () => null),
      tools: vi.fn<SandtableApi['app']['tools']>(async () => ({
        ok: true,
        missing: [],
        paths: {},
        claudeSignedIn: true,
        accounts: [],
        gh: { loggedIn: true, scopes: ['repo', 'project'] },
        linear: true,
        linearWorkspaces: [],
        jira: true,
        jiraSites: []
      })),
      theme: vi.fn<SandtableApi['app']['theme']>(async () => 'system'),
      setTheme: vi.fn(async () => {}),
      keepAwake: vi.fn<SandtableApi['app']['keepAwake']>(async () => false),
      setKeepAwake: vi.fn(async () => {}),
      notifications: vi.fn<SandtableApi['app']['notifications']>(async () => ({
        notify: true,
        sound: true,
        quietWhenFocused: false,
        limitPct: 80
      })),
      setNotifications: vi.fn(async () => {}),
      openNotificationSettings: vi.fn(async () => {}),
      remoteControl: vi.fn<SandtableApi['app']['remoteControl']>(async () => false),
      setRemoteControl: vi.fn(async () => {}),
      awake: vi.fn<SandtableApi['app']['awake']>(async () => false),
      onAwake: vi.fn(() => () => {}),
      onSettings: vi.fn(() => () => {}),
      lastView: vi.fn<SandtableApi['app']['lastView']>(async () => null),
      saveView: vi.fn(),
      frame: vi.fn<SandtableApi['app']['frame']>(async () => ({
        sidebarHidden: false,
        sidebarWidth: 224,
        fullScreen: false
      })),
      onFrame: vi.fn(() => () => {}),
      onSwipe: vi.fn(() => () => {}),
      setSidebarHidden: vi.fn(),
      setSidebarWidth: vi.fn(),
      draft: vi.fn<SandtableApi['app']['draft']>(async () => null),
      saveDraft: vi.fn()
    }
  } satisfies SandtableApi
  window.sandtable = api
  return api
}

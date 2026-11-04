import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import type { SessionRecord } from '../shared/types'
import { createOrchestrator } from './orchestrator'
import {
  hasTmux,
  killTmux,
  enterTmux,
  escapeTmux,
  keysTmux,
  captureTmux,
  listTmux,
  pasteTmux,
  setTmuxSocket,
  startTmux
} from './sessions/tmux'
import { tempDirs } from './test/tempDirs'
import { emptyStore } from './store'

const SOCKET = `sandtable-test-count-${process.pid}`
const NAME = `st-t${process.pid}-needs-you`
const tmuxCli = (...args: string[]): void => {
  execFileSync('tmux', ['-L', SOCKET, ...args], { stdio: 'ignore' })
}

beforeAll(() => setTmuxSocket(SOCKET))
afterAll(() => {
  try {
    tmuxCli('kill-server')
  } catch {
    // no server running
  }
  setTmuxSocket(undefined)
})
beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }))
afterEach(() => vi.useRealTimers())
const tempDir = tempDirs()

it('marks a needsYou session finished when its tmux session ends', async () => {
  const record: SessionRecord = {
    id: 's1',
    projectId: 'p1',
    ticketKey: 'o/r#1',
    tmuxName: NAME,
    branch: '1-x',
    worktrees: [],
    eventsFile: '/none/s1.jsonl',
    startedAt: '2026-10-24T00:00:00.000Z',
    state: 'needsYou'
  }
  await startTmux(NAME, tmpdir(), ['sleep', '30'])
  const orch = createOrchestrator({
    claudeDirSet: false,
    store: {
      load: async () => ({
        ...emptyStore(),
        projects: [{ id: 'p1', name: 'P', repos: [] }],
        sessions: [record]
      }),
      save: async () => undefined
    },
    cache: { load: async () => ({}), save: async () => undefined },
    board: { statusField: vi.fn(), tickets: async () => [], setStatus: vi.fn(), addItem: vi.fn() },
    repoIssues: {
      tickets: async () => [],
      setColumn: vi.fn(),
      reopen: vi.fn(),
      setAssignee: vi.fn(),
      create: vi.fn()
    },
    areas: { list: vi.fn(), apply: vi.fn() },
    linear: () => ({
      teams: vi.fn(),
      tickets: vi.fn(),
      setColumn: vi.fn(),
      setAssignee: vi.fn(),
      details: vi.fn(),
      postComment: vi.fn(),
      create: vi.fn(),
      viewer: vi.fn(),
      areas: vi.fn(),
      applyTriage: vi.fn()
    }),
    linearWorkspaces: vi.fn(),
    jira: vi.fn(),
    jiraCredentials: { save: vi.fn(), sites: vi.fn() },
    jiraClientWith: vi.fn(),
    mergedPullRequests: vi.fn(),
    githubStamp: vi.fn(),
    ticketDetails: vi.fn(),
    postComment: vi.fn(),
    githubViewer: vi.fn(),
    githubReposOf: async () => [],
    pullRequests: async () => [],
    fingerprint: async () => '',
    failedLog: async () => '',
    openFolder: async () => '',
    git: {
      ensureWorktree: vi.fn(),
      removeWorktree: vi.fn(),
      checkRemovable: vi.fn(),
      changes: vi.fn()
    },
    setup: { problem: vi.fn(), copy: vi.fn(), run: vi.fn(), suggest: vi.fn() },
    tmux: {
      startTmux,
      hasTmux,
      listTmux,
      killTmux,
      pasteTmux,
      enterTmux,
      escapeTmux,
      keysTmux,
      captureTmux
    },
    claude: { bin: '/bin/claude', print: vi.fn() },
    events: {
      watchEvents: () => () => undefined,
      readLastState: async () => 'needsYou',
      readAsking: async () => false,
      readBackground: async () => [],
      countNeedsYou: async () => 0
    },
    notify: vi.fn(),
    draft: async () => null,
    remoteControl: () => false,
    dataDir: tempDir('st-orch-tmux-'),
    claudeDir: tempDir('st-claude-tmux-')
  })
  await orch.reconnect()
  expect((await orch.getBoard('p1')).needsYou.p1).toBe(1)

  tmuxCli('kill-session', '-t', `=${NAME}`)
  vi.advanceTimersByTime(3000)
  await vi.waitFor(() => expect(orch.session('s1')?.state).toBe('finished'))
  expect((await orch.getBoard('p1')).needsYou.p1 ?? 0).toBe(0)
  orch.stop()
})

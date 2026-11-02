import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SandtableApi } from '../../../shared/api'
import { prepareText } from '../../../shared/compact'
import type { SessionStatus } from '../../../shared/sessionStatus'
import type { ConversationEntry, SessionRecord, TranscriptFacts } from '../../../shared/types'
import { adhoc, fakeSandtable, project, session } from '../test/fixtures'
import { GaugesButton, GaugesPanel } from './GaugesPanel'

let api: SandtableApi
const NOW = new Date('2026-10-30T14:00:00')
const at = (hhmm: string): number => new Date(`2026-10-30T${hhmm}:00`).getTime()

const status = (over: Partial<SessionStatus> = {}): SessionStatus => ({
  model: 'Opus 5.5',
  effort: 'high',
  contextPct: 46,
  contextSize: 200_000,
  contextUsed: 92_000,
  fiveHour: { pct: 38, resetsAt: at('16:00') },
  sevenDay: { pct: 61, resetsAt: at('18:00') },
  costUsd: 4.1,
  durationMs: 42 * 60_000,
  apiDurationMs: 18 * 60_000,
  linesAdded: 14,
  linesRemoved: 6,
  background: [],
  ...over
})

const facts = (over: Partial<TranscriptFacts> = {}): TranscriptFacts => ({
  todos: [
    { content: 'Find the scroll container', status: 'completed' },
    { content: 'Open a pull request', status: 'in_progress' }
  ],
  permissionMode: 'acceptEdits',
  compactions: [],
  ...over
})

const running = session('T1', { id: 's1', state: 'running' })
const waiting = session('T1', { id: 's1', state: 'needsYou' })

const show = async (
  s: SessionStatus | null,
  over: {
    session?: SessionRecord
    facts?: TranscriptFacts
    entries?: ConversationEntry[]
    onOpenChanges?: () => void
  } = {}
): Promise<void> => {
  vi.mocked(api.sessions.status).mockResolvedValue(s)
  render(
    <GaugesPanel
      session={over.session ?? running}
      project={project}
      facts={over.facts ?? facts()}
      entries={over.entries ?? []}
      onOpenChanges={'onOpenChanges' in over ? over.onOpenChanges : vi.fn()}
    />
  )
  await act(async () => {})
}

const meter = (name: string): HTMLElement => screen.getByRole('meter', { name })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  api = fakeSandtable()
})
afterEach(() => vi.useRealTimers())

describe('GaugesPanel', () => {
  it('shows the three meters', async () => {
    await show(status())
    const ctx = meter('Context window')
    expect(ctx).toHaveAttribute('aria-valuenow', '46')
    expect(ctx).toHaveTextContent('46%')
    expect(ctx).toHaveTextContent('92K of 200K')
    expect(ctx).toHaveAttribute('aria-valuetext', '46% used, 92K of 200K')
    const five = meter('5-hour limit')
    expect(five).toHaveAttribute('aria-valuenow', '38')
    expect(five).toHaveTextContent('38%')
    expect(five).toHaveTextContent('Resets 16:00')
    expect(meter('7-day limit')).toHaveAttribute('aria-valuenow', '61')
  })

  it('hides the limits without rate_limits', async () => {
    await show(status({ fiveHour: null, sevenDay: null }))
    expect(screen.getAllByRole('meter').map((m) => m.getAttribute('aria-label'))).toEqual([
      'Context window'
    ])
  })

  it('waits for the first reply', async () => {
    await show(status({ contextPct: null }))
    expect(screen.getByText("Waiting for Claude's first reply")).toBeInTheDocument()
    expect(screen.queryByRole('meter', { name: 'Context window' })).not.toBeInTheDocument()
  })

  it('words a warning', async () => {
    await show(status({ contextPct: 84, fiveHour: { pct: 93, resetsAt: at('16:00') } }))
    expect(meter('Context window')).toHaveTextContent('Nearly full')
    expect(meter('5-hour limit')).toHaveTextContent('Near limit')
    expect(meter('7-day limit')).not.toHaveTextContent('Near limit')
  })

  it('offers Prepare to compact only once the context is nearly full', async () => {
    await show(status({ contextPct: 79 }), { session: waiting })
    expect(screen.queryByRole('button', { name: /compact/i })).not.toBeInTheDocument()
  })

  it('prepares, then compacts, each on a click', async () => {
    await show(status({ contextPct: 84 }), { session: waiting })
    await userEvent.click(screen.getByRole('button', { name: 'Prepare to compact' }))
    expect(api.sessions.compact).toHaveBeenCalledWith('s1', 'prepare')
    cleanup()
    await show(status({ contextPct: 84 }), {
      session: waiting,
      entries: [
        { kind: 'user', text: prepareText('/f') },
        { kind: 'assistant', text: 'Ready' }
      ]
    })
    await userEvent.click(screen.getByRole('button', { name: 'Compact' }))
    expect(api.sessions.compact).toHaveBeenCalledWith('s1', 'compact')
  })

  it('stays disabled after a click until the conversation moves on', async () => {
    const entries: ConversationEntry[] = [{ kind: 'user', text: prepareText('/f') }]
    vi.mocked(api.sessions.status).mockResolvedValue(status({ contextPct: 84 }))
    const props = { session: waiting, project, facts: facts(), entries }
    const { rerender } = render(<GaugesPanel {...props} />)
    await act(async () => {})
    await userEvent.click(screen.getByRole('button', { name: 'Compact' }))
    expect(screen.getByRole('button', { name: 'Compact' })).toBeDisabled()
    expect(screen.getByText('Compacting…')).toBeInTheDocument()
    const submitted: ConversationEntry[] = [...entries, { kind: 'user', text: '/compact Keep' }]
    rerender(<GaugesPanel {...props} entries={submitted} />)
    expect(screen.getByRole('button', { name: 'Compact' })).toBeDisabled()
    const compacted: ConversationEntry[] = [
      ...submitted,
      { kind: 'compact', at: '', trigger: 'manual' }
    ]
    rerender(<GaugesPanel {...props} entries={compacted} />)
    expect(screen.getByRole('button', { name: 'Prepare to compact' })).toBeEnabled()
  })

  it('disables compacting while Claude works or asks, and says why', async () => {
    await show(status({ contextPct: 84 }))
    expect(screen.getByRole('button', { name: 'Prepare to compact' })).toBeDisabled()
    expect(screen.getByText('After Claude stops working')).toBeInTheDocument()
    cleanup()
    await show(status({ contextPct: 84 }), { session: { ...waiting, asking: true } })
    expect(screen.getByRole('button', { name: 'Prepare to compact' })).toBeDisabled()
    expect(screen.getByText('After you answer Claude')).toBeInTheDocument()
  })

  it('shows why compacting was refused', async () => {
    vi.mocked(api.sessions.compact).mockRejectedValueOnce(
      new Error('The session is still starting.')
    )
    await show(status({ contextPct: 84 }), { session: waiting })
    await userEvent.click(screen.getByRole('button', { name: 'Prepare to compact' }))
    expect(screen.getByRole('alert')).toHaveTextContent('The session is still starting.')
  })

  it('shows a past reset without a percentage', async () => {
    await show(status({ fiveHour: { pct: 38, resetsAt: at('13:00') } }))
    expect(screen.getByText('Reset at 13:00')).toBeInTheDocument()
    expect(screen.queryByRole('meter', { name: '5-hour limit' })).not.toBeInTheDocument()
    expect(screen.queryByText('38%')).not.toBeInTheDocument()
  })

  it('folded rows summarize', async () => {
    await show(status())
    const sessionRow = screen.getByRole('button', { name: /This session/ })
    expect(sessionRow).toHaveAttribute('aria-expanded', 'false')
    expect(sessionRow).toHaveTextContent('$4.10')
    expect(sessionRow).toHaveTextContent('42m')
    expect(screen.getByRole('button', { name: /^Work/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /Claude's to-dos/ })).toHaveTextContent('1 of 2')
    expect(screen.getByText('Open a pull request')).toBeInTheDocument()
    const model = screen.getByRole('button', { name: /^Model/ })
    expect(model).toHaveTextContent('Opus 5.5 · Accept edits')
    await userEvent.click(sessionRow)
    expect(sessionRow).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('API time')).toBeInTheDocument()
    expect(screen.getByText('Price').nextSibling).toHaveTextContent('$4.10 API estimate')
  })

  it('shows tokens from live usage in This session', async () => {
    vi.mocked(api.sessions.liveUsage).mockResolvedValue({
      s1: [
        {
          model: 'claude-opus-4-1',
          name: null,
          input: 1_000_000,
          output: 200_000,
          cacheWrite: 0,
          cacheRead: 0,
          price: 30
        },
        {
          model: 'other',
          name: null,
          input: 5,
          output: 0,
          cacheWrite: 0,
          cacheRead: 0,
          price: null
        }
      ]
    })
    await show(status())
    const row = screen.getByRole('button', { name: /This session/ })
    expect(row).toHaveTextContent('1.2M · $30.00* · 42m')
    await userEvent.click(row)
    expect(screen.queryByText('Price')).not.toBeInTheDocument()
  })

  it('lists running agents', async () => {
    const task: ConversationEntry = {
      kind: 'tool',
      name: 'Task',
      summary: 'Explore the board',
      input: '{}',
      output: null,
      error: false
    }
    await show(status({ background: [{ type: 'shell', description: 'npm run dev' }] }), {
      entries: [task, { ...task, summary: 'Finished one', output: 'done' }]
    })
    const row = screen.getByRole('button', { name: /Agents and tasks/ })
    expect(row).toHaveTextContent('2 running')
    await userEvent.click(row)
    expect(screen.getByText('Explore the board')).toBeInTheDocument()
    expect(screen.getByText('npm run dev')).toBeInTheDocument()
    expect(screen.queryByText('Finished one')).not.toBeInTheDocument()
  })

  it('hides agents with none running', async () => {
    await show(status())
    expect(screen.queryByRole('button', { name: /Agents and tasks/ })).not.toBeInTheDocument()
  })

  it("doesn't read the diff of a removed session", async () => {
    await show(null, {
      session: { ...running, state: 'finished', removedAt: '2026-10-30T13:00:00Z' }
    })
    expect(api.sessions.changes).not.toHaveBeenCalled()
  })

  it('finished drops live-only facts', async () => {
    const task: ConversationEntry = {
      kind: 'tool',
      name: 'Task',
      summary: 'x',
      input: '{}',
      output: null,
      error: false
    }
    await show(status(), {
      session: session('T1', { id: 's1', state: 'finished' }),
      entries: [task]
    })
    expect(screen.getByText('Finished')).toBeInTheDocument()
    expect(screen.getByRole('meter', { name: 'Context window' })).toBeInTheDocument()
    expect(screen.queryByRole('meter', { name: '5-hour limit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Agents and tasks/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Model/ })).not.toHaveTextContent('Accept edits')
  })

  it('leaves out the context line and Elapsed for a finished session with no status', async () => {
    await show(null, { session: session('T1', { id: 's1', state: 'finished' }) })
    expect(screen.queryByText("Waiting for Claude's first reply")).not.toBeInTheDocument()
    const sessionRow = screen.getByRole('button', { name: /This session/ })
    expect(sessionRow).not.toHaveTextContent(/\d+[mhd]/)
    await userEvent.click(sessionRow)
    expect(screen.queryByText('Elapsed')).not.toBeInTheDocument()
  })

  it('opens Changes from files and findings', async () => {
    vi.mocked(api.sessions.changes).mockResolvedValue([
      {
        worktree: '/w',
        base: 'b',
        files: [
          { path: 'a.ts', change: 'modified', added: 10, removed: 2, hunks: [] },
          { path: 'b.ts', change: 'added', added: 4, removed: 4, hunks: [] }
        ]
      }
    ])
    const onOpenChanges = vi.fn()
    await show(status(), { onOpenChanges })
    await userEvent.click(screen.getByRole('button', { name: '2 files' }))
    expect(onOpenChanges).toHaveBeenCalled()
    expect(screen.getByText('+14')).toBeInTheDocument()
    expect(screen.getByText('−6')).toBeInTheDocument()
  })

  it('opens Changes from a running automatic review round', async () => {
    const onOpenChanges = vi.fn()
    const reviewRounds = [{ at: 0, round: 1, startedAt: '2026-10-30T13:58:00', files: 2 }]
    await show(status(), {
      session: { ...waiting, state: 'reviewing', reviewRounds },
      onOpenChanges
    })
    await userEvent.click(screen.getByRole('button', { name: 'Open Changes' }))
    expect(onOpenChanges).toHaveBeenCalledOnce()
  })

  it('reads the changes again when Claude stops and a round starts', async () => {
    vi.mocked(api.sessions.status).mockResolvedValue(status())
    const panel = (session: SessionRecord): React.JSX.Element => (
      <GaugesPanel session={session} project={project} facts={facts()} entries={[]} />
    )
    const { rerender } = render(panel(running))
    await act(async () => {})
    const reads = vi.mocked(api.sessions.changes).mock.calls.length
    rerender(panel({ ...running, state: 'reviewing' }))
    await act(async () => {})
    expect(vi.mocked(api.sessions.changes).mock.calls.length).toBe(reads + 1)
  })

  it('no ticket shows files as text', async () => {
    vi.mocked(api.sessions.changes).mockResolvedValue([
      {
        worktree: '/w',
        base: 'b',
        files: [{ path: 'a.ts', change: 'modified', added: 1, removed: 0, hunks: [] }]
      }
    ])
    await show(status(), { session: adhoc({ id: 's1' }), onOpenChanges: undefined })
    expect(screen.getByText('Files').nextSibling).toHaveTextContent('1 file +1 −0')
    expect(screen.queryByRole('button', { name: '1 file' })).not.toBeInTheDocument()
  })

  it('shows the pull request and its stage', async () => {
    vi.mocked(api.sessions.pullRequests).mockResolvedValue([
      {
        repo: 'o/r',
        number: 286,
        title: 'Fix',
        url: 'https://github.com/o/r/pull/286',
        reviewDecision: null,
        base: 'main',
        stage: 'checksFailing',
        checks: [{ name: 'ci', state: 'failing' }],
        threads: []
      }
    ])
    await show(status())
    expect(screen.getByRole('link', { name: '#286' })).toHaveAttribute(
      'href',
      'https://github.com/o/r/pull/286'
    )
    expect(screen.getByRole('button', { name: /^Work/ })).toHaveTextContent('#286 Checks failing')
  })
  it('switches the view, announced as a radio group, and saves the choice', async () => {
    await show(status())
    const view = screen.getByRole('radiogroup', { name: 'View' })
    expect(within(view).getByRole('radio', { name: 'Conversation' })).toBeChecked()
    await userEvent.click(within(view).getByRole('radio', { name: 'Terminal' }))
    expect(within(view).getByRole('radio', { name: 'Terminal' })).toBeChecked()
    expect(localStorage.getItem('sessionView')).toBe('"terminal"')
  })

  it('has the Remote Control switch, but not once the worktree is removed', async () => {
    await show(status())
    expect(screen.getByRole('switch', { name: 'Remote Control' })).toBeInTheDocument()
    cleanup()
    await show(status(), { session: { ...waiting, removedAt: '2026-10-30T13:00:00Z' } })
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.getByRole('radiogroup', { name: 'View' })).toBeInTheDocument()
  })

  it('has the Automatic review switch on a ticket session only', async () => {
    await show(status())
    expect(screen.getByRole('switch', { name: 'Automatic review' })).toBeInTheDocument()
    cleanup()
    await show(status(), { session: adhoc({ state: 'running' }) })
    expect(screen.queryByRole('switch', { name: 'Automatic review' })).toBeNull()
  })

  it('says where a worktree session runs in Where, open, with the branch only there', async () => {
    const worktrees = ['/w/shop-wt.noindex/feat-147', '/w/api-wt.noindex/feat-147']
    await show(status(), {
      session: session('T1', {
        id: 's1',
        branch: 'feat/147',
        worktrees,
        sandbox: { allowedDomains: ['github.com'] }
      })
    })
    const where = screen.getByRole('button', { name: /^Where/ })
    expect(where).toHaveAttribute('aria-expanded', 'true')
    expect(where).toHaveTextContent('Worktree · Sandboxed')
    expect(screen.getByText('Branch').nextSibling).toHaveTextContent('feat/147')
    expect(screen.getByText('Repos').nextSibling).toHaveTextContent('shop, api')
    for (const w of worktrees) expect(screen.getByText(w)).toBeInTheDocument()
    expect(screen.getByText('Sandboxed')).toHaveAccessibleName(
      /reach only github\.com, plus the macOS trust service\./
    )
    expect(screen.getAllByText('feat/147')).toHaveLength(1)
  })

  it('says when the worktree is removed, and no longer claims its sandbox', async () => {
    await show(null, {
      session: {
        ...running,
        state: 'finished',
        removedAt: '2026-10-30T13:00:00Z',
        sandbox: { allowedDomains: ['github.com'] }
      }
    })
    const where = screen.getByRole('button', { name: /^Where/ })
    expect(where).toHaveTextContent('Worktree removed')
    expect(where).not.toHaveTextContent('Sandboxed')
    expect(screen.queryByText('Sandboxed')).not.toBeInTheDocument()
  })

  it("shows a running session's latest step, which the header no longer does", async () => {
    vi.mocked(api.sessions.activity).mockResolvedValue({
      steps: [{ tool: 'Bash', target: 'npm test', at: new Date(NOW).toISOString() }],
      since: new Date(NOW.getTime() - 4 * 60_000).toISOString()
    })
    await show(status())
    expect(await screen.findByRole('img', { name: /npm test/ })).toHaveTextContent('npm test')
  })

  it('says a main checkout session runs there, with no branch or sandbox', async () => {
    await show(status(), { session: adhoc({ id: 's1' }), onOpenChanges: undefined })
    expect(screen.getByRole('button', { name: /^Where/ })).toHaveTextContent('Main checkout')
    expect(screen.getByText('Repo').nextSibling).toHaveTextContent('shop')
    expect(screen.getByText('Folder').nextSibling).toHaveTextContent('/Users/me/projects/shop')
    expect(screen.queryByText('Branch')).not.toBeInTheDocument()
    expect(screen.queryByText('Sandboxed')).not.toBeInTheDocument()
  })

  it("names the session's chosen model until Claude Code reports one", async () => {
    await show(status({ model: null, effort: null }), {
      session: session('T1', { id: 's1', model: 'sonnet' })
    })
    expect(screen.getByRole('button', { name: /^Model/ })).toHaveTextContent('Sonnet')
    cleanup()
    await show(status(), { session: session('T1', { id: 's1', model: 'sonnet' }) })
    const model = screen.getByRole('button', { name: /^Model/ })
    expect(model).toHaveTextContent('Opus 5.5')
    expect(model).not.toHaveTextContent('Sonnet')
  })

  it('has no Model row on the account default with nothing reported', async () => {
    await show(null, { session: session('T1', { id: 's1', state: 'finished' }) })
    expect(screen.queryByRole('button', { name: /^Model/ })).not.toBeInTheDocument()
  })
})

describe('GaugesButton', () => {
  const button = async (s: SessionStatus, on: SessionRecord = running): Promise<void> => {
    vi.mocked(api.sessions.status).mockResolvedValue(s)
    render(<GaugesButton session={on} project={project} facts={facts()} entries={[]} />)
    await act(async () => {})
  }

  it('reads the context, and says it opens the session details', async () => {
    await button(status())
    expect(screen.getByRole('button', { name: 'Context 46%, session details' })).toHaveTextContent(
      'Context 46%'
    )
  })

  it('reads Session with no context reported', async () => {
    vi.mocked(api.sessions.status).mockResolvedValue(null)
    render(<GaugesButton session={running} project={project} facts={facts()} entries={[]} />)
    await act(async () => {})
    expect(screen.getByRole('button', { name: 'Session, session details' })).toHaveTextContent(
      /^Session$/
    )
  })

  it('words a warning', async () => {
    await button(status({ contextPct: 84 }))
    expect(screen.getByRole('button', { name: /Context/ })).toHaveTextContent(
      'Context 84% · Nearly full'
    )
  })

  it('words a warning only at the rounded figure the panel shows', async () => {
    await button(status({ contextPct: 79.6 }))
    expect(screen.getByRole('button', { name: /Context/ })).toHaveTextContent(
      'Context 80% · Nearly full'
    )
  })

  it("doesn't warn of limits on a finished session", async () => {
    await button(
      status({ fiveHour: { pct: 95, resetsAt: at('16:00') } }),
      session('T1', { id: 's1', state: 'finished' })
    )
    expect(screen.getByRole('button', { name: /Context/ })).toHaveTextContent(/^Context 46%$/)
  })

  it('opens the panel in a popover and Esc returns focus', async () => {
    await button(status())
    const trigger = screen.getByRole('button', { name: /Context 46%/ })
    await userEvent.click(trigger)
    const pop = await screen.findByRole('dialog', { name: 'Session' })
    expect(within(pop).getByRole('meter', { name: 'Context window' })).toBeInTheDocument()
    expect(within(pop).getByRole('radiogroup', { name: 'View' })).toBeInTheDocument()
    expect(within(pop).getByRole('switch', { name: 'Remote Control' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})

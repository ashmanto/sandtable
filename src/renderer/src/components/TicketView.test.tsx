import type { IssueRef, ModelUsage, Overlap, Project, SetupProgress } from '../../../shared/types'
import { SETUP_FAILED } from '../../../shared/worktreeSetup'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SandtableApi } from '../../../shared/api'
import {
  boardView,
  fakeSandtable,
  linearProject,
  linearTicket,
  project,
  session,
  ticket
} from '../test/fixtures'
import { TooltipProvider } from '@/components/ui/tooltip'
import { HeaderFrame } from '@/lib/headerFrame'
import { TicketView } from './TicketView'
import { refineMessage, setStartFailures } from '@/hooks/startFlow'
import { folderError } from '../../../shared/repo'
import { TicketCard } from './TicketCard'

vi.mock('./Terminal', () => ({
  Terminal: ({ sessionId }: { sessionId: string }) => <div data-testid="terminal">{sessionId}</div>
}))

const t = ticket(147, { title: 'Fix the thing' })
let api: SandtableApi
const noElsewhere = { projects: [], onOpenElsewhere: () => {} }

function renderView(
  view: ReturnType<typeof boardView>,
  onBack = vi.fn(),
  ticketKey = t.key,
  width = Infinity,
  p = project,
  projects: Project[] = []
): ReturnType<typeof render> {
  return render(
    <TicketView
      project={p}
      ticketKey={ticketKey}
      view={view}
      onBack={onBack}
      onOpenTicket={vi.fn()}
      projects={projects}
      onOpenElsewhere={vi.fn()}
      onProjectSaved={vi.fn()}
    />,
    {
      wrapper: ({ children }) => (
        <TooltipProvider>
          <HeaderFrame value={{ inset: false, needsYou: 0, width }}>{children}</HeaderFrame>
        </TooltipProvider>
      )
    }
  )
}

beforeEach(() => {
  api = fakeSandtable()
})

describe('TicketView', () => {
  it("shows another project's live session in Details instead of Start, and opens it", async () => {
    const other = { ...project, id: 'p2', name: 'Contacts team', icon: '👥' }
    const onOpenElsewhere = vi.fn()
    render(
      <TicketView
        project={project}
        ticketKey={t.key}
        view={boardView({
          tickets: [t],
          elsewhere: [session(t.key, { projectId: 'p2', state: 'needsYou' })]
        })}
        initialTab="details"
        onBack={vi.fn()}
        onOpenTicket={vi.fn()}
        projects={[project, other]}
        onOpenElsewhere={onOpenElsewhere}
        onProjectSaved={vi.fn()}
      />
    )
    expect(screen.getByText('Session in another project')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Start with…/ })).toBeNull()
    await userEvent.click(
      screen.getByRole('button', { name: 'Needs you in Contacts team. Open the session' })
    )
    expect(onOpenElsewhere).toHaveBeenCalledWith('p2', t.key)
    expect(screen.queryByRole('tab', { name: /Conversation/ })).toBeNull()
  })

  it("puts another project's session and Remove worktree under a finished session's conversation", () => {
    const other = { ...project, id: 'p2', name: 'Contacts team' }
    render(
      <TicketView
        project={project}
        ticketKey={t.key}
        view={boardView({
          tickets: [t],
          sessions: [session(t.key, { state: 'finished' })],
          elsewhere: [session(t.key, { id: 'e', projectId: 'p2', state: 'needsYou' })]
        })}
        initialTab="conversation"
        onBack={vi.fn()}
        onOpenTicket={vi.fn()}
        projects={[project, other]}
        onOpenElsewhere={vi.fn()}
        onProjectSaved={vi.fn()}
      />
    )
    const pane = within(screen.getByRole('tabpanel', { name: 'Conversation' }))
    expect(
      pane.getByRole('button', { name: 'Needs you in Contacts team. Open the session' })
    ).toBeInTheDocument()
    expect(pane.getByRole('button', { name: 'Remove worktree' })).toBeInTheDocument()
    expect(pane.queryByRole('button', { name: 'Resume' })).toBeNull()
  })

  it("shows another project's session on a Done ticket as Done, session open", () => {
    const other = { ...project, id: 'p2', name: 'Contacts team' }
    renderView(
      boardView({
        tickets: [{ ...t, status: 'Done' }],
        elsewhere: [session(t.key, { projectId: 'p2', state: 'running' })]
      }),
      undefined,
      t.key,
      Infinity,
      project,
      [project, other]
    )
    expect(
      screen.getByRole('button', {
        name: 'Done, session open in Contacts team. Open the session'
      })
    ).toBeInTheDocument()
  })

  it('shows the issue, title, and Back to board, with the branch in the side panel only', async () => {
    const onBack = vi.fn()
    const s = session(t.key, { branch: 'feat/147', worktrees: ['/w/shop-wt.noindex/feat-147'] })
    renderView(boardView({ tickets: [t], sessions: [s] }), onBack)
    const header = within(screen.getByRole('button', { name: 'Back to board' }).closest('header')!)
    expect(header.getByText('#147')).toBeInTheDocument()
    expect(header.getByRole('heading', { name: 'Fix the thing' })).toBeInTheDocument()
    expect(header.queryByText('feat/147')).toBeNull()
    expect(header.queryByRole('button', { name: /Worktree/ })).toBeNull()
    const panel = within(screen.getByRole('complementary', { name: 'Session' }))
    expect(panel.getByText('Branch').nextSibling).toHaveTextContent('feat/147')
    expect(panel.getByText('Repo').nextSibling).toHaveTextContent('shop')
    await userEvent.click(screen.getByRole('button', { name: 'Back to board' }))
    expect(onBack).toHaveBeenCalled()
  })

  it('puts the title, Start, and Open on GitHub at the top of Details, not in the header', () => {
    renderView(boardView({ tickets: [t] }))
    const header = screen.getByRole('button', { name: 'Back to board' }).closest('header')!
    expect(within(header).queryByRole('button', { name: 'Start' })).not.toBeInTheDocument()
    expect(within(header).queryByRole('link', { name: 'Open on GitHub' })).not.toBeInTheDocument()
    const pane = screen.getByRole('tabpanel', { name: /Details/ })
    expect(within(pane).getByRole('heading', { name: 'Fix the thing' })).toBeInTheDocument()
    expect(within(pane).getByRole('button', { name: 'Start' })).toBeInTheDocument()
    expect(within(pane).getByRole('link', { name: 'Open on GitHub' })).toHaveAttribute(
      'href',
      t.url
    )
  })

  it('puts the actions where the composer was while Conversation is selected', async () => {
    const s = session(t.key, { state: 'finished' })
    render(
      <TicketView
        project={project}
        ticketKey={t.key}
        view={boardView({ tickets: [t], sessions: [s] })}
        initialTab="conversation"
        onBack={vi.fn()}
        onOpenTicket={vi.fn()}
        {...noElsewhere}
        onProjectSaved={vi.fn()}
      />
    )
    const conversation = screen.getByRole('tabpanel', { name: 'Conversation' })
    expect(within(conversation).getByRole('button', { name: 'Resume' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Resume' })).toHaveLength(1)
    await userEvent.click(screen.getByRole('tab', { name: /Details/ }))
    const details = screen.getByRole('tabpanel', { name: 'Details' })
    expect(within(details).getByRole('button', { name: 'Resume' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Resume' })).toHaveLength(1)
  })

  it('opens a Jira issue in Jira', () => {
    const jt = {
      ...linearTicket(12),
      key: 'INF-12',
      url: 'https://acme.atlassian.net/browse/INF-12'
    }
    render(
      <TicketView
        project={{
          ...linearProject,
          linear: undefined,
          jira: { site: 'acme.atlassian.net', project: 'INF', name: 'Internal' }
        }}
        ticketKey={jt.key}
        view={boardView({ tickets: [jt] })}
        onBack={vi.fn()}
        onOpenTicket={vi.fn()}
        {...noElsewhere}
        onProjectSaved={vi.fn()}
      />
    )
    expect(screen.getByRole('link', { name: 'Open in Jira' })).toHaveAttribute('href', jt.url)
  })

  it('shows a Linear issue by its key, opens it in Linear, and starts it in the repo chosen', async () => {
    const lt = linearTicket(12)
    render(
      <TicketView
        project={linearProject}
        ticketKey={lt.key}
        view={boardView({ tickets: [lt] })}
        onBack={vi.fn()}
        onOpenTicket={vi.fn()}
        {...noElsewhere}
        onProjectSaved={vi.fn()}
      />
    )
    expect(
      within(screen.getByRole('button', { name: 'Back to board' }).closest('header')!).getByText(
        'APP-12'
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open in Linear' })).toHaveAttribute('href', lt.url)
    await userEvent.click(screen.getByRole('button', { name: 'Start' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('radio', { name: 'octo/shop-web' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start' }))
    expect(api.tickets.start).toHaveBeenCalledWith(
      'p1',
      'APP-12',
      [],
      'octo/shop-web',
      undefined,
      undefined,
      undefined,
      undefined
    )
  })

  it('offers no Start when the ticket is no longer on the board', () => {
    renderView(boardView({ tickets: [] }))
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument()
  })

  it('shows each open blocker in the header as words', () => {
    const blocked = ticket(147, {
      blockedBy: [
        { key: `${t.repo}#38`, number: 38, title: 'Add a settings screen', repo: t.repo },
        { key: 'o/other#5', number: 5, title: 'Fix it', repo: 'o/other' }
      ]
    })
    renderView(boardView({ tickets: [blocked] }))
    expect(screen.getByText('Blocked by #38')).toHaveAttribute('title', 'Add a settings screen')
    expect(screen.getByText('Blocked by o/other#5')).toBeInTheDocument()
  })

  it('shows the blockers as a count, Clear Needs you as an icon, and no tab hint below 768 px', async () => {
    const blocked = ticket(147, {
      blockedBy: [
        { key: `${t.repo}#38`, number: 38, title: 'Add a settings screen', repo: t.repo },
        { key: 'o/other#5', number: 5, title: 'Fix it', repo: 'o/other' }
      ]
    })
    const s = session(t.key, { state: 'needsYou' })
    renderView(boardView({ tickets: [blocked], sessions: [s] }), vi.fn(), t.key, 600)
    expect(screen.queryByText('Blocked by #38')).not.toBeInTheDocument()
    expect(screen.getByText('2 blockers')).toHaveAttribute(
      'title',
      'Blocked by #38, Blocked by o/other#5'
    )
    expect(screen.getByText('Needs you')).toBeInTheDocument()
    expect(screen.queryByText('⌘\\ to switch')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Clear Needs you' }))
    expect(api.sessions.clearNeedsYou).toHaveBeenCalledWith(s.id)
  })

  it('links a Done ticket to its merged pull request in the header', () => {
    const pr = 'https://github.com/octo/shop/pull/99'
    renderView(boardView({ tickets: [ticket(147, { status: 'Done', mergedPr: pr })] }))
    expect(screen.getByRole('link', { name: 'Merged' })).toHaveAttribute('href', pr)
  })

  it("says where the ticket's open pull request stands in the header", () => {
    renderView(boardView({ tickets: [ticket(147, { prStage: 'checksFailing' })] }))
    expect(screen.getByText('Checks failing')).toBeInTheDocument()
  })

  it('shows no merged mark on a Done ticket without a merged pull request', () => {
    renderView(boardView({ tickets: [ticket(147, { status: 'Done' })] }))
    expect(screen.queryByRole('link', { name: 'Merged' })).toBeNull()
  })

  it('shows Sandboxed in the side panel, not the header, only for a sandboxed session', () => {
    const sandbox = { allowedDomains: ['github.com'] }
    const { unmount } = renderView(
      boardView({ tickets: [t], sessions: [session(t.key, { sandbox })] })
    )
    const panel = within(screen.getByRole('complementary', { name: 'Session' }))
    expect(panel.getByText('Sandboxed')).toHaveAccessibleName(
      /reach only github\.com, plus the macOS trust service\./
    )
    expect(screen.getAllByText('Sandboxed')).toHaveLength(1)
    unmount()
    renderView(boardView({ tickets: [t], sessions: [session(t.key)] }))
    expect(screen.queryByText('Sandboxed')).toBeNull()
  })

  it("toggles the session's Remote Control from the side panel, not the header", async () => {
    vi.mocked(api.sessions.setRemoteControl).mockRejectedValue(
      new Error('Session is already resuming')
    )
    renderView(boardView({ tickets: [t], sessions: [session(t.key, { state: 'needsYou' })] }))
    expect(screen.queryByRole('button', { name: /Remote/ })).toBeNull()
    await userEvent.click(screen.getByRole('switch', { name: 'Remote Control' }))
    expect(api.sessions.setRemoteControl).toHaveBeenCalledWith(`s-${t.key}`, true)
    expect(await screen.findByText('Session is already resuming')).toBeInTheDocument()
  })

  it('reattaches the terminal after the toggle restarts the session', () => {
    const view = (remoteControl: boolean): ReturnType<typeof boardView> =>
      boardView({ tickets: [t], sessions: [session(t.key, { state: 'needsYou', remoteControl })] })
    const { rerender } = renderView(view(false))
    const before = screen.getByTestId('terminal')
    rerender(
      <TicketView
        project={project}
        ticketKey={t.key}
        view={view(true)}
        onBack={vi.fn()}
        onOpenTicket={vi.fn()}
        {...noElsewhere}
        onProjectSaved={vi.fn()}
      />
    )
    expect(screen.getByTestId('terminal')).not.toBe(before)
  })

  it('has no Remote Control toggle once the worktree is removed', () => {
    const s = session(t.key, { state: 'finished', removedAt: '2026-10-24T11:00:00Z' })
    renderView(boardView({ tickets: [t], sessions: [s] }))
    expect(screen.queryByRole('switch', { name: 'Remote Control' })).toBeNull()
  })

  it('renders the live conversation with the terminal in its drawer', () => {
    renderView(boardView({ tickets: [t], sessions: [session(t.key, { state: 'needsYou' })] }))
    expect(screen.getByTestId('terminal')).toHaveTextContent(`s-${t.key}`)
    expect(screen.getByRole('combobox', { name: 'Message' })).toBeInTheDocument()
    expect(api.sessions.watchConversation).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument()
  })

  it('uses the newest session', () => {
    const old = session(t.key, {
      id: 'old',
      state: 'running',
      startedAt: '2026-10-24T09:00:00.000Z'
    })
    const next = session(t.key, { id: 'new', state: 'finished' })
    renderView(boardView({ tickets: [t], sessions: [old, next] }))
    expect(screen.queryByTestId('terminal')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument()
  })

  it('shows Resume and Remove worktree for a finished session', async () => {
    renderView(boardView({ tickets: [t], sessions: [session(t.key, { state: 'finished' })] }))
    expect(screen.queryByTestId('terminal')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove worktree' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(api.sessions.resume).toHaveBeenCalledWith(`s-${t.key}`)
  })

  it('clears Needs you from the header, but not on Done, session open', async () => {
    const { rerender } = renderView(
      boardView({ tickets: [t], sessions: [session(t.key, { state: 'needsYou' })] })
    )
    await userEvent.click(screen.getByRole('button', { name: 'Clear Needs you' }))
    expect(api.sessions.clearNeedsYou).toHaveBeenCalledWith(`s-${t.key}`)
    const done = ticket(147, { title: 'Fix the thing', status: 'Done' })
    rerender(
      <TicketView
        project={project}
        ticketKey={t.key}
        view={boardView({ tickets: [done], sessions: [session(t.key, { state: 'needsYou' })] })}
        onBack={vi.fn()}
        onOpenTicket={vi.fn()}
        {...noElsewhere}
        onProjectSaved={vi.fn()}
      />
    )
    expect(screen.queryByRole('button', { name: 'Clear Needs you' })).toBeNull()
  })

  it("keeps the live session's tokens out of the header, and raises its cap there", async () => {
    vi.mocked(api.sessions.liveUsage).mockResolvedValue({
      [`s-${t.key}`]: [
        {
          model: 'm',
          name: null,
          input: 8.4e6,
          output: 0,
          cacheWrite: 0,
          cacheRead: 0,
          price: 6.12
        }
      ]
    })
    const s = session(t.key, { state: 'needsYou', capped: true })
    const capped = { ...project, tokenCap: 10e6 }
    renderView(boardView({ tickets: [t], sessions: [s] }), vi.fn(), t.key, Infinity, capped)
    const panel = within(screen.getByRole('complementary', { name: 'Session' }))
    expect(await panel.findByRole('button', { name: /This session/ })).toHaveTextContent('8.4M')
    const header = screen.getByRole('button', { name: 'Back to board' }).closest('header')!
    expect(header).not.toHaveTextContent('8.4M')
    expect(screen.queryByRole('button', { name: /Clear Needs you/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Raise cap' }))
    expect(api.sessions.raiseCap).toHaveBeenCalledWith(s.id)
  })

  it('shows Done, session open with the terminal and ends it from Details', async () => {
    const done = ticket(147, { status: 'Done' })
    renderView(boardView({ tickets: [done], sessions: [session(done.key, { state: 'needsYou' })] }))
    expect(screen.getByText('Done, session open')).toBeInTheDocument()
    expect(screen.getByTestId('terminal')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove worktree' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: /Details/ }))
    await userEvent.click(screen.getByRole('button', { name: 'End session and remove worktree' }))
    expect(api.sessions.endAndRemove).toHaveBeenCalledWith(`s-${done.key}`)
    expect(await screen.findByText('Session ended and worktree removed')).toBeInTheDocument()
  })

  it('shows why the worktree was kept after ending the session', async () => {
    vi.mocked(api.sessions.endAndRemove).mockResolvedValue({
      removed: false,
      reason: 'Uncommitted changes'
    })
    const done = ticket(147, { status: 'Done' })
    renderView(boardView({ tickets: [done], sessions: [session(done.key)] }))
    await userEvent.click(screen.getByRole('tab', { name: /Details/ }))
    await userEvent.click(screen.getByRole('button', { name: 'End session and remove worktree' }))
    expect(
      await screen.findByText('Session ended. Kept the worktree: Uncommitted changes')
    ).toBeInTheDocument()
  })

  it('has no Remove worktree for a live session outside the done column', () => {
    renderView(boardView({ tickets: [t], sessions: [session(t.key)] }))
    expect(screen.queryByRole('button', { name: 'Remove worktree' })).not.toBeInTheDocument()
  })

  it('shows the refusal reason', async () => {
    vi.mocked(api.sessions.removeWorktree).mockResolvedValue({
      removed: false,
      reason: 'Uncommitted changes'
    })
    renderView(boardView({ tickets: [t], sessions: [session(t.key, { state: 'finished' })] }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove worktree' }))
    expect(
      await screen.findByText("Couldn't remove the worktree: Uncommitted changes")
    ).toBeInTheDocument()
  })

  it('shows Worktree removed and hides Resume and Remove worktree for a removed session', async () => {
    const removed = session(t.key, { state: 'finished', removedAt: '2026-10-24T11:00:00.000Z' })
    renderView(boardView({ tickets: [t], sessions: [removed] }))
    await userEvent.click(screen.getByRole('tab', { name: /Conversation/ }))
    expect(
      screen.getByText('The branch stays on GitHub. Start makes a new worktree.')
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove worktree' })).not.toBeInTheDocument()
  })

  it('shows a stripped error when resume fails', async () => {
    vi.mocked(api.sessions.resume).mockRejectedValue(
      new Error("Error invoking remote method 'sessions.resume': Error: Worktree is gone")
    )
    renderView(boardView({ tickets: [t], sessions: [session(t.key, { state: 'finished' })] }))
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(await screen.findByText('Worktree is gone')).toBeInTheDocument()
  })

  it('shows only Details when the ticket has no session', () => {
    renderView(boardView({ tickets: [t] }))
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Details'])
    expect(screen.queryByTestId('terminal')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back to board' })).toBeInTheDocument()
  })

  it('switches to Conversation when a resumed session goes live', () => {
    const finished = session(t.key, { state: 'finished' })
    const { rerender } = renderView(boardView({ tickets: [t], sessions: [finished] }))
    rerender(
      <TicketView
        project={project}
        ticketKey={t.key}
        view={boardView({ tickets: [t], sessions: [{ ...finished, state: 'running' }] })}
        onBack={vi.fn()}
        onOpenTicket={vi.fn()}
        {...noElsewhere}
        onProjectSaved={vi.fn()}
      />
    )
    expect(screen.getByRole('tab', { name: /Conversation/ })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })

  it('opens on the initial tab and reports each tab', async () => {
    const onTabChange = vi.fn()
    render(
      <TicketView
        project={project}
        ticketKey={t.key}
        view={boardView({ tickets: [t], sessions: [session(t.key)] })}
        initialTab="details"
        onTabChange={onTabChange}
        onBack={vi.fn()}
        onOpenTicket={vi.fn()}
        {...noElsewhere}
        onProjectSaved={vi.fn()}
      />
    )
    expect(screen.getByRole('tab', { name: /Details/ })).toHaveAttribute('aria-selected', 'true')
    expect(onTabChange).toHaveBeenLastCalledWith('details')
    await userEvent.click(screen.getByRole('tab', { name: /Conversation/ }))
    expect(onTabChange).toHaveBeenLastCalledWith('conversation')
  })

  describe('details', () => {
    const details = {
      url: t.url,
      body: '**Bold move** and a [link](https://example.com)\n\n<b>raw html</b>\n\n```\nnpm test\n```',
      labels: [
        { name: 'bug', color: 'd73a4a' },
        { name: 'sandtable: in progress', color: 'fb8500' }
      ],
      comments: [
        { author: 'ada', createdAt: '2026-10-09T15:46:00Z', body: 'First *comment*' },
        { author: 'linus', createdAt: '2026-10-10T08:00:00Z', body: 'Second comment' }
      ],
      pullRequests: [
        { number: 12, title: 'Fix it', url: 'https://github.com/a/b/pull/12', state: 'open' },
        {
          number: 13,
          title: 'Fix it again',
          url: 'https://github.com/a/b/pull/13',
          state: 'merged'
        },
        { number: 14, title: 'Abandoned', url: 'https://github.com/a/b/pull/14', state: 'closed' }
      ]
    } as const

    it('loads once and shows the body, labels, comments, and pull requests', async () => {
      vi.mocked(api.tickets.details).mockResolvedValue({
        ...details,
        labels: [...details.labels],
        comments: [...details.comments],
        pullRequests: [...details.pullRequests]
      })
      renderView(boardView({ tickets: [t] }))
      expect(await screen.findByText('Bold move')).toHaveProperty('tagName', 'STRONG')
      expect(screen.getByText('npm test')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^Copy/ })).not.toBeInTheDocument()
      expect(api.tickets.details).toHaveBeenCalledTimes(1)
      expect(api.tickets.details).toHaveBeenCalledWith(project.id, t.key)
      expect(screen.getByRole('link', { name: 'link' })).toHaveAttribute('target', '_blank')
      expect(screen.queryByText('raw html', { selector: 'b' })).not.toBeInTheDocument()
      expect(screen.queryByText(/<b>/)).not.toBeInTheDocument()
      expect(screen.getByText('bug')).toBeInTheDocument()
      expect(screen.getByText('sandtable: in progress')).toBeInTheDocument()
      expect(screen.getByText('ada')).toBeInTheDocument()
      expect(screen.getByText('comment')).toHaveProperty('tagName', 'EM')
      expect(screen.getByText('linus')).toBeInTheDocument()
      expect(screen.getByText('Second comment')).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /Details/ })).toHaveTextContent('2 comments')
      const prs = screen.getAllByRole('link', { name: /#1[234]/ })
      expect(prs.map((a) => a.textContent)).toEqual([
        '#12Fix itOpen',
        '#13Fix it againMerged',
        '#14AbandonedClosed'
      ])
      expect(prs[0]).toHaveAttribute('href', 'https://github.com/a/b/pull/12')
      expect(screen.getByRole('link', { name: 'Open on GitHub' })).toHaveAttribute('href', t.url)
    })

    it('says when there is no description, comment, label, or pull request', async () => {
      renderView(boardView({ tickets: [t] }))
      expect(await screen.findByText('No description')).toBeInTheDocument()
      expect(screen.getByText('No comments')).toBeInTheDocument()
      expect(screen.getByText('No labels')).toBeInTheDocument()
      expect(screen.getByText('No linked pull requests')).toBeInTheDocument()
    })

    describe('usage', () => {
      const opus: ModelUsage = {
        model: 'claude-opus-5-5',
        name: 'Opus 5.5',
        input: 600,
        output: 200_000,
        cacheWrite: 1_100_000,
        cacheRead: 30_100_000,
        price: 18.87
      }
      const nightly: ModelUsage = {
        model: 'claude-nightly-x',
        name: null,
        input: 1_000,
        output: 3_000,
        cacheWrite: 20_000,
        cacheRead: 400_000,
        price: null
      }
      const usage = async (): Promise<HTMLElement> =>
        (await screen.findByRole('heading', { name: 'Usage' })).parentElement!

      it('shows tokens by type and model, and adds up the priced models as an estimate', async () => {
        vi.mocked(api.tickets.usage).mockResolvedValue({ usage: [opus, nightly], workMs: 0 })
        renderView(boardView({ tickets: [t] }))
        const section = await usage()
        expect(api.tickets.usage).toHaveBeenCalledWith(project.id, t.key)
        const total = within(section).getByText('31.8M tokens')
        expect(total).toHaveAttribute('title', '31,824,600')
        for (const [type, count, share] of [
          ['Input', '1.6K', '<1%'],
          ['Output', '203K', '1%'],
          ['Cache write', '1.1M', '4%'],
          ['Cache read', '30.5M', '96%']
        ])
          expect(within(section).getByText(type).parentElement).toHaveTextContent(
            `${type}${count}${share}`
          )
        expect(within(section).getByText('Opus 5.5').parentElement).toHaveTextContent(
          'Opus 5.531.4M$18.87'
        )
        expect(within(section).getByText('claude-nightly-x')).toHaveClass('font-mono')
        expect(within(section).getByText('claude-nightly-x').parentElement).toHaveTextContent(
          'No price'
        )
        expect(within(section).getByText('API price estimate').parentElement).toHaveTextContent(
          '$18.87'
        )
        expect(
          within(section).getByText(
            'What this usage would cost on the API, not what you paid. Models without a price show tokens only.'
          )
        ).toBeInTheDocument()
      })

      it('shows tokens only when no model has a price', async () => {
        vi.mocked(api.tickets.usage).mockResolvedValue({ usage: [nightly], workMs: 0 })
        renderView(boardView({ tickets: [t] }))
        const section = await usage()
        expect(within(section).getByText('424K tokens')).toBeInTheDocument()
        expect(within(section).queryByText('API price estimate')).toBeNull()
        expect(
          within(section).getByText('No model here has a price, so this shows tokens only.')
        ).toBeInTheDocument()
      })

      it("shows Claude's working time under the total, in words for screen readers", async () => {
        vi.mocked(api.tickets.usage).mockResolvedValue({ usage: [opus], workMs: 7_200_000 })
        renderView(boardView({ tickets: [t] }))
        const worked = within(await usage()).getByText(/^Claude worked/)
        expect(worked).toHaveTextContent('Claude worked 2h2 hours')
        expect(within(worked).getByText('2 hours')).toHaveClass('sr-only')
      })

      it('shows no working time when Claude ran no turn', async () => {
        vi.mocked(api.tickets.usage).mockResolvedValue({ usage: [opus], workMs: 0 })
        renderView(boardView({ tickets: [t] }))
        expect(within(await usage()).queryByText(/Claude worked/)).toBeNull()
      })

      it('says when the ticket has no token use', async () => {
        renderView(boardView({ tickets: [t] }))
        expect(within(await usage()).getByText('No token use yet')).toBeInTheDocument()
      })

      it("says when it couldn't read the token use", async () => {
        vi.mocked(api.tickets.usage).mockRejectedValue(
          new Error("Error invoking remote method 'tickets.usage': Error: bad transcript")
        )
        renderView(boardView({ tickets: [t] }))
        expect(
          within(await usage()).getByText("Couldn't read token use: bad transcript")
        ).toHaveClass('text-danger')
      })
    })

    it("loads again when the ticket's labels or blockers change, and not on other syncs", async () => {
      const { rerender } = renderView(boardView({ tickets: [t] }))
      await screen.findByText('No description')
      const again = (next: typeof t): void =>
        rerender(
          <TicketView
            project={project}
            ticketKey={t.key}
            view={boardView({ tickets: [next] })}
            onBack={vi.fn()}
            onOpenTicket={vi.fn()}
            {...noElsewhere}
            onProjectSaved={vi.fn()}
          />
        )
      again({ ...t })
      expect(api.tickets.details).toHaveBeenCalledTimes(1)
      expect(api.tickets.usage).toHaveBeenCalledTimes(1)
      again({ ...t, labels: [{ name: 'area: board', color: '' }] })
      await vi.waitFor(() => expect(api.tickets.details).toHaveBeenCalledTimes(2))
      expect(api.tickets.usage).toHaveBeenCalledTimes(2)
      again({
        ...t,
        labels: [{ name: 'area: board', color: '' }],
        blockedBy: [{ key: 'o/r#38', number: 38, title: 'Settings', repo: t.repo }]
      })
      await vi.waitFor(() => expect(api.tickets.details).toHaveBeenCalledTimes(3))
      expect(api.tickets.usage).toHaveBeenCalledTimes(3)
    })

    it("loads the usage again when the ticket's project changes, as after a chat turn", async () => {
      const listeners = new Set<(projectId: string) => void>()
      vi.mocked(api.board.onChange).mockImplementation((cb) => {
        listeners.add(cb)
        return () => listeners.delete(cb)
      })
      const onChange = (id: string): void => listeners.forEach((cb) => cb(id))
      renderView(boardView({ tickets: [t] }))
      await screen.findByText('No description')
      expect(api.tickets.usage).toHaveBeenCalledTimes(1)
      act(() => onChange('other'))
      expect(api.tickets.usage).toHaveBeenCalledTimes(1)
      act(() => onChange(project.id))
      expect(api.tickets.usage).toHaveBeenCalledTimes(2)
      expect(api.tickets.details).toHaveBeenCalledTimes(1)
    })

    it('clears the error when a load after a sync succeeds', async () => {
      vi.mocked(api.tickets.details).mockRejectedValueOnce(new Error('GitHub is down'))
      const { rerender } = renderView(boardView({ tickets: [t] }))
      expect(
        await screen.findByText("Couldn't load the ticket details: GitHub is down")
      ).toBeInTheDocument()
      rerender(
        <TicketView
          project={project}
          ticketKey={t.key}
          view={boardView({ tickets: [{ ...t, labels: [{ name: 'area: board', color: '' }] }] })}
          onBack={vi.fn()}
          onOpenTicket={vi.fn()}
          {...noElsewhere}
          onProjectSaved={vi.fn()}
        />
      )
      expect(await screen.findByText('No description')).toBeInTheDocument()
      expect(screen.queryByText(/Couldn't load the ticket details/)).toBeNull()
    })

    it('replaces loaded details with the error when a reload after a sync fails', async () => {
      const { rerender } = renderView(boardView({ tickets: [t] }))
      await screen.findByText('No description')
      vi.mocked(api.tickets.details).mockRejectedValueOnce(new Error('GitHub is down'))
      rerender(
        <TicketView
          project={project}
          ticketKey={t.key}
          view={boardView({ tickets: [{ ...t, labels: [{ name: 'area: board', color: '' }] }] })}
          onBack={vi.fn()}
          onOpenTicket={vi.fn()}
          {...noElsewhere}
          onProjectSaved={vi.fn()}
        />
      )
      expect(
        await screen.findByText("Couldn't load the ticket details: GitHub is down")
      ).toBeInTheDocument()
      expect(screen.queryByText('No description')).not.toBeInTheDocument()
    })

    it('shows a stripped error with Retry while the terminal keeps running', async () => {
      vi.mocked(api.tickets.details).mockRejectedValueOnce(
        new Error("Error invoking remote method 'tickets.details': Error: GitHub is down")
      )
      renderView(boardView({ tickets: [t], sessions: [session(t.key)] }))
      expect(
        await screen.findByText("Couldn't load the ticket details: GitHub is down")
      ).toBeInTheDocument()
      expect(screen.getByTestId('terminal')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
      expect(await screen.findByText('No description')).toBeInTheDocument()
      expect(api.tickets.details).toHaveBeenCalledTimes(2)
      expect(api.tickets.usage).toHaveBeenCalledTimes(2)
    })

    it('shows Loading details again on Retry', async () => {
      vi.mocked(api.tickets.details)
        .mockRejectedValueOnce(new Error('GitHub is down'))
        .mockReturnValueOnce(new Promise(() => {}))
      renderView(boardView({ tickets: [t] }))
      await userEvent.click(await screen.findByRole('button', { name: 'Retry' }))
      expect(screen.getByText('Loading details')).toBeInTheDocument()
      expect(screen.queryByText(/Couldn't load the ticket details/)).toBeNull()
    })
  })

  describe('tabs', () => {
    it('opens on Conversation for a live session and keeps it mounted behind Details', async () => {
      renderView(boardView({ tickets: [t], sessions: [session(t.key)] }))
      expect(screen.getByRole('tab', { name: /Conversation/ })).toHaveAttribute(
        'aria-selected',
        'true'
      )
      await userEvent.click(screen.getByRole('tab', { name: /Details/ }))
      expect(screen.getByRole('tab', { name: /Details/ })).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByTestId('terminal')).toBeInTheDocument()
    })

    it('opens on Details without a live session', () => {
      renderView(boardView({ tickets: [t], sessions: [session(t.key, { state: 'finished' })] }))
      expect(screen.getByRole('tab', { name: /Details/ })).toHaveAttribute('aria-selected', 'true')
    })

    it('shows Needs you on the hidden Conversation tab', async () => {
      renderView(boardView({ tickets: [t], sessions: [session(t.key, { state: 'needsYou' })] }))
      const terminalTab = screen.getByRole('tab', { name: /Conversation/ })
      expect(within(terminalTab).queryByText('Needs you')).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('tab', { name: /Details/ }))
      expect(within(terminalTab).getByText('Needs you')).toBeInTheDocument()
      await userEvent.click(terminalTab)
      expect(within(terminalTab).queryByText('Needs you')).not.toBeInTheDocument()
    })

    it('shows Reviewing on the hidden Conversation tab', async () => {
      renderView(boardView({ tickets: [t], sessions: [session(t.key, { state: 'reviewing' })] }))
      await userEvent.click(screen.getByRole('tab', { name: /Details/ }))
      const conversationTab = screen.getByRole('tab', { name: /Conversation/ })
      expect(within(conversationTab).getByText('Reviewing')).toBeInTheDocument()
    })

    it('opens Changes from an automatic review round in the conversation', async () => {
      const s = session(t.key, {
        state: 'needsYou',
        reviewRounds: [{ at: 0, round: 1, startedAt: '2026-10-31T14:02:00', files: 2 }]
      })
      vi.mocked(api.sessions.watchConversation).mockResolvedValue({
        from: 0,
        entries: [{ kind: 'user', text: 'Go' }],
        facts: { todos: [], permissionMode: null, compactions: [] }
      })
      renderView(boardView({ tickets: [t], sessions: [s] }))
      await userEvent.click(await screen.findByRole('button', { name: 'Open Changes' }))
      const changes = screen.getByRole('tab', { name: /Changes/ })
      expect(changes).toHaveAttribute('aria-selected', 'true')
      expect(document.activeElement).toBe(changes)
    })

    it('shows API error on the hidden Conversation tab', async () => {
      renderView(boardView({ tickets: [t], sessions: [session(t.key, { state: 'apiError' })] }))
      await userEvent.click(screen.getByRole('tab', { name: /Details/ }))
      expect(
        within(screen.getByRole('tab', { name: /Conversation/ })).getByText('API error')
      ).toBeInTheDocument()
    })

    it('shows no Needs you on the hidden Conversation tab when the session is done-open', async () => {
      const done = ticket(147, { status: 'Done' })
      renderView(
        boardView({ tickets: [done], sessions: [session(done.key, { state: 'needsYou' })] })
      )
      await userEvent.click(screen.getByRole('tab', { name: /Details/ }))
      expect(
        within(screen.getByRole('tab', { name: /Conversation/ })).queryByText('Needs you')
      ).not.toBeInTheDocument()
    })

    it('cycles through the tabs with Command-backslash', async () => {
      renderView(boardView({ tickets: [t], sessions: [session(t.key)] }))
      for (const name of ['Details', 'Changes', 'Conversation']) {
        await userEvent.keyboard('{Meta>}\\{/Meta}')
        expect(screen.getByRole('tab', { name: new RegExp(name) })).toHaveAttribute(
          'aria-selected',
          'true'
        )
      }
    })

    it('stays on Details without a session, with no Chat tab', async () => {
      renderView(boardView({ tickets: [t] }))
      expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Details'])
      await userEvent.keyboard('{Meta>}\\{/Meta}')
      expect(screen.getByRole('tab', { name: /Details/ })).toHaveAttribute('aria-selected', 'true')
    })

    it("opens the drawer when the session asks something the card can't show", async () => {
      renderView(
        boardView({ tickets: [t], sessions: [session(t.key, { state: 'needsYou', asking: true })] })
      )
      await vi.waitFor(() =>
        expect(screen.getByRole('region', { name: 'Terminal' })).not.toHaveAttribute('inert')
      )
    })

    it('shows the Gauges panel beside the conversation, folded into Context under 900 px', async () => {
      renderView(boardView({ tickets: [t], sessions: [session(t.key)] }))
      expect(screen.getByRole('complementary', { name: 'Session' })).toBeInTheDocument()
      cleanup()
      renderView(boardView({ tickets: [t], sessions: [session(t.key)] }), vi.fn(), t.key, 899)
      expect(screen.queryByRole('complementary', { name: 'Session' })).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: /session details/ }))
      expect(await screen.findByRole('dialog', { name: 'Session' })).toBeInTheDocument()
    })

    it('shows Context on every tab without the side panel, so its details stay reachable', async () => {
      renderView(boardView({ tickets: [t], sessions: [session(t.key)] }))
      expect(screen.queryByRole('button', { name: /session details/ })).toBeNull()
      await userEvent.click(screen.getByRole('tab', { name: /Details/ }))
      await userEvent.click(screen.getByRole('button', { name: /session details/ }))
      const pop = within(await screen.findByRole('dialog', { name: 'Session' }))
      expect(pop.getByRole('button', { name: /^Where/ })).toBeInTheDocument()
      await userEvent.keyboard('{Escape}')
      await userEvent.click(screen.getByRole('tab', { name: /Changes/ }))
      expect(screen.getByRole('button', { name: /session details/ })).toBeInTheDocument()
      await userEvent.click(screen.getByRole('tab', { name: /Conversation/ }))
      expect(screen.queryByRole('button', { name: /session details/ })).toBeNull()
      expect(screen.getByRole('complementary', { name: 'Session' })).toBeInTheDocument()
    })

    it("opens Changes from the panel's files", async () => {
      renderView(boardView({ tickets: [t], sessions: [session(t.key)] }))
      const panel = within(screen.getByRole('complementary', { name: 'Session' }))
      await userEvent.click(panel.getByRole('button', { name: '0 files' }))
      expect(screen.getByRole('tab', { name: /Changes/ })).toHaveAttribute('aria-selected', 'true')
    })

    it('shows the chat panel beside Details without a session', async () => {
      renderView(boardView({ tickets: [t] }))
      const chat = screen.getByRole('complementary', { name: 'Chat' })
      expect(await within(chat).findByText('Ask Claude about this ticket')).toBeInTheDocument()
      expect(api.tickets.chat).toHaveBeenCalledWith(project.id, t.key)
    })

    it('shows the chat panel beside Details with a session', async () => {
      renderView(boardView({ tickets: [t], sessions: [session(t.key)] }))
      expect(api.tickets.chat).not.toHaveBeenCalled()
      await userEvent.click(screen.getByRole('tab', { name: /Details/ }))
      expect(await screen.findByText('Ask Claude about this ticket')).toBeInTheDocument()
    })

    it('hides the chat to a rail and shows it again with what you typed', async () => {
      renderView(boardView({ tickets: [t] }))
      await userEvent.type(await screen.findByRole('textbox', { name: 'Message' }), 'Hi')
      await userEvent.click(screen.getByRole('button', { name: 'Hide chat' }))
      expect(screen.queryByRole('complementary', { name: 'Chat' })).not.toBeInTheDocument()
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Show chat' }))
      await userEvent.click(screen.getByRole('button', { name: 'Show chat' }))
      expect(screen.getByRole('complementary', { name: 'Chat' })).toBeVisible()
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Hide chat' }))
      expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Hi')
      expect(screen.queryByRole('button', { name: 'Show chat' })).not.toBeInTheDocument()
    })

    it('starts with the chat hidden in a window under 900 px', async () => {
      const width = window.innerWidth
      window.innerWidth = 899
      try {
        renderView(boardView({ tickets: [t] }))
        expect(screen.getByRole('button', { name: 'Show chat' })).toBeInTheDocument()
        expect(screen.queryByRole('complementary', { name: 'Chat' })).not.toBeInTheDocument()
        expect(api.tickets.chat).not.toHaveBeenCalled()
        expect(document.activeElement).toBe(document.body)
      } finally {
        window.innerWidth = width
      }
    })

    it('loads the details again after a comment posts', async () => {
      vi.mocked(api.tickets.chat).mockResolvedValue({
        chat: {
          projectId: project.id,
          ticketKey: t.key,
          conversationId: 'c1',
          claudeDir: '/claude',
          cwd: '/repos/r',
          messages: [{ role: 'assistant', text: 'Hi' }]
        },
        answering: false
      })
      vi.mocked(api.tickets.draftComment).mockResolvedValue('Summary')
      renderView(boardView({ tickets: [t] }))
      await userEvent.click(await screen.findByRole('radio', { name: /^Comment/ }))
      await userEvent.click(screen.getByRole('button', { name: 'Draft with Claude' }))
      await userEvent.click(await screen.findByRole('button', { name: 'Post comment' }))
      await screen.findByText('Comment posted')
      expect(api.tickets.details).toHaveBeenCalledTimes(2)
    })

    it('shows Changes only for a session with a worktree, and reads its findings when selected', async () => {
      renderView(boardView({ tickets: [t], sessions: [session(t.key, { worktrees: [] })] }))
      expect(screen.queryByRole('tab', { name: /Changes/ })).not.toBeInTheDocument()
      cleanup()
      vi.clearAllMocks()
      renderView(boardView({ tickets: [t], sessions: [session(t.key, { state: 'finished' })] }))
      expect(api.sessions.findings).not.toHaveBeenCalled()
      expect(api.sessions.pullRequests).not.toHaveBeenCalled()
      expect(screen.queryByRole('complementary', { name: 'Session' })).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('tab', { name: /Changes/ }))
      expect(await screen.findByText('No changes')).toBeInTheDocument()
    })

    it("counts the Changes list's files on its tab from another tab, hidden at zero", async () => {
      const listeners = new Set<(projectId: string) => void>()
      vi.mocked(api.board.onChange).mockImplementation((cb) => {
        listeners.add(cb)
        return () => listeners.delete(cb)
      })
      const file = { change: 'modified' as const, added: 1, removed: 0, hunks: [] }
      vi.mocked(api.sessions.changes).mockResolvedValue([
        { worktree: '/r/a', base: 'origin/main', files: [{ ...file, path: 'a.ts' }] },
        { worktree: '/r/b', base: 'origin/main', files: [{ ...file, path: 'b.ts' }] }
      ])
      renderView(boardView({ tickets: [t], sessions: [session(t.key, { state: 'finished' })] }))
      const tab = await screen.findByRole('tab', { name: 'Changes, 2 files changed' })
      expect(tab).toHaveTextContent('2')
      vi.mocked(api.sessions.changes).mockResolvedValue([
        { worktree: '/r/a', base: 'origin/main', files: [] }
      ])
      act(() => listeners.forEach((cb) => cb(project.id)))
      expect(await screen.findByRole('tab', { name: 'Changes' })).not.toHaveTextContent(/\d/)
    })

    it('falls back to the default tab for a saved Changes tab with no worktree', () => {
      render(
        <TicketView
          project={project}
          ticketKey={t.key}
          view={boardView({ tickets: [t] })}
          initialTab="changes"
          onBack={vi.fn()}
          onOpenTicket={vi.fn()}
          {...noElsewhere}
          onProjectSaved={vi.fn()}
        />
      )
      expect(screen.getByRole('tab', { name: /Details/ })).toHaveAttribute('aria-selected', 'true')
    })

    it('shows Conversation only with a session', () => {
      renderView(boardView({ tickets: [t] }))
      expect(screen.queryByRole('tab', { name: /Conversation/ })).not.toBeInTheDocument()
    })

    it("shows a cleaned-up session's conversation", async () => {
      vi.mocked(api.sessions.watchConversation).mockResolvedValue({
        from: 0,
        entries: [{ kind: 'assistant', text: 'All merged' }],
        facts: { todos: [], permissionMode: null, compactions: [] }
      })
      const removed = session(t.key, { state: 'finished', removedAt: '2026-10-24T11:00:00.000Z' })
      renderView(boardView({ tickets: [t], sessions: [removed] }))
      await userEvent.click(screen.getByRole('tab', { name: /Conversation/ }))
      expect(await screen.findByText('All merged')).toBeInTheDocument()
      expect(api.sessions.watchConversation).toHaveBeenCalledWith(removed.id)
    })

    it('reads an earlier session of a ticket started again', async () => {
      vi.mocked(api.sessions.watchConversation).mockImplementation(async (id) => ({
        from: 0,
        entries: [{ kind: 'assistant', text: `In ${id}` }],
        facts: { todos: [], permissionMode: null, compactions: [] }
      }))
      const removed = session(t.key, {
        id: 'old',
        state: 'finished',
        removedAt: '2026-10-24T11:00:00.000Z'
      })
      const again = session(t.key, { id: 'new', startedAt: '2026-10-24T12:00:00.000Z' })
      renderView(boardView({ tickets: [t], sessions: [removed, again] }))
      expect(await screen.findByText('In new')).toBeInTheDocument()
      expect(screen.getByText('1 message')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('combobox', { name: 'Session' }))
      await userEvent.click(screen.getByRole('option', { name: /Finished/ }))
      expect(await screen.findByText('In old')).toBeInTheDocument()
    })

    it("opens the newest session's details from Context off Conversation, after an older one was picked", async () => {
      const old = session(t.key, { id: 'old', state: 'finished', branch: 'old-branch' })
      const now = session(t.key, {
        id: 'new',
        branch: 'new-branch',
        startedAt: '2026-10-24T12:00:00.000Z'
      })
      renderView(boardView({ tickets: [t], sessions: [old, now] }))
      await userEvent.click(screen.getByRole('combobox', { name: 'Session' }))
      await userEvent.click(screen.getByRole('option', { name: /Finished/ }))
      await userEvent.click(screen.getByRole('tab', { name: /Details/ }))
      await userEvent.click(screen.getByRole('button', { name: /session details/ }))
      const pop = within(await screen.findByRole('dialog', { name: 'Session' }))
      expect(pop.getByText('new-branch')).toBeInTheDocument()
      await userEvent.keyboard('{Escape}')
      await userEvent.click(screen.getByRole('tab', { name: /Conversation/ }))
      const panel = within(screen.getByRole('complementary', { name: 'Session' }))
      expect(panel.getByText('old-branch')).toBeInTheDocument()
      expect(
        vi.mocked(api.sessions.watchConversation).mock.calls.filter(([id]) => id === 'old')
      ).toHaveLength(1)
    })

    it('watches the newest session for Context only off Conversation', async () => {
      const old = session(t.key, { id: 'old', state: 'finished' })
      const now = session(t.key, { id: 'new', startedAt: '2026-10-24T12:00:00.000Z' })
      renderView(boardView({ tickets: [t], sessions: [old, now] }))
      await userEvent.click(screen.getByRole('combobox', { name: 'Session' }))
      await userEvent.click(screen.getByRole('option', { name: /Finished/ }))
      const watched = (): number =>
        vi.mocked(api.sessions.watchConversation).mock.calls.filter(([id]) => id === 'new').length
      expect(watched()).toBe(1)
      await userEvent.click(screen.getByRole('tab', { name: /Details/ }))
      expect(watched()).toBe(2)
    })

    it('leaves the View switch out of Context off Conversation, and opens Changes from its files', async () => {
      renderView(boardView({ tickets: [t], sessions: [session(t.key)] }))
      await userEvent.click(screen.getByRole('tab', { name: /Details/ }))
      await userEvent.click(screen.getByRole('button', { name: /session details/ }))
      const pop = within(await screen.findByRole('dialog', { name: 'Session' }))
      expect(pop.queryByRole('radiogroup', { name: 'View' })).toBeNull()
      await userEvent.click(pop.getByRole('button', { name: '0 files' }))
      const changes = screen.getByRole('tab', { name: /Changes/ })
      expect(changes).toHaveAttribute('aria-selected', 'true')
      expect(screen.queryByRole('dialog', { name: 'Session' })).toBeNull()
      expect(changes).toHaveFocus()
      await userEvent.click(screen.getByRole('button', { name: /session details/ }))
      const again = within(await screen.findByRole('dialog', { name: 'Session' }))
      expect(again.getByText('Files').nextSibling).toHaveTextContent('0 files')
      expect(again.queryByRole('button', { name: '0 files' })).toBeNull()
    })

    it("opens a removed session's details from Context on Details, as its Conversation tab shows them", async () => {
      const removed = session(t.key, { state: 'finished', removedAt: '2026-10-24T11:00:00.000Z' })
      renderView(boardView({ tickets: [t], sessions: [removed] }))
      await userEvent.click(screen.getByRole('tab', { name: /Details/ }))
      await userEvent.click(screen.getByRole('button', { name: /session details/ }))
      const pop = within(await screen.findByRole('dialog', { name: 'Session' }))
      expect(pop.getByRole('button', { name: /^Where/ })).toHaveTextContent('Worktree removed')
    })

    it('leaves the latest step out of the panel on Done, session open', async () => {
      vi.mocked(api.sessions.activity).mockResolvedValue({
        steps: [{ tool: 'Bash', target: 'npm test', at: new Date().toISOString() }],
        since: new Date().toISOString()
      })
      const done = ticket(147, { status: 'Done' })
      renderView(
        boardView({ tickets: [done], sessions: [session(done.key, { state: 'running' })] })
      )
      await userEvent.click(screen.getByRole('tab', { name: /Conversation/ }))
      const panel = within(screen.getByRole('complementary', { name: 'Session' }))
      await act(async () => {})
      expect(panel.queryByRole('img', { name: /npm test/ })).toBeNull()
      expect(screen.getByText('Done, session open')).toBeInTheDocument()
    })

    it('shows no actions under a picked older session of a done ticket with a live session', async () => {
      const done = ticket(147, { status: 'Done' })
      const old = session(done.key, {
        id: 'old',
        state: 'finished',
        removedAt: '2026-10-24T11:00:00.000Z'
      })
      const now = session(done.key, { id: 'new', startedAt: '2026-10-24T12:00:00.000Z' })
      renderView(boardView({ tickets: [done], sessions: [old, now] }))
      await userEvent.click(screen.getByRole('combobox', { name: 'Session' }))
      await userEvent.click(screen.getByRole('option', { name: /Finished/ }))
      const pane = within(screen.getByRole('tabpanel', { name: 'Conversation' }))
      expect(
        pane.getByText('The branch stays on GitHub. Start makes a new worktree.')
      ).toBeInTheDocument()
      expect(pane.queryByRole('button', { name: /End session/ })).toBeNull()
    })

    it('shows no actions or Changes link under a picked older session when the newest is removed', async () => {
      const old = session(t.key, { id: 'old', state: 'finished' })
      const now = session(t.key, {
        id: 'new',
        state: 'finished',
        startedAt: '2026-10-24T12:00:00.000Z',
        removedAt: '2026-10-24T13:00:00.000Z'
      })
      renderView(boardView({ tickets: [t], sessions: [old, now] }), undefined, t.key, Infinity)
      await userEvent.click(screen.getByRole('tab', { name: /Conversation/ }))
      const pane = within(screen.getByRole('tabpanel', { name: 'Conversation' }))
      expect(
        pane.getByText('The branch stays on GitHub. Start makes a new worktree.')
      ).toBeInTheDocument()
      await userEvent.click(screen.getByRole('combobox', { name: 'Session' }))
      await userEvent.click(screen.getAllByRole('option')[1])
      expect(pane.queryByText(/The branch stays on GitHub/)).toBeNull()
      expect(pane.queryByRole('button', { name: /Resume|Remove worktree|Start/ })).toBeNull()
      expect(pane.queryByRole('button', { name: '0 files' })).toBeNull()
      expect(pane.getAllByText('0 files').length).toBeGreaterThan(0)
    })

    it('Summarize session drafts for the session and shows the chat on Details', async () => {
      vi.mocked(api.sessions.watchConversation).mockResolvedValue({
        from: 0,
        entries: [{ kind: 'assistant', text: 'All merged' }],
        facts: { todos: [], permissionMode: null, compactions: [] }
      })
      const done = session(t.key, { state: 'finished' })
      renderView(boardView({ tickets: [t], sessions: [done] }))
      await userEvent.click(screen.getByRole('tab', { name: /Conversation/ }))
      await userEvent.click(await screen.findByRole('button', { name: 'Summarize session' }))
      expect(api.sessions.summarize).toHaveBeenCalledWith(done.id)
      expect(screen.getByRole('tab', { name: /Details/ })).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByRole('complementary', { name: 'Chat' })).toBeVisible()
    })

    it('says so when a finished session has no conversation file', async () => {
      vi.mocked(api.sessions.watchConversation).mockResolvedValue({
        from: 0,
        entries: [],
        facts: { todos: [], permissionMode: null, compactions: [] },
        missing: true
      })
      renderView(boardView({ tickets: [t], sessions: [session(t.key, { state: 'finished' })] }))
      await userEvent.click(screen.getByRole('tab', { name: /Conversation/ }))
      expect(await screen.findByText('Conversation not found')).toBeInTheDocument()
    })

    it('focuses the composer when Conversation is selected', async () => {
      renderView(boardView({ tickets: [t], sessions: [session(t.key, { state: 'idle' })] }))
      await userEvent.click(screen.getByRole('tab', { name: /Details/ }))
      await userEvent.click(screen.getByRole('tab', { name: /Conversation/ }))
      const pane = within(screen.getByRole('tabpanel', { name: 'Conversation' }))
      expect(pane.getByRole('combobox', { name: 'Message' })).toHaveFocus()
    })

    it('falls back to the default tab for a saved Conversation tab with no session', () => {
      render(
        <TicketView
          project={project}
          ticketKey={t.key}
          view={boardView({ tickets: [t] })}
          initialTab="conversation"
          onBack={vi.fn()}
          onOpenTicket={vi.fn()}
          {...noElsewhere}
          onProjectSaved={vi.fn()}
        />
      )
      expect(screen.getByRole('tab', { name: /Details/ })).toHaveAttribute('aria-selected', 'true')
    })

    it('disables Resume and Remove worktree while one runs', async () => {
      let finish: () => void = () => undefined
      vi.mocked(api.sessions.resume).mockReturnValue(new Promise<void>((r) => (finish = r)))
      renderView(boardView({ tickets: [t], sessions: [session(t.key, { state: 'finished' })] }))
      await userEvent.click(screen.getByRole('button', { name: 'Resume' }))
      expect(screen.getByRole('button', { name: 'Resume' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Remove worktree' })).toBeDisabled()
      finish()
      await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Resume' })).toBeEnabled())
    })

    it('disables End session and remove worktree while it runs', async () => {
      vi.mocked(api.sessions.endAndRemove).mockReturnValue(new Promise(() => undefined))
      const done = ticket(147, { status: 'Done' })
      renderView(boardView({ tickets: [done], sessions: [session(done.key)] }))
      await userEvent.click(screen.getByRole('tab', { name: /Details/ }))
      const end = screen.getByRole('button', { name: 'End session and remove worktree' })
      await userEvent.click(end)
      expect(end).toBeDisabled()
    })

    it('disables Start while a start is pending', async () => {
      let finish: () => void = () => undefined
      vi.mocked(api.tickets.start).mockReturnValue(new Promise<void>((r) => (finish = r)))
      renderView(boardView({ tickets: [t] }))
      await userEvent.click(screen.getByRole('button', { name: 'Start' }))
      await userEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Start' })
      )
      expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
      finish()
      await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled())
      expect(api.tickets.start).toHaveBeenCalledTimes(1)
    })

    it('Start in Details runs the check', async () => {
      vi.mocked(api.tickets.checkStart).mockResolvedValue({
        triage: false,
        problems: ['Blocked by #38: Add a settings screen'],
        overlap: [],
        ready: false
      })
      renderView(boardView({ tickets: [t] }))
      await userEvent.click(screen.getByRole('button', { name: 'Start' }))
      expect(await screen.findByText('Blocked by #38: Add a settings screen')).toBeInTheDocument()
      expect(api.tickets.checkStart).toHaveBeenCalledWith(project.id, t.key)
      await userEvent.click(screen.getByRole('button', { name: 'Start anyway' }))
      await userEvent.click(
        within(await screen.findByRole('dialog')).getByRole('button', { name: 'Start' })
      )
      expect(api.tickets.start).toHaveBeenCalledWith(
        project.id,
        t.key,
        [],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined
      )
    })

    it('shows the overlap check under the header and starts anyway', async () => {
      vi.mocked(api.tickets.checkStart).mockResolvedValue({
        triage: false,
        problems: [],
        overlap: [{ key: 'octo/shop#67', number: 67, title: 'Sort cards' }],
        ready: false
      })
      let finish: (o: Overlap[]) => void = () => undefined
      vi.mocked(api.tickets.checkOverlap).mockReturnValue(new Promise((r) => (finish = r)))
      renderView(boardView({ tickets: [t] }))
      await userEvent.click(screen.getByRole('button', { name: 'Start' }))
      await userEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Start' })
      )
      expect(await screen.findByText('Checking overlap with #67')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
      await act(async () =>
        finish([{ key: 'octo/shop#67', number: 67, title: 'Sort cards', reason: 'Same file.' }])
      )
      expect(screen.getByText('Overlaps')).toBeInTheDocument()
      expect(api.tickets.start).not.toHaveBeenCalled()
      await userEvent.click(screen.getByRole('button', { name: 'Start anyway' }))
      expect(api.tickets.start).toHaveBeenCalledWith(
        project.id,
        t.key,
        [],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined
      )
    })

    it('shows a failed setup under the header, disables Start, and starts anyway without setup', async () => {
      const tk = ticket(141)
      const target = `${project.id}\n${tk.key}`
      let push: (target: string, p: SetupProgress | null) => void = () => {}
      vi.mocked(api.setup.onProgress).mockImplementation((cb) => {
        push = cb
        return () => {}
      })
      vi.mocked(api.tickets.start).mockRejectedValueOnce(new Error(`${SETUP_FAILED}: boom`))
      renderView(boardView({ tickets: [tk] }), vi.fn(), tk.key)
      await userEvent.click(screen.getByRole('button', { name: 'Start' }))
      await userEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Start' })
      )
      act(() =>
        push(target, {
          repo: 'octo/shop',
          state: 'failed',
          notes: [],
          lines: [],
          error: 'boom',
          startedAt: new Date().toISOString()
        })
      )
      expect(await screen.findByText('Setup failed: boom')).toBeInTheDocument()
      expect(screen.queryByText(/Couldn't start/)).toBeNull()
      expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
      await userEvent.click(screen.getByRole('button', { name: 'Start anyway' }))
      expect(screen.getByRole('heading', { level: 1, name: tk.title })).toHaveFocus()
      expect(api.tickets.start).toHaveBeenLastCalledWith(
        project.id,
        tk.key,
        [],
        undefined,
        undefined,
        undefined,
        false,
        undefined
      )
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(api.setup.cancel).toHaveBeenCalledWith(target)
    })

    it('Refine in chat sends the gaps to the chat beside Details', async () => {
      vi.mocked(api.tickets.checkStart).mockResolvedValue({
        triage: false,
        problems: [],
        overlap: [],
        ready: true
      })
      vi.mocked(api.tickets.checkReady).mockResolvedValue(["Doesn't say which screen"])
      renderView(boardView({ tickets: [t] }))
      await userEvent.click(screen.getByRole('button', { name: 'Start' }))
      await userEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Start' })
      )
      expect(await screen.findByText('Not ready')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Refine in chat' }))
      await vi.waitFor(() =>
        expect(api.tickets.sendChat).toHaveBeenCalledWith(
          project.id,
          t.key,
          refineMessage(["Doesn't say which screen"])
        )
      )
      expect(api.tickets.sendChat).toHaveBeenCalledTimes(1)
      expect(screen.queryByText('Not ready')).toBeNull()
      expect(api.tickets.start).not.toHaveBeenCalled()
    })

    it("doesn't ask for the repo's setup hint when it starts", async () => {
      const p = { ...project, id: 'p-hint-view' }
      renderView(boardView({ tickets: [t] }), vi.fn(), t.key, Infinity, p)
      await userEvent.click(screen.getByRole('button', { name: 'Start' }))
      await userEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Start' })
      )
      await vi.waitFor(() => expect(api.tickets.start).toHaveBeenCalled())
      expect(api.setup.hint).not.toHaveBeenCalled()
    })

    it('starts a ticket with no session from Details', async () => {
      renderView(boardView({ tickets: [t] }))
      await userEvent.click(screen.getByRole('button', { name: 'Start' }))
      await userEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Start' })
      )
      expect(api.tickets.start).toHaveBeenCalledWith(
        project.id,
        t.key,
        [],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined
      )
    })

    it('starts on the model picked on the chip beside Start, and shows a session model in the side panel', async () => {
      const { unmount } = renderView(boardView({ tickets: [t] }), vi.fn(), t.key, Infinity, {
        ...project,
        model: 'opus'
      })
      await userEvent.click(screen.getByRole('button', { name: 'Model: Opus' }))
      await userEvent.click(screen.getByRole('menuitemradio', { name: 'Sonnet' }))
      await userEvent.click(screen.getByRole('button', { name: 'Start' }))
      await userEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Start' })
      )
      expect(api.tickets.start).toHaveBeenCalledWith(
        project.id,
        t.key,
        [],
        undefined,
        undefined,
        'sonnet',
        undefined,
        undefined
      )
      unmount()
      renderView(boardView({ tickets: [t], sessions: [session(t.key, { model: 'sonnet' })] }))
      expect(screen.queryByText('Model:')).toBeNull()
      const panel = within(screen.getByRole('complementary', { name: 'Session' }))
      expect(panel.getByRole('button', { name: /^Model/ })).toHaveTextContent('Sonnet')
    })

    it("shows a live session's start warning", () => {
      renderView(
        boardView({ tickets: [t], sessions: [session(t.key, { startWarning: 'offline warning' })] })
      )
      expect(screen.getByText('offline warning')).toBeInTheDocument()
    })

    it("shows a finished session's start warning", () => {
      renderView(
        boardView({
          tickets: [t],
          sessions: [session(t.key, { state: 'finished', startWarning: 'Claude exited' })]
        })
      )
      expect(screen.getByText('Claude exited')).toBeInTheDocument()
    })
  })
})

const startWith = async (item: string): Promise<void> => {
  await userEvent.click(screen.getByRole('button', { name: 'Start with…' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: item }))
}

describe('TicketView Start with note', () => {
  it('carries the trimmed note through the check to tickets.start', async () => {
    renderView(boardView({ tickets: [t] }))
    await startWith('Start with note')
    const note = screen.getByRole('textbox', { name: 'Note for this session' })
    expect(note).toHaveFocus()
    const form = within(screen.getByRole('form', { name: 'Start with note' }))
    expect(form.getByRole('button', { name: 'Start' })).toBeInTheDocument()
    await userEvent.type(note, '  Use the new API{Enter}and test it  ')
    await userEvent.click(form.getByRole('button', { name: 'Start with note' }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Start' })
    )
    expect(api.tickets.start).toHaveBeenCalledWith(
      project.id,
      t.key,
      [],
      undefined,
      'Use the new API\nand test it',
      undefined,
      undefined,
      undefined
    )
  })

  it('keeps the note through the overlap check and starts on ⌘↩', async () => {
    vi.mocked(api.tickets.checkStart).mockResolvedValue({
      triage: false,
      problems: [],
      overlap: [{ key: 'octo/shop#67', number: 67, title: 'Sort cards' }],
      ready: false
    })
    vi.mocked(api.tickets.checkOverlap).mockResolvedValue([
      { key: 'octo/shop#67', number: 67, title: 'Sort cards', reason: 'Same file.' }
    ])
    renderView(boardView({ tickets: [t] }))
    await startWith('Start with note')
    await userEvent.type(screen.getByRole('textbox', { name: 'Note for this session' }), 'Hi')
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}')
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Start' })
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Start anyway' }))
    expect(api.tickets.start).toHaveBeenCalledWith(
      project.id,
      t.key,
      [],
      undefined,
      'Hi',
      undefined,
      undefined,
      undefined
    )
  })

  it('sends no note on a plain Start', async () => {
    renderView(boardView({ tickets: [t] }))
    await userEvent.click(screen.getByRole('button', { name: 'Start' }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Start' })
    )
    expect(vi.mocked(api.tickets.start).mock.calls[0][4]).toBeUndefined()
  })

  it('starts with planning from the start menu', async () => {
    renderView(boardView({ tickets: [t] }))
    await startWith('Start with planning')
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Start' })
    )
    expect(vi.mocked(api.tickets.start).mock.calls[0][7]).toBe(true)
  })

  it("doesn't plan a plain Start after a cancelled planning start", async () => {
    renderView(boardView({ tickets: [t] }))
    await startWith('Start with planning')
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' })
    )
    await userEvent.click(screen.getByRole('button', { name: 'Start' }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Start' })
    )
    expect(vi.mocked(api.tickets.start).mock.calls[0][7]).toBeUndefined()
  })

  it('closes on Escape and returns focus to Start with note', async () => {
    renderView(boardView({ tickets: [t] }))
    await startWith('Start with note')
    await userEvent.type(screen.getByRole('textbox', { name: 'Note for this session' }), 'x')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('textbox', { name: 'Note for this session' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Start with…' })).toHaveFocus()
  })

  it('returns focus to Start with… after a planning start closes the dialog', async () => {
    renderView(boardView({ tickets: [t] }))
    await userEvent.click(screen.getByRole('button', { name: 'Start with…' }))
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' })
    )
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: 'Start with…' })).toHaveFocus()
    )
  })

  it('keeps the note when the Start dialog is cancelled', async () => {
    renderView(boardView({ tickets: [t] }))
    await startWith('Start with note')
    await userEvent.type(screen.getByRole('textbox', { name: 'Note for this session' }), 'Hi')
    await userEvent.click(screen.getByRole('button', { name: 'Start with note' }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' })
    )
    await startWith('Start with note')
    expect(screen.getByRole('textbox', { name: 'Note for this session' })).toHaveValue('Hi')
  })

  it('drops a pending Start when the ticket leaves the view', async () => {
    vi.mocked(api.tickets.checkStart).mockReturnValue(new Promise(() => undefined))
    const { rerender } = renderView(boardView({ tickets: [t] }))
    const again = (tickets: (typeof t)[]): void =>
      rerender(
        <TicketView
          project={project}
          ticketKey={t.key}
          view={boardView({ tickets })}
          onBack={vi.fn()}
          onOpenTicket={vi.fn()}
          {...noElsewhere}
          onProjectSaved={vi.fn()}
        />
      )
    await userEvent.click(screen.getByRole('button', { name: 'Start' }))
    again([])
    again([t])
    expect(api.tickets.checkStart).toHaveBeenCalledTimes(1)
  })

  it('moves focus to the selected tab when the note closes on its own', async () => {
    const { rerender } = renderView(boardView({ tickets: [t] }))
    await startWith('Start with note')
    rerender(
      <TicketView
        project={project}
        ticketKey={t.key}
        view={boardView({ tickets: [t], sessions: [session(t.key, { state: 'finished' })] })}
        onBack={vi.fn()}
        onOpenTicket={vi.fn()}
        {...noElsewhere}
        onProjectSaved={vi.fn()}
      />
    )
    expect(screen.queryByRole('textbox', { name: 'Note for this session' })).toBeNull()
    expect(screen.getByRole('tab', { selected: true })).toHaveFocus()
  })

  it('keeps the typed note when you switch tabs', async () => {
    const removed = session(t.key, { state: 'finished', removedAt: '2026-10-03T00:00:00Z' })
    renderView(boardView({ tickets: [t], sessions: [removed] }))
    await startWith('Start with note')
    await userEvent.type(screen.getByRole('textbox', { name: 'Note for this session' }), 'Hi')
    await userEvent.click(screen.getByRole('tab', { name: /Conversation/ }))
    expect(screen.getByRole('textbox', { name: 'Note for this session' })).toHaveValue('Hi')
  })

  it('offers Start with note after the worktree is removed', () => {
    renderView(
      boardView({
        tickets: [t],
        sessions: [session(t.key, { state: 'finished', removedAt: '2026-10-03T00:00:00Z' })]
      })
    )
    expect(screen.getByRole('button', { name: 'Start with…' })).toBeInTheDocument()
  })
})

describe('TicketView instructions strip', () => {
  const withInstructions = {
    ...project,
    instructions: {
      all: 'Run the tests.',
      labels: [
        { label: 'Bug', text: 'Write a failing test\n  first.' },
        { label: 'ui', text: 'Check dark mode.' }
      ]
    }
  }
  const bug = ticket(147, { labels: [{ name: 'bug', color: 'd73a4a' }] })

  it('lists the instructions that apply and shows their text', async () => {
    renderView(boardView({ tickets: [bug] }), vi.fn(), bug.key, Infinity, withInstructions)
    const strip = within(screen.getByRole('region', { name: 'Your instructions' }))
    expect(strip.getByText('Every ticket')).toBeInTheDocument()
    expect(strip.getByText('bug')).toBeInTheDocument()
    expect(strip.queryByText('ui')).toBeNull()
    expect(strip.queryByText('Run the tests.')).toBeNull()
    await userEvent.click(strip.getByRole('button', { name: 'Show' }))
    expect(strip.getByText('Run the tests.')).toBeInTheDocument()
    expect(strip.getAllByRole('term').map((d) => d.title)).toEqual(['Every ticket', 'bug'])
    expect(strip.getByText(/Write a failing test/)).toHaveTextContent(
      'Write a failing test\n  first.',
      { normalizeWhitespace: false }
    )
    await userEvent.click(strip.getByRole('button', { name: 'Hide' }))
    expect(strip.queryByText('Run the tests.')).toBeNull()
  })

  it('is absent when nothing applies', () => {
    renderView(boardView({ tickets: [t] }), vi.fn(), t.key, Infinity, {
      ...project,
      instructions: { labels: [{ label: 'ui', text: 'Check dark mode.' }] }
    })
    expect(screen.queryByRole('region', { name: 'Your instructions' })).toBeNull()
  })
})

describe('a start that fails after the card that began it unmounts', () => {
  const card = (): React.JSX.Element => (
    <TicketCard
      project={project}
      ticket={t}
      session={undefined}
      state={undefined}
      done={false}
      onFolderFixed={vi.fn()}
      onSetUp={vi.fn()}
      tickets={[]}
      onOpenTicket={vi.fn()}
      stateOf={() => undefined}
      onOpen={vi.fn()}
    />
  )
  const ticketView = (onProjectSaved = vi.fn()): React.JSX.Element => (
    <TooltipProvider>
      <HeaderFrame value={{ inset: false, needsYou: 0, width: Infinity }}>
        <TicketView
          project={project}
          ticketKey={t.key}
          view={boardView({ tickets: [t] })}
          onBack={vi.fn()}
          onOpenTicket={vi.fn()}
          {...noElsewhere}
          onProjectSaved={onProjectSaved}
        />
      </HeaderFrame>
    </TooltipProvider>
  )

  it('shows on the ticket view and on the card again, with Choose folder…', async () => {
    const error = folderError('octo/shop')
    const text = `Couldn't start: ${error}. Nothing was created.`
    let ready!: (gaps: string[]) => void
    vi.mocked(api.tickets.checkStart).mockResolvedValue({
      triage: false,
      problems: [],
      overlap: [],
      ready: true
    })
    vi.mocked(api.tickets.checkReady).mockReturnValue(new Promise((resolve) => (ready = resolve)))
    vi.mocked(api.tickets.start).mockRejectedValue(new Error(error))
    const board = render(card())
    await userEvent.click(screen.getByRole('button', { name: 'Start' }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Start' })
    )
    board.unmount()

    const view = render(ticketView())
    await act(async () => ready([]))
    expect(await screen.findByText(text)).toBeInTheDocument()
    expect(screen.getByText("Can't start")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull()
    view.unmount()

    render(card())
    expect(screen.getByText(text)).toBeInTheDocument()
    expect(screen.getByText("Can't start")).toBeInTheDocument()
    cleanup()

    const onProjectSaved = vi.fn()
    render(ticketView(onProjectSaved))
    vi.mocked(api.projects.pickFolder).mockResolvedValueOnce({
      path: '/new/shop',
      repos: ['octo/shop']
    })
    await userEvent.click(screen.getByRole('button', { name: 'Choose folder…' }))
    expect(api.projects.save).toHaveBeenCalledWith({
      ...project,
      repos: [{ github: 'octo/shop', path: '/new/shop' }, project.repos[1]]
    })
    expect(onProjectSaved).toHaveBeenCalled()
    await vi.waitFor(() => expect(screen.queryByText("Can't start")).toBeNull())
  })

  it('shows a saved setup failure with its last lines after a restart', () => {
    const reason = `${SETUP_FAILED}: npm install exited with code 1`
    act(() =>
      setStartFailures(project.id, [
        {
          kind: 'ticket',
          name: t.title,
          ticketKey: t.key,
          at: '2026-10-24T10:00:00.000Z',
          reason,
          repo: null,
          lines: ['npm ERR! boom']
        }
      ])
    )
    render(ticketView())
    expect(screen.getByText(`Couldn't start: ${reason}`)).toBeInTheDocument()
    expect(screen.getByText('npm ERR! boom')).toBeInTheDocument()
    act(() => setStartFailures(project.id, []))
  })
})

describe('TicketView sub-issues', () => {
  const ref = (n: number, column: IssueRef['column'] = 'todo'): IssueRef => ({
    key: `octo/shop#${n}`,
    number: n,
    title: `Part ${n}`,
    repo: 'octo/shop',
    url: `https://github.com/octo/shop/issues/${n}`,
    column
  })
  const parent = ticket(147, {
    title: 'Fix the thing',
    subIssues: {
      completed: 1,
      total: 2,
      items: [
        { ...ref(9), assignee: null },
        { ...ref(10, 'done'), assignee: 'grace' }
      ]
    }
  })
  const onBoard = ticket(9, {
    title: 'Part 9',
    status: 'In Progress',
    assignees: [{ id: 'U_ada', login: 'ada', name: 'Ada Lovelace' }]
  })

  function show(
    tickets: ReturnType<typeof ticket>[],
    key = parent.key,
    p = project
  ): { onOpenTicket: ReturnType<typeof vi.fn>; update: (next: typeof tickets) => void } {
    const onOpenTicket = vi.fn()
    const view = (shown: typeof tickets): React.JSX.Element => (
      <TicketView
        project={p}
        ticketKey={key}
        view={boardView({ tickets: shown })}
        onBack={vi.fn()}
        onOpenTicket={onOpenTicket}
        {...noElsewhere}
        onProjectSaved={vi.fn()}
      />
    )
    const { rerender } = render(view(tickets), { wrapper: TooltipProvider })
    return { onOpenTicket, update: (next) => rerender(view(next)) }
  }

  it("lists a parent's sub-issues with their state as a word, using the board's status and assignee", async () => {
    show([parent, onBoard])
    const section = within(await screen.findByRole('region', { name: 'Sub-issues' }))
    expect(section.getByText('1/2 done')).toBeInTheDocument()
    const rows = section.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('#9')).toBeInTheDocument()
    expect(within(rows[0]).getByText('In progress')).toBeInTheDocument()
    expect(within(rows[0]).getByRole('img', { name: 'Ada Lovelace' })).toBeInTheDocument()
    expect(within(rows[1]).getByText('Done')).toBeInTheDocument()
    expect(within(rows[1]).getByRole('img', { name: 'grace' })).toBeInTheDocument()
  })

  it('shows an issue off the columns as Closed, with no icon', async () => {
    const closed = ticket(147, {
      subIssues: { completed: 1, total: 1, items: [{ ...ref(11, 'hidden'), assignee: null }] }
    })
    show([closed])
    const row = (await screen.findByRole('region', { name: 'Sub-issues' })).querySelector('li')!
    expect(within(row).getByText('Closed')).toBeInTheDocument()
    expect(row.querySelector('svg:not(.lucide)')).toBeNull()
  })

  it('names a sub-issue in another repo with its repo', async () => {
    const other = {
      ...ref(4),
      key: 'octo/api#4',
      repo: 'octo/api',
      url: 'https://github.com/octo/api/issues/4'
    }
    show([
      ticket(147, { subIssues: { completed: 0, total: 1, items: [{ ...other, assignee: null }] } })
    ])
    const section = within(await screen.findByRole('region', { name: 'Sub-issues' }))
    expect(section.getByText('octo/api#4')).toBeInTheDocument()
  })

  it('links to the rest of the sub-issues on GitHub when not all are listed', async () => {
    show([{ ...parent, subIssues: { ...parent.subIssues, total: 60 } }])
    const section = within(await screen.findByRole('region', { name: 'Sub-issues' }))
    expect(section.getByRole('link', { name: /58 more on GitHub/ })).toHaveAttribute(
      'href',
      parent.url
    )
  })

  it('opens a sub-issue on the board in its ticket view, and one off the board on GitHub', async () => {
    const { onOpenTicket } = show([parent, onBoard])
    const section = within(await screen.findByRole('region', { name: 'Sub-issues' }))
    await userEvent.click(section.getByRole('button', { name: /#9 Part 9/ }))
    expect(onOpenTicket).toHaveBeenCalledWith('octo/shop#9')
    const off = section.getByRole('link', { name: /#10 Part 10.*opens on GitHub/ })
    expect(off).toHaveAttribute('href', 'https://github.com/octo/shop/issues/10')
    expect(off).toHaveAttribute('target', '_blank')
  })

  it('names the parent atop a sub-issue and in its aside, and both open it', async () => {
    const child = ticket(9, { title: 'Part 9', parent: { ...ref(147), title: 'Fix the thing' } })
    const { onOpenTicket } = show([{ ...parent, status: 'In Progress' }, child], child.key)
    const pane = within(screen.getByRole('tabpanel', { name: /Details/ }))
    const link = pane.getByRole('button', { name: 'Sub-issue of #147 Fix the thing' })
    expect(within(link).getByText('Fix the thing')).toHaveAttribute('title', 'Fix the thing')
    await userEvent.click(link)
    expect(onOpenTicket).toHaveBeenLastCalledWith(parent.key)
    const aside = within(await screen.findByRole('region', { name: 'Parent' }))
    expect(aside.getByText('In progress')).toBeInTheDocument()
    await userEvent.click(aside.getByRole('button', { name: /#147/ }))
    expect(onOpenTicket).toHaveBeenCalledTimes(2)
  })

  it('opens a parent off the board on GitHub', async () => {
    const child = ticket(9, { title: 'Part 9', parent: ref(3) })
    show([child], child.key)
    expect(
      screen.getByRole('link', { name: /Sub-issue of #3 Part 3.*opens on GitHub/ })
    ).toHaveAttribute('href', 'https://github.com/octo/shop/issues/3')
  })

  it("adds a sub-issue in the parent's repo, without Draft with Claude or a repo choice", async () => {
    show([ticket(147)])
    expect(await screen.findByText('No description')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Sub-issues' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Add sub-issue' }))
    const form = within(screen.getByRole('form', { name: 'Add sub-issue' }))
    expect(form.getByText(/^Sub-issue of/)).toHaveTextContent('Sub-issue of #147')
    expect(form.queryByRole('button', { name: 'Draft with Claude' })).toBeNull()
    expect(form.queryByRole('radiogroup')).toBeNull()
    await userEvent.type(form.getByRole('textbox', { name: 'Title' }), 'Part{Enter}')
    expect(api.tickets.create).toHaveBeenCalledWith(
      'p1',
      expect.any(String),
      'Part',
      '',
      'octo/shop#147'
    )
  })

  it('keeps the composer and its Created line when the first sub-issue syncs in', async () => {
    const { update } = show([ticket(147)])
    await userEvent.click(await screen.findByRole('button', { name: 'Add sub-issue' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Title' }), 'Part{Enter}')
    expect(await screen.findByText('Created octo/shop#9')).toBeInTheDocument()
    update([parent])
    expect(await screen.findByRole('region', { name: 'Sub-issues' })).toBeInTheDocument()
    expect(screen.getByText('Created octo/shop#9')).toBeInTheDocument()
  })

  it('puts focus back on Add sub-issue when Escape closes the composer', async () => {
    show([ticket(147)])
    await userEvent.click(await screen.findByRole('button', { name: 'Add sub-issue' }))
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('form', { name: 'Add sub-issue' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Add sub-issue' })).toHaveFocus()
  })

  it("offers no Add sub-issue on a ticket whose repo isn't in the project", async () => {
    show([ticket(147, { repo: 'octo/elsewhere' })], 'octo/elsewhere#147')
    expect(await screen.findByText('No description')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add sub-issue' })).toBeNull()
  })

  it('adds a Linear sub-issue in the chosen Linear project', async () => {
    const lt = linearTicket(12)
    show([lt], lt.key, linearProject)
    await userEvent.click(await screen.findByRole('button', { name: 'Add sub-issue' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Title' }), 'Part{Enter}')
    expect(api.tickets.create).toHaveBeenCalledWith('p1', 'lp1', 'Part', '', 'APP-12')
  })

  it('offers no Add sub-issue on Jira', async () => {
    const jt = { ...linearTicket(12), key: 'INF-12', status: 'new' }
    show([jt], jt.key, {
      ...linearProject,
      linear: undefined,
      jira: { site: 'acme.atlassian.net', project: 'INF', name: 'Internal' }
    })
    expect(await screen.findByText('No description')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add sub-issue' })).toBeNull()
  })
})

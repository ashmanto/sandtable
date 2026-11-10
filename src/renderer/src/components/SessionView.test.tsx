import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SandtableApi } from '../../../shared/api'
import type { SessionRecord } from '../../../shared/types'
import { HeaderFrame } from '@/lib/headerFrame'
import { adhoc, fakeSandtable, project } from '../test/fixtures'
import { SessionView } from './SessionView'

vi.mock('./Terminal', () => ({
  Terminal: ({ sessionId }: { sessionId: string }) => <div data-testid="terminal">{sessionId}</div>
}))

let api: SandtableApi

const worktree = {
  branch: 'session-a1b2c3d4',
  worktrees: ['/Users/me/projects/shop-web-wt.noindex/session-a1b2c3d4'],
  checkout: undefined
}

function renderView(
  s: SessionRecord,
  onBack = vi.fn(),
  width = Infinity,
  onRoutine = vi.fn()
): void {
  render(
    <HeaderFrame value={{ inset: false, needsYou: 0, width }}>
      <SessionView
        session={s}
        project={project}
        onBack={onBack}
        onRoutine={onRoutine}
        onProjectSaved={vi.fn()}
      />
    </HeaderFrame>
  )
}

beforeEach(() => {
  api = fakeSandtable()
})

describe('SessionView', () => {
  it('shows the name, state, repo, and main checkout with the live conversation', async () => {
    const onBack = vi.fn()
    renderView(adhoc({ state: 'needsYou' }), onBack)
    expect(screen.getByRole('heading', { name: 'Oct 24, 10:00' })).toBeInTheDocument()
    expect(screen.getByText('Needs you')).toBeInTheDocument()
    const panel = within(screen.getByRole('complementary', { name: 'Session' }))
    expect(panel.getByRole('button', { name: /^Where/ })).toHaveTextContent('Main checkout')
    expect(panel.getByText('Repo').nextSibling).toHaveTextContent('shop')
    expect(panel.getByText('/Users/me/projects/shop')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Main checkout' })).toBeNull()
    expect(screen.getByTestId('terminal')).toHaveTextContent('a1')
    expect(screen.getByRole('combobox', { name: 'Message' })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Session' })).toBeInTheDocument()
    expect(api.sessions.watchConversation).toHaveBeenCalledTimes(1)
    expect(
      screen.queryByRole('button', { name: 'End session and remove worktree' })
    ).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Back to board' }))
    expect(onBack).toHaveBeenCalled()
  })

  it("shows the session's model in the side panel, not the header", () => {
    renderView(adhoc({ state: 'needsYou', model: 'haiku' }))
    expect(screen.queryByText('Model:')).toBeNull()
    const panel = within(screen.getByRole('complementary', { name: 'Session' }))
    expect(panel.getByRole('button', { name: /^Model/ })).toHaveTextContent('Haiku')
  })

  it('shows Sandboxed from the session record, once, in the side panel', () => {
    renderView(adhoc({ sandbox: { allowedDomains: ['github.com', 'pypi.org'] } }))
    expect(screen.getAllByText('Sandboxed')).toHaveLength(1)
    const panel = within(screen.getByRole('complementary', { name: 'Session' }))
    expect(panel.getByText('Sandboxed')).toHaveAccessibleName(
      /Sandboxed\. Bash commands .* reach only github\.com and pypi\.org, plus the macOS trust service\./
    )
  })

  it('shows no Sandboxed label for an unsandboxed session in a sandboxing project', () => {
    render(
      <HeaderFrame value={{ inset: false, needsYou: 0, width: Infinity }}>
        <SessionView
          session={adhoc()}
          project={{ ...project, sandbox: true }}
          onBack={vi.fn()}
          onRoutine={vi.fn()}
          onProjectSaved={vi.fn()}
        />
      </HeaderFrame>
    )
    expect(screen.queryByText('Sandboxed')).toBeNull()
  })

  it('clears Needs you from the header', async () => {
    renderView(adhoc({ state: 'needsYou' }))
    await userEvent.click(screen.getByRole('button', { name: 'Clear Needs you' }))
    expect(api.sessions.clearNeedsYou).toHaveBeenCalledWith('a1')
  })

  it("toggles the session's Remote Control from the side panel, not the header", async () => {
    vi.mocked(api.sessions.setRemoteControl).mockRejectedValue(new Error('tmux is gone'))
    renderView(adhoc({ state: 'finished', remoteControl: true }))
    expect(screen.queryByRole('button', { name: /Remote/ })).toBeNull()
    await userEvent.click(screen.getByRole('switch', { name: 'Remote Control' }))
    expect(api.sessions.setRemoteControl).toHaveBeenCalledWith('a1', false)
    expect(await screen.findByText('tmux is gone')).toBeInTheDocument()
  })

  it('reattaches the terminal after the toggle restarts the session', () => {
    const { rerender } = render(
      <SessionView
        session={adhoc()}
        project={project}
        onBack={vi.fn()}
        onRoutine={vi.fn()}
        onProjectSaved={vi.fn()}
      />
    )
    const before = screen.getByTestId('terminal')
    rerender(
      <SessionView
        session={adhoc({ remoteControl: true })}
        project={project}
        onBack={vi.fn()}
        onRoutine={vi.fn()}
        onProjectSaved={vi.fn()}
      />
    )
    expect(screen.getByTestId('terminal')).not.toBe(before)
  })

  it('ends a live session', async () => {
    renderView(adhoc())
    await userEvent.click(screen.getByRole('button', { name: 'End session' }))
    expect(api.sessions.end).toHaveBeenCalledWith('a1')
  })

  it('ends a live worktree session and removes its worktree', async () => {
    renderView(adhoc(worktree))
    const panel = within(screen.getByRole('complementary', { name: 'Session' }))
    expect(panel.getByText('Repo').nextSibling).toHaveTextContent('shop-web')
    expect(panel.getByText('Branch').nextSibling).toHaveTextContent('session-a1b2c3d4')
    expect(panel.getByText(worktree.worktrees[0])).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'End session and remove worktree' }))
    expect(api.sessions.endAndRemove).toHaveBeenCalledWith('a1')
    expect(await screen.findByText('Session ended and worktree removed')).toBeInTheDocument()
  })

  it('resumes a finished session or removes it from the list', async () => {
    renderView(adhoc({ state: 'finished' }))
    expect(screen.queryByTestId('terminal')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Message' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'End session' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(api.sessions.resume).toHaveBeenCalledWith('a1')
    await userEvent.click(screen.getByRole('button', { name: 'Remove from list' }))
    expect(api.sessions.removeWorktree).toHaveBeenCalledWith('a1')
    expect(await screen.findByText('Removed from list')).toBeInTheDocument()
  })

  it('disables every action while Resume works, so a double click resumes once', async () => {
    let finish: () => void = () => {}
    vi.mocked(api.sessions.resume).mockReturnValue(new Promise<void>((r) => (finish = r)))
    renderView(adhoc({ state: 'finished' }))
    await userEvent.dblClick(screen.getByRole('button', { name: 'Resume' }))
    expect(api.sessions.resume).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Resume' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove from list' })).toBeDisabled()
    finish()
    expect(await screen.findByRole('button', { name: 'Resume' })).toBeEnabled()
  })

  it('removes the worktree of a finished worktree session', async () => {
    vi.mocked(api.sessions.removeWorktree).mockResolvedValue({
      removed: false,
      reason: 'Uncommitted changes'
    })
    renderView(adhoc({ ...worktree, state: 'finished' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove worktree' }))
    expect(api.sessions.removeWorktree).toHaveBeenCalledWith('a1')
    expect(
      await screen.findByText("Couldn't remove the worktree: Uncommitted changes")
    ).toBeInTheDocument()
  })

  it('shows a removed session with no actions', () => {
    renderView(adhoc({ state: 'finished', removedAt: '2026-10-24T11:00:00.000Z' }))
    expect(screen.getByText('Session removed')).toBeInTheDocument()
    expect(screen.getByText("It's no longer listed.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove from list' })).not.toBeInTheDocument()
  })

  it('folds the panel into the Context button under 900 px', async () => {
    renderView(adhoc(), vi.fn(), 899)
    expect(screen.queryByRole('complementary', { name: 'Session' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /session details/ }))
    expect(await screen.findByRole('dialog', { name: 'Session' })).toBeInTheDocument()
  })

  it('shows the start warning while live', () => {
    renderView(adhoc({ startWarning: "Couldn't fetch origin" }))
    expect(screen.getByText("Couldn't fetch origin")).toBeInTheDocument()
  })

  it('shows the start warning once finished', () => {
    renderView(adhoc({ state: 'finished', startWarning: 'Claude exited' }))
    expect(screen.getByText('Claude exited')).toBeInTheDocument()
  })

  it('renames on Enter', async () => {
    renderView(adhoc())
    await userEvent.click(screen.getByRole('button', { name: 'Rename session' }))
    const field = screen.getByRole('textbox', { name: 'Session name' })
    expect(field).toHaveValue('Oct 24, 10:00')
    await userEvent.clear(field)
    await userEvent.type(field, 'Triage{Enter}')
    expect(api.sessions.rename).toHaveBeenCalledWith('a1', 'Triage')
    expect(screen.queryByRole('textbox', { name: 'Session name' })).not.toBeInTheDocument()
  })

  it('keeps the old name on Escape', async () => {
    renderView(adhoc())
    await userEvent.click(screen.getByRole('button', { name: 'Rename session' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Session name' }), 'x{Escape}')
    expect(api.sessions.rename).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Oct 24, 10:00' })).toBeInTheDocument()
  })

  it('shows a rename error and keeps the field', async () => {
    vi.mocked(api.sessions.rename).mockRejectedValue(new Error('Enter a name'))
    renderView(adhoc())
    await userEvent.click(screen.getByRole('button', { name: 'Rename session' }))
    await userEvent.clear(screen.getByRole('textbox', { name: 'Session name' }))
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByText('Enter a name')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Session name' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByText('Enter a name')).not.toBeInTheDocument()
  })

  it('disables the header actions while one runs', async () => {
    let finish: () => void = () => {}
    vi.mocked(api.sessions.end).mockReturnValue(new Promise<void>((r) => (finish = r)))
    renderView(adhoc(worktree))
    await userEvent.click(screen.getByRole('button', { name: 'End session' }))
    expect(screen.getByRole('button', { name: 'End session' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'End session and remove worktree' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Rename session' })).toBeDisabled()
    finish()
    expect(await screen.findByRole('button', { name: 'End session' })).toBeEnabled()
  })

  it('folds two outline actions into More actions below 1152 px', async () => {
    renderView(adhoc(worktree), vi.fn(), 1000)
    expect(screen.queryByRole('button', { name: 'End session' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'End session and remove worktree' }))
    expect(api.sessions.endAndRemove).toHaveBeenCalledWith('a1')
  })

  it('keeps a single outline action as a button down to 768 px', async () => {
    renderView(adhoc(), vi.fn(), 1000)
    expect(screen.getByRole('button', { name: 'End session' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }))
    expect(screen.queryByRole('menuitem', { name: 'End session' })).not.toBeInTheDocument()
  })

  it('saves the session as a routine from More actions', async () => {
    const onRoutine = vi.fn()
    vi.mocked(api.sessions.firstMessage).mockResolvedValue('Find the leak')
    renderView(adhoc({ ...worktree, model: 'sonnet' }), vi.fn(), Infinity, onRoutine)
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Save as routine' }))
    expect(api.sessions.firstMessage).toHaveBeenCalledWith('a1')
    expect(onRoutine).toHaveBeenCalledWith(project, undefined, {
      repo: 'octo/shop-web',
      worktree: true,
      message: 'Find the leak',
      model: 'sonnet',
      effort: null
    })
  })

  it('saves a session that ran with no model as an Account default routine', async () => {
    const onRoutine = vi.fn()
    renderView(adhoc(worktree), vi.fn(), Infinity, onRoutine)
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Save as routine' }))
    expect(onRoutine).toHaveBeenCalledWith(
      project,
      undefined,
      expect.objectContaining({ model: null })
    )
  })

  it.each([
    [undefined, null],
    ['low', 'low']
  ] as const)(
    'saves a session with effort %s as a routine with effort %s',
    async (effort, saved) => {
      const onRoutine = vi.fn()
      renderView({ ...adhoc(worktree), effort }, vi.fn(), Infinity, onRoutine)
      await userEvent.click(screen.getByRole('button', { name: 'More actions' }))
      await userEvent.click(screen.getByRole('menuitem', { name: 'Save as routine' }))
      expect(onRoutine).toHaveBeenCalledWith(
        project,
        undefined,
        expect.objectContaining({ effort: saved })
      )
    }
  )

  it('offers no Save as routine for a ticket session', () => {
    renderView(adhoc({ ticketKey: 'octo/shop#1' }))
    expect(screen.queryByRole('button', { name: 'More actions' })).not.toBeInTheDocument()
  })

  it('keeps Resume as a button when the actions fold below 768 px', async () => {
    renderView(adhoc({ state: 'finished' }), vi.fn(), 600)
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }))
    expect(screen.getByRole('menuitem', { name: 'Remove from list' })).toBeInTheDocument()
  })

  it('shows Clear Needs you as an icon below 768 px, and the state in words', async () => {
    renderView(adhoc({ ...worktree, state: 'needsYou' }), vi.fn(), 600)
    expect(screen.getByText('Needs you')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Clear Needs you for Oct 24, 10:00' }))
    expect(api.sessions.clearNeedsYou).toHaveBeenCalledWith('a1')
  })

  it('shows the live tokens in the side panel, not the header, and raises the cap', async () => {
    vi.mocked(api.sessions.liveUsage).mockResolvedValue({
      a1: [
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
    renderView(adhoc({ state: 'needsYou', capped: true }), vi.fn(), Infinity)
    const panel = within(screen.getByRole('complementary', { name: 'Session' }))
    expect(await panel.findByRole('button', { name: /This session/ })).toHaveTextContent('8.4M')
    expect(
      screen.getByRole('button', { name: 'Back to board' }).closest('header')
    ).not.toHaveTextContent('8.4M')
    await userEvent.click(screen.getByRole('button', { name: 'Raise cap' }))
    expect(api.sessions.raiseCap).toHaveBeenCalledWith('a1')
  })

  it('shows Raise cap as an icon below 768 px', async () => {
    vi.mocked(api.sessions.liveUsage).mockResolvedValue({
      a1: [
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
    renderView(adhoc({ state: 'needsYou', capped: true }), vi.fn(), 600)
    await userEvent.click(screen.getByRole('button', { name: 'Raise cap for Oct 24, 10:00' }))
    expect(api.sessions.raiseCap).toHaveBeenCalledWith('a1')
    expect(screen.queryByText(/8\.4M/)).toBeNull()
  })
})

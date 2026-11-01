import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { SandtableApi } from '../../../shared/api'
import { adhoc, fakeSandtable, session } from '../test/fixtures'
import { LeftoverList } from './LeftoverList'

describe('LeftoverList', () => {
  const live = {
    kind: 'session' as const,
    session: session('octo/shop#7', { id: 's7', branch: '7-fix' }),
    project: null,
    name: 'octo/shop#7',
    repo: 'octo/shop',
    title: null,
    done: false,
    keepWorktree: false
  }
  const finished = {
    kind: 'session' as const,
    session: adhoc({ id: 'a2', state: 'finished', branch: 'session-1', worktrees: ['/wt/a'] }),
    project: 'Shop',
    name: 'Oct 24, 10:00',
    repo: 'shop',
    title: null,
    done: false,
    keepWorktree: false
  }
  const unknown = { kind: 'unknown' as const, tmuxName: 'st-old-1' }
  const onChange = (api: SandtableApi): (() => void) => {
    let changed = (): void => {}
    vi.mocked(api.board.onChange).mockImplementation((cb) => {
      changed = () => cb('p1')
      return () => {}
    })
    return () => changed()
  }

  it('names why each row is left over and lists them by that reason', async () => {
    const api = fakeSandtable()
    const done = {
      ...live,
      session: session('octo/shop#9', { id: 's9' }),
      name: 'octo/shop#9',
      project: 'Shop',
      done: true
    }
    vi.mocked(api.sessions.leftovers).mockResolvedValue([unknown, live, finished, done])
    render(<LeftoverList />)
    await screen.findByRole('group', { name: 'octo/shop#9' })
    const rows = screen.getAllByRole('group')
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual([
      'octo/shop#9',
      'Oct 24, 10:00',
      'octo/shop#7',
      'Unknown session st-old-1'
    ])
    expect(rows[0]).toHaveTextContent('Done · Shop · octo/shop')
    expect(rows[1]).toHaveTextContent('Off the board · Shop · shop · session-1')
    expect(rows[2]).toHaveTextContent('Removed project · octo/shop · 7-fix')
  })

  it.each([
    [
      { ...live },
      'End session and remove worktree',
      'Ends the session and removes its worktree. A worktree with uncommitted or unpushed changes stays.'
    ],
    [
      { ...live, keepWorktree: true },
      'End session',
      'Ends the session. Its worktree stays, because a card still uses it.'
    ],
    [
      { ...finished },
      'Remove worktree',
      'Removes the worktree. A worktree with uncommitted or unpushed changes stays.'
    ],
    [unknown, 'End session', 'Ends the tmux session. Sandtable has no worktree on record for it.']
  ])('says what %# does to your work on hover', async (l, name, what) => {
    const api = fakeSandtable()
    vi.mocked(api.sessions.leftovers).mockResolvedValue([l])
    render(<LeftoverList />)
    await userEvent.hover(await screen.findByRole('button', { name }))
    expect(await screen.findByRole('tooltip')).toHaveTextContent(`${name}. ${what}`)
  })

  it('says when there are none', async () => {
    fakeSandtable()
    render(<LeftoverList />)
    expect(await screen.findByText('None. There is nothing to clean up.')).toBeInTheDocument()
  })

  it('ends a live leftover and removes its worktree, then reloads', async () => {
    const api = fakeSandtable()
    vi.mocked(api.sessions.leftovers).mockResolvedValueOnce([live]).mockResolvedValue([])
    render(<LeftoverList />)
    const row = await screen.findByRole('group', { name: 'octo/shop#7' })
    expect(row).toHaveTextContent('Running')
    expect(row).toHaveTextContent('Removed project · octo/shop · 7-fix')
    expect(within(row).getByText('octo/shop#7')).toHaveClass('font-mono')
    await userEvent.click(
      within(row).getByRole('button', { name: 'End session and remove worktree' })
    )
    expect(api.sessions.endAndRemove).toHaveBeenCalledWith('s7')
    expect(await screen.findByText('None. There is nothing to clean up.')).toBeInTheDocument()
  })

  it('shows a refused removal on its row', async () => {
    const api = fakeSandtable()
    vi.mocked(api.sessions.leftovers).mockResolvedValue([finished])
    vi.mocked(api.sessions.removeWorktree).mockResolvedValue({
      removed: false,
      reason: 'Uncommitted changes'
    })
    render(<LeftoverList />)
    const row = await screen.findByRole('group', { name: 'Oct 24, 10:00' })
    expect(row).toHaveTextContent('Finished')
    expect(row).toHaveTextContent('Shop · shop · session-1')
    expect(within(row).getByText('Oct 24, 10:00')).not.toHaveClass('font-mono')
    await userEvent.click(within(row).getByRole('button', { name: 'Remove worktree' }))
    expect(api.sessions.removeWorktree).toHaveBeenCalledWith('a2')
    expect(
      await within(screen.getByRole('group', { name: 'Oct 24, 10:00' })).findByText(
        /Uncommitted changes/
      )
    ).toBeInTheDocument()
  })

  it('ends an unknown tmux session', async () => {
    const api = fakeSandtable()
    vi.mocked(api.sessions.leftovers).mockResolvedValue([unknown])
    render(<LeftoverList />)
    const row = await screen.findByRole('group', { name: 'Unknown session st-old-1' })
    expect(row).toHaveTextContent('st-old-1')
    await userEvent.click(within(row).getByRole('button', { name: 'End session' }))
    expect(api.sessions.endUnknown).toHaveBeenCalledWith('st-old-1')
  })

  it('shows a failed action as a problem', async () => {
    const api = fakeSandtable()
    vi.mocked(api.sessions.leftovers).mockResolvedValue([unknown])
    vi.mocked(api.sessions.endUnknown).mockRejectedValue(new Error('Unknown session'))
    render(<LeftoverList />)
    await userEvent.click(await screen.findByRole('button', { name: 'End session' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Unknown session')
  })

  it('reloads on a board change', async () => {
    const api = fakeSandtable()
    const changed = onChange(api)
    render(<LeftoverList />)
    await screen.findByText('None. There is nothing to clean up.')
    vi.mocked(api.sessions.leftovers).mockResolvedValue([unknown])
    act(() => changed())
    expect(
      await screen.findByRole('group', { name: 'Unknown session st-old-1' })
    ).toBeInTheDocument()
  })

  it('stays busy when the board changes mid-action', async () => {
    const api = fakeSandtable()
    const changed = onChange(api)
    vi.mocked(api.sessions.leftovers).mockResolvedValue([live])
    let finish = (): void => {}
    vi.mocked(api.sessions.endAndRemove).mockImplementation(async () => {
      changed()
      await new Promise<void>((r) => (finish = r))
      return { removed: true }
    })
    render(<LeftoverList />)
    const row = await screen.findByRole('group', { name: 'octo/shop#7' })
    await userEvent.click(within(row).getByRole('button'))
    await act(async () => {})
    expect(within(row).getByRole('button')).toBeDisabled()
    expect(within(row).getByRole('button', { name: 'Ending session' })).toBeInTheDocument()
    await act(async () => finish())
  })

  it('keeps an action error through a board change', async () => {
    const api = fakeSandtable()
    const changed = onChange(api)
    vi.mocked(api.sessions.leftovers).mockResolvedValue([unknown])
    vi.mocked(api.sessions.endUnknown).mockRejectedValue(new Error('Unknown session'))
    render(<LeftoverList />)
    await userEvent.click(await screen.findByRole('button', { name: 'End session' }))
    await screen.findByRole('alert')
    await act(async () => changed())
    expect(screen.getByRole('alert')).toHaveTextContent('Unknown session')
  })

  it('shows a failed load as a problem', async () => {
    const api = fakeSandtable()
    vi.mocked(api.sessions.leftovers).mockRejectedValue(new Error('tmux broke'))
    render(<LeftoverList />)
    expect(await screen.findByRole('alert')).toHaveTextContent('tmux broke')
  })

  it('only ends a live leftover whose worktree a card still uses', async () => {
    const api = fakeSandtable()
    vi.mocked(api.sessions.leftovers).mockResolvedValue([{ ...live, keepWorktree: true }])
    render(<LeftoverList />)
    const row = await screen.findByRole('group', { name: 'octo/shop#7' })
    await userEvent.click(within(row).getByRole('button', { name: 'End session' }))
    expect(api.sessions.end).toHaveBeenCalledWith('s7')
    expect(api.sessions.endAndRemove).not.toHaveBeenCalled()
  })

  it("shows a done ticket's title and its open session as done", async () => {
    const api = fakeSandtable()
    vi.mocked(api.sessions.leftovers).mockResolvedValue([
      { ...live, project: 'Shop', title: 'Fix the build', done: true }
    ])
    render(<LeftoverList />)
    const row = await screen.findByRole('group', { name: 'octo/shop#7' })
    expect(row).toHaveTextContent('Fix the build')
    expect(row).toHaveTextContent('Done, session open')
    expect(row).not.toHaveTextContent('Running')
  })

  it('shows a finished done session by its state', async () => {
    const api = fakeSandtable()
    vi.mocked(api.sessions.leftovers).mockResolvedValue([{ ...finished, done: true }])
    render(<LeftoverList />)
    expect(await screen.findByRole('group', { name: 'Oct 24, 10:00' })).toHaveTextContent(
      'Finished'
    )
  })

  describe('Clean up all', () => {
    it('is offered only for two or more', async () => {
      const api = fakeSandtable()
      vi.mocked(api.sessions.leftovers).mockResolvedValue([unknown])
      render(<LeftoverList />)
      await screen.findByRole('group', { name: 'Unknown session st-old-1' })
      expect(screen.queryByRole('button', { name: 'Clean up all' })).not.toBeInTheDocument()
    })

    it('asks first and does nothing on Cancel', async () => {
      const api = fakeSandtable()
      vi.mocked(api.sessions.leftovers).mockResolvedValue([live, unknown])
      render(<LeftoverList />)
      await userEvent.click(await screen.findByRole('button', { name: 'Clean up all' }))
      const dialog = screen.getByRole('alertdialog')
      expect(dialog).toHaveTextContent('Clean up 2 sessions?')
      expect(dialog).toHaveTextContent(
        'This ends running sessions and removes their worktrees. A worktree with uncommitted or unpushed changes stays, and its row says why.'
      )
      await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
      expect(api.sessions.endAndRemove).not.toHaveBeenCalled()
      expect(api.sessions.endUnknown).not.toHaveBeenCalled()
    })

    it("runs each row's own action, keeps going past failures, and reloads", async () => {
      const api = fakeSandtable()
      const endOnly = {
        ...live,
        session: session('octo/shop#8', { id: 's8' }),
        name: 'octo/shop#8',
        keepWorktree: true
      }
      vi.mocked(api.sessions.leftovers).mockResolvedValue([live, finished, endOnly, unknown])
      vi.mocked(api.sessions.endAndRemove).mockRejectedValue(new Error('tmux broke'))
      vi.mocked(api.sessions.removeWorktree).mockResolvedValue({
        removed: false,
        reason: 'Uncommitted changes'
      })
      render(<LeftoverList />)
      await userEvent.click(await screen.findByRole('button', { name: 'Clean up all' }))
      const calls = vi.mocked(api.sessions.leftovers).mock.calls.length
      await userEvent.click(
        within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Clean up' })
      )
      await vi.waitFor(() => expect(api.sessions.endUnknown).toHaveBeenCalledWith('st-old-1'))
      expect(api.sessions.endAndRemove).toHaveBeenCalledWith('s7')
      expect(api.sessions.removeWorktree).toHaveBeenCalledWith('a2')
      expect(api.sessions.end).toHaveBeenCalledWith('s8')
      expect(
        await within(screen.getByRole('group', { name: 'octo/shop#7' })).findByText(/tmux broke/)
      ).toBeInTheDocument()
      expect(screen.getByRole('group', { name: 'Oct 24, 10:00' })).toHaveTextContent(
        'Uncommitted changes'
      )
      expect(vi.mocked(api.sessions.leftovers).mock.calls.length).toBeGreaterThan(calls)
    })

    it('disables every button while it runs', async () => {
      const api = fakeSandtable()
      vi.mocked(api.sessions.leftovers).mockResolvedValue([live, unknown])
      let finish = (): void => {}
      vi.mocked(api.sessions.endAndRemove).mockImplementation(
        () => new Promise((r) => (finish = () => r({ removed: true })))
      )
      render(<LeftoverList />)
      await userEvent.click(await screen.findByRole('button', { name: 'Clean up all' }))
      await userEvent.click(
        within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Clean up' })
      )
      expect(screen.getByRole('button', { name: 'Cleaning up' })).toBeDisabled()
      for (const b of screen.getAllByRole('button')) expect(b).toBeDisabled()
      await act(async () => finish())
    })
  })
})

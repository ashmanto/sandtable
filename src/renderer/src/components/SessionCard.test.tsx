import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adhoc, fakeSandtable } from '../test/fixtures'
import { SessionCard } from './SessionCard'

beforeEach(() => {
  fakeSandtable()
})

afterEach(() => {
  delete (HTMLElement.prototype as Partial<HTMLElement>).animate
})

describe('SessionCard', () => {
  it("shows the session's model before its state", () => {
    render(<SessionCard session={adhoc({ model: 'opus' })} onOpen={vi.fn()} />)
    expect(screen.getByText('Model:').parentElement).toHaveTextContent('Model: Opus')
  })

  it('opens on Enter and on Space', async () => {
    const onOpen = vi.fn()
    render(<SessionCard session={adhoc()} onOpen={onOpen} />)
    screen.getByRole('group', { name: 'Oct 24, 10:00' }).focus()
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard(' ')
    expect(onOpen).toHaveBeenCalledTimes(2)
  })

  it('marks Remote Control only while it is on, with no toggle', () => {
    fakeSandtable()
    const { rerender } = render(
      <SessionCard session={adhoc({ state: 'needsYou' })} onOpen={vi.fn()} />
    )
    expect(screen.queryByRole('img', { name: 'Remote Control on' })).toBeNull()
    rerender(
      <SessionCard session={adhoc({ state: 'needsYou', remoteControl: true })} onOpen={vi.fn()} />
    )
    expect(screen.getByRole('img', { name: 'Remote Control on' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remote/ })).toBeNull()
  })

  it('clears Needs you without opening the session, and reads Idle after', async () => {
    const api = fakeSandtable()
    const onOpen = vi.fn()
    const { rerender } = render(
      <SessionCard session={adhoc({ state: 'needsYou' })} onOpen={onOpen} />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Clear Needs you' }))
    expect(api.sessions.clearNeedsYou).toHaveBeenCalledWith('a1')
    expect(onOpen).not.toHaveBeenCalled()
    rerender(<SessionCard session={adhoc({ state: 'idle' })} onOpen={onOpen} />)
    expect(screen.getByText('Idle')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear Needs you' })).toBeNull()
  })

  it("shows its live usage against its cap, and raises a capped session's cap without opening it", async () => {
    const api = fakeSandtable()
    vi.mocked(api.sessions.liveUsage).mockResolvedValue({
      a1: [
        { model: 'm', name: null, input: 30e6, output: 0, cacheWrite: 0, cacheRead: 0, price: 5 }
      ]
    })
    const onOpen = vi.fn()
    const { rerender } = render(
      <SessionCard session={adhoc({ state: 'needsYou' })} cap={25e6} onOpen={onOpen} />
    )
    expect(await screen.findByRole('img', { name: '120% of its token cap' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Raise cap' })).toBeNull()
    rerender(
      <SessionCard
        session={adhoc({ state: 'needsYou', capped: true })}
        cap={25e6}
        onOpen={onOpen}
      />
    )
    expect(screen.getByText('Reached its token cap')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear Needs you' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Raise cap' }))
    expect(api.sessions.raiseCap).toHaveBeenCalledWith('a1')
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('asks before ending a worktree session, and Cancel changes nothing', async () => {
    const api = fakeSandtable()
    const onOpen = vi.fn()
    render(
      <SessionCard
        session={adhoc({ worktrees: ['/wt/a1'], branch: 'session-a1' })}
        onOpen={onOpen}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'End session' }))
    expect(screen.getByRole('button', { name: 'End session and remove worktree' })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(api.sessions.endAndRemove).not.toHaveBeenCalled()
    expect(api.sessions.removeWorktree).not.toHaveBeenCalled()
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('ends a main checkout session and removes it from the list', async () => {
    const api = fakeSandtable()
    const onOpen = vi.fn()
    render(<SessionCard session={adhoc()} onOpen={onOpen} />)
    await userEvent.click(screen.getByRole('button', { name: 'End session' }))
    await userEvent.click(screen.getByRole('button', { name: 'End session and remove' }))
    expect(api.sessions.endAndRemove).toHaveBeenCalledWith('a1')
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('removes a finished session without ending it', async () => {
    const api = fakeSandtable()
    render(<SessionCard session={adhoc({ state: 'finished' })} onOpen={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Remove session' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove from list' }))
    expect(api.sessions.removeWorktree).toHaveBeenCalledWith('a1')
    expect(api.sessions.endAndRemove).not.toHaveBeenCalled()
  })

  it('removes the worktree of a finished session without ending it', async () => {
    const api = fakeSandtable()
    render(
      <SessionCard session={adhoc({ state: 'finished', worktrees: ['/wt/a1'] })} onOpen={vi.fn()} />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Remove session' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove worktree' }))
    expect(api.sessions.removeWorktree).toHaveBeenCalledWith('a1')
    expect(api.sessions.endAndRemove).not.toHaveBeenCalled()
  })

  it('shows why a worktree with changes was kept', async () => {
    const api = fakeSandtable()
    vi.mocked(api.sessions.endAndRemove).mockResolvedValue({
      removed: false,
      reason: 'it has uncommitted changes'
    })
    render(<SessionCard session={adhoc({ worktrees: ['/wt/a1'] })} onOpen={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'End session' }))
    await userEvent.click(screen.getByRole('button', { name: 'End session and remove worktree' }))
    expect(
      await screen.findByText('Session ended. Kept the worktree: it has uncommitted changes')
    ).toBeInTheDocument()
  })

  it('rises and fades in when its state changes', () => {
    const animate = vi.fn()
    HTMLElement.prototype.animate = animate
    const { rerender } = render(<SessionCard session={adhoc()} onOpen={vi.fn()} />)
    expect(animate).not.toHaveBeenCalled()
    rerender(<SessionCard session={adhoc({ state: 'needsYou' })} onOpen={vi.fn()} />)
    expect(animate).toHaveBeenCalledWith(
      [
        { opacity: 0, transform: 'translateY(6px)' },
        { opacity: 1, transform: 'none' }
      ],
      { duration: 200, easing: 'ease-out' }
    )
  })

  it("shows a running session's latest step under its place", async () => {
    const api = fakeSandtable()
    vi.mocked(api.sessions.activity).mockResolvedValue({
      steps: [{ tool: 'Read', target: 'README.md', at: null }],
      since: null
    })
    render(<SessionCard session={adhoc()} onOpen={vi.fn()} />)
    expect(await screen.findByText('README.md')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /README/ })).toBeNull()
  })
})

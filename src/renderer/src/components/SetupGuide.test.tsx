import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ToolCheck } from '../../../shared/types'
import { SetupGuide } from './SetupGuide'

const ready: ToolCheck = {
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
}

const guide = (
  check: ToolCheck | { error: string },
  props: Partial<Parameters<typeof SetupGuide>[0]> = {}
): ReturnType<typeof render> =>
  render(
    <SetupGuide
      check={check}
      firstRun={false}
      onCheckAgain={async () => {}}
      onDone={() => {}}
      {...props}
    />
  )

const button = (name: string | RegExp): HTMLElement => screen.getByRole('button', { name })

describe('SetupGuide', () => {
  it('opens at the failing step with its word and install command', () => {
    guide({ ...ready, ok: false, missing: ['tmux'] })
    expect(screen.getByRole('heading', { name: 'tmux and git' })).toBeInTheDocument()
    expect(screen.getByText('Missing')).toBeInTheDocument()
    expect(screen.getByText('brew install tmux')).toBeInTheDocument()
    expect(screen.getByText('Missing: run the command, then check again')).toBeInTheDocument()
    expect(button('Continue')).toBeDisabled()
  })

  it('moves on after Check again once the check passes', async () => {
    const onCheckAgain = vi.fn(async () => {})
    const { rerender } = guide({ ...ready, ok: false, missing: ['tmux'] }, { onCheckAgain })
    await userEvent.click(button('Check again'))
    rerender(
      <SetupGuide check={ready} firstRun={false} onCheckAgain={onCheckAgain} onDone={() => {}} />
    )
    await waitFor(() => expect(button('Continue')).toBeEnabled())
    expect(onCheckAgain).toHaveBeenCalledOnce()
    await userEvent.click(button('Continue'))
    expect(screen.getByRole('heading', { name: 'Claude Code' })).toBeInTheDocument()
  })

  it('shows Not logged in and gh auth login', () => {
    guide({ ...ready, ok: false, gh: { loggedIn: false, scopes: null } })
    expect(screen.getByRole('heading', { name: 'GitHub CLI' })).toBeInTheDocument()
    expect(screen.getAllByText('Not logged in').length).toBeGreaterThan(0)
    expect(screen.getByText('gh auth login --scopes project')).toBeInTheDocument()
  })

  it('disables Check again while checking', async () => {
    let finish = (): void => {}
    const onCheckAgain = vi.fn(() => new Promise<void>((r) => (finish = r)))
    guide({ ...ready, ok: false, missing: ['tmux'] }, { onCheckAgain })
    await userEvent.click(button('Check again'))
    const checking = button(/Checking…/)
    expect(checking).toBeDisabled()
    await userEvent.click(checking)
    expect(onCheckAgain).toHaveBeenCalledOnce()
    expect(button('Continue')).toBeDisabled()
    expect(screen.queryByText('brew install tmux')).not.toBeInTheDocument()
    finish()
    expect(await screen.findByRole('button', { name: 'Check again' })).toBeEnabled()
  })

  it('copies a command and reads Copied', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    guide({ ...ready, ok: false, missing: ['tmux'] })
    await userEvent.click(button('Copy'))
    expect(writeText).toHaveBeenCalledWith('brew install tmux')
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })

  it('counts the warnings in the hint and the rail', async () => {
    guide({ ...ready, gh: { loggedIn: true, scopes: null } })
    await userEvent.click(button('Continue'))
    await userEvent.click(button('Continue'))
    expect(screen.getAllByText("Can't check")).toHaveLength(2)
    expect(
      screen.getByText('You can continue; fix the warnings when you need them')
    ).toBeInTheDocument()
    await userEvent.click(button('Back'))
    expect(screen.getByRole('button', { name: /GitHub CLI/ })).toHaveTextContent(
      'Ready, 2 warnings'
    )
  })

  it('reads Ready, 1 warning in the rail for one warning', async () => {
    guide({ ...ready, gh: { loggedIn: true, scopes: ['repo'] } })
    await userEvent.click(button('Continue'))
    await userEvent.click(button('Continue'))
    await userEvent.click(button('Back'))
    expect(screen.getByRole('button', { name: /GitHub CLI/ })).toHaveTextContent('Ready, 1 warning')
  })

  it('opens at the first step when only a warning is pending', () => {
    guide({ ...ready, gh: { loggedIn: true, scopes: ['repo'] } })
    expect(screen.getByRole('heading', { name: 'tmux and git' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /GitHub CLI/ })).toHaveTextContent('Not checked')
  })

  it('walks through every step to Add project on first run', async () => {
    const onDone = vi.fn()
    guide(ready, { firstRun: true, onDone })
    expect(screen.getByText('Step 1 of 6')).toBeInTheDocument()
    for (let i = 0; i < 5; i++) await userEvent.click(button('Continue'))
    expect(screen.getByRole('heading', { name: 'First project' })).toBeInTheDocument()
    expect(
      screen.getByText('Choose where its tickets come from and the local folder of each repo.')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /tmux and git/ })).toHaveTextContent('Ready')
    expect(screen.queryByRole('button', { name: 'Check again' })).not.toBeInTheDocument()
    await userEvent.click(button('Add project'))
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('reads Done on the last step when not first run', async () => {
    const onDone = vi.fn()
    guide({ ...ready, gh: { loggedIn: true, scopes: ['repo'] } }, { onDone })
    expect(screen.getByText('Step 1 of 5')).toBeInTheDocument()
    await userEvent.click(button('Continue'))
    await userEvent.click(button('Continue'))
    expect(screen.getByText('Missing scope')).toBeInTheDocument()
    expect(
      screen.getByText('You can continue; fix the warning when you need it')
    ).toBeInTheDocument()
    await userEvent.click(button('Continue'))
    expect(screen.getByRole('heading', { name: 'Linear CLI' })).toBeInTheDocument()
    await userEvent.click(button('Continue'))
    expect(screen.getByRole('heading', { name: 'Jira CLI' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Claude Code/ })).toHaveTextContent('Ready')
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument()
    await userEvent.click(button('Done'))
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('shows a failed check as an alert', () => {
    guide({ error: 'boom' })
    expect(screen.getByRole('alert')).toHaveTextContent('boom')
    expect(screen.getByRole('button', { name: /Claude Code/ })).toHaveTextContent('Not checked')
    expect(button('Check again')).toBeEnabled()
    expect(button('Continue')).toBeDisabled()
  })
})

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SandtableApi } from '../../../shared/api'
import { adhoc, fakeSandtable } from '../test/fixtures'
import { RemoteMark, RemoteToggle } from './RemoteToggle'

let api: SandtableApi

beforeEach(() => {
  api = fakeSandtable()
})

const remote = (): HTMLElement => screen.getByRole('switch', { name: 'Remote Control' })

describe('RemoteToggle', () => {
  it('is off when Remote Control is off, says what it does, and turns it on', async () => {
    render(<RemoteToggle session={adhoc({ state: 'needsYou' })} />)
    expect(remote()).not.toBeChecked()
    expect(remote()).toHaveAccessibleDescription(
      'Use this session from claude.ai or the Claude app Turning it off restarts Claude Code in the same conversation.'
    )
    expect(remote().parentElement).toHaveAttribute(
      'title',
      'Follow and steer this session from claude.ai or the Claude app on any device signed in to your account. Turning it off restarts Claude Code in the same conversation.'
    )
    await userEvent.click(remote())
    expect(api.sessions.setRemoteControl).toHaveBeenCalledWith('a1', true)
  })

  it('is on when Remote Control is on and turns it off', async () => {
    render(<RemoteToggle session={adhoc({ state: 'finished', remoteControl: true })} />)
    expect(remote()).toBeChecked()
    await userEvent.click(remote())
    expect(api.sessions.setRemoteControl).toHaveBeenCalledWith('a1', false)
  })

  it('turns Remote Control on while the session is running', async () => {
    render(<RemoteToggle session={adhoc({ state: 'running' })} />)
    await userEvent.click(remote())
    expect(api.sessions.setRemoteControl).toHaveBeenCalledWith('a1', true)
  })

  it.each([
    [
      { state: 'running', remoteControl: true },
      'Wait until the session needs you to turn Remote Control off'
    ],
    [
      { state: 'needsYou', asking: true },
      'Claude is asking you something. Answer it in the terminal first.'
    ]
  ] as const)('is disabled for %o, and says why', (over, why) => {
    render(<RemoteToggle session={adhoc(over)} />)
    expect(remote()).toBeDisabled()
    expect(remote()).toHaveAccessibleDescription(why)
    expect(remote().parentElement).toHaveAttribute('title', why)
    expect(screen.getByText(why)).toBeVisible()
  })

  it('flips when you click its name', async () => {
    render(<RemoteToggle session={adhoc({ state: 'needsYou' })} />)
    await userEvent.click(screen.getByText('Remote Control'))
    expect(api.sessions.setRemoteControl).toHaveBeenCalledWith('a1', true)
  })

  it('is disabled while it works, and shows a refusal', async () => {
    let fail: (err: Error) => void = () => {}
    vi.mocked(api.sessions.setRemoteControl).mockReturnValue(
      new Promise((_, reject) => (fail = reject))
    )
    render(<RemoteToggle session={adhoc({ state: 'needsYou' })} />)
    await userEvent.click(remote())
    expect(remote()).toBeDisabled()
    fail(new Error('tmux is gone'))
    expect(await screen.findByRole('alert')).toHaveTextContent('tmux is gone')
  })
})

describe('RemoteMark', () => {
  it('is a status mark named Remote Control on, not a button', () => {
    render(<RemoteMark />)
    expect(screen.getByRole('img', { name: 'Remote Control on' })).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

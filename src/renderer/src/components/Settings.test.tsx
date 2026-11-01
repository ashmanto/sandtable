import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { SandtableApi } from '../../../shared/api'
import { fakeSandtable } from '../test/fixtures'
import { Settings } from './Settings'

describe('Settings', () => {
  it('shows the Appearance setting', async () => {
    const api = fakeSandtable()
    render(<Settings onBack={() => {}} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('radio', { name: 'Dark' }))
    expect(screen.getByRole('radiogroup', { name: 'Appearance' })).toBeInTheDocument()
    expect(api.app.setTheme).toHaveBeenCalledWith('dark')
    expect(screen.getByRole('radio', { checked: true, name: 'Dark' })).toBeInTheDocument()
  })

  it('shows the stored theme', async () => {
    const api = fakeSandtable()
    vi.mocked(api.app.theme).mockResolvedValue('light')
    render(<Settings onBack={() => {}} />)
    await screen.findByRole('radiogroup', { name: 'Appearance' })
    expect(screen.getByRole('radio', { checked: true, name: 'Light' })).toBeInTheDocument()
  })

  it('keeps the theme when the pressed choice is clicked again', async () => {
    const api = fakeSandtable()
    render(<Settings onBack={() => {}} />)
    await userEvent.click(await screen.findByRole('radio', { name: 'System' }))
    expect(api.app.setTheme).not.toHaveBeenCalled()
    expect(screen.getByRole('radio', { checked: true, name: 'System' })).toBeInTheDocument()
  })

  it('turns Keep awake on, with the helper text under it', async () => {
    const api = fakeSandtable()
    render(<Settings onBack={() => {}} />)
    const toggle = await screen.findByRole('switch', {
      name: 'Keep your Mac awake while sessions run'
    })
    expect(toggle).not.toBeChecked()
    expect(toggle).toHaveAccessibleDescription(
      'With the lid closed, this works only when your Mac is on power and connected to a display.'
    )
    await userEvent.click(toggle)
    expect(toggle).toBeChecked()
    expect(api.app.setKeepAwake).toHaveBeenCalledWith(true)
  })

  it('shows Keep awake as saved', async () => {
    const api = fakeSandtable()
    vi.mocked(api.app.keepAwake).mockResolvedValue(true)
    render(<Settings onBack={() => {}} />)
    await act(async () => {})
    expect(
      await screen.findByRole('switch', { name: 'Keep your Mac awake while sessions run' })
    ).toBeChecked()
  })

  it('turns Remote Control on for new sessions, with the helper text under it', async () => {
    const api = fakeSandtable()
    render(<Settings onBack={() => {}} />)
    const toggle = await screen.findByRole('switch', {
      name: 'Start sessions with Remote Control on'
    })
    expect(toggle).not.toBeChecked()
    expect(toggle).toHaveAccessibleDescription(
      'Follow and steer sessions from claude.ai or the Claude app. A project can override this in Edit project.'
    )
    await userEvent.click(toggle)
    expect(api.app.setRemoteControl).toHaveBeenCalledWith(true)
  })

  it('shows Remote Control as saved', async () => {
    const api = fakeSandtable()
    vi.mocked(api.app.remoteControl).mockResolvedValue(true)
    render(<Settings onBack={() => {}} />)
    expect(
      await screen.findByRole('switch', { name: 'Start sessions with Remote Control on' })
    ).toBeChecked()
  })

  it('shows the Notifications defaults and saves each switch', async () => {
    const api = fakeSandtable()
    render(<Settings onBack={() => {}} />)
    const notify = await screen.findByRole('switch', { name: 'Notify when a session needs you' })
    const sound = screen.getByRole('switch', { name: 'Play a sound' })
    const quiet = screen.getByRole('switch', { name: "Don't notify while Sandtable is in front" })
    expect(notify).toBeChecked()
    expect(sound).toBeChecked()
    expect(quiet).not.toBeChecked()
    expect(notify).toHaveAccessibleDescription('Cards still show Needs you when this is off.')
    await userEvent.click(sound)
    expect(api.app.setNotifications).toHaveBeenLastCalledWith({
      notify: true,
      sound: false,
      quietWhenFocused: false,
      limitPct: 80
    })
    await userEvent.click(quiet)
    expect(api.app.setNotifications).toHaveBeenLastCalledWith({
      notify: true,
      sound: false,
      quietWhenFocused: true,
      limitPct: 80
    })
    await userEvent.click(notify)
    expect(api.app.setNotifications).toHaveBeenLastCalledWith({
      notify: false,
      sound: false,
      quietWhenFocused: true,
      limitPct: 80
    })
  })

  it('shows Notifications as saved, with the other switches off while Notify is off', async () => {
    const api = fakeSandtable()
    vi.mocked(api.app.notifications).mockResolvedValue({
      notify: false,
      sound: true,
      quietWhenFocused: true,
      limitPct: null
    })
    render(<Settings onBack={() => {}} />)
    const notify = await screen.findByRole('switch', { name: 'Notify when a session needs you' })
    expect(notify).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'Play a sound' })).toBeDisabled()
    expect(
      screen.getByRole('switch', { name: "Don't notify while Sandtable is in front" })
    ).toBeDisabled()
  })

  it('saves the plan-limit threshold and turns it off', async () => {
    const api = fakeSandtable()
    render(<Settings onBack={() => {}} />)
    const limit = await screen.findByRole('combobox', { name: 'Notify when a plan limit passes' })
    expect(limit).toHaveTextContent('80%')
    expect(limit).toHaveAccessibleDescription(
      'For the 5-hour and 7-day limits, once per window, even while Sandtable is in front.'
    )
    await userEvent.click(limit)
    await userEvent.click(screen.getByRole('option', { name: 'Off' }))
    expect(api.app.setNotifications).toHaveBeenLastCalledWith({
      notify: true,
      sound: true,
      quietWhenFocused: false,
      limitPct: null
    })
    await userEvent.click(limit)
    await userEvent.click(screen.getByRole('option', { name: '95%' }))
    expect(api.app.setNotifications).toHaveBeenLastCalledWith(
      expect.objectContaining({ limitPct: 95 })
    )
  })

  it('keeps Play a sound on while only the plan-limit notification is on', async () => {
    const api = fakeSandtable()
    vi.mocked(api.app.notifications).mockResolvedValue({
      notify: false,
      sound: true,
      quietWhenFocused: false,
      limitPct: 80
    })
    render(<Settings onBack={() => {}} />)
    expect(await screen.findByRole('switch', { name: 'Play a sound' })).toBeEnabled()
  })

  it('opens Notification Settings in macOS', async () => {
    const api = fakeSandtable()
    render(<Settings onBack={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Open Notification Settings' }))
    expect(api.app.openNotificationSettings).toHaveBeenCalled()
  })

  it('shows why Notification Settings did not open', async () => {
    const api = fakeSandtable()
    vi.mocked(api.app.openNotificationSettings).mockRejectedValueOnce(
      new Error('No application can open the link')
    )
    render(<Settings onBack={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Open Notification Settings' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No application can open the link')
  })

  describe('Claude Code accounts', () => {
    const work = { name: 'Work', dir: '/Users/me/.claude-work' }
    const withWork = (api: SandtableApi): void => {
      vi.mocked(api.accounts.list).mockResolvedValue([
        { name: 'Default', dir: '/Users/me/.claude' },
        work
      ])
    }
    const account = (name: string): HTMLElement => screen.getByRole('group', { name })

    it('lists each account with its folder and sign-in state as a word', async () => {
      const api = fakeSandtable()
      withWork(api)
      let finish: (v: boolean | null) => void = () => {}
      vi.mocked(api.accounts.signedIn).mockImplementation((dir) =>
        dir === work.dir ? new Promise((r) => (finish = r)) : Promise.resolve(false)
      )
      render(<Settings onBack={() => {}} />)
      await screen.findByRole('group', { name: 'Work' })
      expect(
        screen.getByText(
          'You pick one for each project when you add or edit it. Default is the account Claude Code uses on its own.'
        )
      ).toBeInTheDocument()
      expect(account('Default')).toHaveTextContent('~/.claude')
      expect(await within(account('Default')).findByText('Not signed in')).toBeInTheDocument()
      expect(within(account('Default')).getByText('claude auth login')).toBeInTheDocument()
      expect(within(account('Default')).queryByRole('button', { name: /Remove/ })).toBeNull()
      expect(account('Work')).toHaveTextContent('~/.claude-work')
      expect(within(account('Work')).getByText('Checking…')).toBeInTheDocument()
      await act(async () => finish(null))
      expect(within(account('Work')).getByText("Can't check")).toBeInTheDocument()
      expect(within(account('Work')).queryByText(/auth login/)).toBeNull()
    })

    it('shows the sign-in command with the folder for a signed-out account', async () => {
      const api = fakeSandtable()
      withWork(api)
      vi.mocked(api.accounts.signedIn).mockImplementation(async (dir) => dir !== work.dir)
      render(<Settings onBack={() => {}} />)
      await screen.findByRole('group', { name: 'Work' })
      expect(await within(account('Default')).findByText('Signed in')).toBeInTheDocument()
      expect(
        await within(account('Work')).findByText(
          'CLAUDE_CONFIG_DIR=/Users/me/.claude-work claude auth login'
        )
      ).toBeInTheDocument()
    })

    it('removes an account and reloads the list, or shows why it refused', async () => {
      const api = fakeSandtable()
      withWork(api)
      vi.mocked(api.accounts.remove).mockRejectedValueOnce(
        new Error('Shop uses Work. Pick another account for it first.')
      )
      render(<Settings onBack={() => {}} />)
      await screen.findByRole('group', { name: 'Work' })
      const remove = within(account('Work')).getByRole('button', { name: 'Remove Work' })
      await userEvent.click(remove)
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Shop uses Work. Pick another account for it first.'
      )
      vi.mocked(api.accounts.list).mockResolvedValue([
        { name: 'Default', dir: '/Users/me/.claude' }
      ])
      await userEvent.click(remove)
      expect(api.accounts.remove).toHaveBeenLastCalledWith(work.dir)
      expect(await screen.findByRole('group', { name: 'Default' })).toBeInTheDocument()
      expect(screen.queryByRole('group', { name: 'Work' })).toBeNull()
      expect(screen.queryByRole('alert')).toBeNull()
    })

    it('adds an account from a found folder, or shows why it refused', async () => {
      const api = fakeSandtable()
      vi.mocked(api.accounts.folders).mockResolvedValue(['/Users/me/.claude-work'])
      vi.mocked(api.accounts.add).mockRejectedValueOnce(
        new Error('An account named work already exists')
      )
      render(<Settings onBack={() => {}} />)
      await userEvent.click(await screen.findByRole('button', { name: 'Add account' }))
      expect(screen.getByLabelText('Name')).toHaveFocus()
      await userEvent.click(await screen.findByRole('button', { name: '~/.claude-work' }))
      expect(screen.getByLabelText('Folder')).toHaveValue('~/.claude-work')
      expect(screen.getByLabelText('Name')).toHaveValue('work')
      await userEvent.click(screen.getByRole('button', { name: 'Add' }))
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'An account named work already exists'
      )
      await userEvent.clear(screen.getByLabelText('Name'))
      await userEvent.type(screen.getByLabelText('Name'), 'Work')
      vi.mocked(api.accounts.list).mockResolvedValue([
        { name: 'Default', dir: '/Users/me/.claude' },
        work
      ])
      await userEvent.click(screen.getByRole('button', { name: 'Add' }))
      expect(api.accounts.add).toHaveBeenLastCalledWith({ name: 'Work', dir: '~/.claude-work' })
      expect(await screen.findByRole('group', { name: 'Work' })).toBeInTheDocument()
      expect(screen.queryByLabelText('Folder')).toBeNull()
    })
    it('re-checks sign-in when the window regains focus', async () => {
      const api = fakeSandtable()
      vi.mocked(api.accounts.signedIn).mockResolvedValue(false)
      render(<Settings onBack={() => {}} />)
      await screen.findByRole('group', { name: 'Default' })
      expect(await within(account('Default')).findByText('Not signed in')).toBeInTheDocument()
      vi.mocked(api.accounts.signedIn).mockResolvedValue(true)
      await act(async () => window.dispatchEvent(new Event('focus')))
      expect(await within(account('Default')).findByText('Signed in')).toBeInTheDocument()
    })

    it('shows why the accounts could not load', async () => {
      const api = fakeSandtable()
      vi.mocked(api.accounts.list).mockRejectedValue(new Error('store is locked'))
      render(<Settings onBack={() => {}} />)
      expect(await screen.findByRole('alert')).toHaveTextContent('store is locked')
    })

    it('disables Remove while it runs, so a double click removes once', async () => {
      const api = fakeSandtable()
      withWork(api)
      let finish: () => void = () => {}
      vi.mocked(api.accounts.remove).mockImplementation(() => new Promise((r) => (finish = r)))
      render(<Settings onBack={() => {}} />)
      await screen.findByRole('group', { name: 'Work' })
      const remove = within(account('Work')).getByRole('button', { name: 'Remove Work' })
      await userEvent.click(remove)
      expect(remove).toBeDisabled()
      await userEvent.click(remove)
      expect(api.accounts.remove).toHaveBeenCalledTimes(1)
      await act(async () => finish())
    })

    it('disables Add while it runs', async () => {
      const api = fakeSandtable()
      vi.mocked(api.accounts.add).mockImplementation(() => new Promise(() => {}))
      render(<Settings onBack={() => {}} />)
      await userEvent.click(await screen.findByRole('button', { name: 'Add account' }))
      await userEvent.type(screen.getByLabelText('Name'), 'Work')
      await userEvent.type(screen.getByLabelText('Folder'), '~/.claude-work')
      await userEvent.click(screen.getByRole('button', { name: 'Add' }))
      expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
    })

    it('replaces a suggested name when you pick another folder, but keeps a typed one', async () => {
      const api = fakeSandtable()
      vi.mocked(api.accounts.folders).mockResolvedValue([
        '/Users/me/.claude-work',
        '/Users/me/.claude-side',
        '/Users/me/.claude_personal',
        '/Users/me/.claude.bak'
      ])
      render(<Settings onBack={() => {}} />)
      await userEvent.click(await screen.findByRole('button', { name: 'Add account' }))
      const name = screen.getByLabelText('Name')
      await userEvent.click(await screen.findByRole('button', { name: '~/.claude_personal' }))
      expect(name).toHaveValue('')
      await userEvent.click(screen.getByRole('button', { name: '~/.claude.bak' }))
      expect(name).toHaveValue('')
      await userEvent.click(screen.getByRole('button', { name: '~/.claude-work' }))
      expect(name).toHaveValue('work')
      await userEvent.click(screen.getByRole('button', { name: '~/.claude-side' }))
      expect(name).toHaveValue('side')
      expect(screen.getByLabelText('Folder')).toHaveValue('~/.claude-side')
      await userEvent.clear(name)
      await userEvent.type(name, 'Mine')
      await userEvent.click(screen.getByRole('button', { name: '~/.claude-work' }))
      expect(name).toHaveValue('Mine')
    })

    it('closes the form and clears its error on Cancel', async () => {
      const api = fakeSandtable()
      vi.mocked(api.accounts.add).mockRejectedValueOnce(new Error('Enter a name'))
      render(<Settings onBack={() => {}} />)
      await userEvent.click(await screen.findByRole('button', { name: 'Add account' }))
      await userEvent.click(screen.getByRole('button', { name: 'Add' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('Enter a name')
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByLabelText('Folder')).toBeNull()
      expect(screen.queryByRole('alert')).toBeNull()
    })
  })

  it('shows the Leftover sessions section', async () => {
    fakeSandtable()
    render(<Settings onBack={() => {}} />)
    expect(screen.getByRole('heading', { name: 'Leftover sessions' })).toBeInTheDocument()
    expect(await screen.findByText('None. There is nothing to clean up.')).toBeInTheDocument()
  })

  it('goes back', async () => {
    fakeSandtable()
    const onBack = vi.fn()
    render(<Settings onBack={onBack} />)
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(onBack).toHaveBeenCalled()
  })
})

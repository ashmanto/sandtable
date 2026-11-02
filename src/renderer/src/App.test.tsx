import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SandtableApi, WindowFrame } from '../../shared/api'
import type { LastView, ToolCheck } from '../../shared/types'
import App from './App'
import { adhoc, boardView, fakeSandtable, project, session, ticket } from './test/fixtures'

vi.mock('./components/Terminal', () => ({ Terminal: () => <div data-testid="terminal" /> }))

let api: SandtableApi

beforeEach(() => {
  api = fakeSandtable()
  localStorage.clear()
})

async function finishSetup(): Promise<void> {
  for (let i = 0; i < 5; i++)
    await userEvent.click(await screen.findByRole('button', { name: 'Continue' }))
  await userEvent.click(screen.getByRole('button', { name: 'Add project' }))
}

describe('App', () => {
  it('opens the first project board', async () => {
    vi.mocked(api.board.get).mockResolvedValue(boardView({ tickets: [ticket(1)] }))
    render(<App />)
    expect(await screen.findByText('Ticket 1')).toBeInTheDocument()
    expect(api.board.get).toHaveBeenCalledWith('p1')
  })

  it('still counts a session toward Needs you when the label filter hides its ticket', async () => {
    localStorage.setItem('labelFilter:p1', JSON.stringify({ mode: 'only', labels: ['bug'] }))
    const t = ticket(1, { labels: [{ name: 'docs', color: 'ffffff' }] })
    vi.mocked(api.board.get).mockResolvedValue(
      boardView({
        tickets: [t],
        sessions: [session(t.key, { state: 'needsYou' })],
        needsYou: { p1: 1 }
      })
    )
    render(<App />)
    expect(await screen.findByText('1 hidden by filter')).toBeInTheDocument()
    expect(screen.queryByText('Ticket 1')).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: '1 needs you' })).toHaveTextContent('1')
  })

  it("doesn't carry one project's label filter to another", async () => {
    localStorage.setItem('labelFilter:p1', JSON.stringify({ mode: 'only', labels: ['bug'] }))
    vi.mocked(api.projects.list).mockResolvedValue([
      project,
      { ...project, id: 'p2', name: 'Other' }
    ])
    vi.mocked(api.board.get).mockResolvedValue(boardView({ tickets: [ticket(1)] }))
    render(<App />)
    expect(await screen.findByText('1 hidden by filter')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Other' }))
    expect(await screen.findByText('Ticket 1')).toBeInTheDocument()
    expect(screen.queryByText(/hidden by filter/)).not.toBeInTheDocument()
  })

  it('goes to the add-project flow from Add project and to a ticket when main asks', async () => {
    let openTicket: (view: LastView) => void = () => {}
    vi.mocked(api.app.onOpen).mockImplementation((cb) => {
      openTicket = cb
      return () => {}
    })
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: 'Add project' }))
    expect(screen.getByRole('heading', { name: 'Add project' })).toBeInTheDocument()
    act(() => openTicket({ projectId: project.id, ticketKey: 'octo/shop#147' }))
    expect(screen.getByRole('button', { name: 'Back to board' })).toBeInTheDocument()
  })

  it('opens the ticket main queued before the window subscribed', async () => {
    vi.mocked(api.app.pendingOpen).mockResolvedValue({
      projectId: project.id,
      ticketKey: 'octo/shop#147'
    })
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Back to board' })).toBeInTheDocument()
  })

  it('restores the saved ticket and its Details tab', async () => {
    const t = ticket(1)
    vi.mocked(api.app.lastView).mockResolvedValue({
      projectId: project.id,
      ticketKey: t.key,
      tab: 'details'
    })
    vi.mocked(api.board.get).mockResolvedValue(
      boardView({ tickets: [t], sessions: [session(t.key)] })
    )
    render(<App />)
    expect(await screen.findByTestId('terminal')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Details/ })).toHaveAttribute('aria-selected', 'true')
  })

  it("opens a ticket's sidebar row on Conversation, even from its own Details tab", async () => {
    const t = ticket(1)
    const s = session(t.key)
    vi.mocked(api.app.lastView).mockResolvedValue({
      projectId: project.id,
      ticketKey: t.key,
      tab: 'details'
    })
    vi.mocked(api.board.get).mockResolvedValue(
      boardView({ tickets: [t], sessions: [s], sidebarSessions: [{ ...s, name: t.title }] })
    )
    render(<App />)
    const sidebar = await screen.findByRole('navigation')
    expect(await screen.findByRole('tab', { name: /Details/ })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await userEvent.click(within(sidebar).getByRole('button', { name: /#1.*Ticket 1/ }))
    expect(screen.getByRole('tab', { name: /Conversation/ })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })

  it("opens another project's session in a fresh ticket view", async () => {
    const t = ticket(1)
    const other = { ...project, id: 'p2', name: 'Web' }
    const theirs = session(t.key, { projectId: 'p2' })
    vi.mocked(api.projects.list).mockResolvedValue([project, other])
    vi.mocked(api.app.lastView).mockResolvedValue({
      projectId: project.id,
      ticketKey: t.key,
      tab: 'details'
    })
    vi.mocked(api.board.get).mockImplementation(async (id) =>
      id === 'p2'
        ? boardView({ tickets: [t], sessions: [theirs] })
        : boardView({ tickets: [t], elsewhere: [theirs] })
    )
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: 'Hide chat' }))
    await userEvent.click(screen.getByRole('button', { name: 'Running in Web. Open the session' }))
    expect(await screen.findByTestId('terminal')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: /Details/ }))
    expect(await screen.findByRole('button', { name: 'Hide chat' })).toBeInTheDocument()
  })

  it('opens Conversation for a saved Terminal tab of a live session', async () => {
    const t = ticket(1)
    vi.mocked(api.app.lastView).mockResolvedValue({
      projectId: project.id,
      ticketKey: t.key,
      tab: 'terminal' as 'details'
    })
    vi.mocked(api.board.get).mockResolvedValue(
      boardView({ tickets: [t], sessions: [session(t.key)] })
    )
    render(<App />)
    expect(await screen.findByRole('tab', { name: /Conversation/ })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })

  it('restores a saved Conversation tab', async () => {
    const t = ticket(1)
    vi.mocked(api.app.lastView).mockResolvedValue({
      projectId: project.id,
      ticketKey: t.key,
      tab: 'conversation'
    })
    vi.mocked(api.board.get).mockResolvedValue(
      boardView({ tickets: [t], sessions: [session(t.key, { state: 'finished' })] })
    )
    render(<App />)
    expect(await screen.findByRole('tab', { name: /Conversation/ })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })

  it('ignores a saved tab that is not a tab', async () => {
    const t = ticket(1)
    vi.mocked(api.app.lastView).mockResolvedValue({
      projectId: project.id,
      ticketKey: t.key,
      tab: 'bogus' as 'details'
    })
    vi.mocked(api.board.get).mockResolvedValue(boardView({ tickets: [t] }))
    render(<App />)
    expect(await screen.findByRole('tab', { name: /Details/ })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })

  it('does not save the add-project flow for a new project', async () => {
    vi.mocked(api.projects.list).mockResolvedValue([])
    render(<App />)
    await finishSetup()
    expect(await screen.findByRole('heading', { name: 'Add project' })).toBeInTheDocument()
    expect(api.app.saveView).not.toHaveBeenCalled()
  })

  it('opens a pending notification ticket over the saved view', async () => {
    vi.mocked(api.app.lastView).mockResolvedValue({ projectId: project.id })
    vi.mocked(api.app.pendingOpen).mockResolvedValue({
      projectId: project.id,
      ticketKey: 'octo/shop#147'
    })
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Back to board' })).toBeInTheDocument()
  })

  it('keeps the tab when main opens the ticket already shown', async () => {
    let openTicket: (view: LastView) => void = () => {}
    vi.mocked(api.app.onOpen).mockImplementation((cb) => {
      openTicket = cb
      return () => {}
    })
    const t = ticket(1)
    vi.mocked(api.app.lastView).mockResolvedValue({
      projectId: project.id,
      ticketKey: t.key,
      tab: 'conversation'
    })
    vi.mocked(api.board.get).mockResolvedValue(
      boardView({ tickets: [t], sessions: [session(t.key, { state: 'finished' })] })
    )
    render(<App />)
    await screen.findByRole('tab', { name: /Conversation/, selected: true })
    act(() => openTicket({ projectId: project.id, ticketKey: t.key }))
    expect(api.app.saveView).toHaveBeenLastCalledWith({
      projectId: project.id,
      ticketKey: t.key,
      tab: 'conversation'
    })
  })

  it('opens a new session from the board and saves it as the view', async () => {
    vi.mocked(api.board.get).mockResolvedValue(boardView({ sessions: [adhoc()] }))
    vi.mocked(api.projects.list).mockResolvedValue([{ ...project, repos: [project.repos[0]] }])
    render(<App />)
    await screen.findByRole('button', { name: 'Sync' })
    await userEvent.click(
      within(screen.getByRole('main')).getByRole('button', { name: 'New session' })
    )
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Start' }))
    expect(await screen.findByRole('heading', { name: 'Oct 24, 10:00' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(api.sessions.create).toHaveBeenCalledWith(
      'p1',
      'octo/shop',
      false,
      undefined,
      '',
      null,
      expect.any(String),
      undefined
    )
    expect(api.app.saveView).toHaveBeenLastCalledWith({ projectId: project.id, sessionId: 'a1' })
  })

  it('opens the drafting session from New ticket in To do', async () => {
    vi.mocked(api.board.get).mockResolvedValue(
      boardView({ sessions: [adhoc({ name: 'New ticket' })] })
    )
    vi.mocked(api.projects.list).mockResolvedValue([{ ...project, repos: [project.repos[0]] }])
    render(<App />)
    await screen.findByRole('button', { name: 'Sync' })
    await userEvent.click(screen.getByRole('button', { name: 'New ticket' }))
    await userEvent.keyboard('Dark mode')
    await userEvent.click(screen.getByRole('button', { name: 'Draft with Claude' }))
    expect(await screen.findByRole('heading', { name: 'New ticket' })).toBeInTheDocument()
    expect(api.sessions.create).toHaveBeenCalledWith('p1', 'octo/shop', false, {
      title: 'Dark mode',
      body: ''
    })
  })

  describe("another project's row in the sidebar", () => {
    const other = { ...project, id: 'p2', name: 'Other' }
    const triage = adhoc({ id: 'a2', projectId: 'p2', name: 'Triage' })

    beforeEach(() => {
      vi.mocked(api.projects.list).mockResolvedValue([project, other])
      vi.mocked(api.board.get).mockImplementation(async (id) =>
        boardView({ sessions: id === 'p2' ? [triage] : [], sidebarSessions: [triage] })
      )
    })

    it('opens its session', async () => {
      localStorage.setItem('sandtable.openProjects', JSON.stringify(['p2']))
      render(<App />)
      const sidebar = await screen.findByRole('navigation')
      await userEvent.click(await within(sidebar).findByRole('button', { name: /^Triage/ }))
      expect(await screen.findByRole('heading', { name: 'Triage' })).toBeInTheDocument()
      expect(api.board.get).toHaveBeenLastCalledWith('p2')
    })

    it('edits the project from its More menu', async () => {
      render(<App />)
      await userEvent.click(await screen.findByRole('button', { name: 'More for Other' }))
      await userEvent.click(screen.getByRole('menuitem', { name: 'Edit project' }))
      expect(await screen.findByRole('heading', { name: 'Edit Other' })).toBeInTheDocument()
    })

    it('starts a session in the project from its More menu', async () => {
      render(<App />)
      await userEvent.click(await screen.findByRole('button', { name: 'More for Other' }))
      await userEvent.click(screen.getByRole('menuitem', { name: 'New session' }))
      await userEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Start' })
      )
      expect(api.sessions.create).toHaveBeenCalledWith(
        'p2',
        expect.any(String),
        expect.anything(),
        undefined,
        '',
        null,
        expect.any(String),
        undefined
      )
    })

    it('opens the routine editor from its More menu and saves the routine', async () => {
      render(<App />)
      await userEvent.click(await screen.findByRole('button', { name: 'More for Other' }))
      await userEvent.click(screen.getByRole('menuitem', { name: 'Routines' }))
      await userEvent.click(await screen.findByRole('menuitem', { name: 'New routine…' }))
      const editor = within(await screen.findByRole('dialog', { name: 'New routine in Other' }))
      await userEvent.type(editor.getByRole('textbox', { name: 'Name' }), 'nightly')
      await userEvent.type(editor.getByRole('textbox', { name: 'First message' }), 'Check')
      await userEvent.click(editor.getByRole('button', { name: 'Save' }))
      expect(api.routines.save).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 'p2', name: 'nightly', message: 'Check' })
      )
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })

    it('turns a new session into a routine with Save as routine', async () => {
      render(<App />)
      await userEvent.click(await screen.findByRole('button', { name: 'More for Other' }))
      await userEvent.click(screen.getByRole('menuitem', { name: 'New session' }))
      const dialog = within(screen.getByRole('dialog'))
      await userEvent.type(dialog.getByRole('textbox', { name: 'First message' }), 'Look')
      await userEvent.click(dialog.getByRole('button', { name: 'Save as routine' }))
      const editor = within(await screen.findByRole('dialog', { name: 'New routine in Other' }))
      expect(editor.getByRole('textbox', { name: 'First message' })).toHaveValue('Look')
      expect(screen.getAllByRole('dialog')).toHaveLength(1)
    })

    it('leaves Settings for Edit project from its More menu', async () => {
      render(<App />)
      await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))
      expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'More for Other' }))
      await userEvent.click(screen.getByRole('menuitem', { name: 'Edit project' }))
      expect(await screen.findByRole('heading', { name: 'Edit Other' })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Settings' })).not.toBeInTheDocument()
    })

    it('keeps its sessions and count while the next board loads', async () => {
      localStorage.setItem('sandtable.openProjects', JSON.stringify(['p2']))
      vi.mocked(api.board.get).mockImplementation((id) =>
        id === 'p1'
          ? Promise.resolve(boardView({ sidebarSessions: [triage], needsYou: { p2: 2 } }))
          : new Promise(() => {})
      )
      render(<App />)
      const sidebar = await screen.findByRole('navigation')
      await within(sidebar).findByRole('button', { name: /^Triage/ })
      await userEvent.click(within(sidebar).getByRole('button', { name: 'Other' }))
      expect(within(sidebar).getByRole('button', { name: /^Triage/ })).toBeInTheDocument()
      expect(within(sidebar).getByRole('img', { name: '2 need you' })).toBeInTheDocument()
    })
  })

  it('restores a saved session', async () => {
    vi.mocked(api.app.lastView).mockResolvedValue({ projectId: project.id, sessionId: 'a1' })
    vi.mocked(api.board.get).mockResolvedValue(boardView({ sessions: [adhoc()] }))
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Oct 24, 10:00' })).toBeInTheDocument()
    expect(screen.getByTestId('terminal')).toBeInTheDocument()
  })

  it('opens the board when the saved session was removed', async () => {
    vi.mocked(api.app.lastView).mockResolvedValue({ projectId: project.id, sessionId: 'a1' })
    vi.mocked(api.board.get).mockResolvedValue(
      boardView({ sessions: [adhoc({ state: 'finished', removedAt: '2026-10-24T11:00:00Z' })] })
    )
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Sync' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Back to board' })).not.toBeInTheDocument()
  })

  it('opens the tab main asks for, and Back returns to the board', async () => {
    const t = ticket(1)
    let open: (view: LastView) => void = () => {}
    vi.mocked(api.app.onOpen).mockImplementation((cb) => {
      open = cb
      return () => {}
    })
    vi.mocked(api.board.get).mockResolvedValue(
      boardView({ tickets: [t], sessions: [session(t.key)] })
    )
    render(<App />)
    await screen.findByRole('button', { name: 'Sync' })
    act(() => open({ projectId: project.id, ticketKey: t.key, tab: 'changes' }))
    expect(await screen.findByRole('tab', { name: /Changes/ })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    act(() => open({ projectId: project.id, ticketKey: t.key, tab: 'conversation' }))
    expect(screen.getByRole('tab', { name: /Conversation/ })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await userEvent.keyboard('{Meta>}[[{/Meta}')
    expect(await screen.findByRole('button', { name: 'Sync' })).toBeInTheDocument()
  })

  it('opens a session when main asks', async () => {
    let open: (view: LastView) => void = () => {}
    vi.mocked(api.app.onOpen).mockImplementation((cb) => {
      open = cb
      return () => {}
    })
    vi.mocked(api.board.get).mockResolvedValue(boardView({ sessions: [adhoc()] }))
    render(<App />)
    await screen.findByRole('button', { name: 'Sync' })
    act(() => open({ projectId: project.id, sessionId: 'a1' }))
    expect(await screen.findByRole('heading', { name: 'Oct 24, 10:00' })).toBeInTheDocument()
  })

  it('opens Settings from the menu and goes back to the board', async () => {
    let openSettings = (): void => {}
    vi.mocked(api.app.onSettings).mockImplementation((cb) => {
      openSettings = cb
      return () => {}
    })
    render(<App />)
    await screen.findByRole('button', { name: 'Sync' })
    act(() => openSettings())
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(await screen.findByRole('radiogroup', { name: 'Appearance' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sync' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('button', { name: 'Sync' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Settings' })).not.toBeInTheDocument()
  })

  it('opens Settings from the sidebar', async () => {
    render(<App />)
    await screen.findByRole('button', { name: 'Sync' })
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
  })

  it('opens Usage from the sidebar and goes back to the board', async () => {
    render(<App />)
    await screen.findByRole('button', { name: 'Sync' })
    await userEvent.click(screen.getByRole('button', { name: 'Usage' }))
    expect(screen.getByRole('heading', { name: 'Usage' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sync' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.queryByRole('heading', { name: 'Usage' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Usage' }))
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.queryByRole('heading', { name: 'Usage' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sync' })).toBeInTheDocument()
  })

  it('leaves Settings when you choose a project or main opens a ticket', async () => {
    let openSettings = (): void => {}
    vi.mocked(api.app.onSettings).mockImplementation((cb) => {
      openSettings = cb
      return () => {}
    })
    let open: (view: LastView) => void = () => {}
    vi.mocked(api.app.onOpen).mockImplementation((cb) => {
      open = cb
      return () => {}
    })
    render(<App />)
    const sidebar = await screen.findByRole('navigation')
    act(() => openSettings())
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    await userEvent.click(within(sidebar).getByRole('button', { name: /^Shop/ }))
    expect(screen.queryByRole('heading', { name: 'Settings' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sync' })).toBeInTheDocument()
    act(() => openSettings())
    act(() => open({ projectId: project.id, ticketKey: 'octo/shop#147' }))
    expect(screen.queryByRole('heading', { name: 'Settings' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back to board' })).toBeInTheDocument()
  })

  it('opens Settings when main queued it before the window subscribed', async () => {
    vi.mocked(api.app.pendingOpen).mockResolvedValue('settings')
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByRole('button', { name: 'Sync' })).toBeInTheDocument()
  })

  it('closes Settings when main opens the ticket already behind it', async () => {
    const t = ticket(1)
    vi.mocked(api.app.lastView).mockResolvedValue({ projectId: project.id, ticketKey: t.key })
    vi.mocked(api.board.get).mockResolvedValue(boardView({ tickets: [t] }))
    let openSettings = (): void => {}
    vi.mocked(api.app.onSettings).mockImplementation((cb) => {
      openSettings = cb
      return () => {}
    })
    let open: (view: LastView) => void = () => {}
    vi.mocked(api.app.onOpen).mockImplementation((cb) => {
      open = cb
      return () => {}
    })
    render(<App />)
    await screen.findByRole('button', { name: 'Back to board' })
    act(() => openSettings())
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    act(() => open({ projectId: project.id, ticketKey: t.key }))
    expect(screen.queryByRole('heading', { name: 'Settings' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back to board' })).toBeInTheDocument()
  })

  it('keeps the Add project draft behind Settings', async () => {
    let openSettings = (): void => {}
    vi.mocked(api.app.onSettings).mockImplementation((cb) => {
      openSettings = cb
      return () => {}
    })
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: 'Add project' }))
    await userEvent.type(screen.getByLabelText('Name'), 'Draft')
    act(() => openSettings())
    expect(screen.getByLabelText('Name')).not.toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByLabelText('Name')).toHaveValue('Draft')
  })

  it('leaves Settings when you start a new session from the sidebar', async () => {
    let openSettings = (): void => {}
    vi.mocked(api.app.onSettings).mockImplementation((cb) => {
      openSettings = cb
      return () => {}
    })
    render(<App />)
    const sidebar = await screen.findByRole('navigation')
    await screen.findByRole('button', { name: 'Sync' })
    act(() => openSettings())
    await userEvent.click(within(sidebar).getByRole('button', { name: 'New session' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('heading', { name: 'Settings' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sync' })).toBeVisible()
  })

  it('opens the first project board when the saved project was removed', async () => {
    vi.mocked(api.app.lastView).mockResolvedValue({ projectId: 'gone', ticketKey: 'a/b#1' })
    vi.mocked(api.board.get).mockResolvedValue(boardView({ tickets: [ticket(1)] }))
    render(<App />)
    expect(await screen.findByText('Ticket 1')).toBeInTheDocument()
    expect(api.board.get).not.toHaveBeenCalledWith('gone')
  })

  it('opens the project board when the saved ticket was removed', async () => {
    vi.mocked(api.app.lastView).mockResolvedValue({
      projectId: project.id,
      ticketKey: 'octo/shop#999'
    })
    vi.mocked(api.board.get).mockResolvedValue(boardView({ tickets: [ticket(1)] }))
    render(<App />)
    expect(await screen.findByText('Ticket 1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Back to board' })).not.toBeInTheDocument()
  })

  it('saves the open ticket and tab', async () => {
    const t = ticket(1)
    vi.mocked(api.board.get).mockResolvedValue(
      boardView({ tickets: [t], sessions: [session(t.key, { state: 'finished' })] })
    )
    render(<App />)
    await userEvent.click(await screen.findByText('Ticket 1'))
    await userEvent.click(await screen.findByRole('tab', { name: /Conversation/ }))
    expect(api.app.saveView).toHaveBeenLastCalledWith({
      projectId: project.id,
      ticketKey: t.key,
      tab: 'conversation'
    })
  })

  it('reloads the sidebar after a save', async () => {
    vi.mocked(api.projects.list).mockResolvedValueOnce([]).mockResolvedValue([project])
    vi.mocked(api.projects.pickFolder).mockResolvedValue({
      path: '/Users/me/projects/shop',
      repos: ['octo/shop']
    })
    render(<App />)
    await finishSetup()
    await userEvent.type(await screen.findByLabelText('Name'), 'Shop{Enter}')
    await userEvent.click(screen.getByRole('radio', { name: /Repo issues/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add from a folder…' }))
    await screen.findByText('Remote matches')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('button', { name: /^Shop/ })).toBeInTheDocument()
    expect(api.projects.save).toHaveBeenCalled()
  })

  describe('project groups', () => {
    const work = { id: 'g1', name: 'Work' }

    it('shows the saved groups and arranges projects through main', async () => {
      vi.mocked(api.projects.groups).mockResolvedValue([work])
      render(<App />)
      expect(await screen.findByRole('heading', { name: 'Work' })).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'More for Shop' }))
      await userEvent.click(screen.getByRole('menuitemradio', { name: 'Work' }))
      expect(api.projects.arrange).toHaveBeenCalledWith([work], [{ id: 'p1', group: 'g1' }])
      expect(
        within(screen.getByRole('list', { name: 'Work' })).getByRole('button', { name: 'Shop' })
      ).toBeInTheDocument()
    })

    it('reloads projects and groups when arranging fails', async () => {
      vi.mocked(api.projects.groups).mockResolvedValue([work])
      vi.mocked(api.projects.arrange).mockRejectedValue(new Error('disk full'))
      const log = vi.spyOn(console, 'error').mockImplementation(() => {})
      render(<App />)
      await userEvent.click(await screen.findByRole('button', { name: 'More for Work' }))
      await userEvent.click(screen.getByRole('menuitem', { name: 'Delete group' }))
      expect(await screen.findByRole('heading', { name: 'Work' })).toBeInTheDocument()
      expect(log).toHaveBeenCalledWith(new Error('disk full'))
      log.mockRestore()
    })
  })

  it('returns to the board on Cancel', async () => {
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: 'More for Shop' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit project' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Sync' })).toBeInTheDocument()
  })

  async function deleteProject(): Promise<void> {
    await userEvent.click(await screen.findByRole('button', { name: 'More for Shop' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit project' }))
    await userEvent.click(screen.getByRole('button', { name: /Review/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete project' }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
  }

  it('routes to the first remaining project after deleting the one being viewed', async () => {
    const other = { ...project, id: 'p2', name: 'Other' }
    vi.mocked(api.projects.list).mockResolvedValueOnce([project, other]).mockResolvedValue([other])
    render(<App />)
    await deleteProject()
    await waitFor(() => expect(api.board.get).toHaveBeenLastCalledWith('p2'))
    expect(screen.queryByRole('heading', { name: 'Edit Shop' })).not.toBeInTheDocument()
  })

  it('routes to the add-project flow after deleting the last project', async () => {
    vi.mocked(api.projects.list).mockResolvedValueOnce([project]).mockResolvedValue([])
    render(<App />)
    await deleteProject()
    expect(await screen.findByRole('heading', { name: 'Add project' })).toBeInTheDocument()
  })

  it('opens the setup guide at a missing tool instead of the app', async () => {
    vi.mocked(api.app.tools).mockResolvedValue({
      ok: false,
      missing: ['tmux'],
      paths: {},
      claudeSignedIn: true,
      accounts: [],
      gh: { loggedIn: true, scopes: ['repo', 'project'] },
      linear: true,
      linearWorkspaces: [],
      jira: true,
      jiraSites: []
    })
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'tmux and git' })).toBeInTheDocument()
    expect(screen.getByText('brew install tmux')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sync' })).not.toBeInTheDocument()
    vi.mocked(api.app.tools).mockResolvedValue({
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
    })
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Continue' }))
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(await screen.findByRole('button', { name: 'Sync' })).toBeInTheDocument()
  })

  it('opens Settings over the setup guide and goes back to it', async () => {
    let openSettings = (): void => {}
    vi.mocked(api.app.onSettings).mockImplementation((cb) => {
      openSettings = cb
      return () => {}
    })
    vi.mocked(api.projects.list).mockResolvedValue([])
    render(<App />)
    await screen.findByRole('heading', { name: 'tmux and git' })
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByText('Step 2 of 6')).toBeInTheDocument()
    act(() => openSettings())
    expect(await screen.findByRole('radiogroup', { name: 'Appearance' })).toBeInTheDocument()
    expect(screen.getByText('Step 2 of 6')).not.toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('Step 2 of 6')).toBeInTheDocument()
  })

  it('opens the guide on first run and hands off to Add project', async () => {
    vi.mocked(api.projects.list).mockResolvedValue([])
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'tmux and git' })).toBeInTheDocument()
    expect(screen.getByText('Step 1 of 6')).toBeInTheDocument()
    await finishSetup()
    expect(await screen.findByRole('heading', { name: 'Add project' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
  })

  it('waits for the tool check on first run instead of showing Add project', async () => {
    let resolve: (check: ToolCheck) => void = () => {}
    vi.mocked(api.projects.list).mockResolvedValue([])
    vi.mocked(api.app.tools).mockReturnValue(new Promise((r) => (resolve = r)))
    render(<App />)
    await waitFor(() => expect(api.projects.list).toHaveBeenCalled())
    await act(async () => {})
    expect(screen.queryByRole('heading', { name: 'Add project' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add project' })).not.toBeInTheDocument()
    await act(async () =>
      resolve({
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
      })
    )
    expect(await screen.findByRole('heading', { name: 'tmux and git' })).toBeInTheDocument()
    await finishSetup()
    expect(await screen.findByRole('heading', { name: 'Add project' })).toBeInTheDocument()
  })

  const passing: ToolCheck = {
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

  it.each([
    ['the guide', { ...passing, ok: false, missing: ['tmux' as const] }, 'tmux and git'],
    ['the board', passing, null]
  ])(
    'shows Checking setup on a later start until the check resolves, then %s',
    async (_, check, heading) => {
      let resolve: (check: ToolCheck) => void = () => {}
      vi.mocked(api.board.get).mockResolvedValue(boardView({ tickets: [ticket(1)] }))
      vi.mocked(api.app.tools).mockReturnValue(new Promise((r) => (resolve = r)))
      render(<App />)
      expect(await screen.findByText('Checking setup…')).toBeInTheDocument()
      await waitFor(() => expect(api.projects.list).toHaveBeenCalled())
      await act(async () => {})
      expect(screen.queryByText('Ticket 1')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Sync' })).not.toBeInTheDocument()
      await act(async () => resolve(check))
      if (heading) expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
      else expect(await screen.findByText('Ticket 1')).toBeInTheDocument()
      expect(screen.queryByText('Checking setup…')).not.toBeInTheDocument()
    }
  )

  it('stops Checking setup when the projects fail to load', async () => {
    vi.mocked(api.projects.list).mockRejectedValue(new Error('store unreadable'))
    render(<App />)
    await waitFor(() => expect(screen.queryByText('Checking setup…')).not.toBeInTheDocument())
  })

  it('ignores a check that resolves after its effect was cleaned up', async () => {
    const resolvers: ((check: ToolCheck) => void)[] = []
    vi.mocked(api.app.tools).mockImplementation(() => new Promise((r) => resolvers.push(r)))
    render(<App />, { reactStrictMode: true })
    await waitFor(() => expect(resolvers).toHaveLength(2))
    await act(async () => resolvers[1](passing))
    expect(await screen.findByRole('button', { name: 'Sync' })).toBeInTheDocument()
    await act(async () => resolvers[0]({ ...passing, ok: false, missing: ['tmux'] }))
    expect(screen.queryByText('Set up Sandtable')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sync' })).toBeInTheDocument()
  })

  it('skips the guide on a later start with only a warning', async () => {
    vi.mocked(api.app.tools).mockResolvedValue({
      ok: true,
      missing: [],
      paths: {},
      claudeSignedIn: true,
      accounts: [],
      gh: { loggedIn: true, scopes: ['repo'] },
      linear: true,
      linearWorkspaces: [],
      jira: true,
      jiraSites: []
    })
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Sync' })).toBeInTheDocument()
    expect(screen.queryByText('Set up Sandtable')).not.toBeInTheDocument()
  })

  it('shows the guide with the error when the check fails', async () => {
    vi.mocked(api.app.tools).mockRejectedValue(
      new Error("Error invoking remote method 'app.tools': Error: boom")
    )
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
    expect(screen.getByText('Set up Sandtable')).toBeInTheDocument()
  })

  it('hides the sidebar through main and keeps the Needs you count beside Show sidebar', async () => {
    let onFrame: (frame: WindowFrame) => void = () => {}
    vi.mocked(api.app.onFrame).mockImplementation((cb) => {
      onFrame = cb
      return () => {}
    })
    vi.mocked(api.projects.list).mockResolvedValue([
      project,
      { ...project, id: 'p2', name: 'Other' }
    ])
    vi.mocked(api.board.get).mockResolvedValue(
      boardView({ needsYou: { p1: 2, p2: 1, removed: 4 } })
    )
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: 'Hide sidebar' }))
    expect(api.app.setSidebarHidden).toHaveBeenCalledWith(true)
    expect(screen.queryByRole('button', { name: 'Show sidebar' })).not.toBeInTheDocument()

    act(() => onFrame({ sidebarHidden: true, sidebarWidth: 224, fullScreen: false }))
    expect(screen.getByRole('navigation', { hidden: true })).toHaveAttribute('inert')
    expect(screen.getByText('3 need you')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Show sidebar' }))
    expect(api.app.setSidebarHidden).toHaveBeenLastCalledWith(false)

    act(() => onFrame({ sidebarHidden: false, sidebarWidth: 224, fullScreen: false }))
    expect(screen.getByRole('navigation')).not.toHaveAttribute('inert')
    expect(screen.queryByRole('button', { name: 'Show sidebar' })).not.toBeInTheDocument()
  })

  it('opens the sidebar at the saved width and saves a resize through main', async () => {
    vi.mocked(api.app.frame).mockResolvedValue({
      sidebarHidden: false,
      sidebarWidth: 300,
      fullScreen: false
    })
    render(<App />)
    const handle = await screen.findByRole('separator', { name: 'Resize sidebar' })
    await waitFor(() => expect(handle).toHaveAttribute('aria-valuenow', '300'))
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(api.app.setSidebarWidth).toHaveBeenCalledWith(316)
    expect(screen.getByRole('navigation')).toHaveStyle({ width: '316px' })
  })

  it('opens with the sidebar hidden when main says so', async () => {
    vi.mocked(api.app.frame).mockResolvedValue({
      sidebarHidden: true,
      sidebarWidth: 224,
      fullScreen: false
    })
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Show sidebar' })).toBeInTheDocument()
    expect(screen.queryByText(/needs? you$/)).not.toBeInTheDocument()
  })

  it('leaves room for the window controls only where they sit over a header', async () => {
    vi.mocked(api.app.frame).mockResolvedValue({
      sidebarHidden: true,
      sidebarWidth: 224,
      fullScreen: true
    })
    render(<App />)
    await screen.findByRole('button', { name: 'Show sidebar' })
    expect(screen.getByRole('banner')).not.toHaveClass('pl-22')
  })

  describe('Back and Forward', () => {
    const other = { ...project, id: 'p2', name: 'Other' }
    const heading = (name: string): Promise<HTMLElement> => screen.findByRole('heading', { name })

    beforeEach(() => {
      vi.mocked(api.projects.list).mockResolvedValue([project, other])
    })

    it('goes through the screens you visited with the buttons, disabled at each end', async () => {
      render(<App />)
      await heading('Shop')
      const back = screen.getByRole('button', { name: 'Go back' })
      const forward = screen.getByRole('button', { name: 'Go forward' })
      expect(back).toBeDisabled()
      expect(forward).toBeDisabled()

      await userEvent.click(screen.getByRole('button', { name: 'Other' }))
      await userEvent.click(screen.getByRole('button', { name: 'Usage' }))
      await userEvent.click(back)
      await heading('Other')
      await userEvent.click(back)
      await heading('Shop')
      expect(back).toBeDisabled()
      await userEvent.click(forward)
      await heading('Other')
      await userEvent.click(forward)
      await heading('Usage')
      expect(forward).toBeDisabled()
    })

    it('goes back and forward with Command-[ and Command-] and the mouse side buttons', async () => {
      render(<App />)
      await heading('Shop')
      await userEvent.click(screen.getByRole('button', { name: 'Other' }))
      await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
      fireEvent.keyDown(window, { key: '[', metaKey: true })
      await heading('Other')
      fireEvent.mouseUp(window, { button: 3 })
      await heading('Shop')
      fireEvent.mouseUp(window, { button: 4 })
      await heading('Other')
      fireEvent.keyDown(window, { key: ']', metaKey: true })
      await heading('Settings')
    })

    it('goes back and forward with brackets typed with Option held, as on a Norwegian layout', async () => {
      render(<App />)
      await heading('Shop')
      await userEvent.click(screen.getByRole('button', { name: 'Other' }))
      fireEvent.keyDown(window, { key: '[', code: 'Digit8', metaKey: true, altKey: true })
      await heading('Shop')
      fireEvent.keyDown(window, { key: ']', code: 'Digit9', metaKey: true, altKey: true })
      await heading('Other')
      fireEvent.keyDown(window, { key: '“', code: 'BracketLeft', metaKey: true, altKey: true })
      fireEvent.keyDown(window, { key: 'å', code: 'BracketLeft', metaKey: true })
      expect(screen.getByRole('heading', { name: 'Other' })).toBeInTheDocument()
    })

    it('goes back and forward with a left or right swipe, as Logi Options+ sends', async () => {
      let onSwipe: (direction: string) => void = () => {}
      vi.mocked(api.app.onSwipe).mockImplementation((cb) => {
        onSwipe = cb
        return () => {}
      })
      render(<App />)
      await heading('Shop')
      await userEvent.click(screen.getByRole('button', { name: 'Other' }))
      act(() => onSwipe('left'))
      await heading('Shop')
      act(() => onSwipe('right'))
      await heading('Other')
    })

    it('puts Go back and Go forward after Hide sidebar at the end of the sidebar strip', async () => {
      render(<App />)
      const hide = await screen.findByRole('button', { name: 'Hide sidebar' })
      const back = screen.getByRole('button', { name: 'Go back' })
      const forward = screen.getByRole('button', { name: 'Go forward' })
      expect(hide.compareDocumentPosition(back) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(back.compareDocumentPosition(forward) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('drops the forward screens when you move somewhere else after going back', async () => {
      render(<App />)
      await heading('Shop')
      await userEvent.click(screen.getByRole('button', { name: 'Other' }))
      await userEvent.click(screen.getByRole('button', { name: 'Go back' }))
      await heading('Shop')
      await userEvent.click(screen.getByRole('button', { name: 'Usage' }))
      expect(screen.getByRole('button', { name: 'Go forward' })).toBeDisabled()
    })

    it("doesn't add a step for a tab switch inside a ticket", async () => {
      const t = ticket(1)
      vi.mocked(api.board.get).mockResolvedValue(
        boardView({ tickets: [t], sessions: [session(t.key, { state: 'finished' })] })
      )
      render(<App />)
      await userEvent.click(await screen.findByText('Ticket 1'))
      await userEvent.click(await screen.findByRole('tab', { name: 'Details' }))
      await userEvent.click(screen.getByRole('tab', { name: 'Conversation' }))
      await userEvent.click(screen.getByRole('button', { name: 'Go back' }))
      await heading('Shop')
    })

    it("treats Settings' own Back as going back, so Go back doesn't reopen it", async () => {
      render(<App />)
      await heading('Shop')
      await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
      await userEvent.click(screen.getByRole('button', { name: 'Back' }))
      await heading('Shop')
      expect(screen.getByRole('button', { name: 'Go back' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Go forward' })).toBeEnabled()
    })

    it('keeps Usage open when the ticket behind it switches tab on its own', async () => {
      const listeners: ((projectId: string) => void)[] = []
      vi.mocked(api.board.onChange).mockImplementation((cb) => {
        listeners.push(cb)
        return () => {}
      })
      const t = ticket(1)
      vi.mocked(api.board.get).mockResolvedValue(boardView({ tickets: [t] }))
      render(<App />)
      await userEvent.click(await screen.findByText('Ticket 1'))
      await userEvent.click(await screen.findByRole('tab', { name: 'Details' }))
      await userEvent.click(screen.getByRole('button', { name: 'Usage' }))
      vi.mocked(api.board.get).mockResolvedValue(
        boardView({ tickets: [t], sessions: [session(t.key, { state: 'running' })] })
      )
      act(() => listeners.forEach((cb) => cb(project.id)))
      await waitFor(() => expect(screen.getAllByText('Running').length).toBeGreaterThan(0))
      await waitFor(() =>
        expect(api.app.saveView).toHaveBeenLastCalledWith(
          expect.objectContaining({ tab: 'conversation' })
        )
      )
      expect(screen.getByRole('heading', { name: 'Usage', level: 1 })).toBeInTheDocument()
    })

    it('skips a session that ended', async () => {
      let open: (view: LastView) => void = () => {}
      vi.mocked(api.app.onOpen).mockImplementation((cb) => {
        open = cb
        return () => {}
      })
      vi.mocked(api.board.get).mockResolvedValue(boardView({ sessions: [adhoc()] }))
      render(<App />)
      await heading('Shop')
      act(() => open({ projectId: project.id, sessionId: 'a1' }))
      await heading('Oct 24, 10:00')
      await userEvent.click(screen.getByRole('button', { name: 'Other' }))
      vi.mocked(api.board.get).mockResolvedValue(
        boardView({ sessions: [adhoc({ state: 'finished', removedAt: '2026-10-24T11:00:00Z' })] })
      )
      await userEvent.click(screen.getByRole('button', { name: 'Go back' }))
      await heading('Shop')
      expect(screen.getByRole('button', { name: 'Go back' })).toBeDisabled()
    })

    it('skips a removed project, then disables Go back with nothing left to reach', async () => {
      vi.mocked(api.projects.list)
        .mockReset()
        .mockResolvedValueOnce([project, other])
        .mockResolvedValue([other])
      render(<App />)
      await heading('Shop')
      await userEvent.click(screen.getByRole('button', { name: 'Other' }))
      await userEvent.click(screen.getByRole('button', { name: 'Shop' }))
      await deleteProject()
      await heading('Other')
      await waitFor(() => expect(screen.getByRole('button', { name: 'Go back' })).toBeEnabled())
      await userEvent.click(screen.getByRole('button', { name: 'Go back' }))
      await waitFor(() => expect(screen.getByRole('button', { name: 'Go back' })).toBeDisabled())
      expect(screen.getByRole('heading', { name: 'Other' })).toBeInTheDocument()
    })
  })

  it('leaves room for the window controls on the setup guide', async () => {
    vi.mocked(api.projects.list).mockResolvedValue([])
    render(<App />)
    await screen.findByRole('heading', { name: 'Set up Sandtable' })
    expect(screen.getByRole('banner')).toHaveClass('pl-22')
  })
})

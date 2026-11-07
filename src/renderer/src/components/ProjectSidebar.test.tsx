import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelUsage, Routine } from '../../../shared/types'
import { adhoc, fakeSandtable, project } from '../test/fixtures'
import { ProjectSidebar } from './ProjectSidebar'

const other = { ...project, id: 'p2', name: 'Sandtable' }

const sidebar = (
  over: Partial<React.ComponentProps<typeof ProjectSidebar>> = {}
): React.JSX.Element => (
  <ProjectSidebar
    projects={[project, other]}
    selectedId="p1"
    needsYou={{}}
    sessions={[]}
    openSessionId={null}
    openTicketKey={null}
    onSelect={vi.fn()}
    onAdd={vi.fn()}
    onEdit={vi.fn()}
    onOpenSession={vi.fn()}
    onOpenTicket={vi.fn()}
    onNewSession={vi.fn()}
    onSettings={vi.fn()}
    onUsage={vi.fn()}
    onRoutine={vi.fn()}
    groups={[]}
    onArrange={vi.fn()}
    {...over}
  />
)

function Arranged(over: Partial<React.ComponentProps<typeof ProjectSidebar>>): React.JSX.Element {
  const [state, setState] = useState({
    projects: over.projects ?? [project, other],
    groups: over.groups ?? []
  })
  return sidebar({
    ...over,
    ...state,
    onArrange: (projects, groups) => setState({ projects, groups })
  })
}

const usage = (input: number, price: number | null): ModelUsage => ({
  model: 'm',
  name: null,
  input,
  output: 0,
  cacheWrite: 0,
  cacheRead: 0,
  price
})

const triage = adhoc({ id: 'a2', projectId: 'p2', name: 'Triage', state: 'finished' })

describe('ProjectSidebar', () => {
  beforeEach(() => {
    localStorage.clear()
    fakeSandtable()
  })

  it('resizes from the separator by pointer, arrow keys, and double-click, within the range', () => {
    const onResize = vi.fn()
    render(sidebar({ width: 300, onResize }))
    const handle = screen.getByRole('separator', { name: 'Resize sidebar' })
    expect(handle).toHaveAttribute('aria-valuenow', '300')
    expect(handle).toHaveAttribute('aria-controls', screen.getByRole('navigation').id)

    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1, button: 2 })
    fireEvent.pointerMove(handle, { clientX: 150, pointerId: 1 })
    expect(onResize).not.toHaveBeenCalled()
    expect(screen.getByRole('navigation')).toHaveStyle({ width: '300px' })

    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 150, pointerId: 1 })
    expect(onResize).toHaveBeenLastCalledWith(350)
    fireEvent.pointerMove(handle, { clientX: 400, pointerId: 1 })
    expect(onResize).toHaveBeenLastCalledWith(400)
    fireEvent.lostPointerCapture(handle, { pointerId: 1 })
    onResize.mockClear()
    fireEvent.pointerMove(handle, { clientX: 0, pointerId: 1 })
    expect(onResize).not.toHaveBeenCalled()

    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(onResize).toHaveBeenLastCalledWith(284)
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(onResize).toHaveBeenLastCalledWith(316)
    fireEvent.doubleClick(handle)
    expect(onResize).toHaveBeenLastCalledWith(224)
  })

  it('slides out by its own width while hidden', () => {
    render(sidebar({ width: 300, hidden: true, onResize: vi.fn() }))
    expect(screen.getByRole('navigation', { hidden: true })).toHaveStyle({ marginLeft: '-300px' })
  })

  it('says Keeping your Mac awake only while the sleep block is on', async () => {
    const api = fakeSandtable()
    let onAwake: (active: boolean) => void = () => {}
    vi.mocked(api.app.onAwake).mockImplementation((cb) => {
      onAwake = cb
      return () => {}
    })
    vi.mocked(api.app.awake).mockResolvedValue(true)
    render(sidebar())
    expect(await screen.findByText('Keeping your Mac awake')).toBeInTheDocument()
    expect(
      screen.getAllByRole('status').filter((s) => s.textContent === 'Keeping your Mac awake')
    ).toHaveLength(1)
    act(() => onAwake(false))
    expect(screen.queryByText('Keeping your Mac awake')).not.toBeInTheDocument()
    act(() => onAwake(true))
    expect(screen.getByText('Keeping your Mac awake')).toBeInTheDocument()
  })

  it('selects a project by its name and shows its Needs you count as a number', async () => {
    const onSelect = vi.fn()
    render(sidebar({ needsYou: { p2: 3, p1: 1 }, onSelect }))
    expect(screen.getByRole('img', { name: '3 need you' })).toHaveTextContent(/^3$/)
    expect(screen.getByRole('img', { name: '1 needs you' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Sandtable' }))
    expect(onSelect).toHaveBeenCalledWith('p2')
  })

  it('has Add project beside the Projects heading, which names the list', async () => {
    const onAdd = vi.fn()
    render(sidebar({ onAdd }))
    expect(screen.getByRole('heading', { level: 2, name: 'Projects' })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Projects' })).toBeInTheDocument()
    const add = screen.getByRole('button', { name: 'Add project' })
    await userEvent.click(add)
    expect(onAdd).toHaveBeenCalled()
  })

  it('adds asking or capped after Needs you, and nothing else', () => {
    render(
      sidebar({
        sessions: [
          adhoc({ id: 'a1', name: 'Asks', state: 'needsYou', asking: true }),
          adhoc({ id: 'a2', name: 'Capped', state: 'needsYou', capped: true }),
          adhoc({ id: 'a3', name: 'Runs', state: 'running', capped: true })
        ]
      })
    )
    expect(screen.getByRole('button', { name: /^Asks/ })).toHaveTextContent(/Needs you\s*asking/)
    expect(screen.getByRole('button', { name: /^Capped/ })).toHaveTextContent(/Needs you\s*capped/)
    expect(screen.getByRole('button', { name: /^Runs/ })).not.toHaveTextContent(/asking|capped/)
  })

  it("opens and closes a project's sessions with its tile toggle", async () => {
    render(sidebar({ sessions: [triage] }))
    const toggle = screen.getByRole('button', { name: 'Show sessions of Sandtable' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveTextContent('S')
    expect(screen.queryByRole('button', { name: /Triage/ })).not.toBeInTheDocument()
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveAccessibleName('Hide sessions of Sandtable')
    expect(screen.getByRole('button', { name: /Triage/ })).toHaveTextContent('Finished')
    await userEvent.click(toggle)
    expect(screen.queryByRole('button', { name: /Triage/ })).not.toBeInTheDocument()
  })

  it('shows the first character of the name on the tile, even an emoji', () => {
    render(sidebar({ projects: [{ ...project, name: '🚀 rocket' }] }))
    expect(screen.getByRole('button', { name: /sessions of 🚀 rocket/ })).toHaveTextContent(/^🚀$/)
  })

  it("shows the project's icon on the tile instead of the letter when it has one", () => {
    render(sidebar({ projects: [{ ...project, icon: '🦊' }, other] }))
    expect(screen.getByRole('button', { name: /sessions of Shop/ })).toHaveTextContent(/^🦊$/)
    expect(screen.getByRole('button', { name: /sessions of Sandtable/ })).toHaveTextContent(/^S$/)
  })

  it('reaches the tile, the name, and More by Tab, and More back by Shift+Tab', async () => {
    render(sidebar({ selectedId: null }))
    screen.getByRole('button', { name: 'Show sessions of Shop' }).focus()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Shop' })).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'More for Shop' })).toHaveFocus()
    screen.getByRole('button', { name: 'Show sessions of Sandtable' }).focus()
    await userEvent.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'More for Shop' })).toHaveFocus()
  })

  it('marks the selected project current when it closes over its open session', async () => {
    render(sidebar({ sessions: [adhoc()], openSessionId: 'a1' }))
    expect(screen.getByRole('button', { name: 'Shop' })).not.toHaveAttribute('aria-current')
    await userEvent.click(screen.getByRole('button', { name: 'Hide sessions of Shop' }))
    expect(screen.getByRole('button', { name: 'Shop' })).toHaveAttribute('aria-current', 'page')
  })

  it('clears Needs you from a session row without opening the session', async () => {
    const api = fakeSandtable()
    const onOpenSession = vi.fn()
    render(
      sidebar({
        sessions: [adhoc({ state: 'needsYou' }), adhoc({ id: 'a3', name: 'Other' })],
        onOpenSession
      })
    )
    const clear = screen.getByRole('button', { name: 'Clear Needs you for Oct 24, 10:00' })
    expect(clear).not.toHaveAttribute('title')
    expect(screen.queryByRole('button', { name: /Clear Needs you for Other/ })).toBeNull()
    expect(clear.parentElement?.closest('button')).toBeNull()
    await userEvent.click(clear)
    expect(api.sessions.clearNeedsYou).toHaveBeenCalledWith('a1')
    expect(onOpenSession).not.toHaveBeenCalled()
  })

  it('keeps the same trailing slot on every session row, so the chips line up', () => {
    render(
      sidebar({ sessions: [adhoc({ state: 'needsYou' }), adhoc({ id: 'a3', name: 'Other' })] })
    )
    const rows = ['Oct 24, 10:00', 'Other'].map(
      (name) => screen.getByRole('button', { name: new RegExp(`^${name}`) }).parentElement!
    )
    expect(rows.map((r) => r.children.length)).toEqual([2, 2])
  })

  it('logs a failed clear from a session row', async () => {
    const api = fakeSandtable()
    const failure = new Error('disk full')
    vi.mocked(api.sessions.clearNeedsYou).mockRejectedValue(failure)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(sidebar({ sessions: [adhoc({ state: 'needsYou' })] }))
    await userEvent.click(screen.getByRole('button', { name: /^Clear Needs you for/ }))
    await vi.waitFor(() => expect(log).toHaveBeenCalledWith(failure))
    log.mockRestore()
  })

  it("doesn't save a selected ID that isn't a project", () => {
    render(sidebar({ selectedId: 'new' }))
    expect(JSON.parse(localStorage.getItem('sandtable.openProjects') ?? '[]')).toEqual([])
  })

  it('opens the selected project', () => {
    render(sidebar())
    expect(screen.getByRole('button', { name: 'Hide sessions of Shop' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
  })

  it('remembers which projects are open across launches', async () => {
    const first = render(sidebar({ sessions: [triage] }))
    await userEvent.click(screen.getByRole('button', { name: 'Show sessions of Sandtable' }))
    await userEvent.click(screen.getByRole('button', { name: 'Hide sessions of Shop' }))
    expect(JSON.parse(localStorage.getItem('sandtable.openProjects') ?? '[]')).toEqual(['p2'])
    first.unmount()
    render(sidebar({ sessions: [triage], selectedId: null }))
    expect(screen.getByRole('button', { name: 'Hide sessions of Sandtable' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
    expect(screen.getByRole('button', { name: /Triage/ })).toBeInTheDocument()
  })

  it.each(['{nope', '{"a":1}'])('ignores a malformed saved open state: %s', (saved) => {
    localStorage.setItem('sandtable.openProjects', saved)
    render(sidebar({ selectedId: null }))
    expect(screen.getByRole('button', { name: 'Show sessions of Shop' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show sessions of Sandtable' })).toBeInTheDocument()
  })

  it('keeps the valid IDs of a saved open state', () => {
    localStorage.setItem('sandtable.openProjects', '[1,"p2"]')
    render(sidebar({ selectedId: null }))
    expect(screen.getByRole('button', { name: 'Hide sessions of Sandtable' })).toBeInTheDocument()
  })

  it("lists an open project's sessions with their state words and New session", async () => {
    const onOpenSession = vi.fn()
    const onNewSession = vi.fn()
    localStorage.setItem('sandtable.openProjects', JSON.stringify(['p2']))
    render(
      sidebar({
        sessions: [adhoc(), triage],
        openSessionId: 'a2',
        onOpenSession,
        onNewSession
      })
    )
    expect(screen.getByRole('button', { name: /Oct 24, 10:00/ })).toHaveTextContent('Running')
    const open = screen.getByRole('button', { name: /Triage/ })
    expect(open).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Shop' })).not.toHaveAttribute('aria-current')
    await userEvent.click(open)
    expect(onOpenSession).toHaveBeenCalledWith('p2', 'a2')
    const [, second] = screen.getAllByRole('button', { name: 'New session' })
    await userEvent.click(second)
    expect(onNewSession).toHaveBeenCalledWith('p2')
  })

  it('lists ticket sessions by number and title, and opens the ticket from the row', async () => {
    const onOpenTicket = vi.fn()
    const sessions = [
      adhoc({ id: 's1', ticketKey: 'o/shop#147', name: 'Dark mode toggle', state: 'needsYou' }),
      adhoc({ id: 's2', ticketKey: 'APP-7', name: 'Rate limits', state: 'idle' }),
      adhoc({ id: 's3', projectId: 'p2', ticketKey: 'o/shop#147', name: 'Dark mode toggle' })
    ]
    localStorage.setItem('sandtable.openProjects', JSON.stringify(['p2']))
    render(sidebar({ sessions, openTicketKey: 'o/shop#147', onOpenTicket }))
    const [row, sameKey] = screen.getAllByRole('button', { name: /#147.*Dark mode toggle/ })
    expect(sameKey).not.toHaveAttribute('aria-current')
    expect(row).toHaveTextContent('Needs you')
    expect(row).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Shop' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('button', { name: /APP-7.*Rate limits/ })).toHaveTextContent('Idle')
    expect(
      screen.getByRole('button', { name: 'Clear Needs you for Dark mode toggle' })
    ).toBeVisible()
    row.focus()
    await userEvent.keyboard('{Enter}')
    expect(onOpenTicket).toHaveBeenCalledWith('p1', 'o/shop#147')
  })

  it('shows Reviewing on its row with a pulsing icon and no Clear Needs you', () => {
    render(sidebar({ sessions: [adhoc({ name: 'Rate limits', state: 'reviewing' })] }))
    const row = screen.getByRole('button', { name: /Rate limits.*Reviewing/ })
    expect(within(row).getByText('Reviewing').parentElement).toHaveClass('[&>svg]:soft-pulse')
    expect(screen.queryByRole('button', { name: /Clear Needs you/ })).toBeNull()
  })

  it('shows Done, session open on its row with no Clear Needs you', () => {
    const shipped = adhoc({ ticketKey: 'o/shop#2', name: 'Shipped', state: 'needsYou' })
    render(sidebar({ sessions: [{ ...shipped, done: true }] }))
    const row = screen.getByRole('button', { name: /#2.*Shipped.*Done, session open/ })
    expect(within(row).getByText('Done', { exact: true })).toBeVisible()
    expect(screen.queryByRole('button', { name: /Clear Needs you/ })).toBeNull()
  })

  it("names no step on a running session's row or its tooltip", async () => {
    const api = fakeSandtable()
    vi.mocked(api.sessions.activity).mockResolvedValue({
      steps: [{ tool: 'Edit', target: 'src/main/orchestrator.ts', at: null }],
      since: null
    })
    render(sidebar({ sessions: [adhoc()] }))
    const row = screen.getByRole('button', { name: /Oct 24, 10:00/ })
    await act(async () => {})
    await userEvent.hover(row)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Oct 24, 10:00 — Running')
    expect(screen.getByRole('tooltip')).not.toHaveTextContent('Editing')
    expect(row).not.toHaveTextContent('Editing')
  })

  it("adds a live session's tokens and estimate to its row's tooltip", async () => {
    const api = fakeSandtable()
    vi.mocked(api.sessions.liveUsage).mockResolvedValue({ a1: [usage(8.4e6, 6.12)] })
    render(sidebar({ sessions: [adhoc({ state: 'idle' })] }))
    const row = screen.getByRole('button', { name: /Oct 24, 10:00/ })
    await act(async () => {})
    await userEvent.hover(row)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Oct 24, 10:00 — Idle 8.4M tokens · $6.12 API estimate'
    )
  })

  it("adds a capped session's state to its row's tooltip, with no Clear Needs you", async () => {
    const api = fakeSandtable()
    vi.mocked(api.sessions.liveUsage).mockResolvedValue({ a1: [usage(8.4e6, 6.12)] })
    render(sidebar({ sessions: [adhoc({ state: 'needsYou', capped: true })] }))
    const row = screen.getByRole('button', { name: /Oct 24, 10:00/ })
    await act(async () => {})
    await userEvent.hover(row)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Oct 24, 10:00 — Needs you 8.4M tokens · $6.12 API estimate Reached its token cap'
    )
    expect(screen.queryByRole('button', { name: /Clear Needs you/ })).toBeNull()
  })

  it("marks a row tooltip's estimate with * when a model has no price", async () => {
    const api = fakeSandtable()
    vi.mocked(api.sessions.liveUsage).mockResolvedValue({
      a1: [usage(8.4e6, 6.12), { ...usage(1e6, null), model: 'x' }]
    })
    render(sidebar({ sessions: [adhoc({ state: 'idle' })] }))
    await act(async () => {})
    await userEvent.hover(screen.getByRole('button', { name: /Oct 24, 10:00/ }))
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Oct 24, 10:00 — Idle 9.4M tokens · $6.12* API estimate'
    )
  })

  it('shows Live now with the total of the live sessions, and each one on hover and focus', async () => {
    const api = fakeSandtable()
    vi.mocked(api.sessions.liveUsage).mockResolvedValue({
      gone: [usage(99e6, 99)],
      a1: [usage(8.4e6, 6.12)],
      a2: [usage(2.1e6, 1.5)]
    })
    const sessions = [
      adhoc({ id: 'a1', ticketKey: 'o/shop#174', name: 'Show live token spend' }),
      adhoc({ id: 'a2', name: 'Release notes' })
    ]
    render(sidebar({ sessions }))
    const meter = await screen.findByRole('group', {
      name: 'Live now: 109.5M tokens, $106.62 API estimate'
    })
    expect(meter).toHaveTextContent('Live now109.5M · $106.62 API estimate')
    expect(meter).toHaveAttribute('tabIndex', '0')
    act(() => meter.focus())
    const tip = within(await screen.findByRole('tooltip'))
    expect(tip.getByText('#174')).toHaveClass('font-mono')
    expect(tip.getByText('Show live token spend')).toBeInTheDocument()
    expect(tip.getByText('Release notes')).toBeInTheDocument()
    expect(tip.getByText('2.1M')).toBeInTheDocument()
    const rows = tip.getAllByRole('listitem')
    expect(rows.map((r) => r.textContent)).toEqual([
      '#174Show live token spend8.4M$6.12 API estimate',
      'Release notes2.1M$1.50 API estimate',
      'Session not on the board99M$99.00 API estimate'
    ])
    expect(tip.getByText(/Share of tokens across live sessions/)).toHaveTextContent(
      'Share of tokens across live sessions. API price estimate, not what you paid.'
    )
  })

  it('names the unpriced caveat on Live now and shows a session with no price as tokens only', async () => {
    const api = fakeSandtable()
    vi.mocked(api.sessions.liveUsage).mockResolvedValue({
      a1: [usage(8.4e6, 6.12)],
      a2: [usage(2.1e6, null)]
    })
    const sessions = [adhoc({ id: 'a1', name: 'Priced' }), adhoc({ id: 'a2', name: 'Unpriced' })]
    render(sidebar({ sessions }))
    const meter = await screen.findByRole('group', {
      name: 'Live now: 10.5M tokens, $6.12 API estimate, leaves out a model with no price'
    })
    act(() => meter.focus())
    const tip = within(await screen.findByRole('tooltip'))
    const row = tip.getByText('Unpriced').closest('li')
    expect(row).toHaveTextContent(/^Unpriced2.1M$/)
  })

  it('shows no Live now without live tokens', async () => {
    render(sidebar({ sessions: [adhoc()] }))
    await act(async () => {})
    expect(screen.queryByText('Live now')).toBeNull()
  })

  it("shows a session row's full title and state word on hover and focus", async () => {
    const sessions = [
      adhoc({ id: 's1', ticketKey: 'o/shop#2', name: 'A very long ticket title', state: 'idle' }),
      { ...adhoc({ id: 's2', name: 'Shipped' }), done: true as const }
    ]
    render(sidebar({ sessions }))
    const row = screen.getByRole('button', { name: /#2.*A very long ticket title.*Idle/ })
    await userEvent.hover(row)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('A very long ticket title — Idle')
    await userEvent.unhover(row)
    row.focus()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: /Shipped/ })).toHaveFocus()
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Shipped — Done, session open')
  })

  it("counts a collapsed project's sessions per state, in words", async () => {
    const sessions = [
      adhoc({ id: 'a1', state: 'running' }),
      adhoc({ id: 'a6', state: 'reviewing' }),
      adhoc({ id: 'a7', state: 'reviewing' }),
      adhoc({ id: 'a2', state: 'idle' }),
      adhoc({ id: 'a3', state: 'idle' }),
      adhoc({ id: 'a5', routineId: 'r1', state: 'done' }),
      adhoc({ id: 'a8', state: 'limitReached' }),
      { ...adhoc({ id: 'a4', ticketKey: 'o/shop#2', state: 'needsYou' }), done: true as const }
    ]
    render(sidebar({ sessions, needsYou: { p1: 1 } }))
    expect(screen.queryByRole('img', { name: '1 running' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Hide sessions of Shop' }))
    expect(screen.getAllByRole('img').map((i) => i.getAttribute('aria-label'))).toEqual([
      '1 needs you',
      '1 running',
      '2 reviewing',
      '2 idle',
      '1 done',
      '1 done, session open',
      '1 at its limit'
    ])
  })

  it("lists a collapsed project's titles per state on a count chip's hover and focus", async () => {
    const sessions = [
      adhoc({ id: 'a1', name: 'Rate limits', state: 'idle' }),
      adhoc({ id: 'a2', name: 'Dark mode', state: 'idle' }),
      adhoc({ id: 'a3', name: 'Login', state: 'needsYou' })
    ]
    render(sidebar({ sessions, needsYou: { p1: 1 } }))
    await userEvent.click(screen.getByRole('button', { name: 'Hide sessions of Shop' }))
    const idle = screen.getByRole('img', { name: '2 idle' })
    await userEvent.hover(idle)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('2 idle Rate limits Dark mode')
    await userEvent.unhover(idle)
    screen.getByRole('button', { name: 'More for Shop' }).focus()
    await userEvent.tab()
    expect(screen.getByRole('img', { name: '1 needs you' })).toHaveFocus()
    expect(await screen.findByRole('tooltip')).toHaveTextContent('1 needs you Login')
  })

  it('offers Edit project and New session in the More menu', async () => {
    const onEdit = vi.fn()
    const onNewSession = vi.fn()
    render(sidebar({ onEdit, onNewSession }))
    await userEvent.click(screen.getByRole('button', { name: 'More for Sandtable' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit project' }))
    expect(onEdit).toHaveBeenCalledWith('p2')
    await userEvent.click(screen.getByRole('button', { name: 'More for Sandtable' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'New session' }))
    expect(onNewSession).toHaveBeenCalledWith('p2')
  })

  it('opens the routine editor from the More menu, new or for a routine', async () => {
    const onRoutine = vi.fn()
    const nightly = {
      id: 'r1',
      projectId: 'p2',
      name: 'nightly',
      repo: 'octo/shop',
      worktree: false,
      message: 'Check'
    }
    vi.mocked(window.sandtable.routines.list).mockResolvedValue([nightly])
    render(sidebar({ onRoutine }))
    await userEvent.click(screen.getByRole('button', { name: 'More for Sandtable' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Routines' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'New routine…' }))
    expect(onRoutine).toHaveBeenCalledWith(other)
    expect(window.sandtable.routines.list).toHaveBeenCalledWith('p2')
    await userEvent.click(screen.getByRole('button', { name: 'More for Sandtable' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Routines' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'nightly' }))
    expect(onRoutine).toHaveBeenLastCalledWith(other, nightly)
  })

  it("doesn't list another project's routines when its answer comes late", async () => {
    let late: (routines: Routine[]) => void = () => undefined
    vi.mocked(window.sandtable.routines.list)
      .mockImplementationOnce(() => new Promise((r) => (late = r)))
      .mockResolvedValueOnce([])
    render(sidebar())
    await userEvent.click(screen.getByRole('button', { name: 'More for Sandtable' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Routines' }))
    await userEvent.keyboard('{Escape}{Escape}')
    await userEvent.click(screen.getByRole('button', { name: 'More for Shop' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Routines' }))
    await screen.findByRole('menuitem', { name: 'New routine…' })
    await act(async () =>
      late([
        {
          id: 'r1',
          projectId: 'p2',
          name: 'nightly',
          repo: 'octo/shop',
          worktree: false,
          message: 'Check'
        }
      ])
    )
    expect(screen.queryByRole('menuitem', { name: 'nightly' })).not.toBeInTheDocument()
  })

  it('marks the project row current when the open session is no longer listed', () => {
    render(sidebar({ sessions: [adhoc()], openSessionId: 'gone' }))
    expect(screen.getByRole('button', { name: 'Shop' })).toHaveAttribute('aria-current', 'page')
  })

  describe('groups', () => {
    const work = { id: 'g1', name: 'Work' }
    const home = { id: 'g2', name: 'Home' }
    const notes = { ...project, id: 'p3', name: 'Notes', group: 'g1' }
    const grouped = [project, { ...other, group: 'g2' }, notes]
    const names = (list: HTMLElement): string[] =>
      within(list)
        .getAllByRole('button', { name: /^(Shop|Sandtable|Notes)$/ })
        .map((b) => b.textContent ?? '')
    const ids = (ps: { id: string }[]): string[] => ps.map((p) => p.id)

    it('lists ungrouped projects under Projects, then each group in order', () => {
      render(sidebar({ projects: grouped, groups: [work, home] }))
      expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
        'Projects',
        'Work',
        'Home'
      ])
      expect(names(screen.getByRole('list', { name: 'Projects' }))).toEqual(['Shop'])
      expect(names(screen.getByRole('list', { name: 'Work' }))).toEqual(['Notes'])
      expect(names(screen.getByRole('list', { name: 'Home' }))).toEqual(['Sandtable'])
    })

    it('says to drag projects into an empty group', () => {
      render(sidebar({ groups: [work] }))
      expect(
        within(screen.getByRole('list', { name: 'Work' })).getByText('Drag projects here')
      ).toBeInTheDocument()
    })

    it('collapses a group to its Needs you total and remembers it across launches', async () => {
      const docs = { ...project, id: 'p4', name: 'Docs', group: 'g1' }
      const first = render(
        sidebar({
          projects: [...grouped, docs],
          groups: [work, home],
          needsYou: { p3: 2, p4: 3, p1: 1 }
        })
      )
      expect(screen.queryByRole('img', { name: '5 need you' })).not.toBeInTheDocument()
      const toggle = screen.getByRole('button', { name: 'Work' })
      expect(toggle).toHaveAttribute('aria-expanded', 'true')
      await userEvent.click(toggle)
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByRole('button', { name: 'Notes' })).not.toBeInTheDocument()
      const total = screen.getByRole('img', { name: '5 need you' })
      expect(total).toHaveTextContent(/^5$/)
      expect(
        screen.getByRole('button', { name: 'More for Work' }).compareDocumentPosition(total) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
      expect(JSON.parse(localStorage.getItem('sandtable.collapsedGroups') ?? '[]')).toEqual(['g1'])
      first.unmount()
      render(sidebar({ projects: grouped, groups: [work, home] }))
      expect(screen.getByRole('button', { name: 'Work' })).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByRole('button', { name: 'Notes' })).not.toBeInTheDocument()
    })

    it('adds a named group at the end with New group, and cancels with Escape or no name', async () => {
      const onArrange = vi.fn()
      render(sidebar({ groups: [work], onArrange }))
      await userEvent.click(screen.getByRole('button', { name: 'New group' }))
      await userEvent.keyboard('{Escape}')
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'New group' }))
      await userEvent.keyboard('{Enter}')
      expect(onArrange).not.toHaveBeenCalled()
      await userEvent.click(screen.getByRole('button', { name: 'New group' }))
      const field = screen.getByRole('textbox', { name: 'New group name' })
      expect(field).toHaveFocus()
      await userEvent.type(field, '  Private {Enter}')
      expect(onArrange).toHaveBeenCalledWith(
        [project, other],
        [work, { id: expect.any(String), name: 'Private' }]
      )
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    })

    it('renames a group from its More menu, not by double-click', async () => {
      const onArrange = vi.fn()
      render(sidebar({ groups: [work, home], onArrange }))
      await userEvent.dblClick(screen.getByRole('button', { name: 'Home' }))
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'More for Work' }))
      await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
      const field = screen.getByRole<HTMLInputElement>('textbox', { name: 'Group name' })
      expect(field).toHaveFocus()
      expect(field).toHaveValue('Work')
      expect([field.selectionStart, field.selectionEnd]).toEqual([0, 4])
      await userEvent.keyboard('Job{Enter}')
      expect(onArrange).toHaveBeenLastCalledWith([project, other], [{ ...work, name: 'Job' }, home])
    })

    it('deletes a group, moving its projects to the end of the ungrouped ones', async () => {
      const onArrange = vi.fn()
      render(sidebar({ projects: grouped, groups: [work, home], onArrange }))
      await userEvent.click(screen.getByRole('button', { name: 'More for Work' }))
      await userEvent.click(screen.getByRole('menuitem', { name: 'Delete group' }))
      const [projects, groups] = onArrange.mock.calls[0]
      expect(ids(projects)).toEqual(['p1', 'p3', 'p2'])
      expect(projects[1]).not.toHaveProperty('group')
      expect(groups).toEqual([home])
    })

    it('forgets that a deleted group was collapsed', async () => {
      localStorage.setItem('sandtable.collapsedGroups', JSON.stringify(['g1', 'g2']))
      render(sidebar({ projects: grouped, groups: [work, home] }))
      await userEvent.click(screen.getByRole('button', { name: 'More for Work' }))
      await userEvent.click(screen.getByRole('menuitem', { name: 'Delete group' }))
      expect(JSON.parse(localStorage.getItem('sandtable.collapsedGroups') ?? '[]')).toEqual(['g2'])
    })

    it('expands a collapsed group a project moves into with Move to', async () => {
      localStorage.setItem('sandtable.collapsedGroups', JSON.stringify(['g1']))
      render(sidebar({ projects: grouped, groups: [work, home] }))
      await userEvent.click(screen.getByRole('button', { name: 'More for Shop' }))
      await userEvent.click(screen.getByRole('menuitemradio', { name: 'Work' }))
      expect(screen.getByRole('button', { name: 'Work' })).toHaveAttribute('aria-expanded', 'true')
    })

    it('moves a group up or down from its More menu', async () => {
      const onArrange = vi.fn()
      render(sidebar({ groups: [work, home], onArrange }))
      await userEvent.click(screen.getByRole('button', { name: 'More for Work' }))
      expect(screen.getByRole('menuitem', { name: 'Move up' })).toHaveAttribute('aria-disabled')
      await userEvent.click(screen.getByRole('menuitem', { name: 'Move down' }))
      expect(onArrange).toHaveBeenCalledWith([project, other], [home, work])
    })

    it('moves a project to a group or out of one with Move to', async () => {
      const onArrange = vi.fn()
      render(sidebar({ projects: grouped, groups: [work, home], onArrange }))
      await userEvent.click(screen.getByRole('button', { name: 'More for Shop' }))
      expect(screen.getByRole('menuitemradio', { name: 'No group' })).toBeChecked()
      expect(screen.getByRole('menuitemradio', { name: 'Work' })).not.toBeChecked()
      await userEvent.click(screen.getByRole('menuitemradio', { name: 'Work' }))
      const [projects, groups] = onArrange.mock.calls[0]
      expect(ids(projects)).toEqual(['p3', 'p1', 'p2'])
      expect(projects[1].group).toBe('g1')
      expect(groups).toEqual([work, home])
      await userEvent.click(screen.getByRole('button', { name: 'More for Notes' }))
      await userEvent.click(screen.getByRole('menuitemradio', { name: 'No group' }))
      expect(ids(onArrange.mock.calls[1][0])).toEqual(['p1', 'p3', 'p2'])
    })

    it('moves a project into a new group with Move to, New group…', async () => {
      const onArrange = vi.fn()
      render(sidebar({ groups: [work], onArrange }))
      await userEvent.click(screen.getByRole('button', { name: 'More for Sandtable' }))
      await userEvent.click(screen.getByRole('menuitem', { name: 'New group…' }))
      const field = screen.getByRole('textbox', { name: 'New group name' })
      expect(field).toHaveFocus()
      await userEvent.type(field, 'Private{Enter}')
      const [projects, groups] = onArrange.mock.calls[0]
      expect(groups).toEqual([work, { id: expect.any(String), name: 'Private' }])
      expect(ids(projects)).toEqual(['p1', 'p2'])
      expect(projects[1].group).toBe(groups[1].id)
    })

    it('does nothing when Move to picks the group a project is already in', async () => {
      const onArrange = vi.fn()
      render(sidebar({ projects: grouped, groups: [work, home], onArrange }))
      await userEvent.click(screen.getByRole('button', { name: 'More for Notes' }))
      await userEvent.click(screen.getByRole('menuitemradio', { name: 'Work' }))
      await userEvent.click(screen.getByRole('button', { name: 'More for Shop' }))
      await userEvent.click(screen.getByRole('menuitemradio', { name: 'No group' }))
      expect(onArrange).not.toHaveBeenCalled()
    })

    it("keeps a group's list named while the group is renamed", async () => {
      render(sidebar({ projects: grouped, groups: [work, home] }))
      await userEvent.click(screen.getByRole('button', { name: 'More for Work' }))
      await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
      expect(screen.getByRole('list', { name: 'Work' })).toBeInTheDocument()
    })

    it("doesn't drag the row when a press on its menu moves", async () => {
      const onArrange = vi.fn()
      render(sidebar({ onArrange }))
      await userEvent.click(screen.getByRole('button', { name: 'More for Shop' }))
      const item = screen.getByRole('menuitem', { name: 'Edit project' })
      fireEvent.pointerDown(item, { button: 0, isPrimary: true, clientX: 10, clientY: 10 })
      fireEvent.pointerMove(item, { clientX: 10, clientY: 40 })
      expect(screen.queryByText(/Picked up/)).not.toBeInTheDocument()
      fireEvent.pointerUp(item, { clientX: 10, clientY: 40 })
      expect(onArrange).not.toHaveBeenCalled()
    })

    describe('keyboard focus', () => {
      it('follows a project moved with Move to', async () => {
        render(<Arranged projects={grouped} groups={[work, home]} />)
        await userEvent.click(screen.getByRole('button', { name: 'More for Shop' }))
        await userEvent.click(screen.getByRole('menuitemradio', { name: 'Work' }))
        await act(() => new Promise((r) => setTimeout(r, 10)))
        expect(
          within(screen.getByRole('list', { name: 'Work' })).getByRole('button', { name: 'Shop' })
        ).toHaveFocus()
      })

      it.each([
        ['Job{Enter}', 'Job'],
        ['{Escape}', 'Work']
      ])('goes to the group heading after a rename: %s', async (keys, name) => {
        render(<Arranged groups={[work, home]} />)
        await userEvent.click(screen.getByRole('button', { name: 'More for Work' }))
        await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
        await userEvent.keyboard(keys)
        expect(screen.getByRole('button', { name })).toHaveFocus()
        expect(screen.getByRole('button', { name })).toHaveAttribute('aria-expanded', 'true')
      })

      it('goes to a new group heading, or back to New group when canceled', async () => {
        render(<Arranged groups={[work]} />)
        await userEvent.click(screen.getByRole('button', { name: 'New group' }))
        await userEvent.keyboard('{Escape}')
        expect(screen.getByRole('button', { name: 'New group' })).toHaveFocus()
        await userEvent.click(screen.getByRole('button', { name: 'New group' }))
        await userEvent.keyboard('Private{Enter}')
        expect(screen.getByRole('button', { name: 'Private' })).toHaveFocus()
        expect(screen.getByRole('button', { name: 'Private' })).toHaveAttribute(
          'aria-expanded',
          'true'
        )
      })

      it('goes to New group after a group is deleted', async () => {
        render(<Arranged projects={grouped} groups={[work, home]} />)
        await userEvent.click(screen.getByRole('button', { name: 'More for Work' }))
        await userEvent.click(screen.getByRole('menuitem', { name: 'Delete group' }))
        await act(() => new Promise((r) => setTimeout(r, 10)))
        expect(screen.getByRole('button', { name: 'New group' })).toHaveFocus()
      })
    })

    it('moves a project up or down within its section', async () => {
      const onArrange = vi.fn()
      render(sidebar({ onArrange }))
      await userEvent.click(screen.getByRole('button', { name: 'More for Shop' }))
      expect(screen.getByRole('menuitem', { name: 'Move up' })).toHaveAttribute('aria-disabled')
      await userEvent.click(screen.getByRole('menuitem', { name: 'Move down' }))
      expect(ids(onArrange.mock.calls[0][0])).toEqual(['p2', 'p1'])
      await userEvent.click(screen.getByRole('button', { name: 'More for Sandtable' }))
      await userEvent.click(screen.getByRole('menuitem', { name: 'Move up' }))
      expect(ids(onArrange.mock.calls[1][0])).toEqual(['p2', 'p1'])
    })
  })

  it("shows the couldn't-start line under a project only when it has entries, folded or open", async () => {
    const onOpenTicket = vi.fn()
    render(
      sidebar({
        onOpenTicket,
        couldntStart: {
          p1: [
            {
              kind: 'ticket',
              name: 'Dark mode toggle',
              ticketKey: 'octo/shop#52',
              at: '2026-10-24T11:00:00.000Z',
              reason: 'tmux broke',
              repo: null
            }
          ]
        }
      })
    )
    expect(screen.getAllByRole('button', { name: /couldn't start/ })).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: /sessions of Shop/ }))
    expect(screen.getByRole('button', { name: "1 couldn't start" })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: "1 couldn't start" }))
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: "Couldn't start in Shop" })).getByRole(
        'button',
        { name: /Dark mode toggle/ }
      )
    )
    expect(onOpenTicket).toHaveBeenCalledWith('p1', 'octo/shop#52')
  })
})

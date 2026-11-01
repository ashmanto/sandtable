import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import type { SandtableApi } from '../../../shared/api'
import {
  adhoc,
  boardView,
  fakeSandtable,
  linearProject,
  linearTicket,
  project,
  session,
  ticket
} from '../test/fixtures'
import { folderError } from '../../../shared/repo'
import { Board } from './Board'
import type { BoardView } from '../../../shared/api'
import type { IssueRef } from '../../../shared/types'

let api: SandtableApi

const handlers = {
  onProjectSaved: vi.fn(),
  onNewSession: vi.fn(),
  onDrafted: vi.fn(),
  onOpenSession: vi.fn(),
  onRoutine: vi.fn(),
  onSetUp: vi.fn(),
  onOpenElsewhere: vi.fn(),
  projects: [project]
}

function renderBoard(view: BoardView, onSync = vi.fn(), p = project): ReturnType<typeof vi.fn> {
  const onOpenTicket = vi.fn()
  render(
    <Board {...handlers} project={p} view={view} onSync={onSync} onOpenTicket={onOpenTicket} />
  )
  return onOpenTicket
}

const FOLDER_ERROR = folderError('octo/shop')

async function startFromCard(title: string, extra?: string): Promise<void> {
  await userEvent.click(within(card(title)).getByRole('button', { name: 'Start' }))
  const dialog = screen.getByRole('dialog')
  if (extra) await userEvent.click(within(dialog).getByLabelText(extra))
  await userEvent.click(within(dialog).getByRole('button', { name: 'Start' }))
}

const solo = { ...project, repos: [project.repos[0]] }
const openFilters = (): Promise<void> =>
  userEvent.click(screen.getByRole('button', { name: /^Filters/ }))
const openSub = async (name: string): Promise<void> => {
  await openFilters()
  await userEvent.click(screen.getByRole('menuitem', { name: new RegExp(`^${name}`) }))
}

const card = (title: string): HTMLElement => screen.getByText(title).closest('[data-slot="card"]')!
const column = (name: string): HTMLElement => screen.getByRole('region', { name })

const titles = ['To do', 'In progress', 'Done']

function mockRects(layout: (el: Element) => DOMRect): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const overlay = this.parentElement?.style
    return overlay?.position === 'fixed'
      ? new DOMRect(...[overlay.left, overlay.top, overlay.width, overlay.height].map(parseFloat))
      : layout(this)
  })
}

const mockColumnRects = (): void =>
  mockRects((el) => {
    const i = titles.indexOf(el.closest('section')?.getAttribute('aria-label') ?? '')
    return i < 0 ? new DOMRect() : new DOMRect(i * 362, 0, 350, 600)
  })

const mockListRects = (shift = { y: 0 }): void =>
  mockRects((el) => {
    let top = shift.y
    for (const s of document.querySelectorAll('section[aria-label]')) {
      if (!titles.includes(s.getAttribute('aria-label')!)) continue
      const rows = [...s.querySelectorAll('[role="group"]')]
      top += 8
      if (s === el) return new DOMRect(0, top, 800, 36 * (rows.length + 1))
      const i = rows.indexOf(el)
      if (i >= 0) return new DOMRect(0, top + 36 * (i + 1), 800, 36)
      top += 36 * (rows.length + 1)
    }
    return new DOMRect()
  })

beforeEach(() => {
  vi.clearAllMocks()
  api = fakeSandtable()
})

describe('Board', () => {
  it("shows another project's live session on the card instead of Start, and opens it there", async () => {
    const other = { ...project, id: 'p2', name: 'Contacts team', icon: '👥' }
    const t = ticket(9)
    const onOpenElsewhere = vi.fn()
    const onOpenTicket = vi.fn()
    render(
      <Board
        {...handlers}
        projects={[project, other]}
        onOpenElsewhere={onOpenElsewhere}
        project={project}
        view={boardView({
          tickets: [t],
          elsewhere: [session(t.key, { projectId: 'p2', state: 'running' })]
        })}
        onSync={vi.fn()}
        onOpenTicket={onOpenTicket}
      />
    )
    const c = within(card('Ticket 9'))
    expect(c.queryByRole('button', { name: 'Start' })).toBeNull()
    expect(c.queryByRole('button', { name: 'Start with note' })).toBeNull()
    expect(c.getByText('Contacts team')).toBeInTheDocument()
    expect(c.getAllByText('Running')).toHaveLength(1)
    await userEvent.click(
      c.getByRole('button', { name: 'Running in Contacts team. Open the session' })
    )
    expect(onOpenElsewhere).toHaveBeenCalledWith('p2', t.key)
    expect(onOpenTicket).not.toHaveBeenCalled()
  })

  it("shows another project's session on a Done card as Done, session open", () => {
    const other = { ...project, id: 'p2', name: 'Contacts team' }
    const t = ticket(9, { status: 'Done' })
    render(
      <Board
        {...handlers}
        projects={[project, other]}
        project={project}
        view={boardView({
          tickets: [t],
          elsewhere: [session(t.key, { projectId: 'p2', state: 'running' })]
        })}
        onSync={vi.fn()}
        onOpenTicket={vi.fn()}
      />
    )
    expect(
      within(card('Ticket 9')).getByRole('button', {
        name: 'Done, session open in Contacts team. Open the session'
      })
    ).toBeInTheDocument()
  })

  it("prefers the card's own live session over another project's", () => {
    const other = { ...project, id: 'p2', name: 'Contacts team' }
    const t = ticket(9)
    render(
      <Board
        {...handlers}
        projects={[project, other]}
        project={project}
        view={boardView({
          tickets: [t],
          sessions: [session(t.key, { state: 'idle' })],
          elsewhere: [session(t.key, { id: 's2', projectId: 'p2' })]
        })}
        onSync={vi.fn()}
        onOpenTicket={vi.fn()}
      />
    )
    expect(within(card('Ticket 9')).queryByRole('button', { name: /Contacts team/ })).toBeNull()
  })

  it('shows the three columns and hides Wont fix tickets', () => {
    renderBoard(
      boardView({
        tickets: [
          ticket(1, { status: 'Todo' }),
          ticket(2, { status: 'In Progress' }),
          ticket(3, { status: 'Done' }),
          ticket(4, { status: 'Wont fix' })
        ]
      })
    )
    expect(within(column('To do')).getByText('Ticket 1')).toBeInTheDocument()
    expect(within(column('In progress')).getByText('Ticket 2')).toBeInTheDocument()
    expect(within(column('Done')).getByText('Ticket 3')).toBeInTheDocument()
    expect(screen.queryByText('Ticket 4')).not.toBeInTheDocument()
  })

  it('shows the issue number, repo, and title on each card', () => {
    renderBoard(boardView({ tickets: [ticket(147, { title: 'Dark mode toggle' })] }))
    const c = card('Dark mode toggle')
    expect(within(c).getByText('#147')).toBeInTheDocument()
    expect(within(c).getByText('shop')).toBeInTheDocument()
  })

  it('shows the parent, assignees, labels, sub-issues, board fields, and dates on a card', () => {
    const created = new Date(2026, 9, 12, 14, 5).toISOString()
    const updated = new Date(2026, 9, 23, 9, 30).toISOString()
    renderBoard(
      boardView({
        tickets: [
          ticket(5, {
            title: 'Fix `npm test` on CI',
            parent: {
              key: 'octo/shop#2',
              number: 2,
              title: 'Make the build green',
              repo: 'octo/shop',
              url: 'https://github.com/octo/shop/issues/2',
              column: 'todo'
            },
            assignees: [
              { id: 'U_ada', login: 'ada', name: 'Ada Lovelace' },
              { id: 'U_grace', login: 'grace', name: null },
              { id: 'U_linus', login: 'linus', name: 'Linus T' }
            ],
            labels: [
              { name: 'bug', color: 'd73a4a' },
              { name: 'sandtable: in progress', color: 'fb8500' }
            ],
            subIssues: { completed: 3, total: 6, items: [] },
            boardFields: [{ name: 'Priority', value: 'P1' }],
            createdAt: created,
            updatedAt: updated
          })
        ]
      })
    )
    const c = screen.getByText('#5').closest('[data-slot="card"]') as HTMLElement
    const w = within(c)
    expect(
      w.getByRole('link', {
        name: 'Sub-issue of #2 Make the build green (opens on GitHub)'
      })
    ).toHaveAttribute('href', 'https://github.com/octo/shop/issues/2')
    expect(w.getByRole('img', { name: 'Ada Lovelace' })).toHaveTextContent(/^A$/)
    expect(w.getByRole('img', { name: 'grace' })).toHaveTextContent('G')
    expect(w.queryByRole('img', { name: 'Linus T' })).toBeNull()
    expect(w.getByText('+1')).toHaveAttribute('aria-label', '1 more: Linus T')
    expect(w.getByText('bug')).toBeInTheDocument()
    expect(w.queryByText('sandtable: in progress')).toBeNull()
    expect(w.getByRole('button', { name: '3/6 sub-issues, 3 of 6 done' })).toHaveTextContent(
      '3/6 sub-issues'
    )
    expect(w.getByRole('listitem', { name: 'Priority: P1' })).toHaveTextContent('P1')
    expect(w.getByText('Oct 12')).toHaveAttribute('title', 'Oct 12, 2026, 14:05')
    expect(w.getByText('Oct 23')).toHaveAttribute('title', 'Oct 23, 2026, 09:30')
    expect(w.getByText('npm test').tagName).toBe('CODE')
  })

  describe('sub-issues on cards', () => {
    const ref = (n: number, column: 'todo' | 'done' = 'todo'): IssueRef => ({
      key: `octo/shop#${n}`,
      number: n,
      title: `Ticket ${n}`,
      repo: 'octo/shop',
      url: `https://github.com/octo/shop/issues/${n}`,
      column
    })
    const view = (): BoardView =>
      boardView({
        tickets: [
          ticket(1, {
            subIssues: {
              completed: 1,
              total: 3,
              items: [
                { ...ref(2), assignee: null },
                { ...ref(9, 'done'), assignee: null }
              ]
            }
          }),
          ticket(2, { parent: ref(1) })
        ],
        sessions: [session('octo/shop#2', { state: 'needsYou' })]
      })
    const cardOf = (n: number): HTMLElement =>
      document.querySelector(`[data-ticket="octo/shop#${n}"]`)!

    it("opens a parent's sub-issue list from its chip, and a row jumps to that card", async () => {
      const onOpenTicket = renderBoard(view())
      const chip = within(cardOf(1)).getByRole('button', { name: '1/3 sub-issues, 1 of 3 done' })
      expect(chip).toHaveAttribute('aria-expanded', 'false')
      await userEvent.click(chip)
      expect(chip).toHaveAttribute('aria-expanded', 'true')
      const w = within(cardOf(1))
      expect(w.getByRole('link', { name: '#9 Ticket 9 (opens on GitHub)' })).toHaveAttribute(
        'href',
        'https://github.com/octo/shop/issues/9'
      )
      expect(w.getByRole('link', { name: '1 more on GitHub' })).toBeInTheDocument()
      expect(w.getByRole('button', { name: '#2 Ticket 2, Needs you' })).toHaveTextContent(
        'Needs you'
      )
      await userEvent.click(w.getByRole('button', { name: '#2 Ticket 2, Needs you' }))
      expect(cardOf(2)).toHaveFocus()
      expect(onOpenTicket).not.toHaveBeenCalled()
      await userEvent.click(chip)
      expect(w.queryByRole('button', { name: '#2 Ticket 2, Needs you' })).toBeNull()
    })

    it("jumps from a sub-issue's parent line to the parent's card", async () => {
      const onOpenTicket = renderBoard(view())
      await userEvent.click(
        within(cardOf(2)).getByRole('button', { name: 'Sub-issue of #1 Ticket 1' })
      )
      expect(cardOf(1)).toHaveFocus()
      expect(onOpenTicket).not.toHaveBeenCalled()
    })

    it("names a Linear parent by its key, and opens one that isn't on the board in Linear", () => {
      renderBoard(
        boardView({
          tickets: [
            linearTicket(8, {
              parent: {
                ...ref(7),
                key: 'APP-7',
                repo: '',
                url: 'https://linear.app/octo/issue/APP-7'
              }
            })
          ]
        }),
        vi.fn(),
        linearProject
      )
      expect(
        screen.getByRole('link', { name: 'Sub-issue of APP-7 Ticket 7 (opens in Linear)' })
      ).toHaveAttribute('href', 'https://linear.app/octo/issue/APP-7')
    })
  })

  it.each([
    ['an avatar', 'Ada Lovelace', 'img', 'Ada Lovelace'],
    ['the more count', '+2', 'text', 'grace, Linus T']
  ])('names %s in a tooltip on hover', async (_, target, kind, tip) => {
    renderBoard(
      boardView({
        tickets: [
          ticket(5, {
            assignees: [
              { id: 'U_ada', login: 'ada', name: 'Ada Lovelace' },
              { id: 'U_bob', login: 'bob', name: null },
              { id: 'U_grace', login: 'grace', name: null },
              { id: 'U_linus', login: 'linus', name: 'Linus T' }
            ]
          })
        ]
      })
    )
    const c = within(card('Ticket 5'))
    await userEvent.hover(
      kind === 'img' ? c.getByRole('img', { name: target }) : c.getByText(target)
    )
    expect(await screen.findByRole('tooltip')).toHaveTextContent(tip)
  })

  it('shows the state as an icon and a word, and leaves out empty properties', () => {
    const t = ticket(1)
    renderBoard(boardView({ tickets: [t], sessions: [session(t.key, { state: 'running' })] }))
    const chip = within(card('Ticket 1')).getByText('Running')
    expect(chip.querySelector('svg')).not.toBeNull()
    expect(within(card('Ticket 1')).queryAllByRole('img')).toHaveLength(0)
    expect(within(card('Ticket 1')).queryByText('0/0')).toBeNull()
  })

  it('keeps an unmatched backtick and skips empty code in a title', () => {
    renderBoard(boardView({ tickets: [ticket(1, { title: 'Quote `` and ` alone' })] }))
    const title = screen.getByText('#1').closest('[data-slot="card"]')!.querySelector('p')!
    expect(title).toHaveTextContent('Quote and ` alone')
    expect(title.querySelector('code')).toBeNull()
  })

  it('shows Running and Needs you as words', () => {
    const a = ticket(1)
    const b = ticket(2)
    renderBoard(
      boardView({
        tickets: [a, b],
        sessions: [session(a.key, { state: 'running' }), session(b.key, { state: 'needsYou' })]
      })
    )
    expect(within(card('Ticket 1')).getByText('Running')).toBeInTheDocument()
    expect(within(card('Ticket 2')).getByText('Needs you')).toBeInTheDocument()
  })

  it('uses the newest session of a ticket', () => {
    const a = ticket(1)
    renderBoard(
      boardView({
        tickets: [a],
        sessions: [
          session(a.key, { id: 'new', state: 'finished', startedAt: '2026-10-24T12:00:00.000Z' }),
          session(a.key, { id: 'old', state: 'running', startedAt: '2026-10-24T09:00:00.000Z' })
        ]
      })
    )
    expect(within(card('Ticket 1')).getByText('Finished')).toBeInTheDocument()
    expect(within(card('Ticket 1')).getByRole('button', { name: 'Resume' })).toBeInTheDocument()
  })

  it('a card shows Blocked by for each open blocker', () => {
    renderBoard(
      boardView({
        tickets: [
          ticket(1, {
            blockedBy: [
              {
                key: 'octo/shop#38',
                number: 38,
                title: 'Add a settings screen',
                repo: 'octo/shop'
              },
              {
                key: 'octo/shop-web#7',
                number: 7,
                title: 'Ship the API',
                repo: 'octo/shop-web'
              }
            ]
          })
        ]
      })
    )
    const c = card('Ticket 1')
    expect(within(c).getByText('Blocked by #38').closest('li')).toHaveAttribute(
      'title',
      'Add a settings screen'
    )
    expect(within(c).getByText('Blocked by octo/shop-web#7').closest('li')).toHaveAttribute(
      'title',
      'Ship the API'
    )
  })

  it('Start opens the check before the repo picker', async () => {
    vi.mocked(api.tickets.checkStart).mockResolvedValue({
      triage: false,
      problems: ['Blocked by #2: Ticket 2'],
      overlap: [],
      ready: false
    })
    const t = ticket(1)
    renderBoard(boardView({ tickets: [t] }))
    await userEvent.click(within(card('Ticket 1')).getByRole('button', { name: 'Start' }))
    const check = await screen.findByRole('dialog')
    expect(await within(check).findByText('Blocked by #2: Ticket 2')).toBeInTheDocument()
    expect(within(check).queryByText('Extra repos (optional)')).toBeNull()
    await userEvent.click(within(check).getByRole('button', { name: 'Start anyway' }))
    expect(await screen.findByText('Extra repos (optional)')).toBeInTheDocument()
    expect(api.tickets.start).not.toHaveBeenCalled()
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Start' }))
    expect(api.tickets.start).toHaveBeenCalledWith(
      'p1',
      t.key,
      [],
      undefined,
      undefined,
      undefined,
      undefined
    )
  })

  it('shows what a ticket that is not ready is missing, and Refine in chat opens the ticket', async () => {
    vi.mocked(api.tickets.checkStart).mockResolvedValue({
      triage: false,
      problems: [],
      overlap: [],
      ready: true
    })
    vi.mocked(api.tickets.checkReady).mockResolvedValue(['No way to tell when it’s done'])
    const t = ticket(5)
    const onOpen = renderBoard(boardView({ tickets: [t] }))
    await userEvent.click(within(card('Ticket 5')).getByRole('button', { name: 'Start' }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Start' })
    )
    const c = card('Ticket 5')
    expect(await within(c).findByText('Not ready')).toBeInTheDocument()
    expect(within(c).getByText('No way to tell when it’s done')).toBeInTheDocument()
    expect(within(c).getByRole('button', { name: 'Start anyway' })).toBeInTheDocument()
    expect(within(c).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    await userEvent.click(within(c).getByRole('button', { name: 'Refine in chat' }))
    expect(onOpen).toHaveBeenCalledWith(t.key)
    expect(within(c).queryByText('Not ready')).toBeNull()
    expect(api.tickets.start).not.toHaveBeenCalled()
  })

  it('hints at a worktree setup on the first Start in a repo, and Set up opens the repo', async () => {
    vi.mocked(api.setup.hint).mockResolvedValue({ copy: ['.env'], command: 'npm install' })
    const p = { ...solo, id: 'p-hint' }
    render(
      <Board
        {...handlers}
        project={p}
        view={boardView({ tickets: [ticket(8)] })}
        onSync={vi.fn()}
        onOpenTicket={vi.fn()}
      />
    )
    const c = card('Ticket 8')
    await userEvent.click(within(c).getByRole('button', { name: 'Start' }))
    expect(await within(c).findByRole('status')).toHaveTextContent(
      "New worktrees here won't have .env or node_modules"
    )
    expect(api.setup.hint).toHaveBeenCalledWith('p-hint', 'octo/shop')
    await userEvent.click(within(c).getByRole('button', { name: 'Set up' }))
    expect(handlers.onSetUp).toHaveBeenCalledWith('octo/shop')
    expect(within(c).queryByText(/New worktrees here/)).toBeNull()
  })

  it('Not now hides the hint for good and puts focus back on the card', async () => {
    vi.mocked(api.setup.hint).mockResolvedValue({ copy: ['.env'] })
    const p = { ...solo, id: 'p-not-now' }
    render(
      <Board
        {...handlers}
        project={p}
        view={boardView({ tickets: [ticket(9)] })}
        onSync={vi.fn()}
        onOpenTicket={vi.fn()}
      />
    )
    const c = card('Ticket 9')
    await userEvent.click(within(c).getByRole('button', { name: 'Start' }))
    await userEvent.click(await within(c).findByRole('button', { name: 'Not now' }))
    expect(api.setup.hideHint).toHaveBeenCalledWith('p-not-now', 'octo/shop')
    expect(within(c).queryByText(/New worktrees here/)).toBeNull()
    expect(c).toHaveFocus()
  })

  it("shows on the card why Not now couldn't save", async () => {
    vi.mocked(api.setup.hint).mockResolvedValue({ copy: ['.env'] })
    vi.mocked(api.setup.hideHint).mockRejectedValue(new Error('disk full'))
    const p = { ...solo, id: 'p-not-now-fails' }
    render(
      <Board
        {...handlers}
        project={p}
        view={boardView({ tickets: [ticket(9)] })}
        onSync={vi.fn()}
        onOpenTicket={vi.fn()}
      />
    )
    const c = card('Ticket 9')
    await userEvent.click(within(c).getByRole('button', { name: 'Start' }))
    await userEvent.click(await within(c).findByRole('button', { name: 'Not now' }))
    expect(await within(c).findByText("Couldn't hide the hint: disk full")).toBeInTheDocument()
  })

  it("lets a later start warning replace Not now's error on the card", async () => {
    vi.mocked(api.setup.hint).mockResolvedValue({ copy: ['.env'] })
    vi.mocked(api.setup.hideHint).mockRejectedValue(new Error('disk full'))
    const p = { ...solo, id: 'p-not-now-then-warning' }
    const board = (view: ReturnType<typeof boardView>): React.JSX.Element => (
      <Board {...handlers} project={p} view={view} onSync={vi.fn()} onOpenTicket={vi.fn()} />
    )
    const { rerender } = render(board(boardView({ tickets: [ticket(9)] })))
    const c = card('Ticket 9')
    await userEvent.click(within(c).getByRole('button', { name: 'Start' }))
    await userEvent.click(await within(c).findByRole('button', { name: 'Not now' }))
    await within(c).findByText("Couldn't hide the hint: disk full")
    rerender(
      board(
        boardView({
          tickets: [ticket(9)],
          sessions: [session(ticket(9).key, { startWarning: 'Claude exited' })]
        })
      )
    )
    expect(within(card('Ticket 9')).getByText('Claude exited')).toBeInTheDocument()
  })

  it('keeps Start busy while Not now saves', async () => {
    vi.mocked(api.setup.hint).mockResolvedValue({ copy: ['.env'] })
    vi.mocked(api.tickets.start).mockReturnValue(new Promise(() => {}))
    const p = { ...solo, id: 'p-not-now-starting' }
    render(
      <Board
        {...handlers}
        project={p}
        view={boardView({ tickets: [ticket(9)] })}
        onSync={vi.fn()}
        onOpenTicket={vi.fn()}
      />
    )
    const c = card('Ticket 9')
    await userEvent.click(within(c).getByRole('button', { name: 'Start' }))
    expect(await within(c).findByRole('button', { name: 'Starting' })).toBeDisabled()
    await userEvent.click(await within(c).findByRole('button', { name: 'Not now' }))
    await vi.waitFor(() => expect(api.setup.hideHint).toHaveBeenCalled())
    expect(within(c).getByRole('button', { name: 'Starting' })).toBeDisabled()
  })

  describe('overlap check on the card', () => {
    const me = ticket(73, { labels: [{ name: 'area: board', color: 'ededed' }] })
    const busy = [
      { key: 'octo/shop#67', number: 67, title: 'Sort cards' },
      { key: 'octo/shop#91', number: 91, title: 'To clean up' }
    ]
    const reason = 'Both change how a card lays out its rows.'

    beforeEach(() => {
      vi.mocked(api.tickets.checkStart).mockResolvedValue({
        triage: false,
        problems: [],
        overlap: busy,
        ready: false
      })
    })

    it('starts with no warning when Claude finds no overlap', async () => {
      renderBoard(boardView({ tickets: [me] }))
      await startFromCard('Ticket 73')
      await vi.waitFor(() =>
        expect(api.tickets.start).toHaveBeenCalledWith(
          'p1',
          me.key,
          [],
          undefined,
          undefined,
          undefined,
          undefined
        )
      )
      expect(api.tickets.checkOverlap).toHaveBeenCalledWith('p1', me.key)
      expect(screen.queryByText('Overlaps')).toBeNull()
    })

    it('shows each overlap, and Start anyway starts with the repos picked', async () => {
      vi.mocked(api.tickets.checkOverlap).mockResolvedValue([
        { key: 'octo/shop#67', number: 67, title: 'Sort cards', reason }
      ])
      const onOpen = renderBoard(boardView({ tickets: [me] }))
      await startFromCard('Ticket 73', 'octo/shop-web')
      const c = card('Ticket 73')
      expect(await within(c).findByText('Overlaps')).toBeInTheDocument()
      expect(within(c).getByText(reason)).toHaveTextContent(`#67 ${reason}`)
      expect(within(c).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
      expect(api.tickets.start).not.toHaveBeenCalled()
      await userEvent.click(within(c).getByText(reason))
      expect(onOpen).not.toHaveBeenCalled()
      await userEvent.click(within(c).getByRole('button', { name: 'Start anyway' }))
      expect(api.tickets.start).toHaveBeenCalledWith(
        'p1',
        me.key,
        ['octo/shop-web'],
        undefined,
        undefined,
        undefined,
        undefined
      )
      expect(onOpen).not.toHaveBeenCalled()
      expect(within(c).queryByText('Overlaps')).toBeNull()
    })

    it('shows the error and the area-label fallback when the check fails', async () => {
      vi.mocked(api.tickets.checkOverlap).mockRejectedValue(
        new Error("Overlap check didn't finish within 3 minutes")
      )
      renderBoard(boardView({ tickets: [me] }))
      await startFromCard('Ticket 73')
      const c = card('Ticket 73')
      expect(
        await within(c).findByText("Overlap check didn't finish within 3 minutes")
      ).toHaveClass('text-danger')
      expect(
        within(c).getByText('By area label: #67 and #91 are in progress in area: board.')
      ).toBeInTheDocument()
      expect(within(c).getByRole('button', { name: 'Start anyway' })).toBeInTheDocument()
      await userEvent.click(within(c).getByRole('button', { name: 'Cancel' }))
      expect(within(c).queryByText(/By area label/)).toBeNull()
      expect(api.tickets.start).not.toHaveBeenCalled()
    })

    it('drops the result when you cancel during the wait', async () => {
      let finish: (o: never[]) => void = () => undefined
      vi.mocked(api.tickets.checkOverlap).mockReturnValue(new Promise((r) => (finish = r)))
      renderBoard(boardView({ tickets: [me] }))
      await startFromCard('Ticket 73')
      const c = card('Ticket 73')
      expect(within(c).getByRole('status')).toHaveTextContent('Checking overlap with #67 and #91')
      expect(within(c).getByRole('button', { name: 'Checking' })).toBeDisabled()
      await userEvent.click(within(c).getByRole('button', { name: 'Cancel' }))
      await act(async () => finish([]))
      expect(api.tickets.start).not.toHaveBeenCalled()
      expect(within(c).getByRole('button', { name: 'Start' })).toBeEnabled()
    })
  })

  it('shows Start on to-do and in-progress cards without a live session, never on done', () => {
    const live = ticket(4, { status: 'In Progress' })
    renderBoard(
      boardView({
        tickets: [
          ticket(1, { status: 'Todo' }),
          ticket(2, { status: 'In Progress' }),
          ticket(3, { status: 'Done' }),
          live
        ],
        sessions: [session(live.key, { state: 'needsYou' })]
      })
    )
    expect(within(card('Ticket 1')).getByRole('button', { name: 'Start' })).toBeInTheDocument()
    expect(within(card('Ticket 2')).getByRole('button', { name: 'Start' })).toBeInTheDocument()
    expect(within(card('Ticket 3')).queryByRole('button', { name: 'Start' })).toBeNull()
    expect(within(card('Ticket 4')).queryByRole('button', { name: 'Start' })).toBeNull()
  })

  it('says when a ticket repo is not in the project and offers no Start', () => {
    renderBoard(boardView({ tickets: [ticket(9, { repo: 'octo/elsewhere' })] }))
    const c = card('Ticket 9')
    expect(within(c).getByText('Repo not in this project')).toBeInTheDocument()
    expect(within(c).queryByRole('button', { name: 'Start' })).toBeNull()
  })

  it('shows the error above the columns and still shows the tickets', () => {
    renderBoard(boardView({ error: 'GitHub is down', tickets: [ticket(1)] }))
    const error = screen.getByText('GitHub is down')
    expect(error.compareDocumentPosition(column('To do')) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    )
    expect(screen.getByText('Ticket 1')).toBeInTheDocument()
  })

  it('says where the tickets come from in the header', () => {
    const { rerender } = render(
      <Board
        {...handlers}
        project={project}
        view={boardView()}
        onSync={vi.fn()}
        onOpenTicket={vi.fn()}
      />
    )
    expect(screen.getByText('GitHub Projects board')).toBeInTheDocument()
    rerender(
      <Board
        {...handlers}
        project={{ ...project, board: undefined }}
        view={boardView()}
        onSync={vi.fn()}
        onOpenTicket={vi.fn()}
      />
    )
    expect(screen.getByText('Issues from shop, shop-web')).toBeInTheDocument()
  })

  it("shows the project's icon before its name in the header, only when set", () => {
    const { rerender } = render(
      <Board
        {...handlers}
        project={{ ...project, icon: '🦊' }}
        view={boardView()}
        onSync={vi.fn()}
        onOpenTicket={vi.fn()}
      />
    )
    const heading = screen.getByRole('heading', { name: project.name })
    expect(heading.previousElementSibling).toHaveTextContent('🦊')
    expect(heading.previousElementSibling).toHaveAttribute('aria-hidden')
    rerender(
      <Board
        {...handlers}
        project={project}
        view={boardView()}
        onSync={vi.fn()}
        onOpenTicket={vi.fn()}
      />
    )
    expect(screen.queryByText('🦊')).not.toBeInTheDocument()
  })

  it('hides the error on Dismiss until the error text changes', async () => {
    const { rerender } = render(
      <Board
        {...handlers}
        project={project}
        view={boardView({ error: 'GitHub is down' })}
        onSync={vi.fn()}
        onOpenTicket={vi.fn()}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText('GitHub is down')).toBeNull()
    rerender(
      <Board
        {...handlers}
        project={project}
        view={boardView({ error: 'GitHub is down' })}
        onSync={vi.fn()}
        onOpenTicket={vi.fn()}
      />
    )
    expect(screen.queryByText('GitHub is down')).toBeNull()
    rerender(
      <Board
        {...handlers}
        project={project}
        view={boardView({ error: 'Rate limited' })}
        onSync={vi.fn()}
        onOpenTicket={vi.fn()}
      />
    )
    expect(screen.getByText('Rate limited')).toBeInTheDocument()
  })

  it('has Sync and the last sync time in the header', async () => {
    const onSync = vi.fn()
    renderBoard(boardView({ syncedAt: '2026-10-24T10:42:00.000Z' }), onSync)
    expect(
      screen.getByText(new Date('2026-10-24T10:42:00.000Z').toLocaleTimeString(), { exact: false })
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Sync' }))
    expect(onSync).toHaveBeenCalled()
  })

  it('starts a ticket with any number of extra repos checked in the dialog', async () => {
    const api3 = { github: 'octo/shop-api', path: '/repos/shop-api' }
    const t = ticket(1)
    render(
      <Board
        {...handlers}
        project={{ ...project, repos: [...project.repos, api3] }}
        view={boardView({ tickets: [t] })}
        onSync={vi.fn()}
        onOpenTicket={vi.fn()}
      />
    )
    await userEvent.click(within(card('Ticket 1')).getByRole('button', { name: 'Start' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByLabelText('octo/shop')).toBeNull()
    await userEvent.click(within(dialog).getByLabelText('octo/shop-web'))
    await userEvent.click(within(dialog).getByLabelText('octo/shop-api'))
    await userEvent.click(within(dialog).getByLabelText('octo/shop-web'))
    await userEvent.click(within(dialog).getByLabelText('octo/shop-web'))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start' }))
    expect(api.tickets.start).toHaveBeenCalledWith(
      'p1',
      t.key,
      ['octo/shop-web', 'octo/shop-api'],
      undefined,
      undefined,
      undefined,
      undefined
    )
  })

  it('starts without extra repos by default and shows a failure without the IPC prefix', async () => {
    const t = ticket(41)
    vi.mocked(api.tickets.start).mockRejectedValueOnce(
      new Error("Error invoking remote method 'tickets:start': Error: Repo not in this project")
    )
    renderBoard(boardView({ tickets: [t] }))
    await startFromCard('Ticket 41')
    expect(api.tickets.start).toHaveBeenCalledWith(
      'p1',
      t.key,
      [],
      undefined,
      undefined,
      undefined,
      undefined
    )
    expect(
      await within(card('Ticket 41')).findByText("Couldn't start: Repo not in this project")
    ).toBeInTheDocument()
  })

  it("shows a session's start warning on its card after the card moves, even once finished", async () => {
    const t = ticket(1, { status: 'In Progress' })
    const warning =
      "Couldn't update octo/shop from GitHub, so this branch starts from your local copy: offline"
    renderBoard(
      boardView({
        tickets: [t, ticket(2)],
        sessions: [
          session(t.key, { startWarning: warning }),
          session(ticket(2).key, { state: 'finished', startWarning: 'Claude exited' })
        ]
      })
    )
    expect(within(card('Ticket 1')).getByText(warning)).toBeInTheDocument()
    expect(within(card('Ticket 2')).getByText('Claude exited')).toBeInTheDocument()
  })

  it('opens the ticket on a click anywhere on the card or Enter, but not from its buttons', async () => {
    const onOpen = renderBoard(boardView({ tickets: [ticket(1)] }))
    await userEvent.click(within(card('Ticket 1')).getByText('#1'))
    expect(onOpen).toHaveBeenCalledWith('octo/shop#1')
    card('Ticket 1').focus()
    await userEvent.keyboard('{Enter}')
    expect(onOpen).toHaveBeenCalledTimes(2)
    await userEvent.click(within(card('Ticket 1')).getByRole('button', { name: 'Start' }))
    expect(onOpen).toHaveBeenCalledTimes(2)
  })

  it('marks a card whose session has Remote Control on, with no toggle', () => {
    const a = ticket(1)
    const b = ticket(2)
    renderBoard(
      boardView({
        tickets: [a, b],
        sessions: [
          session(a.key, { state: 'needsYou', remoteControl: true }),
          session(b.key, { state: 'needsYou' })
        ]
      })
    )
    expect(within(card('Ticket 1')).getByRole('img', { name: 'Remote Control on' })).toBeVisible()
    expect(within(card('Ticket 2')).queryByRole('img', { name: 'Remote Control on' })).toBeNull()
    expect(within(card('Ticket 1')).queryByRole('button', { name: /Remote/ })).toBeNull()
  })

  it('reads Resuming while a resume works', async () => {
    const t = ticket(1)
    vi.mocked(api.sessions.resume).mockReturnValue(new Promise(() => {}))
    renderBoard(boardView({ tickets: [t], sessions: [session(t.key, { state: 'finished' })] }))
    await userEvent.click(within(card('Ticket 1')).getByRole('button', { name: 'Resume' }))
    expect(within(card('Ticket 1')).getByRole('button', { name: 'Resuming' })).toBeDisabled()
  })

  it('clears a result line after 3.5 s', async () => {
    vi.useFakeTimers()
    try {
      const t = ticket(1, { status: 'Done' })
      renderBoard(boardView({ tickets: [t], sessions: [session(t.key, { state: 'finished' })] }))
      fireEvent.click(within(card('Ticket 1')).getByRole('button', { name: 'Remove worktree' }))
      await act(async () => {})
      expect(within(card('Ticket 1')).getByText('Worktree removed')).toBeInTheDocument()
      act(() => {
        vi.advanceTimersByTime(3400)
      })
      expect(within(card('Ticket 1')).getByText('Worktree removed')).toBeInTheDocument()
      act(() => {
        vi.advanceTimersByTime(100)
      })
      expect(within(card('Ticket 1')).queryByText('Worktree removed')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows Resume on a finished card outside Done and Remove worktree on one in Done', async () => {
    const a = ticket(1)
    const b = ticket(2, { status: 'Done' })
    renderBoard(
      boardView({
        tickets: [a, b],
        sessions: [session(a.key, { state: 'finished' }), session(b.key, { state: 'finished' })]
      })
    )
    await userEvent.click(within(card('Ticket 1')).getByRole('button', { name: 'Resume' }))
    expect(api.sessions.resume).toHaveBeenCalledWith(`s-${a.key}`)
    expect(within(card('Ticket 2')).queryByRole('button', { name: 'Resume' })).toBeNull()
    await userEvent.click(within(card('Ticket 2')).getByRole('button', { name: 'Remove worktree' }))
    expect(api.sessions.removeWorktree).toHaveBeenCalledWith(`s-${b.key}`)
    expect(await within(card('Ticket 2')).findByText('Worktree removed')).toBeInTheDocument()
  })

  it('shows Finished on a finished card outside Done but not on one in Done', () => {
    const a = ticket(1)
    const b = ticket(2, { status: 'Done' })
    renderBoard(
      boardView({
        tickets: [a, b],
        sessions: [session(a.key, { state: 'finished' }), session(b.key, { state: 'finished' })]
      })
    )
    expect(within(card('Ticket 1')).getByText('Finished')).toBeInTheDocument()
    expect(within(card('Ticket 2')).queryByText('Finished')).toBeNull()
    expect(within(card('Ticket 2')).getByRole('button', { name: 'Remove worktree' })).toBeVisible()
  })

  it('clears Needs you from a card without opening it, but not on Done, session open', async () => {
    const a = ticket(1)
    const done = ticket(2, { status: 'Done' })
    const onOpen = renderBoard(
      boardView({
        tickets: [a, done],
        sessions: [session(a.key, { state: 'needsYou' }), session(done.key, { state: 'needsYou' })]
      })
    )
    await userEvent.click(within(card('Ticket 1')).getByRole('button', { name: 'Clear Needs you' }))
    expect(api.sessions.clearNeedsYou).toHaveBeenCalledWith(`s-${a.key}`)
    expect(onOpen).not.toHaveBeenCalled()
    expect(within(card('Ticket 2')).queryByRole('button', { name: 'Clear Needs you' })).toBeNull()
  })

  it('shows Done, session open on a done card with a live session and ends it in one click', async () => {
    const t = ticket(1, { status: 'Done' })
    const onOpen = renderBoard(
      boardView({ tickets: [t], sessions: [session(t.key, { state: 'needsYou' })] })
    )
    const c = card('Ticket 1')
    expect(within(c).getByText('Done, session open')).toBeInTheDocument()
    expect(within(c).queryByText('Needs you')).toBeNull()
    await userEvent.click(
      within(c).getByRole('button', { name: 'End session and remove worktree' })
    )
    expect(api.sessions.endAndRemove).toHaveBeenCalledWith(`s-${t.key}`)
    expect(await within(c).findByText('Session ended and worktree removed')).toBeInTheDocument()
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('says the session ended but the worktree was kept when the removal refuses', async () => {
    vi.mocked(api.sessions.endAndRemove).mockResolvedValue({
      removed: false,
      reason: 'Commits not pushed'
    })
    const t = ticket(1, { status: 'Done' })
    renderBoard(boardView({ tickets: [t], sessions: [session(t.key)] }))
    await userEvent.click(
      within(card('Ticket 1')).getByRole('button', { name: 'End session and remove worktree' })
    )
    expect(
      await within(card('Ticket 1')).findByText(
        'Session ended. Kept the worktree: Commits not pushed'
      )
    ).toBeInTheDocument()
  })

  it("shows Can't start when the folder check fails, and a passing folder fixes every card from that repo", async () => {
    vi.mocked(api.tickets.start).mockRejectedValue(new Error(FOLDER_ERROR))
    renderBoard(boardView({ tickets: [ticket(1), ticket(2)] }))
    await startFromCard('Ticket 1')
    await startFromCard('Ticket 2')
    const c = card('Ticket 1')
    expect(await within(c).findByText("Can't start")).toBeInTheDocument()
    expect(
      within(c).getByText(`Couldn't start: ${FOLDER_ERROR}. Nothing was created.`)
    ).toBeInTheDocument()
    expect(within(c).queryByRole('button', { name: 'Start' })).toBeNull()

    vi.mocked(api.projects.pickFolder).mockResolvedValueOnce({
      path: '/elsewhere',
      repos: ['octo/other']
    })
    await userEvent.click(within(c).getByRole('button', { name: 'Choose folder…' }))
    expect(
      await within(c).findByText("This folder's git remote doesn't point at octo/shop")
    ).toBeInTheDocument()
    expect(api.projects.save).not.toHaveBeenCalled()

    vi.mocked(api.projects.pickFolder).mockResolvedValueOnce({
      path: '/new/shop',
      repos: ['Octo/Shop']
    })
    await userEvent.click(within(c).getByRole('button', { name: 'Choose folder…' }))
    expect(api.projects.save).toHaveBeenCalledWith({
      ...project,
      repos: [{ github: 'octo/shop', path: '/new/shop' }, project.repos[1]]
    })
    await vi.waitFor(() => expect(screen.queryByText("Can't start")).toBeNull())
    expect(within(card('Ticket 2')).getByRole('button', { name: 'Start' })).toBeInTheDocument()
  })

  it('checks and saves the folder of the second repo when that is the one that failed', async () => {
    vi.mocked(api.tickets.start).mockRejectedValue(new Error(folderError('octo/shop-web')))
    renderBoard(boardView({ tickets: [ticket(1), ticket(2)] }))
    await startFromCard('Ticket 1', 'octo/shop-web')
    const c = card('Ticket 1')
    expect(await within(c).findByText("Can't start")).toBeInTheDocument()

    vi.mocked(api.projects.pickFolder).mockResolvedValueOnce({
      path: '/new/shop',
      repos: ['octo/shop']
    })
    await userEvent.click(within(c).getByRole('button', { name: 'Choose folder…' }))
    expect(
      await within(c).findByText("This folder's git remote doesn't point at octo/shop-web")
    ).toBeInTheDocument()

    vi.mocked(api.projects.pickFolder).mockResolvedValueOnce({
      path: '/new/frontend',
      repos: ['octo/shop-web']
    })
    await userEvent.click(within(c).getByRole('button', { name: 'Choose folder…' }))
    expect(api.projects.save).toHaveBeenCalledWith({
      ...project,
      repos: [project.repos[0], { github: 'octo/shop-web', path: '/new/frontend' }]
    })
    await vi.waitFor(() => expect(screen.queryByText("Can't start")).toBeNull())
  })

  describe('dragging', () => {
    beforeEach(mockColumnRects)

    afterEach(() => vi.restoreAllMocks())

    const dragRight = async (title: string, cancel = false): Promise<void> => {
      card(title).focus()
      await userEvent.keyboard(' ')
      await userEvent.keyboard('{ArrowRight}')
      await userEvent.keyboard(cancel ? '{Escape}' : ' ')
    }

    it('moves a card to the next column with Space, ArrowRight, and Space', async () => {
      vi.mocked(api.tickets.move).mockReturnValue(new Promise(() => {}))
      renderBoard(boardView({ tickets: [ticket(1)] }))
      await dragRight('Ticket 1')
      expect(api.tickets.move).toHaveBeenCalledWith(
        project.id,
        'octo/shop#1',
        'inProgress',
        undefined
      )
      expect(within(column('In progress')).getByText('Ticket 1')).toBeInTheDocument()
    })

    it('ignores Up and Down Arrow on the board', async () => {
      renderBoard(boardView({ tickets: [ticket(1)] }))
      card('Ticket 1').focus()
      await userEvent.keyboard(' ')
      await userEvent.keyboard('{ArrowDown}')
      await userEvent.keyboard(' ')
      expect(api.tickets.move).not.toHaveBeenCalled()
    })

    it('puts the card back when Escape cancels a drag', async () => {
      renderBoard(boardView({ tickets: [ticket(1)] }))
      await dragRight('Ticket 1', true)
      expect(api.tickets.move).not.toHaveBeenCalled()
      expect(within(column('To do')).getByText('Ticket 1')).toBeInTheDocument()
    })

    it('still opens the ticket with Enter and a click', async () => {
      const onOpen = renderBoard(boardView({ tickets: [ticket(1)] }))
      card('Ticket 1').focus()
      await userEvent.keyboard('{Enter}')
      await userEvent.click(within(card('Ticket 1')).getByText('Ticket 1'))
      expect(onOpen).toHaveBeenCalledTimes(2)
      expect(api.tickets.move).not.toHaveBeenCalled()
    })

    it('lets a button inside a card take Space', async () => {
      renderBoard(boardView({ tickets: [ticket(1)] }))
      within(card('Ticket 1')).getByRole('button', { name: 'Start' }).focus()
      await userEvent.keyboard(' ')
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(api.tickets.move).not.toHaveBeenCalled()
    })

    it("doesn't drag a card from its note", async () => {
      renderBoard(boardView({ tickets: [ticket(1)] }))
      await userEvent.click(
        within(card('Ticket 1')).getByRole('button', { name: 'Start with note' })
      )
      const note = screen.getByRole('textbox', { name: 'Note for this session' })
      await userEvent.keyboard(' {ArrowRight} ')
      const at = (clientX: number, clientY: number): PointerEventInit => ({
        clientX,
        clientY,
        isPrimary: true,
        button: 0
      })
      fireEvent.pointerDown(note, at(10, 10))
      fireEvent.pointerMove(note, at(20, 20))
      fireEvent.pointerMove(note, at(450, 100))
      fireEvent.pointerUp(note, at(450, 100))
      expect(note).toHaveValue('  ')
      expect(api.tickets.move).not.toHaveBeenCalled()
      expect(within(column('To do')).getByText('Ticket 1')).toBeInTheDocument()
    })

    it('keeps the buttons inside a draggable card reachable', () => {
      renderBoard(boardView({ tickets: [ticket(1)] }))
      const c = screen.getByRole('group', { name: '#1 Ticket 1' })
      expect(c).not.toHaveAttribute('role', 'button')
      expect(c).not.toHaveAttribute('aria-pressed')
      expect(within(c).getByRole('button', { name: 'Start' })).toBeInTheDocument()
    })

    it('does not drag a card whose move is in flight', async () => {
      vi.mocked(api.tickets.move).mockReturnValue(new Promise(() => {}))
      renderBoard(boardView({ tickets: [ticket(1)] }))
      await dragRight('Ticket 1')
      await dragRight('Ticket 1')
      expect(api.tickets.move).toHaveBeenCalledTimes(1)
    })

    it('puts the card back in its synced column once the move answers', async () => {
      renderBoard(boardView({ tickets: [ticket(1)] }))
      await dragRight('Ticket 1')
      expect(api.tickets.move).toHaveBeenCalled()
      await vi.waitFor(() =>
        expect(within(column('To do')).getByText('Ticket 1')).toBeInTheDocument()
      )
    })

    it('does not move a card dropped on its own column', async () => {
      renderBoard(boardView({ tickets: [ticket(1)] }))
      card('Ticket 1').focus()
      await userEvent.keyboard(' ')
      await userEvent.keyboard(' ')
      expect(api.tickets.move).not.toHaveBeenCalled()
    })

    it('does not move a card released outside every column', () => {
      vi.useFakeTimers()
      try {
        renderBoard(boardView({ tickets: [ticket(1)] }))
        const at = (clientX: number, clientY: number): PointerEventInit => ({
          clientX,
          clientY,
          isPrimary: true,
          button: 0
        })
        const dragged = card('Ticket 1')
        fireEvent.pointerDown(dragged, at(10, 10))
        fireEvent.pointerMove(dragged, at(20, 20))
        fireEvent.pointerMove(dragged, at(500, 900))
        fireEvent.pointerUp(dragged, at(500, 900))
        expect(api.tickets.move).not.toHaveBeenCalled()
        // dnd-kit swallows document clicks for 50 ms after a pointer drag.
        act(() => {
          vi.advanceTimersByTime(50)
        })
      } finally {
        vi.useRealTimers()
      }
    })

    it('shows a refused move in the error line, again after Dismiss', async () => {
      vi.mocked(api.tickets.move).mockRejectedValue(
        new Error("Error invoking remote method 'tickets.move': Error: Unknown ticket")
      )
      renderBoard(boardView({ tickets: [ticket(1)] }))
      await dragRight('Ticket 1')
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent("Couldn't move #1: Unknown ticket")
      await userEvent.click(within(alert).getByRole('button', { name: 'Dismiss' }))
      expect(screen.queryByRole('alert')).toBeNull()
      await vi.waitFor(() =>
        expect(within(column('To do')).getByText('Ticket 1')).toBeInTheDocument()
      )
      await dragRight('Ticket 1')
      expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't move #1: Unknown ticket")
    })

    it('shows a repeated synced move error again after a fresh drop', async () => {
      vi.mocked(api.tickets.move).mockRejectedValue(new Error('no write access'))
      const failed = boardView({ tickets: [ticket(1)], error: "Couldn't move #1: no write access" })
      render(
        <Board
          {...handlers}
          project={project}
          view={failed}
          onSync={vi.fn()}
          onOpenTicket={vi.fn()}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
      await dragRight('Ticket 1')
      expect(await screen.findByRole('alert')).toHaveTextContent(
        "Couldn't move #1: no write access"
      )
    })

    it('keeps a dismissed sync error hidden when a move succeeds', async () => {
      render(
        <Board
          {...handlers}
          project={project}
          view={boardView({ tickets: [ticket(1)], error: 'GitHub is down' })}
          onSync={vi.fn()}
          onOpenTicket={vi.fn()}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
      await dragRight('Ticket 1')
      await vi.waitFor(() => expect(api.tickets.move).toHaveBeenCalled())
      expect(screen.queryByRole('alert')).toBeNull()
    })

    it('shows a later sync error after a refused move, dismissed or not', async () => {
      vi.mocked(api.tickets.move).mockRejectedValue(new Error('Unknown ticket'))
      const view = (error: string | null): BoardView => boardView({ tickets: [ticket(1)], error })
      const board = (error: string | null): React.JSX.Element => (
        <Board
          {...handlers}
          project={project}
          view={view(error)}
          onSync={vi.fn()}
          onOpenTicket={vi.fn()}
        />
      )
      const { rerender } = render(board(null))
      await dragRight('Ticket 1')
      expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't move #1: Unknown ticket")
      rerender(board('GitHub is down'))
      expect(screen.getByRole('alert')).toHaveTextContent('GitHub is down')
      rerender(board(null))
      await vi.waitFor(() =>
        expect(within(column('To do')).getByText('Ticket 1')).toBeInTheDocument()
      )
      await dragRight('Ticket 1')
      await userEvent.click(
        within(await screen.findByRole('alert')).getByRole('button', { name: 'Dismiss' })
      )
      rerender(board('Rate limited'))
      expect(screen.getByRole('alert')).toHaveTextContent('Rate limited')
    })

    it('does not open the ticket on Enter while it is being dragged', async () => {
      const onOpen = renderBoard(boardView({ tickets: [ticket(1)] }))
      card('Ticket 1').focus()
      await userEvent.keyboard(' ')
      await userEvent.keyboard('{ArrowRight}')
      await userEvent.keyboard('{Enter}')
      expect(onOpen).not.toHaveBeenCalled()
    })

    it('does not move after the board is gone mid-drag', async () => {
      const { unmount } = render(
        <Board
          {...handlers}
          project={project}
          view={boardView({ tickets: [ticket(1)] })}
          onSync={vi.fn()}
          onOpenTicket={vi.fn()}
        />
      )
      card('Ticket 1').focus()
      await userEvent.keyboard(' ')
      await userEvent.keyboard('{ArrowRight}')
      unmount()
      await userEvent.keyboard(' ')
      expect(api.tickets.move).not.toHaveBeenCalled()
    })

    it('announces where a moved card ends up', async () => {
      vi.mocked(api.tickets.move).mockReturnValue(new Promise(() => {}))
      renderBoard(boardView({ tickets: [ticket(1)] }))
      await dragRight('Ticket 1')
      expect(await screen.findByRole('status')).toHaveTextContent('Moved #1 to In progress.')
    })

    it('announces the column names to a screen reader', async () => {
      renderBoard(boardView({ tickets: [ticket(1)] }))
      card('Ticket 1').focus()
      await userEvent.keyboard(' ')
      await userEvent.keyboard('{ArrowRight}')
      expect(await screen.findByRole('status')).toHaveTextContent('Over In progress.')
      await userEvent.keyboard('{Escape}')
      expect(screen.getByRole('status')).toHaveTextContent('Move canceled. #1 stays in To do.')
    })
  })

  describe('new ticket', () => {
    it('turns the New ticket placeholder at the end of To do into a composer', async () => {
      const onDrafted = vi.fn()
      render(
        <Board
          {...handlers}
          project={project}
          view={boardView({ tickets: [ticket(1)] })}
          onSync={vi.fn()}
          onOpenTicket={vi.fn()}
          onDrafted={onDrafted}
        />
      )
      expect(within(column('In progress')).queryByRole('button', { name: 'New ticket' })).toBeNull()
      await userEvent.click(within(column('To do')).getByRole('button', { name: 'New ticket' }))
      const form = within(column('To do')).getByRole('form', { name: 'New ticket' })
      expect(within(form).getByLabelText('Title')).toHaveFocus()
      expect(screen.queryByRole('button', { name: 'New ticket' })).not.toBeInTheDocument()
      await userEvent.click(within(form).getByRole('button', { name: 'Draft with Claude' }))
      expect(onDrafted).toHaveBeenCalledWith('a1')
    })

    it('reopens the composer with its draft after the board mounts again', async () => {
      const { unmount } = render(
        <Board
          {...handlers}
          project={project}
          view={boardView()}
          onSync={vi.fn()}
          onOpenTicket={vi.fn()}
          onDrafted={vi.fn()}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: 'New ticket' }))
      await userEvent.keyboard('Dark mode')
      unmount()
      renderBoard(boardView())
      expect(screen.getByLabelText('Title')).toHaveValue('Dark mode')
    })

    it('puts the placeholder back on Escape', async () => {
      render(
        <Board
          {...handlers}
          project={project}
          view={boardView()}
          onSync={vi.fn()}
          onOpenTicket={vi.fn()}
          onDrafted={vi.fn()}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: 'New ticket' }))
      await userEvent.keyboard('{Escape}')
      expect(screen.queryByRole('form', { name: 'New ticket' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'New ticket' })).toHaveFocus()
    })

    it('returns focus to the placeholder on Close after a created issue', async () => {
      vi.mocked(window.sandtable.tickets.create).mockRejectedValue(
        new Error("Created octo/shop#9, but couldn't refresh the board: rate limited")
      )
      render(
        <Board
          {...handlers}
          project={project}
          view={boardView()}
          onSync={vi.fn()}
          onOpenTicket={vi.fn()}
          onDrafted={vi.fn()}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: 'New ticket' }))
      await userEvent.keyboard('Dark mode{Enter}')
      await userEvent.click(await screen.findByRole('button', { name: 'Close' }))
      expect(screen.getByRole('button', { name: 'New ticket' })).toHaveFocus()
    })
  })

  describe('sessions without a ticket', () => {
    it('opens the New session dialog from the tile that ends the Sessions strip', async () => {
      const onNewSession = vi.fn()
      render(
        <Board
          {...handlers}
          project={project}
          view={boardView()}
          onSync={vi.fn()}
          onOpenTicket={vi.fn()}
          onNewSession={onNewSession}
        />
      )
      expect(screen.getAllByRole('button', { name: 'New session' })).toHaveLength(1)
      const strip = screen.getByRole('region', { name: 'Sessions' })
      await userEvent.click(within(strip).getByRole('button', { name: 'New session' }))
      expect(onNewSession).toHaveBeenCalled()
    })

    it('explains New session in a tooltip on hover and keeps its name', async () => {
      render(
        <Board
          {...handlers}
          project={project}
          view={boardView()}
          onSync={vi.fn()}
          onOpenTicket={vi.fn()}
          onNewSession={vi.fn()}
        />
      )
      await userEvent.hover(screen.getByRole('button', { name: 'New session' }))
      expect(await screen.findByRole('tooltip')).toHaveTextContent(
        "Start a Claude Code session that isn't tied to a ticket"
      )
    })

    it('lists unremoved sessions with their state words, and a click opens one', async () => {
      const onOpenSession = vi.fn()
      render(
        <Board
          {...handlers}
          project={project}
          view={boardView({
            tickets: [ticket(1)],
            sessions: [
              session(ticket(1).key),
              adhoc({ state: 'needsYou' }),
              adhoc({
                id: 'a2',
                name: 'Gone',
                state: 'finished',
                removedAt: '2026-10-24T11:00:00Z'
              })
            ]
          })}
          onSync={vi.fn()}
          onOpenTicket={vi.fn()}
          onOpenSession={onOpenSession}
        />
      )
      const strip = screen.getByRole('region', { name: 'Sessions' })
      expect(within(strip).getByText('1')).toBeInTheDocument()
      expect(within(strip).getByText('Needs you')).toBeInTheDocument()
      expect(within(strip).getByText('main checkout')).toBeInTheDocument()
      expect(within(strip).queryByText('Gone')).not.toBeInTheDocument()
      await userEvent.click(within(strip).getByText('Oct 24, 10:00'))
      expect(onOpenSession).toHaveBeenCalledWith('a1')
    })

    it('shows the Sessions strip with a count of 0 without such sessions', () => {
      renderBoard(boardView({ tickets: [ticket(1)], sessions: [session(ticket(1).key)] }))
      const strip = screen.getByRole('region', { name: 'Sessions' })
      expect(within(strip).getByRole('heading')).toHaveTextContent('Sessions0')
    })

    it('shows the Routines section above Sessions, with New routine opening the editor', async () => {
      const nightly = {
        id: 'r1',
        projectId: 'p1',
        name: 'Nightly',
        repo: 'octo/shop',
        worktree: true,
        message: 'Check dependencies'
      }
      renderBoard(boardView({ routines: [nightly] }))
      const routines = screen.getByRole('region', { name: 'Routines' })
      const sessions = screen.getByRole('region', { name: 'Sessions' })
      expect(
        routines.compareDocumentPosition(sessions) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
      expect(within(routines).getByRole('button', { name: 'Start Nightly' })).toBeInTheDocument()
      await userEvent.click(within(routines).getByRole('button', { name: /New routine/ }))
      expect(handlers.onRoutine).toHaveBeenCalledWith(project)
    })
  })

  describe('label filter', () => {
    const labeled = (): BoardView =>
      boardView({
        tickets: [
          ticket(1, {
            labels: [
              { name: 'bug', color: 'd73a4a' },
              { name: 'sandtable: in progress', color: 'fb8500' }
            ]
          }),
          ticket(2, { labels: [{ name: 'documentation', color: '0075ca' }] }),
          ticket(3)
        ]
      })

    beforeEach(() => localStorage.clear())

    it('has an icon-only Filters button on the toolbar after Display', () => {
      renderBoard(labeled(), vi.fn(), solo)
      const button = screen.getByRole('button', { name: 'Filters' })
      expect(button).toHaveTextContent('')
      expect(screen.getByRole('button', { name: 'Display' }).compareDocumentPosition(button)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING
      )
      expect(button.compareDocumentPosition(column('To do'))).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    })

    it("lists the tickets' labels without Sandtable's own", async () => {
      renderBoard(labeled(), vi.fn(), solo)
      await openFilters()
      const items = screen.getAllByRole('menuitemcheckbox').map((i) => i.textContent)
      expect(items).toEqual(['bug', 'documentation'])
    })

    it('shows only tickets with a selected label and says how many are hidden', async () => {
      renderBoard(labeled(), vi.fn(), solo)
      await openFilters()
      await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'bug' }))
      expect(screen.getByRole('menuitemcheckbox', { name: 'bug' })).toBeChecked()
      await userEvent.keyboard('{Escape}')
      expect(screen.getByRole('button', { name: 'Filters, 1 checked' })).toBeInTheDocument()
      expect(screen.getByText('Ticket 1')).toBeInTheDocument()
      expect(screen.queryByText('Ticket 2')).not.toBeInTheDocument()
      expect(screen.queryByText('Ticket 3')).not.toBeInTheDocument()
      expect(screen.getByText('2 hidden by filter')).toBeInTheDocument()
      expect(within(column('To do')).getByText('1')).toBeInTheDocument()
    })

    it('hides tickets with the selected labels in hide mode, and Clear filter shows all', async () => {
      renderBoard(labeled(), vi.fn(), solo)
      await openFilters()
      await userEvent.click(screen.getByRole('menuitemradio', { name: 'Hide' }))
      await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'documentation' }))
      await userEvent.keyboard('{Escape}')
      expect(screen.queryByText('Ticket 2')).not.toBeInTheDocument()
      expect(screen.getByText('Ticket 3')).toBeInTheDocument()
      expect(screen.getByText('1 hidden by filter')).toBeInTheDocument()
      await openFilters()
      await userEvent.click(screen.getByRole('menuitem', { name: 'Clear filter' }))
      expect(screen.getByText('Ticket 2')).toBeInTheDocument()
      expect(screen.queryByText(/hidden by filter/)).not.toBeInTheDocument()
    })

    it("doesn't count or list a Wont fix ticket", async () => {
      const view = labeled()
      view.tickets.push(
        ticket(4, { status: 'Wont fix', labels: [{ name: 'wontfix', color: 'ffffff' }] })
      )
      renderBoard(view, vi.fn(), solo)
      await openFilters()
      expect(screen.queryByRole('menuitemcheckbox', { name: 'wontfix' })).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'bug' }))
      expect(screen.getByText('2 hidden by filter')).toBeInTheDocument()
    })

    it('remembers the filter per project when the board opens again', async () => {
      renderBoard(labeled(), vi.fn(), solo)
      await openFilters()
      await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'bug' }))
      cleanup()
      renderBoard(labeled(), vi.fn(), solo)
      expect(screen.queryByText('Ticket 2')).not.toBeInTheDocument()
      cleanup()
      render(
        <Board
          {...handlers}
          project={{ ...solo, id: 'p2' }}
          view={labeled()}
          onSync={vi.fn()}
          onOpenTicket={vi.fn()}
        />
      )
      expect(screen.getByText('Ticket 2')).toBeInTheDocument()
    })
  })

  describe('repo filter', () => {
    const front = 'octo/shop-web'
    const spread = (): BoardView =>
      boardView({
        tickets: [
          ticket(1, { labels: [{ name: 'bug', color: 'd73a4a' }] }),
          ticket(2, { repo: front, labels: [{ name: 'bug', color: 'd73a4a' }] }),
          ticket(3, { repo: front, assignees: [{ id: 'U_ann', login: 'ann', name: null }] })
        ]
      })

    beforeEach(() => localStorage.clear())

    it('has no Repos submenu in a project with one repo, and ignores a saved repo filter there', async () => {
      localStorage.setItem('repoFilter:p1', JSON.stringify({ mode: 'only', repos: [front] }))
      renderBoard(spread(), vi.fn(), solo)
      expect(screen.queryByText(/hidden by filter/)).not.toBeInTheDocument()
      await openFilters()
      expect(screen.queryByRole('menuitem', { name: /^Repos/ })).not.toBeInTheDocument()
      expect(screen.getByRole('menuitemcheckbox', { name: 'bug' })).toBeInTheDocument()
    })

    it('offers Labels and Repos submenus, each with its own mode', async () => {
      renderBoard(spread())
      await openFilters()
      const subs = screen.getAllByRole('menuitem').map((i) => i.textContent)
      expect(subs).toEqual(['Labels', 'Repos'])
      await userEvent.click(screen.getByRole('menuitem', { name: 'Repos' }))
      const rows = screen.getAllByRole('menuitemcheckbox').map((i) => i.textContent)
      expect(rows).toEqual(['octo/shop', front])
      expect(screen.getByRole('menuitemradio', { name: 'Show only' })).toBeChecked()
    })

    it('shows only tickets from a checked repo', async () => {
      renderBoard(spread())
      await openSub('Repos')
      await userEvent.click(screen.getByRole('menuitemcheckbox', { name: front }))
      expect(screen.getByRole('menuitemcheckbox', { name: front })).toBeChecked()
      expect(screen.getByRole('menuitem', { name: 'Repos, 1 checked' })).toBeInTheDocument()
      await userEvent.keyboard('{Escape}{Escape}')
      expect(screen.getByRole('button', { name: 'Filters, 1 checked' })).toBeInTheDocument()
      expect(screen.queryByText('Ticket 1')).not.toBeInTheDocument()
      expect(screen.getByText('Ticket 3')).toBeInTheDocument()
      expect(screen.getByText('1 hidden by filter')).toBeInTheDocument()
    })

    it('lists a checked repo the project no longer has, and unchecking it shows every ticket', async () => {
      localStorage.setItem('repoFilter:p1', JSON.stringify({ mode: 'only', repos: ['gone/repo'] }))
      renderBoard(spread())
      expect(screen.getByText('3 hidden by filter')).toBeInTheDocument()
      await openSub('Repos')
      const gone = screen.getByRole('menuitemcheckbox', { name: 'gone/repo' })
      expect(gone).toBeChecked()
      await userEvent.click(gone)
      expect(screen.queryByText(/hidden by filter/)).not.toBeInTheDocument()
    })

    it('hides tickets from a checked repo in hide mode', async () => {
      renderBoard(spread())
      await openSub('Repos')
      await userEvent.click(screen.getByRole('menuitemradio', { name: 'Hide' }))
      await userEvent.click(screen.getByRole('menuitemcheckbox', { name: front }))
      await userEvent.keyboard('{Escape}{Escape}')
      expect(screen.getByText('Ticket 1')).toBeInTheDocument()
      expect(screen.queryByText('Ticket 2')).not.toBeInTheDocument()
      expect(screen.getByText('2 hidden by filter')).toBeInTheDocument()
    })

    it('offers No repo last on a Linear project, for issues with no repo yet', async () => {
      render(
        <Board
          {...handlers}
          project={linearProject}
          view={boardView({
            tickets: [linearTicket(12), linearTicket(13, { repo: 'octo/shop' })]
          })}
          onSync={vi.fn()}
          onOpenTicket={vi.fn()}
        />
      )
      await openSub('Repos')
      expect(screen.getAllByRole('menuitemcheckbox').at(-1)).toHaveTextContent('No repo')
      await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'No repo' }))
      await userEvent.keyboard('{Escape}{Escape}')
      expect(screen.getByText('Ticket 12')).toBeInTheDocument()
      expect(screen.queryByText('Ticket 13')).not.toBeInTheDocument()
    })

    it('shows only tickets that pass the label, repo, and assignee filters', () => {
      localStorage.setItem('labelFilter:p1', JSON.stringify({ mode: 'only', labels: ['bug'] }))
      localStorage.setItem('repoFilter:p1', JSON.stringify({ mode: 'only', repos: [front] }))
      renderBoard(spread())
      expect(screen.getByText('Ticket 2')).toBeInTheDocument()
      expect(screen.getByText('2 hidden by filter')).toBeInTheDocument()
      cleanup()
      localStorage.setItem('assigneeFilter:p1', JSON.stringify({ mode: 'only', people: ['ann'] }))
      renderBoard(spread())
      expect(screen.getByText('3 hidden by filter')).toBeInTheDocument()
    })

    it('remembers the repo filter per project when the board opens again', async () => {
      renderBoard(spread())
      await openSub('Repos')
      await userEvent.click(screen.getByRole('menuitemcheckbox', { name: front }))
      cleanup()
      renderBoard(spread())
      expect(screen.queryByText('Ticket 1')).not.toBeInTheDocument()
      cleanup()
      renderBoard(spread(), vi.fn(), { ...project, id: 'p2' })
      expect(screen.getByText('Ticket 1')).toBeInTheDocument()
    })

    it('clears both labels and repos with Clear filter', async () => {
      localStorage.setItem('labelFilter:p1', JSON.stringify({ mode: 'hide', labels: ['bug'] }))
      localStorage.setItem('repoFilter:p1', JSON.stringify({ mode: 'hide', repos: [front] }))
      renderBoard(spread())
      expect(screen.getByText('3 hidden by filter')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Filters, 2 checked' })).toBeInTheDocument()
      await openFilters()
      await userEvent.click(screen.getByRole('menuitem', { name: 'Clear filter' }))
      expect(screen.queryByText(/hidden by filter/)).not.toBeInTheDocument()
      expect(JSON.parse(localStorage.getItem('labelFilter:p1')!).labels).toEqual([])
      expect(JSON.parse(localStorage.getItem('repoFilter:p1')!).repos).toEqual([])
    })
  })

  describe('assignee filter', () => {
    const assigned = (): BoardView =>
      boardView({
        tickets: [
          ticket(1, {
            assignees: [{ id: 'U_ME', login: 'ME', name: null }],
            labels: [{ name: 'bug', color: 'ffffff' }]
          }),
          ticket(2, { assignees: [{ id: 'U_ann', login: 'ann', name: 'Ann Lee' }] }),
          ticket(3, { labels: [{ name: 'bug', color: 'ffffff' }] })
        ]
      })
    const openFilter = (): Promise<void> =>
      userEvent.click(screen.getByRole('button', { name: /^Assignees/ }))

    beforeEach(() => localStorage.clear())

    it('has an icon-only Assignees button after Filters, listing Me, Unassigned, then people', async () => {
      renderBoard(assigned())
      const button = screen.getByRole('button', { name: 'Assignees' })
      expect(button).toHaveTextContent('')
      expect(screen.getByRole('button', { name: 'Filters' }).compareDocumentPosition(button)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING
      )
      await openFilter()
      const items = screen.getAllByRole('menuitemcheckbox')
      const names = ['Me', 'Unassigned', 'Ann Lee', 'ME']
      expect(items).toEqual(names.map((name) => screen.getByRole('menuitemcheckbox', { name })))
    })

    it('shows only tickets assigned to the signed-in user with Me', async () => {
      renderBoard(assigned())
      await openFilter()
      await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Me' }))
      await userEvent.keyboard('{Escape}')
      expect(api.projects.me).toHaveBeenCalledWith('p1')
      expect(await screen.findByText('2 hidden by filter')).toBeInTheDocument()
      expect(screen.getByText('Ticket 1')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Assignees, 1 checked' })).toBeInTheDocument()
    })

    it('shows only unassigned tickets with Unassigned', async () => {
      renderBoard(assigned())
      await openFilter()
      await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Unassigned' }))
      await userEvent.keyboard('{Escape}')
      expect(screen.getByText('Ticket 3')).toBeInTheDocument()
      expect(screen.getByText('2 hidden by filter')).toBeInTheDocument()
    })

    it('shows only tickets that pass both the label and assignee filters', async () => {
      localStorage.setItem('labelFilter:p1', JSON.stringify({ mode: 'only', labels: ['bug'] }))
      localStorage.setItem('assigneeFilter:p1', JSON.stringify({ mode: 'hide', people: ['@none'] }))
      renderBoard(assigned())
      expect(screen.getByText('Ticket 1')).toBeInTheDocument()
      expect(screen.getByText('2 hidden by filter')).toBeInTheDocument()
    })

    it('asks who Me is again after the next sync when the first ask fails', async () => {
      localStorage.setItem('assigneeFilter:p1', JSON.stringify({ mode: 'only', people: ['@me'] }))
      vi.mocked(api.projects.me).mockRejectedValueOnce(new Error('offline'))
      const { rerender } = render(
        <Board
          {...handlers}
          project={project}
          view={assigned()}
          onSync={vi.fn()}
          onOpenTicket={vi.fn()}
        />
      )
      expect(await screen.findByText('3 hidden by filter')).toBeInTheDocument()
      rerender(
        <Board
          {...handlers}
          project={project}
          view={{ ...assigned(), syncedAt: '2026-10-26T00:00:00.000Z' }}
          onSync={vi.fn()}
          onOpenTicket={vi.fn()}
        />
      )
      expect(await screen.findByText('Ticket 1')).toBeInTheDocument()
      expect(api.projects.me).toHaveBeenCalledTimes(2)
    })

    it('remembers the filter per project when the board opens again', async () => {
      renderBoard(assigned())
      await openFilter()
      await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Ann Lee' }))
      cleanup()
      renderBoard(assigned())
      expect(screen.getByText('Ticket 2')).toBeInTheDocument()
      expect(screen.queryByText('Ticket 1')).not.toBeInTheDocument()
      expect(api.projects.me).not.toHaveBeenCalled()
    })
  })

  describe('display', () => {
    const view = (): BoardView =>
      boardView({
        tickets: [
          ticket(1, { updatedAt: '2026-10-03T00:00:00.000Z' }),
          ticket(2, {
            updatedAt: '2026-10-09T00:00:00.000Z',
            labels: [{ name: 'docs', color: 'ffffff' }]
          }),
          ticket(3, {
            updatedAt: '2026-10-05T00:00:00.000Z',
            labels: [{ name: 'bug', color: 'ffffff' }]
          })
        ]
      })
    const titles = (): string[] =>
      within(column('To do'))
        .getAllByText(/^Ticket \d$/)
        .map((e) => e.textContent!)
    const choose = async (name: string): Promise<void> => {
      await userEvent.click(screen.getByRole('button', { name: /^Display/ }))
      await userEvent.click(screen.getByRole('menuitemradio', { name }))
      await userEvent.keyboard('{Escape}')
    }

    beforeEach(() => localStorage.clear())

    it("keeps the board's manual order by default", () => {
      renderBoard(view())
      expect(titles()).toEqual(['Ticket 1', 'Ticket 2', 'Ticket 3'])
      const button = screen.getByRole('button', { name: 'Display' })
      expect(button).toHaveTextContent(/^$/)
      expect(button).not.toHaveAttribute('title')
    })

    it('puts the most recently updated ticket first and says so on the button', async () => {
      renderBoard(view())
      await choose('Updated')
      expect(titles()).toEqual(['Ticket 2', 'Ticket 3', 'Ticket 1'])
      const button = screen.getByRole('button', { name: 'Display, ordered by Updated, descending' })
      expect(button).toHaveTextContent(/^Updated ↓$/)
      expect(button).not.toHaveAttribute('title')
      await choose('Ascending')
      expect(titles()).toEqual(['Ticket 1', 'Ticket 3', 'Ticket 2'])
    })

    it('groups by label A to Z with unlabeled tickets last', async () => {
      renderBoard(view())
      await choose('Label')
      expect(titles()).toEqual(['Ticket 3', 'Ticket 2', 'Ticket 1'])
    })

    it('calls the default Default on a project without a board', async () => {
      render(
        <Board
          {...handlers}
          project={{ ...project, board: undefined }}
          view={view()}
          onSync={vi.fn()}
          onOpenTicket={vi.fn()}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: 'Display' }))
      expect(screen.getByRole('menuitemradio', { name: 'Default' })).toBeChecked()
    })

    it('rises a card that a sync changed, so its jump to a new place shows', () => {
      const animate = vi.fn()
      HTMLElement.prototype.animate = animate
      onTestFinished(() => {
        delete (HTMLElement.prototype as Partial<HTMLElement>).animate
      })
      const onOpenTicket = vi.fn()
      const { rerender } = render(
        <Board
          {...handlers}
          project={project}
          view={view()}
          onSync={vi.fn()}
          onOpenTicket={onOpenTicket}
        />
      )
      const next = view()
      next.tickets[0] = { ...next.tickets[0], updatedAt: '2026-10-10T00:00:00.000Z' }
      rerender(
        <Board
          {...handlers}
          project={project}
          view={next}
          onSync={vi.fn()}
          onOpenTicket={onOpenTicket}
        />
      )
      expect(animate).toHaveBeenCalledTimes(1)
    })

    it('remembers the order per project when the board opens again', async () => {
      renderBoard(view())
      await choose('Updated')
      cleanup()
      renderBoard(view())
      expect(titles()).toEqual(['Ticket 2', 'Ticket 3', 'Ticket 1'])
    })
  })

  describe('To clean up', () => {
    const unknown = { kind: 'unknown' as const, tmuxName: 'st-old-1' }
    const panel = (): HTMLElement => screen.getByRole('dialog', { name: 'To clean up' })

    it('shows a header button with the count', async () => {
      vi.mocked(api.sessions.leftovers).mockResolvedValue([
        unknown,
        { kind: 'unknown', tmuxName: 'st-old-2' }
      ])
      renderBoard(boardView())
      const button = await screen.findByRole('button', { name: '2 sessions to clean up' })
      expect(button).toHaveTextContent(/^2$/)
      expect(button).not.toHaveAttribute('title')
      expect(button).toHaveClass('bg-danger-soft', 'text-danger')
      expect(screen.queryByRole('button', { name: 'Review' })).not.toBeInTheDocument()
    })

    it('hides when there are none', async () => {
      renderBoard(boardView())
      await act(async () => {})
      expect(screen.queryByRole('button', { name: /to clean up/ })).not.toBeInTheDocument()
    })

    it('opens the list in a side panel with Clean up all in its header', async () => {
      vi.mocked(api.sessions.leftovers).mockResolvedValue([
        unknown,
        { kind: 'unknown', tmuxName: 'st-old-2' }
      ])
      renderBoard(boardView())
      await userEvent.click(await screen.findByRole('button', { name: '2 sessions to clean up' }))
      expect(
        await within(panel()).findByRole('group', { name: 'Unknown session st-old-1' })
      ).toBeInTheDocument()
      const header = within(panel()).getByRole('heading', { name: 'To clean up' }).parentElement!
      expect(within(header).getByRole('button', { name: 'Clean up all' })).toBeInTheDocument()
      expect(within(header).getByRole('button', { name: 'Close' })).toBeEnabled()
    })

    it("can't close while a cleanup runs", async () => {
      vi.mocked(api.sessions.leftovers).mockResolvedValue([unknown])
      let finish = (): void => {}
      vi.mocked(api.sessions.endUnknown).mockImplementation(
        () => new Promise<void>((r) => (finish = r))
      )
      renderBoard(boardView())
      await userEvent.click(await screen.findByRole('button', { name: '1 session to clean up' }))
      await userEvent.click(await within(panel()).findByRole('button', { name: 'End session' }))
      expect(within(panel()).getByRole('button', { name: 'Close' })).toBeDisabled()
      await userEvent.keyboard('{Escape}')
      await userEvent.click(document.querySelector('[data-slot="sheet-overlay"]')!)
      expect(panel()).toBeInTheDocument()
      await act(async () => finish())
      await vi.waitFor(() =>
        expect(within(panel()).getByRole('button', { name: 'Close' })).toBeEnabled()
      )
    })

    it('recounts when the panel closes', async () => {
      vi.mocked(api.sessions.leftovers).mockResolvedValue([unknown])
      renderBoard(boardView())
      await userEvent.click(await screen.findByRole('button', { name: '1 session to clean up' }))
      await within(panel()).findByRole('group')
      vi.mocked(api.sessions.leftovers).mockResolvedValue([])
      await userEvent.click(within(panel()).getByRole('button', { name: 'Close' }))
      await vi.waitFor(() =>
        expect(screen.queryByRole('button', { name: /to clean up/ })).not.toBeInTheDocument()
      )
    })
  })

  describe('Linear project', () => {
    beforeEach(() => localStorage.clear())

    const renderLinear = (view: BoardView): void => {
      render(
        <Board
          {...handlers}
          project={linearProject}
          view={view}
          onSync={vi.fn()}
          onOpenTicket={vi.fn()}
          onDrafted={vi.fn()}
        />
      )
    }

    it('names a Jira project by key and name in the header', () => {
      render(
        <Board
          {...handlers}
          project={{
            ...linearProject,
            linear: undefined,
            jira: { site: 'acme.atlassian.net', project: 'INF', name: 'Internal' }
          }}
          view={boardView({ tickets: [] })}
          onSync={vi.fn()}
          onOpenTicket={vi.fn()}
          onDrafted={vi.fn()}
        />
      )
      expect(screen.getByText('Jira project INF (Internal)')).toBeInTheDocument()
    })

    it('names the team and its projects in the header and has New ticket on the board and list', async () => {
      renderLinear(boardView({ tickets: [linearTicket(12)] }))
      expect(screen.getByText('Linear team APP, Launch')).toBeInTheDocument()
      expect(within(column('To do')).getByRole('button', { name: 'New ticket' })).toBeVisible()
      await userEvent.click(
        within(screen.getByRole('group', { name: 'View' })).getByRole('button', { name: 'List' })
      )
      const row = screen.getByRole('group', { name: 'APP-12 Ticket 12' })
      expect(within(row).getByText('APP-12')).toHaveAttribute('title', 'APP-12')
      expect(screen.getByRole('button', { name: 'New ticket' })).toBeVisible()
    })

    it('announces a drag with the Linear key', async () => {
      renderLinear(boardView({ tickets: [linearTicket(12)] }))
      card('Ticket 12').focus()
      await userEvent.keyboard(' ')
      expect(await screen.findByRole('status')).toHaveTextContent('Picked up APP-12.')
      await userEvent.keyboard('{Escape}')
    })

    it('labels a card with its key and offers Start with no repo, asking for one', async () => {
      renderLinear(boardView({ tickets: [linearTicket(12)] }))
      const c = card('Ticket 12')
      expect(c).toHaveAccessibleName('APP-12 Ticket 12')
      expect(within(c).getByText('APP-12')).toBeInTheDocument()
      expect(within(c).queryByText('Repo not in this project')).toBeNull()
      await userEvent.click(within(c).getByRole('button', { name: 'Start' }))
      const dialog = await screen.findByRole('dialog')
      await userEvent.click(within(dialog).getByRole('radio', { name: 'octo/shop' }))
      await userEvent.click(within(dialog).getByRole('button', { name: 'Start' }))
      expect(api.tickets.start).toHaveBeenCalledWith(
        'p1',
        'APP-12',
        [],
        'octo/shop',
        undefined,
        undefined,
        undefined
      )
    })
  })

  describe('view switcher', () => {
    const view = (): BoardView => boardView({ tickets: [ticket(1)] })
    const switcher = (): HTMLElement => screen.getByRole('group', { name: 'View' })

    beforeEach(() => localStorage.clear())

    it('has icon-only Board and List buttons, with Board pressed', () => {
      renderBoard(view())
      const board = within(switcher()).getByRole('button', { name: 'Board' })
      const list = within(switcher()).getByRole('button', { name: 'List' })
      expect(board).toHaveTextContent('')
      expect(list).toHaveTextContent('')
      expect(board).not.toHaveAttribute('title')
      expect(list).not.toHaveAttribute('title')
      expect(board).toHaveAttribute('aria-pressed', 'true')
      expect(list).toHaveAttribute('aria-pressed', 'false')
    })

    it('switches between the columns and the list', async () => {
      renderBoard(view())
      await userEvent.click(within(switcher()).getByRole('button', { name: 'List' }))
      expect(within(switcher()).getByRole('button', { name: 'List' })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      expect(screen.queryByRole('heading', { name: /^To do/ })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^To do/ })).toHaveAttribute(
        'aria-expanded',
        'true'
      )
      expect(screen.getByRole('button', { name: 'Display' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument()
      await userEvent.click(within(switcher()).getByRole('button', { name: 'Board' }))
      expect(within(column('To do')).getByText('Ticket 1')).toBeInTheDocument()
    })

    it('remembers the view per project when the board opens again', async () => {
      renderBoard(view())
      await userEvent.click(within(switcher()).getByRole('button', { name: 'List' }))
      cleanup()
      renderBoard(view())
      expect(screen.queryByRole('heading', { name: /^To do/ })).not.toBeInTheDocument()
      cleanup()
      render(
        <Board
          {...handlers}
          project={{ ...project, id: 'p2' }}
          view={view()}
          onSync={vi.fn()}
          onOpenTicket={vi.fn()}
        />
      )
      expect(screen.getByRole('heading', { name: /^To do/ })).toBeInTheDocument()
    })

    it('starts each column heading with its status icon', () => {
      renderBoard(boardView({ tickets: [] }))
      for (const name of ['To do', 'In progress', 'Done']) {
        const heading = within(column(name)).getByRole('heading')
        expect(heading.firstElementChild?.tagName.toLowerCase()).toBe('svg')
        expect(heading.firstElementChild).toHaveAttribute('aria-hidden', 'true')
      }
    })
  })

  describe('list view', () => {
    const showList = (): Promise<void> =>
      userEvent.click(
        within(screen.getByRole('group', { name: 'View' })).getByRole('button', { name: 'List' })
      )
    const header = (name: string): HTMLElement =>
      within(column(name)).getByRole('button', { name: new RegExp(`^${name}`) })
    const row = (name: string): HTMLElement => screen.getByRole('group', { name })
    const mixed = (): BoardView =>
      boardView({
        tickets: [
          ticket(1, { status: 'Todo', labels: [{ name: 'bug', color: 'd73a4a' }] }),
          ticket(2, { status: 'In Progress' }),
          ticket(3, { status: 'Todo' }),
          ticket(4, { status: 'Done' })
        ]
      })

    beforeEach(() => {
      localStorage.clear()
      mockListRects()
    })

    afterEach(() => vi.restoreAllMocks())

    it('groups the tickets by status in board order with a count on each header', async () => {
      renderBoard(mixed())
      await showList()
      const groups = ['To do', 'In progress', 'Done'].map(column)
      expect(groups[0].compareDocumentPosition(groups[1])).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
      expect(groups[1].compareDocumentPosition(groups[2])).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
      expect(header('To do')).toHaveTextContent('To do 2')
      expect(header('In progress')).toHaveTextContent('In progress 1')
      expect(header('Done')).toHaveTextContent('Done 1')
      expect(header('To do')).toHaveAttribute('aria-expanded', 'true')
      expect(header('To do')).toHaveAccessibleName('To do 2')
      const [chevron, status] = header('To do').querySelectorAll('svg')
      expect(chevron).toHaveAttribute('aria-hidden', 'true')
      expect(status).toHaveAttribute('viewBox', '0 0 14 14')
      expect(status).toHaveAttribute('aria-hidden', 'true')
      expect(
        within(column('To do'))
          .getAllByRole('group')
          .map((r) => r.getAttribute('aria-label'))
      ).toEqual(['#1 Ticket 1', '#3 Ticket 3'])
      expect(within(column('Done')).getByRole('group', { name: '#4 Ticket 4' })).toBeInTheDocument()
    })

    it('shows Finished on a finished row outside Done but not on one in Done', async () => {
      const a = ticket(1)
      const b = ticket(2, { status: 'Done' })
      renderBoard(
        boardView({
          tickets: [a, b],
          sessions: [session(a.key, { state: 'finished' }), session(b.key, { state: 'finished' })]
        })
      )
      await showList()
      expect(within(row('#1 Ticket 1')).getByText('Finished')).toBeInTheDocument()
      expect(within(row('#2 Ticket 2')).queryByText('Finished')).toBeNull()
    })

    it('shows the number, title, labels, state word, and updated date on a row', async () => {
      const t = ticket(5, {
        title: 'Dark mode toggle',
        labels: [
          { name: 'bug', color: 'd73a4a' },
          { name: 'sandtable: in progress', color: 'fb8500' }
        ],
        updatedAt: new Date(2026, 9, 23, 9, 30).toISOString()
      })
      renderBoard(boardView({ tickets: [t], sessions: [session(t.key, { state: 'running' })] }))
      await showList()
      const w = within(row('#5 Dark mode toggle'))
      expect(w.getByText('#5')).toBeInTheDocument()
      expect(w.getByText('Dark mode toggle')).toBeInTheDocument()
      expect(w.getByText('bug')).toBeInTheDocument()
      expect(w.queryByText('sandtable: in progress')).toBeNull()
      expect(w.getByText('Running')).toBeInTheDocument()
      expect(w.getByText('Oct 23')).toHaveAttribute('title', 'Oct 23, 2026, 09:30')
      expect(w.queryByRole('button')).toBeNull()
    })

    it('opens the ticket on a click or Enter', async () => {
      const onOpen = renderBoard(mixed())
      await showList()
      await userEvent.click(within(row('#1 Ticket 1')).getByText('Ticket 1'))
      row('#3 Ticket 3').focus()
      await userEvent.keyboard('{Enter}')
      expect(onOpen.mock.calls).toEqual([['octo/shop#1'], ['octo/shop#3']])
    })

    it('narrows the list with the label filter', async () => {
      renderBoard(mixed())
      await showList()
      await openSub('Labels')
      await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'bug' }))
      await userEvent.keyboard('{Escape}')
      expect(row('#1 Ticket 1')).toBeInTheDocument()
      expect(screen.queryByRole('group', { name: '#3 Ticket 3' })).toBeNull()
      expect(header('To do')).toHaveTextContent('To do 1')
    })

    it('narrows the list with the repo filter', async () => {
      renderBoard(boardView({ tickets: [ticket(1), ticket(2, { repo: 'octo/shop-web' })] }))
      await showList()
      await openSub('Repos')
      await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'octo/shop' }))
      await userEvent.keyboard('{Escape}')
      expect(row('#1 Ticket 1')).toBeInTheDocument()
      expect(screen.queryByRole('group', { name: '#2 Ticket 2' })).toBeNull()
    })

    it('narrows the list with the assignee filter', async () => {
      localStorage.setItem('assigneeFilter:p1', JSON.stringify({ mode: 'only', people: ['@none'] }))
      renderBoard(
        boardView({
          tickets: [
            ticket(1),
            ticket(2, { assignees: [{ id: 'U_ann', login: 'ann', name: null }] })
          ]
        })
      )
      await showList()
      expect(row('#1 Ticket 1')).toBeInTheDocument()
      expect(screen.queryByRole('group', { name: '#2 Ticket 2' })).toBeNull()
    })

    it('collapses a group to its header and count, and remembers it per project', async () => {
      renderBoard(mixed())
      await showList()
      await userEvent.click(header('To do'))
      expect(header('To do')).toHaveAttribute('aria-expanded', 'false')
      expect(header('To do')).toHaveTextContent('To do 2')
      expect(screen.queryByRole('group', { name: '#1 Ticket 1' })).toBeNull()
      expect(row('#2 Ticket 2')).toBeInTheDocument()
      cleanup()
      renderBoard(mixed())
      expect(header('To do')).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByRole('group', { name: '#1 Ticket 1' })).toBeNull()
      await userEvent.click(header('To do'))
      expect(row('#1 Ticket 1')).toBeInTheDocument()
      await userEvent.click(header('To do'))
      cleanup()
      render(
        <Board
          {...handlers}
          project={{ ...project, id: 'p2' }}
          view={mixed()}
          onSync={vi.fn()}
          onOpenTicket={vi.fn()}
        />
      )
      await showList()
      expect(header('To do')).toHaveAttribute('aria-expanded', 'true')
    })

    const dragDown = async (name: string): Promise<void> => {
      row(name).focus()
      await userEvent.keyboard(' ')
      await userEvent.keyboard('{ArrowDown}')
      await userEvent.keyboard(' ')
    }

    it('moves a row to the next group with Space, ArrowDown, and Space', async () => {
      vi.mocked(api.tickets.move).mockReturnValue(new Promise(() => {}))
      renderBoard(mixed())
      await showList()
      await dragDown('#1 Ticket 1')
      expect(api.tickets.move).toHaveBeenCalledWith(
        project.id,
        'octo/shop#1',
        'inProgress',
        undefined
      )
      expect(
        within(column('In progress')).getByRole('group', { name: '#1 Ticket 1' })
      ).toBeInTheDocument()
    })

    it('keeps the last row of a long group over its own group when picked up', async () => {
      renderBoard(
        boardView({
          tickets: [1, 2, 3, 4].map((n) => ticket(n)).concat(ticket(5, { status: 'In Progress' }))
        })
      )
      await showList()
      await userEvent.click(header('In progress'))
      row('#4 Ticket 4').focus()
      await userEvent.keyboard(' ')
      await userEvent.keyboard(' ')
      expect(api.tickets.move).not.toHaveBeenCalled()
    })

    it('moves a row onto a collapsed group with ArrowDown', async () => {
      vi.mocked(api.tickets.move).mockReturnValue(new Promise(() => {}))
      renderBoard(mixed())
      await showList()
      await userEvent.click(header('In progress'))
      await dragDown('#1 Ticket 1')
      expect(api.tickets.move).toHaveBeenCalledWith(
        project.id,
        'octo/shop#1',
        'inProgress',
        undefined
      )
    })

    it('does not move a row dropped on its own group', async () => {
      renderBoard(mixed())
      await showList()
      row('#1 Ticket 1').focus()
      await userEvent.keyboard(' ')
      await userEvent.keyboard(' ')
      expect(api.tickets.move).not.toHaveBeenCalled()
    })

    it('does not drag a row whose move is in flight', async () => {
      vi.mocked(api.tickets.move).mockReturnValue(new Promise(() => {}))
      renderBoard(mixed())
      await showList()
      await dragDown('#1 Ticket 1')
      await dragDown('#1 Ticket 1')
      expect(api.tickets.move).toHaveBeenCalledTimes(1)
    })

    it('tells a screen reader to choose a group with Up or Down Arrow', async () => {
      renderBoard(mixed())
      await showList()
      expect(screen.getByText(/Up or Down Arrow to choose a group/)).toBeInTheDocument()
    })

    it('ends To do with a New ticket row that opens the composer', async () => {
      render(
        <Board
          {...handlers}
          project={project}
          view={mixed()}
          onSync={vi.fn()}
          onOpenTicket={vi.fn()}
          onDrafted={vi.fn()}
        />
      )
      await showList()
      expect(within(column('In progress')).queryByRole('button', { name: 'New ticket' })).toBeNull()
      await userEvent.click(within(column('To do')).getByRole('button', { name: 'New ticket' }))
      const form = within(column('To do')).getByRole('form', { name: 'New ticket' })
      expect(within(form).getByLabelText('Title')).toHaveFocus()
    })

    const composerBoard = (): void => {
      render(
        <Board
          {...handlers}
          project={project}
          view={mixed()}
          onSync={vi.fn()}
          onOpenTicket={vi.fn()}
          onDrafted={vi.fn()}
        />
      )
    }
    const viewButton = (name: string): HTMLElement =>
      within(screen.getByRole('group', { name: 'View' })).getByRole('button', { name })

    it('locks the view and To do while the composer creates, and keeps a post-create failure', async () => {
      let fail: (err: Error) => void = () => {}
      vi.mocked(api.tickets.create).mockReturnValue(new Promise((_, reject) => (fail = reject)))
      composerBoard()
      await showList()
      await userEvent.click(screen.getByRole('button', { name: 'New ticket' }))
      await userEvent.keyboard('Dark mode{Enter}')
      expect(viewButton('Board')).toBeDisabled()
      expect(viewButton('List')).toBeDisabled()
      expect(header('To do')).toBeDisabled()
      expect(header('Done')).toBeEnabled()
      await act(async () =>
        fail(new Error("Created octo/shop#9, but couldn't refresh the board: rate limited"))
      )
      expect(await screen.findByRole('alert')).toHaveTextContent('Created octo/shop#9')
      expect(viewButton('Board')).toBeDisabled()
      expect(header('To do')).toBeDisabled()
      await userEvent.click(screen.getByRole('button', { name: 'Close' }))
      expect(viewButton('Board')).toBeEnabled()
      expect(header('To do')).toBeEnabled()
    })

    it('keeps the composer when the pressed view is clicked again with To do collapsed in the list', async () => {
      composerBoard()
      await showList()
      await userEvent.click(header('To do'))
      await userEvent.click(viewButton('Board'))
      await userEvent.click(screen.getByRole('button', { name: 'New ticket' }))
      await userEvent.click(viewButton('Board'))
      expect(screen.getByRole('form', { name: 'New ticket' })).toBeInTheDocument()
    })

    it('locks the view and the group headers while a row is dragged', async () => {
      renderBoard(mixed())
      await showList()
      row('#1 Ticket 1').focus()
      await userEvent.keyboard(' ')
      expect(viewButton('Board')).toBeDisabled()
      expect(header('Done')).toBeDisabled()
      await userEvent.keyboard('{Escape}')
      expect(viewButton('Board')).toBeEnabled()
      expect(header('Done')).toBeEnabled()
    })

    it('ignores Left and Right Arrow in the list', async () => {
      renderBoard(mixed())
      await showList()
      row('#1 Ticket 1').focus()
      await userEvent.keyboard(' ')
      await userEvent.keyboard('{ArrowRight}')
      await userEvent.keyboard(' ')
      expect(api.tickets.move).not.toHaveBeenCalled()
    })

    it('focuses the header of a collapsed group a row is dropped on', async () => {
      vi.mocked(api.tickets.move).mockReturnValue(new Promise(() => {}))
      renderBoard(mixed())
      await showList()
      await userEvent.click(header('In progress'))
      await dragDown('#1 Ticket 1')
      expect(api.tickets.move).toHaveBeenCalled()
      await vi.waitFor(() => expect(header('In progress')).toHaveFocus())
    })

    it('drops on the group under the pointer after the list moves mid-drag', async () => {
      vi.mocked(api.tickets.move).mockReturnValue(new Promise(() => {}))
      const shift = { y: 0 }
      mockListRects(shift)
      renderBoard(mixed())
      await showList()
      vi.useFakeTimers()
      try {
        const at = (clientY: number): PointerEventInit => ({
          clientX: 10,
          clientY,
          isPrimary: true,
          button: 0
        })
        const dragged = row('#1 Ticket 1')
        fireEvent.pointerDown(dragged, at(50))
        fireEvent.pointerMove(dragged, at(60))
        shift.y = 80
        act(() => {
          vi.advanceTimersByTime(150)
        })
        fireEvent.pointerMove(dragged, at(240))
        fireEvent.pointerUp(dragged, at(240))
        expect(api.tickets.move).toHaveBeenCalledWith(
          project.id,
          'octo/shop#1',
          'inProgress',
          undefined
        )
        act(() => {
          vi.advanceTimersByTime(50)
        })
      } finally {
        vi.useRealTimers()
      }
    })

    it('closes the composer when To do collapses or the view changes', async () => {
      render(
        <Board
          {...handlers}
          project={project}
          view={mixed()}
          onSync={vi.fn()}
          onOpenTicket={vi.fn()}
          onDrafted={vi.fn()}
        />
      )
      await showList()
      await userEvent.click(screen.getByRole('button', { name: 'New ticket' }))
      await userEvent.click(header('To do'))
      await userEvent.click(header('To do'))
      expect(screen.queryByRole('form', { name: 'New ticket' })).toBeNull()
      await userEvent.click(screen.getByRole('button', { name: 'New ticket' }))
      await userEvent.click(screen.getByRole('button', { name: 'Board' }))
      expect(screen.queryByRole('form', { name: 'New ticket' })).toBeNull()
      expect(screen.getByRole('button', { name: 'New ticket' })).toBeInTheDocument()
    })
  })

  describe('grouped by assignee', () => {
    const dana = { id: 'U_dana', login: 'dana', name: 'Dana Whitfield' }
    const ari = { id: 'U_ari', login: 'ari', name: 'Ari Moss' }
    const team = (): BoardView =>
      boardView({
        tickets: [
          ticket(1, { assignees: [dana], updatedAt: '2026-10-03T00:00:00.000Z' }),
          ticket(2, { status: 'In Progress', assignees: [ari] }),
          ticket(3, { assignees: [dana, ari], updatedAt: '2026-10-09T00:00:00.000Z' }),
          ticket(4, { status: 'Done' })
        ]
      })
    const group = (over: object = {}): void =>
      localStorage.setItem(
        'boardDisplay:p1',
        JSON.stringify({ group: 'assignee', order: 'manual', dir: 'asc', ...over })
      )
    const cell = (name: string): HTMLElement => screen.getByRole('region', { name })
    const lane = (name: string): HTMLElement =>
      within(screen.getByRole('region', { name })).getAllByRole('button', {
        name: new RegExp(`^${name}`)
      })[0]
    const cards = (name: string): string[] =>
      within(cell(name))
        .queryAllByRole('group')
        .map((g) => g.getAttribute('aria-label')!)
    const showList = (): Promise<void> =>
      userEvent.click(
        within(screen.getByRole('group', { name: 'View' })).getByRole('button', { name: 'List' })
      )
    const mockZoneRects = (): void =>
      mockRects((el) => {
        const zones = [
          ...document.querySelectorAll(
            'section[aria-label*=", "], [data-slot="lane-head"], [data-slot="lane-count"], section > button[aria-expanded="false"]'
          )
        ]
        const exact = zones.indexOf(el)
        const i = exact >= 0 ? exact : zones.findIndex((z) => z.contains(el))
        return i < 0 ? new DOMRect() : new DOMRect(0, i * 100, 350, 90)
      })
    const drag = async (name: string, keys: string, within_?: string): Promise<void> => {
      const target = within_
        ? within(cell(within_)).getByRole('group', { name })
        : screen.getAllByRole('group', { name })[0]
      target.focus()
      await userEvent.keyboard(' ')
      await userEvent.keyboard(keys)
      await userEvent.keyboard(' ')
    }

    beforeEach(() => {
      localStorage.clear()
      group()
      mockZoneRects()
    })

    afterEach(() => vi.restoreAllMocks())

    it('shows a lane per person sorted by name, then No assignee, with a ticket in each of its lanes', () => {
      renderBoard(team())
      const lanes = screen.getAllByRole('button', { expanded: true })
      expect(lanes).toHaveLength(3)
      ;['Ari Moss 2', 'Dana Whitfield 2', 'No assignee 1'].forEach((name, i) =>
        expect(lanes[i]).toHaveAccessibleName(name)
      )
      expect(cards('Ari Moss, To do')).toEqual(['#3 Ticket 3'])
      expect(cards('Ari Moss, In progress')).toEqual(['#2 Ticket 2'])
      expect(cards('Dana Whitfield, To do')).toEqual(['#1 Ticket 1', '#3 Ticket 3'])
      expect(cards('No assignee, Done')).toEqual(['#4 Ticket 4'])
      for (const name of ['To do', 'In progress', 'Done'])
        expect(screen.getByRole('heading', { name: new RegExp(`^${name}`) })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: /^To do/ })).toHaveTextContent('To do2')
    })

    it('always shows the No assignee lane, even when it is empty', () => {
      renderBoard(boardView({ tickets: [ticket(1, { assignees: [dana] })] }))
      expect(lane('No assignee')).toHaveAccessibleName('No assignee 0')
      expect(cards('No assignee, To do')).toEqual([])
    })

    it("ends No assignee's To do with New ticket", () => {
      renderBoard(team())
      expect(
        within(cell('No assignee, To do')).getByRole('button', { name: 'New ticket' })
      ).toBeInTheDocument()
      expect(screen.getAllByRole('button', { name: 'New ticket' })).toHaveLength(1)
    })

    it('groups by Assignee from Display, says so on the button, and remembers it per project', async () => {
      localStorage.clear()
      renderBoard(team())
      await userEvent.click(screen.getByRole('button', { name: 'Display' }))
      expect(screen.getByText('Group by')).toBeVisible()
      expect(screen.getByText('Order by')).toBeVisible()
      await userEvent.click(screen.getByRole('menuitemradio', { name: 'Assignee' }))
      await userEvent.keyboard('{Escape}')
      const button = screen.getByRole('button', { name: 'Display, grouped by Assignee' })
      expect(button).toHaveTextContent(/^Assignee$/)
      expect(cell('Dana Whitfield, To do')).toBeInTheDocument()
      cleanup()
      renderBoard(team())
      expect(cell('Dana Whitfield, To do')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: /^Display/ }))
      await userEvent.click(screen.getByRole('menuitemradio', { name: 'Updated' }))
      await userEvent.keyboard('{Escape}')
      expect(
        screen.getByRole('button', {
          name: 'Display, grouped by Assignee, ordered by Updated, descending'
        })
      ).toHaveTextContent(/^Assignee · Updated ↓$/)
      cleanup()
      render(
        <Board
          {...handlers}
          project={{ ...project, id: 'p2' }}
          view={team()}
          onSync={vi.fn()}
          onOpenTicket={vi.fn()}
        />
      )
      expect(screen.queryByRole('region', { name: 'Dana Whitfield, To do' })).toBeNull()
      expect(column('To do')).toBeInTheDocument()
    })

    it('sorts inside each lane', () => {
      group({ order: 'updated', dir: 'desc' })
      renderBoard(team())
      expect(cards('Dana Whitfield, To do')).toEqual(['#3 Ticket 3', '#1 Ticket 1'])
    })

    it('moves a card to another lane with Up Arrow and shows it there at once', async () => {
      vi.mocked(api.tickets.move).mockReturnValue(new Promise(() => {}))
      renderBoard(team())
      await drag('#1 Ticket 1', '{ArrowUp}')
      expect(api.tickets.move).toHaveBeenCalledWith(project.id, 'octo/shop#1', 'todo', {
        from: 'U_dana',
        to: 'U_ari'
      })
      expect(cards('Ari Moss, To do')).toEqual(['#1 Ticket 1', '#3 Ticket 3'])
      expect(cards('Dana Whitfield, To do')).toEqual(['#3 Ticket 3'])
      expect(screen.getByRole('status')).toHaveTextContent('Moved #1 to Ari Moss, To do.')
      await vi.waitFor(() =>
        expect(
          within(cell('Ari Moss, To do')).getByRole('group', { name: '#1 Ticket 1' })
        ).toHaveFocus()
      )
    })

    it('moves the copy it picked up: a card in two lanes leaves the lane it came from', async () => {
      vi.mocked(api.tickets.move).mockReturnValue(new Promise(() => {}))
      renderBoard(team())
      await drag('#3 Ticket 3', '{ArrowDown}{ArrowDown}', 'Ari Moss, To do')
      expect(api.tickets.move).toHaveBeenCalledWith(project.id, 'octo/shop#3', 'todo', {
        from: 'U_ari',
        to: null
      })
      expect(cards('Ari Moss, To do')).toEqual([])
      expect(cards('Dana Whitfield, To do')).toEqual(['#1 Ticket 1', '#3 Ticket 3'])
      expect(screen.getByRole('status')).toHaveTextContent('Removed Ari Moss from #3.')
      await vi.waitFor(() =>
        expect(
          within(cell('Dana Whitfield, To do')).getByRole('group', { name: '#3 Ticket 3' })
        ).toHaveFocus()
      )
    })

    it('moves a card to another lane and column in one drop, naming both', async () => {
      vi.mocked(api.tickets.move).mockReturnValue(new Promise(() => {}))
      renderBoard(team())
      screen.getAllByRole('group', { name: '#1 Ticket 1' })[0].focus()
      await userEvent.keyboard(' ')
      await userEvent.keyboard('{ArrowDown}{ArrowRight}')
      expect(screen.getByRole('status')).toHaveTextContent('Over No assignee, In progress.')
      await userEvent.keyboard(' ')
      expect(api.tickets.move).toHaveBeenCalledWith(project.id, 'octo/shop#1', 'inProgress', {
        from: 'U_dana',
        to: null
      })
      expect(cards('No assignee, In progress')).toEqual(['#1 Ticket 1'])
    })

    it('moves within a lane with only the column', async () => {
      vi.mocked(api.tickets.move).mockReturnValue(new Promise(() => {}))
      renderBoard(team())
      await drag('#1 Ticket 1', '{ArrowRight}')
      expect(api.tickets.move).toHaveBeenCalledWith(
        project.id,
        'octo/shop#1',
        'inProgress',
        undefined
      )
    })

    it('tells a screen reader to choose a column and a lane', () => {
      renderBoard(team())
      expect(
        screen.getByText(
          /Left or Right Arrow to choose a column and Up or Down Arrow to choose a lane/
        )
      ).toBeInTheDocument()
    })

    it('puts the card back in its lane with the error when the write fails', async () => {
      vi.mocked(api.tickets.move).mockRejectedValue(new Error("couldn't assign Ari"))
      renderBoard(team())
      await drag('#1 Ticket 1', '{ArrowUp}')
      expect(await screen.findByRole('alert')).toHaveTextContent(
        "Couldn't move #1: couldn't assign Ari"
      )
      await vi.waitFor(() =>
        expect(cards('Dana Whitfield, To do')).toEqual(['#1 Ticket 1', '#3 Ticket 3'])
      )
      expect(cards('Ari Moss, To do')).toEqual(['#3 Ticket 3'])
      await vi.waitFor(() =>
        expect(
          within(cell('Dana Whitfield, To do')).getByRole('group', { name: '#1 Ticket 1' })
        ).toHaveFocus()
      )
    })

    it("doesn't take focus back after the drop: not on a view switch or a later sync", async () => {
      let answer: () => void = () => {}
      vi.mocked(api.tickets.move).mockReturnValue(new Promise((r) => (answer = r)))
      const board = (view: BoardView): React.JSX.Element => (
        <Board
          {...handlers}
          project={project}
          view={view}
          onSync={vi.fn()}
          onOpenTicket={vi.fn()}
          onDrafted={vi.fn()}
        />
      )
      const { rerender } = render(board(team()))
      await drag('#1 Ticket 1', '{ArrowUp}')
      await vi.waitFor(() =>
        expect(
          within(cell('Ari Moss, To do')).getByRole('group', { name: '#1 Ticket 1' })
        ).toHaveFocus()
      )
      await act(async () => answer())
      await userEvent.click(screen.getByRole('button', { name: 'New ticket' }))
      const title = screen.getByLabelText('Title')
      expect(title).toHaveFocus()
      const synced = team()
      synced.tickets[0] = { ...synced.tickets[0], assignees: [ari] }
      rerender(board(synced))
      expect(
        within(cell('Ari Moss, To do')).getByRole('group', { name: '#1 Ticket 1' })
      ).toBeInTheDocument()
      expect(title).toHaveFocus()
      const listButton = within(screen.getByRole('group', { name: 'View' })).getByRole('button', {
        name: 'List'
      })
      await userEvent.click(listButton)
      expect(listButton).toHaveFocus()
    })

    it('locks the lane headers while a card is dragged', async () => {
      renderBoard(team())
      screen.getAllByRole('group', { name: '#1 Ticket 1' })[0].focus()
      await userEvent.keyboard(' ')
      expect(lane('Ari Moss')).toBeDisabled()
      await userEvent.keyboard('{Escape}')
      expect(lane('Ari Moss')).toBeEnabled()
    })

    it('drops a keyboard drag on the count it is centered on, not a neighbour it covers', async () => {
      vi.mocked(api.tickets.move).mockReturnValue(new Promise(() => {}))
      renderBoard(team())
      await userEvent.click(lane('Ari Moss'))
      vi.restoreAllMocks()
      mockRects((el) => {
        const c = [...document.querySelectorAll('[data-slot="lane-count"]')].indexOf(el)
        if (c >= 0) return new DOMRect([300, 362, 724][c], 0, 40, 28)
        const [who, title] =
          el.closest('section[aria-label*=", "]')?.getAttribute('aria-label')?.split(', ') ?? []
        const col = titles.indexOf(title)
        const row = ['Dana Whitfield', 'No assignee'].indexOf(who)
        return col < 0 || row < 0
          ? new DOMRect()
          : new DOMRect(col * 362, 100 + row * 400, 350, 300)
      })
      await drag('#1 Ticket 1', '{ArrowUp}{ArrowRight}')
      expect(api.tickets.move).toHaveBeenCalledWith(project.id, 'octo/shop#1', 'inProgress', {
        from: 'U_dana',
        to: 'U_ari'
      })
    })

    it('collapses a lane to its counts per column, which take a drop, and remembers it', async () => {
      vi.mocked(api.tickets.move).mockReturnValue(new Promise(() => {}))
      renderBoard(team())
      await userEvent.click(lane('Ari Moss'))
      expect(lane('Ari Moss')).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByRole('region', { name: 'Ari Moss, To do' })).toBeNull()
      const counts = screen
        .getByRole('region', { name: 'Ari Moss' })
        .querySelectorAll('[data-slot="lane-count"]')
      expect([...counts].map((c) => c.textContent)).toEqual(['1 to do', '1 in progress', '0 done'])
      for (const c of counts) expect(c.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
      cleanup()
      renderBoard(team())
      expect(lane('Ari Moss')).toHaveAttribute('aria-expanded', 'false')
      await drag('#1 Ticket 1', '{ArrowUp}{ArrowRight}')
      expect(api.tickets.move).toHaveBeenCalledWith(project.id, 'octo/shop#1', 'inProgress', {
        from: 'U_dana',
        to: 'U_ari'
      })
      expect(screen.getByRole('status')).toHaveTextContent('Moved #1 to Ari Moss, In progress.')
      await vi.waitFor(() => expect(lane('Ari Moss')).toHaveFocus())
    })

    const pointer = (y: number): PointerEventInit => ({
      clientX: 10,
      clientY: y,
      isPrimary: true,
      button: 0
    })
    const holding = async (run: (move: (y: number) => void) => void): Promise<void> => {
      await userEvent.click(lane('Ari Moss'))
      vi.useFakeTimers()
      const dragged = screen.getAllByRole('group', { name: '#1 Ticket 1' })[0]
      try {
        fireEvent.pointerDown(dragged, pointer(410))
        fireEvent.pointerMove(dragged, pointer(420))
        run((y) => fireEvent.pointerMove(dragged, pointer(y)))
      } finally {
        fireEvent.pointerUp(dragged, pointer(2000))
        act(() => {
          vi.advanceTimersByTime(50)
        })
        vi.useRealTimers()
      }
    }
    const wait = (ms: number): void =>
      act(() => {
        vi.advanceTimersByTime(ms)
      })

    it('opens a collapsed lane after a pointer drag holds over its name for 700 ms, ringing the panel', async () => {
      renderBoard(team())
      await holding((move) => {
        move(10)
        wait(650)
        expect(lane('Ari Moss')).toHaveAttribute('aria-expanded', 'false')
        expect(screen.getByRole('region', { name: 'Ari Moss' })).toHaveClass('ring-line-2')
        wait(100)
        expect(lane('Ari Moss')).toHaveAttribute('aria-expanded', 'true')
      })
    })

    it('keeps holding across a lane and opens it from a count too', async () => {
      renderBoard(team())
      await holding((move) => {
        move(110)
        wait(400)
        move(10)
        wait(350)
        expect(lane('Ari Moss')).toHaveAttribute('aria-expanded', 'true')
      })
    })

    it('stops the hold when the drag leaves the lane before 700 ms', async () => {
      renderBoard(team())
      await holding((move) => {
        move(110)
        wait(650)
        move(410)
        wait(1000)
        expect(lane('Ari Moss')).toHaveAttribute('aria-expanded', 'false')
        expect(screen.getByRole('region', { name: 'Ari Moss' })).not.toHaveClass('ring-line-2')
      })
    })

    it('never opens a lane during a keyboard drag', async () => {
      renderBoard(team())
      await userEvent.click(lane('Ari Moss'))
      screen.getAllByRole('group', { name: '#1 Ticket 1' })[0].focus()
      await userEvent.keyboard(' ')
      vi.useFakeTimers()
      try {
        fireEvent.keyDown(document.activeElement!, { code: 'ArrowUp' })
        expect(screen.getByRole('status')).toHaveTextContent('Over Ari Moss, To do.')
        wait(800)
        expect(lane('Ari Moss')).toHaveAttribute('aria-expanded', 'false')
      } finally {
        fireEvent.keyDown(document.activeElement!, { code: 'Escape' })
        vi.useRealTimers()
      }
    })

    it('closes the composer when Group by changes or No assignee collapses', async () => {
      render(
        <Board
          {...handlers}
          project={project}
          view={team()}
          onSync={vi.fn()}
          onOpenTicket={vi.fn()}
          onDrafted={vi.fn()}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: 'New ticket' }))
      await userEvent.click(lane('No assignee'))
      await userEvent.click(lane('No assignee'))
      expect(screen.queryByRole('form', { name: 'New ticket' })).toBeNull()
      await userEvent.click(screen.getByRole('button', { name: 'New ticket' }))
      await userEvent.click(screen.getByRole('button', { name: /^Display/ }))
      await userEvent.click(screen.getByRole('menuitemradio', { name: 'None' }))
      await userEvent.keyboard('{Escape}')
      expect(screen.queryByRole('form', { name: 'New ticket' })).toBeNull()
      expect(
        within(column('To do')).getByRole('button', { name: 'New ticket' })
      ).toBeInTheDocument()
    })

    it('locks No assignee and Group by while the composer creates', async () => {
      vi.mocked(api.tickets.create).mockReturnValue(new Promise(() => {}))
      renderBoard(team())
      await userEvent.click(screen.getByRole('button', { name: 'New ticket' }))
      await userEvent.keyboard('Dark mode{Enter}')
      expect(lane('No assignee')).toBeDisabled()
      expect(lane('Dana Whitfield')).toBeEnabled()
      await userEvent.click(screen.getByRole('button', { name: /^Display/ }))
      expect(screen.getByRole('menuitemradio', { name: 'None' })).toHaveAttribute(
        'aria-disabled',
        'true'
      )
    })

    describe('in the list', () => {
      const header = (name: string): HTMLElement =>
        within(screen.getByRole('region', { name })).getByRole('button', {
          name: new RegExp(`^${name}`)
        })

      it('shows a header per person, then To do, In progress, and Done with rows', async () => {
        renderBoard(team())
        await showList()
        expect(header('Dana Whitfield')).toHaveAccessibleName('Dana Whitfield 2')
        expect(header('Dana Whitfield')).toHaveAttribute('aria-expanded', 'true')
        expect(cards('Dana Whitfield, To do')).toEqual(['#1 Ticket 1', '#3 Ticket 3'])
        expect(cards('Ari Moss, To do')).toEqual(['#3 Ticket 3'])
        expect(cards('Ari Moss, In progress')).toEqual(['#2 Ticket 2'])
        expect(cards('No assignee, Done')).toEqual(['#4 Ticket 4'])
        expect(
          within(cell('No assignee, To do')).getByRole('button', { name: 'New ticket' })
        ).toBeInTheDocument()
      })

      it('collapses a person, shared with the board', async () => {
        renderBoard(team())
        await showList()
        await userEvent.click(header('Dana Whitfield'))
        expect(screen.queryByRole('region', { name: 'Dana Whitfield, To do' })).toBeNull()
        await userEvent.click(
          within(screen.getByRole('group', { name: 'View' })).getByRole('button', { name: 'Board' })
        )
        expect(lane('Dana Whitfield')).toHaveAttribute('aria-expanded', 'false')
      })

      it("steps through each lane's status groups with Down Arrow", async () => {
        vi.mocked(api.tickets.move).mockReturnValue(new Promise(() => {}))
        renderBoard(team())
        await showList()
        await drag('#1 Ticket 1', '{ArrowDown}{ArrowDown}{ArrowDown}')
        expect(api.tickets.move).toHaveBeenCalledWith(project.id, 'octo/shop#1', 'todo', {
          from: 'U_dana',
          to: null
        })
        expect(cards('No assignee, To do')).toEqual(['#1 Ticket 1'])
        await vi.waitFor(() =>
          expect(
            within(cell('No assignee, To do')).getByRole('group', { name: '#1 Ticket 1' })
          ).toHaveFocus()
        )
      })

      it("takes a drop on a collapsed person's header, keeping the column", async () => {
        vi.mocked(api.tickets.move).mockReturnValue(new Promise(() => {}))
        renderBoard(team())
        await showList()
        await userEvent.click(header('Ari Moss'))
        await drag('#1 Ticket 1', '{ArrowUp}')
        expect(api.tickets.move).toHaveBeenCalledWith(project.id, 'octo/shop#1', 'todo', {
          from: 'U_dana',
          to: 'U_ari'
        })
        await vi.waitFor(() => expect(header('Ari Moss')).toHaveFocus())
      })
    })
  })

  describe('grouped by parent', () => {
    const ref = (n: number, over: Partial<IssueRef> & object = {}): IssueRef => ({
      key: `octo/shop#${n}`,
      number: n,
      title: `Ticket ${n}`,
      repo: 'octo/shop',
      url: `https://github.com/octo/shop/issues/${n}`,
      column: 'todo',
      ...over
    })
    const family = (): BoardView =>
      boardView({
        tickets: [
          ticket(1, { subIssues: { completed: 1, total: 3, items: [] } }),
          ticket(2, { status: 'In Progress', parent: ref(1) }),
          ticket(3, { parent: ref(1), subIssues: { completed: 0, total: 1, items: [] } }),
          ticket(4, {
            parent: {
              ...ref(9, { title: 'Closed epic', column: 'done' }),
              subIssues: { completed: 2, total: 5 }
            }
          }),
          ticket(5, { parent: ref(3) }),
          ticket(6, { status: 'Done' })
        ]
      })
    const cell = (name: string): HTMLElement => screen.getByRole('region', { name })
    const cards = (name: string): string[] =>
      within(cell(name))
        .queryAllByRole('group')
        .map((g) => g.getAttribute('aria-label')!)
    const inCell = (name: string, ticket_: string): HTMLElement =>
      within(cell(name)).getByRole('group', { name: ticket_ })
    const showList = (): Promise<void> =>
      userEvent.click(
        within(screen.getByRole('group', { name: 'View' })).getByRole('button', { name: 'List' })
      )
    const mockZoneRects = (): void =>
      mockRects((el) => {
        const zones = [
          ...document.querySelectorAll(
            'section[aria-label*=", "], [data-slot="lane-head"], [data-slot="lane-count"], section > button[aria-expanded="false"]'
          )
        ]
        const exact = zones.indexOf(el)
        const i = exact >= 0 ? exact : zones.findIndex((z) => z.contains(el))
        return i < 0 ? new DOMRect() : new DOMRect(0, i * 100, 350, 90)
      })
    const drag = async (name: string, keys: string): Promise<void> => {
      screen.getByRole('group', { name }).focus()
      await userEvent.keyboard(' ')
      await userEvent.keyboard(keys)
      await userEvent.keyboard(' ')
    }

    beforeEach(() => {
      localStorage.clear()
      localStorage.setItem(
        'boardDisplay:p1',
        JSON.stringify({ group: 'parent', order: 'manual', dir: 'asc' })
      )
      mockZoneRects()
    })

    afterEach(() => vi.restoreAllMocks())

    it('shows a lane per parent, its own in its lane, then No parent with New ticket', () => {
      renderBoard(family())
      const lanes = screen.getAllByRole('button', { expanded: true })
      expect(lanes).toHaveLength(4)
      expect(lanes[0]).toHaveAccessibleName('#1 Ticket 1, To do, 1/3 sub-issues done')
      expect(lanes[1]).toHaveAccessibleName('#3 Ticket 3, To do, 0/1 sub-issues done')
      expect(lanes[2]).toHaveAccessibleName('#9 Closed epic, Done, 2/5 sub-issues done')
      expect(lanes[3]).toHaveAccessibleName('No parent 1')
      expect(cards('#1 Ticket 1, To do')).toEqual(['#1 Ticket 1'])
      expect(cards('#1 Ticket 1, In progress')).toEqual(['#2 Ticket 2'])
      expect(cards('#3 Ticket 3, To do')).toEqual(['#3 Ticket 3', '#5 Ticket 5'])
      expect(cards('#9 Closed epic, To do')).toEqual(['#4 Ticket 4'])
      expect(cards('No parent, Done')).toEqual(['#6 Ticket 6'])
      expect(
        within(cell('No parent, To do')).getByRole('button', { name: 'New ticket' })
      ).toBeInTheDocument()
    })

    it("tags a parent's card, drops the parent line inside a lane, and keeps it on a parent that is a sub-issue", () => {
      renderBoard(family())
      const one = within(inCell('#1 Ticket 1, To do', '#1 Ticket 1'))
      expect(one.getByText('Parent')).toBeInTheDocument()
      const two = within(inCell('#1 Ticket 1, In progress', '#2 Ticket 2'))
      expect(two.queryByText('Parent')).toBeNull()
      expect(two.queryByText('Ticket 1')).toBeNull()
      const three = within(inCell('#3 Ticket 3, To do', '#3 Ticket 3'))
      expect(three.getByText('Parent')).toBeInTheDocument()
      expect(three.getByText('Ticket 1')).toBeInTheDocument()
      expect(
        within(inCell('#9 Closed epic, To do', '#4 Ticket 4')).queryByText('Closed epic')
      ).toBeNull()
    })

    it('groups by Parent from Display and says so on the button', async () => {
      localStorage.clear()
      renderBoard(family())
      await userEvent.click(screen.getByRole('button', { name: 'Display' }))
      await userEvent.click(screen.getByRole('menuitemradio', { name: 'Parent' }))
      await userEvent.keyboard('{Escape}')
      expect(screen.getByRole('button', { name: 'Display, grouped by Parent' })).toHaveTextContent(
        /^Parent$/
      )
      expect(cell('No parent, Done')).toBeInTheDocument()
    })

    it('moves a card between columns in its lane, without a lane change', async () => {
      vi.mocked(api.tickets.move).mockReturnValue(new Promise(() => {}))
      renderBoard(family())
      await drag('#2 Ticket 2', '{ArrowRight}')
      expect(api.tickets.move).toHaveBeenCalledWith(project.id, 'octo/shop#2', 'done', undefined)
      expect(cards('#1 Ticket 1, Done')).toEqual(['#2 Ticket 2'])
    })

    it('keeps a keyboard drag in its lane: Up and Down Arrow do nothing', async () => {
      renderBoard(family())
      await drag('#2 Ticket 2', '{ArrowDown}{ArrowUp}')
      expect(api.tickets.move).not.toHaveBeenCalled()
      expect(screen.getByRole('status')).toHaveTextContent('#2 stays in #1 Ticket 1, In progress.')
    })

    it("doesn't take a pointer drop in another parent's lane", async () => {
      renderBoard(family())
      const dragged = screen.getByRole('group', { name: '#2 Ticket 2' })
      const at = (y: number): PointerEventInit => ({
        clientX: 10,
        clientY: y,
        isPrimary: true,
        button: 0
      })
      fireEvent.pointerDown(dragged, at(210))
      fireEvent.pointerMove(dragged, at(220))
      fireEvent.pointerMove(dragged, at(510))
      fireEvent.pointerUp(dragged, at(510))
      await new Promise((r) => setTimeout(r, 50))
      await vi.waitFor(() =>
        expect(screen.getByRole('status')).toHaveTextContent(/#2 stays in #1 Ticket 1, In progress/)
      )
      expect(api.tickets.move).not.toHaveBeenCalled()
      expect(cards('#1 Ticket 1, In progress')).toEqual(['#2 Ticket 2'])
    })

    it('tells a screen reader to choose only a column', () => {
      renderBoard(family())
      expect(
        screen.getByText(/press Space, then Left or Right Arrow to choose a column, and Space/)
      ).toBeInTheDocument()
    })

    it('collapses a parent lane and remembers it', async () => {
      renderBoard(family())
      await userEvent.click(screen.getAllByRole('button', { expanded: true })[0])
      expect(screen.queryByRole('region', { name: '#1 Ticket 1, To do' })).toBeNull()
      cleanup()
      renderBoard(family())
      expect(screen.getByRole('button', { name: /^#1 Ticket 1/ })).toHaveAttribute(
        'aria-expanded',
        'false'
      )
    })

    it('shows the parent lanes in the list, keeping a drag in its lane', async () => {
      renderBoard(family())
      await showList()
      expect(cards('#1 Ticket 1, In progress')).toEqual(['#2 Ticket 2'])
      expect(
        within(inCell('#1 Ticket 1, To do', '#1 Ticket 1')).getByText('Parent')
      ).toBeInTheDocument()
      await drag('#2 Ticket 2', '{ArrowDown}{ArrowDown}{ArrowDown}')
      expect(api.tickets.move).toHaveBeenCalledWith(project.id, 'octo/shop#2', 'done', undefined)
    })
  })
})

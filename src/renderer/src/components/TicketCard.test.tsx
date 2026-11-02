import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SandtableApi } from '../../../shared/api'
import type { ModelUsage, SessionRecord, SetupProgress, Ticket } from '../../../shared/types'
import { SETUP_CANCELLED, SETUP_FAILED } from '../../../shared/worktreeSetup'
import { fakeSandtable, project, session, ticket } from '../test/fixtures'
import type { DragHandle } from '@/hooks/useTicketDrag'
import { TicketCard } from './TicketCard'

const t = ticket(98, { status: 'Done' })
const opus: ModelUsage = {
  model: 'claude-opus-5-5',
  name: 'Opus 5.5',
  input: 600,
  output: 200_000,
  cacheWrite: 1_100_000,
  cacheRead: 30_700_000,
  price: 18.876
}
let api: SandtableApi

const card = (done: boolean, s?: SessionRecord): React.JSX.Element => (
  <TicketCard
    project={project}
    ticket={t}
    session={s}
    state={undefined}
    done={done}
    onFolderFixed={vi.fn()}
    onSetUp={vi.fn()}
    tickets={[]}
    onOpenTicket={vi.fn()}
    stateOf={() => undefined}
    onOpen={vi.fn()}
  />
)
const renderCard = (done: boolean, s?: SessionRecord): ReturnType<typeof render> =>
  render(card(done, s))

beforeEach(() => {
  api = fakeSandtable()
})

describe('TicketCard usage', () => {
  it("shows a Done ticket's tokens left and API estimate right, with no cap meter", async () => {
    vi.mocked(api.tickets.usage).mockResolvedValue({ usage: [opus], workMs: 0 })
    renderCard(true)
    const tokens = (await screen.findByText('32M')).parentElement
    expect(tokens).toHaveTextContent(/^32M tokens$/)
    expect(tokens?.nextElementSibling).toHaveTextContent('$18.88 API estimate')
    expect(screen.queryByRole('img', { name: /token cap/ })).toBeNull()
    expect(api.tickets.usage).toHaveBeenCalledWith(project.id, t.key)
  })

  it('marks the estimate when a model has no price', async () => {
    vi.mocked(api.tickets.usage).mockResolvedValue({
      usage: [opus, { ...opus, model: 'x', price: null }],
      workMs: 0
    })
    renderCard(true)
    expect((await screen.findByText('64M')).parentElement?.nextElementSibling).toHaveTextContent(
      '$18.88* (leaves out a model with no price) API estimate'
    )
  })

  it("shows a live session's usage against the project's cap, and Raise cap while capped", async () => {
    vi.mocked(api.sessions.liveUsage).mockResolvedValue({ [`s-${t.key}`]: [opus] })
    const live = session(t.key, { state: 'needsYou', capped: true, tokenCap: 40e6 })
    const onOpen = vi.fn()
    render(
      <TicketCard
        project={{ ...project, tokenCap: 25e6 }}
        ticket={t}
        session={live}
        state="needsYou"
        done={false}
        onFolderFixed={vi.fn()}
        onSetUp={vi.fn()}
        tickets={[]}
        onOpenTicket={vi.fn()}
        stateOf={() => undefined}
        onOpen={onOpen}
      />
    )
    expect(await screen.findByRole('img', { name: '80% of its token cap' })).toBeInTheDocument()
    expect(screen.getByText('40M').parentElement).toHaveTextContent('32M tokens of 40M cap')
    expect(screen.queryByRole('button', { name: /Clear Needs you/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Raise cap' }))
    expect(api.sessions.raiseCap).toHaveBeenCalledWith(live.id)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it("says why a Done ticket's open session stopped at its cap, but not once it ends", async () => {
    vi.mocked(api.tickets.usage).mockResolvedValue({ usage: [opus], workMs: 0 })
    const { rerender } = renderCard(true, session(t.key, { state: 'needsYou', capped: true }))
    expect(await screen.findByText('Reached its token cap')).toBeInTheDocument()
    rerender(card(true, session(t.key, { state: 'finished', capped: true })))
    expect(screen.queryByText('Reached its token cap')).toBeNull()
  })

  it('shows no usage on a card outside Done', async () => {
    vi.mocked(api.tickets.usage).mockResolvedValue({ usage: [opus], workMs: 0 })
    renderCard(false)
    await Promise.resolve()
    expect(api.tickets.usage).not.toHaveBeenCalled()
    expect(screen.queryByText(/tokens/)).toBeNull()
  })

  it('shows no usage with no tokens', async () => {
    renderCard(true)
    await act(async () => {})
    expect(api.tickets.usage).toHaveBeenCalled()
    expect(screen.queryByText(/tokens/)).toBeNull()
  })

  it("reads usage again only when the ticket's newest session changes", async () => {
    const s = session(t.key, { state: 'finished' })
    const { rerender } = renderCard(true, s)
    await act(async () => {})
    rerender(card(true, s))
    await act(async () => {})
    expect(api.tickets.usage).toHaveBeenCalledTimes(1)
    rerender(card(true, { ...s, id: 'new' }))
    await act(async () => {})
    expect(api.tickets.usage).toHaveBeenCalledTimes(2)
  })
})

describe('TicketCard merged mark', () => {
  const pr = 'https://github.com/octo/shop/pull/99'
  const renderMerged = (over: Partial<Ticket>, done = true, onOpen = vi.fn()): void => {
    render(
      <TicketCard
        project={project}
        ticket={{ ...t, ...over }}
        session={undefined}
        state={undefined}
        done={done}
        onFolderFixed={vi.fn()}
        onSetUp={vi.fn()}
        tickets={[]}
        onOpenTicket={vi.fn()}
        stateOf={() => undefined}
        onOpen={onOpen}
      />
    )
  }

  it('links a Done card with a merged pull request to it without opening the ticket', () => {
    const onOpen = vi.fn()
    renderMerged({ mergedPr: pr }, true, onOpen)
    const mark = screen.getByRole('link', { name: 'Merged' })
    expect(mark).toHaveAttribute('href', pr)
    expect(mark).toHaveAttribute('target', '_blank')
    fireEvent.click(mark)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('shows no mark without a merged pull request', () => {
    renderMerged({ mergedPr: null })
    expect(screen.queryByText('Merged')).toBeNull()
  })

  it('shows no mark outside Done', () => {
    renderMerged({ mergedPr: pr }, false)
    expect(screen.queryByText('Merged')).toBeNull()
  })
})

describe('TicketCard pull request stage', () => {
  const renderStage = (over: Partial<Ticket>, done = false): void => {
    render(
      <TicketCard
        project={project}
        ticket={{ ...t, ...over }}
        session={undefined}
        state={undefined}
        done={done}
        onFolderFixed={vi.fn()}
        onSetUp={vi.fn()}
        tickets={[]}
        onOpenTicket={vi.fn()}
        stateOf={() => undefined}
        onOpen={vi.fn()}
      />
    )
  }

  it.each([
    ['open', 'PR open'],
    ['conflicts', 'Conflicts'],
    ['checksFailing', 'Checks failing'],
    ['changesRequested', 'Changes requested'],
    ['readyToMerge', 'Ready to merge']
  ] as const)('says %s as "%s" on a card outside Done', (prStage, word) => {
    renderStage({ prStage })
    expect(screen.getByText(word)).toBeInTheDocument()
  })

  it('shows no stage on a Done card or without an open pull request', () => {
    renderStage({ prStage: 'open' }, true)
    expect(screen.queryByText('PR open')).toBeNull()
    cleanup()
    renderStage({ prStage: null })
    expect(screen.queryByText('PR open')).toBeNull()
  })
})

const openNote = async (): Promise<void> => {
  await userEvent.click(screen.getByRole('button', { name: 'Start with…' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Start with note' }))
}

describe('TicketCard Start with note', () => {
  const todo = ticket(98)
  const todoCard = (onOpen = vi.fn(), s?: SessionRecord, tk = todo): React.JSX.Element => (
    <TicketCard
      project={project}
      ticket={tk}
      session={s}
      state={undefined}
      done={false}
      onFolderFixed={vi.fn()}
      onSetUp={vi.fn()}
      tickets={[]}
      onOpenTicket={vi.fn()}
      stateOf={() => undefined}
      onOpen={onOpen}
    />
  )
  const renderTodo = (onOpen = vi.fn()): void => {
    render(
      <TicketCard
        project={project}
        ticket={todo}
        session={undefined}
        state={undefined}
        done={false}
        onFolderFixed={vi.fn()}
        onSetUp={vi.fn()}
        tickets={[]}
        onOpenTicket={vi.fn()}
        stateOf={() => undefined}
        onOpen={onOpen}
      />
    )
  }

  it("starts with the project's model, or the one picked on the chip, without opening the card", async () => {
    const onOpen = vi.fn()
    const { unmount } = render(
      <TicketCard
        project={{ ...project, model: 'sonnet' }}
        ticket={todo}
        session={undefined}
        state={undefined}
        done={false}
        onFolderFixed={vi.fn()}
        onSetUp={vi.fn()}
        tickets={[]}
        onOpenTicket={vi.fn()}
        stateOf={() => undefined}
        onOpen={onOpen}
      />
    )
    const chip = screen.getByRole('button', { name: 'Model: Sonnet' })
    await userEvent.click(chip)
    const items = screen.getAllByRole('menuitemradio')
    expect(items.map((i) => i.textContent)).toEqual([
      'Account default',
      'Fable',
      'Opus',
      'Sonnet,Project',
      'Haiku'
    ])
    expect(screen.getByRole('menuitemradio', { name: /Sonnet/ })).toBeChecked()
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Haiku' }))
    expect(screen.getByRole('button', { name: 'Model: Haiku' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Start' }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Start' })
    )
    expect(api.tickets.start).toHaveBeenCalledWith(
      project.id,
      todo.key,
      [],
      undefined,
      undefined,
      'haiku',
      undefined,
      undefined
    )
    expect(onOpen).not.toHaveBeenCalled()
    unmount()
    renderTodo(onOpen)
    expect(screen.getByRole('button', { name: 'Model: Account default' })).toBeInTheDocument()
  })

  it.each([
    ['opus', 'Opus'],
    [undefined, null]
  ] as const)("shows the session's model %s before its state", (model, word) => {
    render(
      <TicketCard
        project={project}
        ticket={todo}
        session={session(todo.key, { state: 'running', model })}
        state="running"
        done={false}
        onFolderFixed={vi.fn()}
        onSetUp={vi.fn()}
        tickets={[]}
        onOpenTicket={vi.fn()}
        stateOf={() => undefined}
        onOpen={vi.fn()}
      />
    )
    if (word) expect(screen.getByText('Model:').parentElement).toHaveTextContent(`Model: ${word}`)
    else expect(screen.queryByText('Model:')).toBeNull()
  })

  it('carries the note to tickets.start without opening the card', async () => {
    const onOpen = vi.fn()
    renderTodo(onOpen)
    await openNote()
    const note = screen.getByRole('textbox', { name: 'Note for this session' })
    expect(note).toHaveFocus()
    await userEvent.type(note, 'Keep it small')
    await userEvent.click(screen.getByRole('button', { name: 'Start with note' }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Start' })
    )
    expect(api.tickets.start).toHaveBeenCalledWith(
      project.id,
      todo.key,
      [],
      undefined,
      'Keep it small',
      undefined,
      undefined,
      undefined
    )
    expect(onOpen).not.toHaveBeenCalled()
  })

  const startWith = async (item: string): Promise<void> => {
    await userEvent.click(screen.getByRole('button', { name: 'Start with…' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: item }))
  }

  it('starts with planning from the start menu without opening the card', async () => {
    const onOpen = vi.fn()
    renderTodo(onOpen)
    await startWith('Start with planning')
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Start' })
    )
    expect(vi.mocked(api.tickets.start).mock.calls[0][7]).toBe(true)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it("doesn't plan a plain Start after a cancelled planning start", async () => {
    renderTodo()
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

  it('keeps the start menu keys from the card', async () => {
    const onOpen = vi.fn()
    const onKeyDown = vi.fn()
    render(
      <TicketCard
        project={project}
        ticket={todo}
        session={undefined}
        state={undefined}
        done={false}
        onFolderFixed={vi.fn()}
        onSetUp={vi.fn()}
        tickets={[]}
        onOpenTicket={vi.fn()}
        stateOf={() => undefined}
        onOpen={onOpen}
        dragHandle={{ ref: vi.fn(), onKeyDown } as unknown as DragHandle}
      />
    )
    screen.getByRole('button', { name: 'Start with…' }).focus()
    await userEvent.keyboard('{Enter}')
    await screen.findByRole('menuitem', { name: 'Start with planning' })
    onKeyDown.mockClear()
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(onKeyDown).not.toHaveBeenCalled()
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('closes on Escape and returns focus to Start with note', async () => {
    renderTodo()
    await openNote()
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('textbox', { name: 'Note for this session' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Start with…' })).toHaveFocus()
  })

  it('offers it only when the action is Start', () => {
    renderCard(true)
    expect(screen.queryByRole('button', { name: 'Start with…' })).toBeNull()
  })

  it('returns focus to Start with note after the Start dialog closes', async () => {
    renderTodo()
    await openNote()
    await userEvent.type(screen.getByRole('textbox', { name: 'Note for this session' }), 'Hi')
    await userEvent.click(screen.getByRole('button', { name: 'Start with note' }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' })
    )
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: 'Start with…' })).toHaveFocus()
    )
  })

  it('closes when Start is no longer offered', async () => {
    const { rerender } = render(todoCard())
    await openNote()
    rerender(todoCard(vi.fn(), session(todo.key)))
    expect(screen.queryByRole('textbox', { name: 'Note for this session' })).toBeNull()
    rerender(todoCard())
    expect(screen.queryByRole('textbox', { name: 'Note for this session' })).toBeNull()
  })

  const submitNote = async (text: string): Promise<void> => {
    await openNote()
    await userEvent.type(screen.getByRole('textbox', { name: 'Note for this session' }), text)
    await userEvent.click(screen.getByRole('button', { name: 'Start with note' }))
  }

  it('keeps the note when the Start dialog is cancelled', async () => {
    renderTodo()
    await submitNote('Hi')
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' })
    )
    await openNote()
    expect(screen.getByRole('textbox', { name: 'Note for this session' })).toHaveValue('Hi')
  })

  it('keeps the note when the start fails, and clears it once a start succeeds', async () => {
    vi.mocked(api.tickets.start).mockRejectedValueOnce(new Error('boom'))
    renderTodo()
    const startInDialog = async (): Promise<void> =>
      userEvent.click(
        within(await screen.findByRole('dialog')).getByRole('button', { name: 'Start' })
      )
    await submitNote('Hi')
    await startInDialog()
    expect(await screen.findByText("Couldn't start: boom")).toBeInTheDocument()
    expect(api.app.setStartFailures).toHaveBeenLastCalledWith([
      { projectId: 'p1', ticketKey: 'octo/shop#98' }
    ])
    await openNote()
    const note = screen.getByRole('textbox', { name: 'Note for this session' })
    expect(note).toHaveValue('Hi')
    await userEvent.click(screen.getByRole('button', { name: 'Start with note' }))
    await startInDialog()
    await vi.waitFor(() => expect(api.tickets.start).toHaveBeenCalledTimes(2))
    await openNote()
    expect(screen.getByRole('textbox', { name: 'Note for this session' })).toHaveValue('')
    expect(api.app.setStartFailures).toHaveBeenLastCalledWith([])
  })

  it("drops a pending Start when the card can't start any more", async () => {
    vi.mocked(api.tickets.checkStart).mockReturnValue(new Promise(() => undefined))
    const { rerender } = render(todoCard())
    await userEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(api.tickets.checkStart).toHaveBeenCalledTimes(1)
    rerender(todoCard(vi.fn(), undefined, { ...todo, repo: 'someone/else' }))
    rerender(todoCard())
    expect(api.tickets.checkStart).toHaveBeenCalledTimes(1)
  })

  it('moves focus to the card when the note closes on its own', async () => {
    const { rerender } = render(todoCard())
    await openNote()
    expect(screen.getByRole('textbox', { name: 'Note for this session' })).toHaveFocus()
    rerender(todoCard(vi.fn(), session(todo.key)))
    expect(document.activeElement).toHaveAttribute('data-slot', 'card')
  })
})

describe('TicketCard activity', () => {
  const running = session(t.key)
  const minutesAgo = (m: number): string => new Date(Date.now() - m * 60_000 - 5_000).toISOString()
  const activity = {
    steps: [
      { tool: 'Bash', target: 'npm test', at: minutesAgo(0) },
      { tool: 'Edit', target: 'src/main/orchestrator.ts', at: minutesAgo(1) }
    ],
    since: minutesAgo(4)
  }
  const runningCard = (
    onOpen = vi.fn(),
    state: 'running' | 'needsYou' = 'running'
  ): React.JSX.Element => (
    <TicketCard
      project={project}
      ticket={t}
      session={{ ...running, state }}
      state={state}
      done={false}
      onFolderFixed={vi.fn()}
      onSetUp={vi.fn()}
      tickets={[]}
      onOpenTicket={vi.fn()}
      stateOf={() => undefined}
      onOpen={onOpen}
    />
  )

  it("shows a running session's latest step and how long it has run, beside the state word", async () => {
    vi.mocked(api.sessions.activity).mockResolvedValue(activity)
    render(runningCard())
    const strip = await screen.findByRole('button', {
      name: 'Running npm test, for 4 minutes. Show last steps'
    })
    expect(strip).toHaveTextContent('Running npm test4m')
    expect(strip).toHaveAttribute('title', 'Running npm test')
    expect(screen.getByText('Running', { selector: '.bg-blue-soft' })).toBeInTheDocument()
    expect(api.sessions.activity).toHaveBeenCalledWith(running.id)
  })

  it('opens the earlier steps from the strip without opening the card', async () => {
    vi.mocked(api.sessions.activity).mockResolvedValue(activity)
    const onOpen = vi.fn()
    render(runningCard(onOpen))
    const strip = await screen.findByRole('button', { name: /Show last steps/ })
    expect(screen.queryByRole('list', { name: 'Last steps' })).toBeNull()
    await userEvent.click(strip)
    expect(strip).toHaveAttribute('aria-expanded', 'true')
    const trail = within(screen.getByRole('list', { name: 'Last steps' }))
    expect(trail.getByText('npm test')).toBeInTheDocument()
    expect(trail.getByText('src/main/orchestrator.ts')).toBeInTheDocument()
    const row = trail.getByText('npm test').parentElement
    expect(row).toHaveAttribute('title', 'Running npm test')
    expect(row).toHaveClass('truncate')
    await userEvent.keyboard('{Enter}')
    expect(strip).toHaveAttribute('aria-expanded', 'false')
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('follows pushed steps for its session only', async () => {
    let push: (id: string, a: typeof activity) => void = () => {}
    vi.mocked(api.sessions.onActivity).mockImplementation((cb) => {
      push = cb
      return () => {}
    })
    render(runningCard())
    await act(async () => {})
    act(() => push('other', activity))
    expect(screen.queryByRole('button', { name: /Show last steps/ })).toBeNull()
    act(() => push(running.id, activity))
    expect(screen.getByRole('button', { name: /^Running npm test/ })).toBeInTheDocument()
  })

  it('shows the latest step as text, not a button, with no earlier steps', async () => {
    vi.mocked(api.sessions.activity).mockResolvedValue({ ...activity, steps: [activity.steps[0]] })
    render(runningCard())
    expect(await screen.findByText('npm test')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /npm test/ })).toBeNull()
  })

  it('drops the old steps when the session leaves Running and comes back', async () => {
    vi.mocked(api.sessions.activity).mockResolvedValueOnce(activity).mockResolvedValue(null)
    const { rerender } = render(runningCard())
    await screen.findByRole('button', { name: /Show last steps/ })
    rerender(runningCard(vi.fn(), 'needsYou'))
    rerender(runningCard())
    await act(async () => {})
    expect(screen.queryByRole('button', { name: /Show last steps/ })).toBeNull()
  })

  it('shows no strip while the session needs you', async () => {
    vi.mocked(api.sessions.activity).mockResolvedValue(activity)
    render(runningCard(vi.fn(), 'needsYou'))
    await act(async () => {})
    expect(api.sessions.activity).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /Show last steps/ })).toBeNull()
  })
})

describe('TicketCard worktree setup', () => {
  const tk = ticket(140)
  const target = `${project.id}\n${tk.key}`
  const failed: SetupProgress = {
    repo: 'octo/shop',
    state: 'failed',
    notes: [],
    lines: ['npm ERR! one', 'npm ERR! two'],
    error: 'npm install exited with code 1',
    startedAt: new Date().toISOString()
  }
  let push: (target: string, p: SetupProgress | null) => void = () => {}
  const renderCard = (onOpen = vi.fn()): void => {
    vi.mocked(api.setup.onProgress).mockImplementation((cb) => {
      push = cb
      return () => {}
    })
    render(
      <TicketCard
        project={project}
        ticket={tk}
        session={undefined}
        state={undefined}
        done={false}
        onFolderFixed={vi.fn()}
        onSetUp={vi.fn()}
        tickets={[]}
        onOpenTicket={vi.fn()}
        stateOf={() => undefined}
        onOpen={onOpen}
      />
    )
  }

  it('shows a running setup in place of the start buttons, and Cancel cancels it', async () => {
    const onOpen = vi.fn()
    renderCard(onOpen)
    act(() => push(target, { ...failed, state: 'running', lines: [] }))
    expect(screen.getByRole('status')).toHaveTextContent('Copying files into the worktree')
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(api.setup.cancel).toHaveBeenCalledWith(target)
    expect(onOpen).not.toHaveBeenCalled()
    expect(document.querySelector('[data-slot="card"]')).toHaveFocus()
  })

  it("shows a failed setup instead of Couldn't start, and Start anyway reruns the start without setup", async () => {
    vi.mocked(api.tickets.start).mockRejectedValueOnce(
      new Error(`${SETUP_FAILED}: npm install exited with code 1`)
    )
    renderCard()
    await openNote()
    await userEvent.type(screen.getByRole('textbox', { name: 'Note for this session' }), 'Hi')
    await userEvent.click(screen.getByRole('button', { name: 'Start with note' }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Start' })
    )
    act(() => push(target, failed))
    await vi.waitFor(() => expect(api.tickets.start).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Setup failed: npm install exited with code 1')).toBeVisible()
    expect(screen.queryByText(/Couldn't start/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Start with…' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Model:/ })).toBeNull()
    let finish: () => void = () => undefined
    vi.mocked(api.tickets.start).mockReturnValueOnce(new Promise<void>((r) => (finish = r)))
    await userEvent.click(screen.getByRole('button', { name: 'Start anyway' }))
    expect(api.tickets.start).toHaveBeenLastCalledWith(
      project.id,
      tk.key,
      [],
      undefined,
      'Hi',
      undefined,
      false,
      undefined
    )
    expect(document.querySelector('[data-slot="card"]')).toHaveFocus()
    expect(screen.queryByRole('button', { name: 'Start anyway' })).toBeNull()
    expect(api.tickets.start).toHaveBeenCalledTimes(2)
    act(() => push(target, null))
    await act(async () => finish())
    await openNote()
    expect(screen.getByRole('textbox', { name: 'Note for this session' })).toHaveValue('')
  })

  it("doesn't show Couldn't start when the setup is cancelled", async () => {
    vi.mocked(api.tickets.start).mockRejectedValueOnce(new Error(SETUP_CANCELLED))
    renderCard()
    await userEvent.click(screen.getByRole('button', { name: 'Start' }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Start' })
    )
    await vi.waitFor(() => expect(api.tickets.start).toHaveBeenCalled())
    await act(async () => {})
    expect(screen.queryByText(/Couldn't start/)).toBeNull()
  })
})

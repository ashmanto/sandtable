import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SandtableApi } from '../../../shared/api'
import type { Chat as Saved, ChatState, Step } from '../../../shared/types'
import { fakeSandtable } from '../test/fixtures'
import { ChatPanel } from './ChatPanel'

let api: SandtableApi

const saved: Saved = {
  projectId: 'p1',
  ticketKey: 'o/r#1',
  conversationId: 'c1',
  claudeDir: '/claude',
  cwd: '/repos/r',
  messages: [
    { role: 'user', text: 'What breaks?' },
    { role: 'assistant', text: 'The **parser**' },
    { role: 'assistant', text: '```\nx\n```' }
  ]
}

const loaded = (chat: Saved | null, answering = false): ChatState => ({ chat, answering })

const renderChat = (onPosted = vi.fn(), onHide = vi.fn()): ReturnType<typeof render> =>
  render(
    <ChatPanel
      projectId="p1"
      ticketKey="o/r#1"
      service="GitHub"
      active
      hidden={false}
      onPosted={onPosted}
      onHide={onHide}
    />
  )

const toComment = async (): Promise<void> =>
  userEvent.click(await screen.findByRole('radio', { name: /^Comment/ }))

beforeEach(() => {
  api = fakeSandtable()
})

describe('ChatPanel', () => {
  it('waits until active, then shows the saved messages with no count or cost', async () => {
    vi.mocked(api.tickets.chat).mockResolvedValue(loaded(saved))
    const panel = (active: boolean): React.JSX.Element => (
      <ChatPanel
        projectId="p1"
        ticketKey="o/r#1"
        service="GitHub"
        active={active}
        hidden={false}
        onPosted={vi.fn()}
        onHide={vi.fn()}
      />
    )
    const { rerender } = render(panel(false))
    expect(api.tickets.chat).not.toHaveBeenCalled()
    rerender(panel(true))
    expect(await screen.findByText('parser')).toBeInTheDocument()
    expect(api.tickets.chat).toHaveBeenCalledWith('p1', 'o/r#1')
    expect(screen.getByRole('complementary', { name: 'Chat' })).toHaveTextContent(/^Chat/)
    expect(screen.queryByText(/message|\$/)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('textbox', { name: 'Reply on GitHub as you' })
    ).not.toBeInTheDocument()
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'YouWhat breaks?',
      'ClaudeThe parser',
      'Claudex\n'
    ])
    expect(screen.queryByRole('button', { name: /^Copy/ })).not.toBeInTheDocument()
  })

  it('shows the empty state without a chat, and no Start over', async () => {
    renderChat()
    expect(await screen.findByText('Ask Claude about this ticket')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start over' })).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Ask Claude', checked: true })).toBeInTheDocument()
  })

  it('sends a suggestion as your message and keeps what you typed', async () => {
    renderChat()
    await userEvent.type(await screen.findByRole('textbox', { name: 'Message' }), 'Draft question')
    for (const text of [
      'Which files would this touch?',
      "What's unclear in this ticket?",
      'How would you split this into tasks?'
    ])
      expect(await screen.findByRole('button', { name: text })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: "What's unclear in this ticket?" }))
    expect(api.tickets.sendChat).toHaveBeenCalledWith(
      'p1',
      'o/r#1',
      "What's unclear in this ticket?"
    )
    expect(
      within(await screen.findByRole('list')).getByText("What's unclear in this ticket?")
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Which files would this touch?' })).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Draft question')
  })

  it('calls onHide on Hide chat', async () => {
    const onHide = vi.fn()
    renderChat(vi.fn(), onHide)
    await userEvent.click(await screen.findByRole('button', { name: 'Hide chat' }))
    expect(onHide).toHaveBeenCalled()
  })

  it('shows a load failure with Retry', async () => {
    vi.mocked(api.tickets.chat).mockRejectedValueOnce(
      new Error("Error invoking remote method 'tickets.chat': Error: disk full")
    )
    renderChat()
    expect(await screen.findByText("Couldn't load the chat: disk full")).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Ask Claude about this ticket')).toBeInTheDocument()
  })

  it('sends, disables the composer while Claude answers, then shows the answer', async () => {
    const scrolled = vi.spyOn(Element.prototype, 'scrollTo')
    let answer: (c: Saved) => void = () => undefined
    vi.mocked(api.tickets.sendChat).mockReturnValue(new Promise((r) => (answer = r)))
    renderChat()
    const box = await screen.findByRole('textbox', { name: 'Message' })
    await userEvent.type(box, 'What breaks?')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(api.tickets.sendChat).toHaveBeenCalledWith('p1', 'o/r#1', 'What breaks?')
    expect(scrolled).toHaveBeenCalledWith({ top: 0, behavior: 'instant' })
    expect(screen.getByText('Claude is answering')).toBeInTheDocument()
    expect(box).toBeDisabled()
    expect(box).toHaveValue('What breaks?')
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Claude is answering')
    expect(screen.getByRole('status')).toHaveClass('shimmer')
    answer(saved)
    expect(await screen.findByText('parser')).toBeInTheDocument()
    expect(box).toHaveValue('')
    expect(box).toBeEnabled()
    await waitFor(() => expect(box).toHaveFocus())
    expect(screen.queryByText('Claude is answering')).not.toBeInTheDocument()
  })

  it('keeps unsent text for this ticket only, until you send it', async () => {
    vi.mocked(api.tickets.sendChat).mockResolvedValue(saved)
    const first = renderChat()
    await userEvent.type(await screen.findByRole('textbox', { name: 'Message' }), 'Half a question')
    first.unmount()
    const other = render(
      <ChatPanel
        projectId="p1"
        ticketKey="o/r#2"
        service="GitHub"
        active
        hidden={false}
        onPosted={vi.fn()}
        onHide={vi.fn()}
      />
    )
    expect(await screen.findByRole('textbox', { name: 'Message' })).toHaveValue('')
    other.unmount()
    renderChat()
    const box = await screen.findByRole('textbox', { name: 'Message' })
    expect(box).toHaveValue('Half a question')
    expect(api.app.saveDraft).toHaveBeenCalledWith('chat:p1\0o/r#1', { text: 'Half a question' })
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(box).toHaveValue(''))
    expect(api.app.saveDraft).toHaveBeenLastCalledWith('chat:p1\0o/r#1', { text: '' })
  })

  it("shows the ticket's latest step while Claude answers, and Stop keeps the question", async () => {
    let fail: (err: Error) => void = () => undefined
    vi.mocked(api.tickets.sendChat).mockReturnValue(new Promise((_, reject) => (fail = reject)))
    let push: (projectId: string, ticketKey: string, steps: Step[]) => void = () => undefined
    vi.mocked(api.tickets.onChatSteps).mockImplementation((cb) => {
      push = cb
      return () => undefined
    })
    renderChat()
    const box = await screen.findByRole('textbox', { name: 'Message' })
    await userEvent.type(box, 'What breaks?{Enter}')
    act(() => push('p1', 'o/r#2', [{ tool: 'Grep', target: 'nope', at: null }]))
    act(() =>
      push('p1', 'o/r#1', [
        { tool: 'Read', target: 'src/a.ts', at: null },
        { tool: 'Grep', target: 'chatArgs', at: null }
      ])
    )
    expect(screen.getByTitle('Searching chatArgs')).toBeInTheDocument()
    expect(screen.queryByTitle('Reading src/a.ts')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/^Claude is answering$/)
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(api.tickets.stopChat).toHaveBeenCalledWith('p1', 'o/r#1')
    await act(async () => fail(new Error('Chat stopped')))
    await waitFor(() => expect(box).toBeEnabled())
    expect(box).toHaveValue('What breaks?')
    expect(box).toHaveFocus()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Searching chatArgs')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
  })

  it('offers no Stop while a session summary runs', async () => {
    vi.mocked(api.tickets.chat).mockResolvedValue({
      chat: null,
      answering: true,
      summarizing: true
    })
    renderChat()
    expect(await screen.findByText('Claude is summarizing the session')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument()
  })

  it('stops an answer that was running when the panel opened, then focuses the box', async () => {
    let onChange: (projectId: string) => void = () => undefined
    vi.mocked(api.board.onChange).mockImplementation((cb) => {
      onChange = cb
      return () => undefined
    })
    vi.mocked(api.tickets.chat).mockResolvedValueOnce(loaded(null, true))
    renderChat()
    await userEvent.click(await screen.findByRole('button', { name: 'Stop' }))
    expect(api.tickets.stopChat).toHaveBeenCalledWith('p1', 'o/r#1')
    act(() => onChange('p1'))
    const box = screen.getByRole('textbox', { name: 'Message' })
    await waitFor(() => expect(box).toHaveFocus())
  })

  it('keeps the text and shows the error when a send fails', async () => {
    vi.mocked(api.tickets.sendChat).mockRejectedValue(
      new Error("Error invoking remote method 'tickets.sendChat': Error: claude timed out")
    )
    renderChat()
    const box = await screen.findByRole('textbox', { name: 'Message' })
    await userEvent.type(box, 'Why?')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('claude timed out')
    expect(box).toHaveValue('Why?')
  })

  it('sends on Enter and adds a line on Shift+Enter', async () => {
    renderChat()
    const box = await screen.findByRole('textbox', { name: 'Message' })
    await userEvent.type(box, 'one{Shift>}{Enter}{/Shift}two')
    expect(api.tickets.sendChat).not.toHaveBeenCalled()
    expect(box).toHaveValue('one\ntwo')
    await userEvent.type(box, '{Enter}')
    expect(api.tickets.sendChat).toHaveBeenCalledWith('p1', 'o/r#1', 'one\ntwo')
  })

  it.each(['Linear', 'Jira'] as const)(
    "names %s as where the project's comment goes",
    async (service) => {
      vi.mocked(api.tickets.chat).mockResolvedValue(loaded({ ...saved, ticketKey: 'APP-1' }))
      vi.mocked(api.tickets.draftComment).mockResolvedValue('The parser breaks.')
      render(
        <ChatPanel
          projectId="p1"
          ticketKey="APP-1"
          service={service}
          active
          hidden={false}
          onPosted={vi.fn()}
          onHide={vi.fn()}
        />
      )
      await toComment()
      await userEvent.click(screen.getByRole('button', { name: 'Draft with Claude' }))
      expect(
        await screen.findByRole('textbox', { name: `Reply on ${service} as you` })
      ).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Start over' }))
      expect(
        screen.getByText(`Comments you posted stay on ${service}.`, { exact: false })
      ).toBeInTheDocument()
    }
  )

  it('drafts an editable comment in place of the message box and posts only the edited text on Post comment', async () => {
    const onPosted = vi.fn()
    vi.mocked(api.tickets.chat).mockResolvedValue(loaded(saved))
    vi.mocked(api.tickets.draftComment).mockResolvedValue('The parser breaks.')
    renderChat(onPosted)
    await toComment()
    expect(screen.queryByRole('textbox', { name: 'Message' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Draft with Claude' }))
    expect(api.tickets.draftComment).toHaveBeenCalledWith('p1', 'o/r#1')
    const draft = await screen.findByRole('textbox', { name: 'Reply on GitHub as you' })
    await waitFor(() => expect(draft).toHaveValue('The parser breaks.'))
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(api.tickets.postComment).not.toHaveBeenCalled()
    await userEvent.type(draft, ' Fix it.')
    await userEvent.click(screen.getByRole('button', { name: 'Post comment' }))
    expect(api.tickets.postComment).toHaveBeenCalledWith(
      'p1',
      'o/r#1',
      'The parser breaks. Fix it.'
    )
    expect(await screen.findByText('Comment posted')).toBeInTheDocument()
    expect(
      screen.queryByRole('textbox', { name: 'Reply on GitHub as you' })
    ).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus()
    expect(onPosted).toHaveBeenCalled()
    expect(api.tickets.saveDraft).toHaveBeenCalledTimes(1)
  })

  it('disables Post comment for an empty draft and drops a discarded one', async () => {
    vi.mocked(api.tickets.chat).mockResolvedValue(loaded(saved))
    vi.mocked(api.tickets.draftComment).mockResolvedValue('Text')
    renderChat()
    await toComment()
    await userEvent.click(screen.getByRole('button', { name: 'Draft with Claude' }))
    const draft = await screen.findByRole('textbox', { name: 'Reply on GitHub as you' })
    await waitFor(() => expect(draft).toHaveValue('Text'))
    await userEvent.clear(draft)
    expect(screen.getByRole('button', { name: 'Post comment' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(api.tickets.discardDraft).toHaveBeenCalledWith('p1', 'o/r#1')
    expect(
      screen.queryByRole('textbox', { name: 'Reply on GitHub as you' })
    ).not.toBeInTheDocument()
    expect(api.tickets.saveDraft).not.toHaveBeenCalled()
    expect(screen.getByRole('radio', { name: 'Ask Claude', checked: true })).toBeInTheDocument()
    expect(api.tickets.postComment).not.toHaveBeenCalled()
  })

  it('writes a comment yourself on a ticket with no chat, saving it before posting', async () => {
    renderChat()
    await toComment()
    const draft = screen.getByRole('textbox', { name: 'Reply on GitHub as you' })
    expect(draft).toHaveValue('')
    await waitFor(() => expect(draft).toHaveFocus())
    expect(screen.getByRole('button', { name: 'Draft with Claude' })).toBeDisabled()
    await userEvent.type(draft, 'Mine{Enter}')
    expect(draft).toHaveValue('Mine\n')
    expect(screen.getByRole('button', { name: 'Rewrite with Claude' })).toBeEnabled()
    await userEvent.type(draft, '{Backspace}')
    await userEvent.click(screen.getByRole('button', { name: 'Post comment' }))
    expect(api.tickets.saveDraft).toHaveBeenCalledWith('p1', 'o/r#1', 'Mine')
    expect(api.tickets.postComment).toHaveBeenCalledWith('p1', 'o/r#1', 'Mine')
    expect(vi.mocked(api.tickets.saveDraft).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(api.tickets.postComment).mock.invocationCallOrder[0]
    )
  })

  it('replaces your text with Claude’s rewrite and posts nothing', async () => {
    let finish: (d: string) => void = () => undefined
    vi.mocked(api.tickets.chat).mockResolvedValueOnce(loaded({ ...saved, draft: 'mine' }))
    vi.mocked(api.tickets.draftComment).mockReturnValue(new Promise((r) => (finish = r)))
    renderChat()
    const draft = await screen.findByRole('textbox', { name: 'Reply on GitHub as you' })
    await userEvent.type(draft, ' too')
    await userEvent.click(screen.getByRole('button', { name: 'Rewrite with Claude' }))
    expect(api.tickets.draftComment).toHaveBeenCalledWith('p1', 'o/r#1', 'mine too')
    expect(screen.getByRole('status')).toHaveTextContent('Claude is rewriting the comment')
    vi.mocked(api.tickets.chat).mockResolvedValueOnce(loaded({ ...saved, draft: 'Better' }))
    finish('Better')
    await waitFor(() => expect(draft).toHaveValue('Better'))
    expect(api.tickets.postComment).not.toHaveBeenCalled()
  })

  it('stops a rewrite from the comment box and focuses the draft again', async () => {
    let fail: (err: Error) => void = () => undefined
    vi.mocked(api.tickets.chat).mockResolvedValue(loaded({ ...saved, draft: 'mine' }))
    vi.mocked(api.tickets.draftComment).mockReturnValue(new Promise((_, reject) => (fail = reject)))
    renderChat()
    const draft = await screen.findByRole('textbox', { name: 'Reply on GitHub as you' })
    await userEvent.click(screen.getByRole('button', { name: 'Rewrite with Claude' }))
    expect(screen.queryByRole('button', { name: 'Post comment' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(api.tickets.stopChat).toHaveBeenCalledWith('p1', 'o/r#1')
    await act(async () => fail(new Error('Chat stopped')))
    await waitFor(() => expect(draft).toHaveFocus())
    expect(draft).toHaveValue('mine')
  })

  it('shows an error when saving the draft fails, until a save works', async () => {
    vi.mocked(api.tickets.saveDraft).mockRejectedValueOnce(new Error('disk full'))
    renderChat()
    await toComment()
    const draft = screen.getByRole('textbox', { name: 'Reply on GitHub as you' })
    await userEvent.type(draft, 'Mine')
    await userEvent.tab()
    expect(await screen.findByText("Couldn't save the draft: disk full")).toBeInTheDocument()
    expect(draft).toHaveValue('Mine')
    await userEvent.click(draft)
    await userEvent.tab()
    await waitFor(() =>
      expect(screen.queryByText(/Couldn't save the draft/)).not.toBeInTheDocument()
    )
    expect(api.tickets.saveDraft).toHaveBeenCalledTimes(2)
  })

  it('saves the draft you typed when the panel closes', async () => {
    vi.mocked(api.tickets.chat).mockResolvedValue(loaded(saved))
    const { unmount } = renderChat()
    await toComment()
    await userEvent.type(screen.getByRole('textbox', { name: 'Reply on GitHub as you' }), 'Mine')
    expect(api.tickets.saveDraft).not.toHaveBeenCalled()
    unmount()
    expect(api.tickets.saveDraft).toHaveBeenCalledWith('p1', 'o/r#1', 'Mine')
  })

  it('keeps and saves the draft when you switch back to Ask Claude, and marks Comment', async () => {
    vi.mocked(api.tickets.chat).mockResolvedValue(loaded(saved))
    renderChat()
    await toComment()
    expect(screen.getByRole('radio', { name: 'Comment' })).toBeChecked()
    await userEvent.click(screen.getByRole('radio', { name: 'Ask Claude' }))
    expect(api.tickets.saveDraft).not.toHaveBeenCalled()
    await toComment()
    await userEvent.type(screen.getByRole('textbox', { name: 'Reply on GitHub as you' }), 'Mine')
    await userEvent.click(screen.getByRole('radio', { name: 'Ask Claude' }))
    expect(api.tickets.saveDraft).toHaveBeenCalledWith('p1', 'o/r#1', 'Mine')
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus())
    await userEvent.click(screen.getByRole('radio', { name: 'Comment, has a draft' }))
    expect(screen.getByRole('textbox', { name: 'Reply on GitHub as you' })).toHaveValue('Mine')
  })

  it('deletes a saved draft you cleared instead of saving it empty', async () => {
    vi.mocked(api.tickets.chat).mockResolvedValue(loaded({ ...saved, draft: 'Kept' }))
    renderChat()
    await userEvent.clear(await screen.findByRole('textbox', { name: 'Reply on GitHub as you' }))
    await userEvent.click(screen.getByRole('radio', { name: 'Ask Claude' }))
    expect(api.tickets.discardDraft).toHaveBeenCalledWith('p1', 'o/r#1')
    expect(api.tickets.saveDraft).not.toHaveBeenCalled()
    expect(screen.getByRole('radio', { name: 'Comment' })).toBeInTheDocument()
  })

  it('marks a summary that lands while you type a message instead of taking the box away', async () => {
    let onChange: (projectId: string) => void = () => undefined
    vi.mocked(api.board.onChange).mockImplementation((cb) => {
      onChange = cb
      return () => undefined
    })
    vi.mocked(api.tickets.chat).mockResolvedValueOnce(loaded(saved))
    renderChat()
    const box = await screen.findByRole('textbox', { name: 'Message' })
    await userEvent.type(box, 'Wh')
    vi.mocked(api.tickets.chat).mockResolvedValueOnce(
      loaded({ ...saved, draft: 'What changed', summary: true })
    )
    act(() => onChange('p1'))
    expect(await screen.findByRole('radio', { name: 'Comment, has a draft' })).toBeInTheDocument()
    expect(box).toHaveFocus()
  })

  it('asks before Start over and clears only on confirm', async () => {
    vi.mocked(api.tickets.chat).mockResolvedValue(loaded(saved))
    renderChat()
    await userEvent.click(await screen.findByRole('button', { name: 'Start over' }))
    expect(screen.getByText('Start over?')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(api.tickets.clearChat).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Start over' }))
    await userEvent.click(screen.getByRole('button', { name: 'Start over' }))
    await waitFor(() => expect(api.tickets.clearChat).toHaveBeenCalledWith('p1', 'o/r#1'))
    expect(await screen.findByText('Ask Claude about this ticket')).toBeInTheDocument()
  })

  it("doesn't send while an input method is composing", async () => {
    renderChat()
    const box = await screen.findByRole('textbox', { name: 'Message' })
    await userEvent.type(box, 'か')
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true })
    expect(api.tickets.sendChat).not.toHaveBeenCalled()
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(api.tickets.sendChat).toHaveBeenCalledWith('p1', 'o/r#1', 'か')
  })

  it('shows a turn still running after reopening, with every button but Hide chat and Stop disabled, and reloads when it ends', async () => {
    let onChange: (projectId: string) => void = () => undefined
    vi.mocked(api.board.onChange).mockImplementation((cb) => {
      onChange = cb
      return () => undefined
    })
    vi.mocked(api.tickets.chat).mockResolvedValueOnce(loaded({ ...saved, draft: 'Kept' }, true))
    renderChat()
    expect(await screen.findByRole('status')).toHaveTextContent('Claude is answering')
    expect(screen.getByRole('textbox', { name: 'Reply on GitHub as you' })).toBeDisabled()
    for (const b of screen.getAllByRole('button'))
      if (!['Hide chat', 'Stop'].includes(b.getAttribute('aria-label') ?? b.textContent ?? ''))
        expect(b).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Hide chat' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled()
    vi.mocked(api.tickets.chat).mockResolvedValueOnce(
      loaded({
        ...saved,
        draft: 'Kept',
        messages: [...saved.messages, { role: 'user', text: 'Next' }]
      })
    )
    act(() => onChange('other'))
    expect(api.tickets.chat).toHaveBeenCalledTimes(1)
    act(() => onChange('p1'))
    expect(await screen.findByText('Next')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Reply on GitHub as you' })).toBeEnabled()
  })

  it('shows the saved draft on load and keeps edits when the chat reloads', async () => {
    let onChange: (projectId: string) => void = () => undefined
    vi.mocked(api.board.onChange).mockImplementation((cb) => {
      onChange = cb
      return () => undefined
    })
    vi.mocked(api.tickets.chat).mockResolvedValue(loaded({ ...saved, draft: 'Kept' }))
    renderChat()
    const draft = await screen.findByRole('textbox', { name: 'Reply on GitHub as you' })
    expect(draft).toHaveValue('Kept')
    await userEvent.type(draft, ' more')
    act(() => onChange('p1'))
    await waitFor(() => expect(api.tickets.chat).toHaveBeenCalledTimes(2))
    expect(draft).toHaveValue('Kept more')
  })

  it('shows the drafting word, then the draft', async () => {
    let finish: (d: string) => void = () => undefined
    vi.mocked(api.tickets.chat).mockResolvedValueOnce(loaded(saved))
    vi.mocked(api.tickets.draftComment).mockReturnValue(new Promise((r) => (finish = r)))
    renderChat()
    await toComment()
    await userEvent.click(screen.getByRole('button', { name: 'Draft with Claude' }))
    expect(screen.getByRole('status')).toHaveTextContent('Claude is drafting a comment')
    expect(screen.getByRole('status')).toHaveClass('shimmer')
    vi.mocked(api.tickets.chat).mockResolvedValueOnce(loaded({ ...saved, draft: 'D' }))
    finish('D')
    const draft = screen.getByRole('textbox', { name: 'Reply on GitHub as you' })
    await waitFor(() => expect(draft).toHaveValue('D'))
    await waitFor(() => expect(draft).toHaveFocus())
  })

  it('shows the posting and starting-over words', async () => {
    let finish: () => void = () => undefined
    vi.mocked(api.tickets.chat).mockResolvedValue(loaded({ ...saved, draft: 'D' }))
    vi.mocked(api.tickets.postComment).mockReturnValue(new Promise((r) => (finish = r)))
    renderChat()
    await userEvent.click(await screen.findByRole('button', { name: 'Post comment' }))
    expect(screen.getByRole('status')).toHaveTextContent('Posting comment')
    finish()
    expect(await screen.findByText('Comment posted')).toBeInTheDocument()
    vi.mocked(api.tickets.clearChat).mockReturnValue(new Promise((r) => (finish = r)))
    await userEvent.click(screen.getByRole('button', { name: 'Start over' }))
    await userEvent.click(screen.getByRole('button', { name: 'Start over' }))
    expect(await screen.findByText('Starting over')).toBeInTheDocument()
    finish()
  })

  it('shows where a link goes on hover', async () => {
    vi.mocked(api.tickets.chat).mockResolvedValue(
      loaded({ ...saved, messages: [{ role: 'assistant', text: '[docs](https://example.com/a)' }] })
    )
    renderChat()
    expect(await screen.findByRole('link', { name: 'docs' })).toHaveAttribute(
      'title',
      'https://example.com/a'
    )
  })

  it('opens a session summary draft in Comment beside an empty chat, labeled', async () => {
    vi.mocked(api.tickets.chat).mockResolvedValue(
      loaded({ ...saved, messages: [], draft: 'What changed', summary: true })
    )
    renderChat()
    const draft = await screen.findByRole('textbox', {
      name: 'Session summary Reply on GitHub as you'
    })
    expect(draft).toHaveValue('What changed')
    expect(screen.getByText('Ask Claude about this ticket')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Message' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Post comment' }))
    expect(api.tickets.postComment).toHaveBeenCalledWith('p1', 'o/r#1', 'What changed')
  })

  it('says Claude is summarizing the session while a summary runs', async () => {
    vi.mocked(api.tickets.chat).mockResolvedValue({
      chat: null,
      answering: true,
      summarizing: true
    })
    renderChat()
    expect(await screen.findByRole('status')).toHaveTextContent('Claude is summarizing the session')
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeDisabled()
  })

  it("shows a failed summary's error and keeps the earlier draft", async () => {
    vi.mocked(api.tickets.chat).mockResolvedValue({
      ...loaded({ ...saved, draft: 'Earlier' }),
      failed: "Summary didn't finish within 3 minutes"
    })
    renderChat()
    expect(
      await screen.findByText(
        "Couldn't draft the session summary: Summary didn't finish within 3 minutes"
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Reply on GitHub as you' })).toHaveValue('Earlier')
    await userEvent.click(screen.getByRole('button', { name: 'Start over' }))
    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Start over' })
    )
    await waitFor(() =>
      expect(screen.queryByText(/Couldn't draft the session summary/)).not.toBeInTheDocument()
    )
  })
})

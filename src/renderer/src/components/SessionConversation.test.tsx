import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SandtableApi } from '../../../shared/api'
import type {
  ConversationEntry,
  ReviewRound,
  SessionCommand,
  SessionRecord
} from '../../../shared/types'
import { fakeSandtable, session } from '../test/fixtures'
import { useLiveConversation } from '@/hooks/useLiveConversation'
import { useSessionView } from '@/lib/sessionView'
import { SessionConversation } from './SessionConversation'
import type { SessionPrompt } from '../../../shared/prompt'

vi.mock('./Terminal', () => ({
  Terminal: ({ active }: { active?: boolean }) => (
    <div data-testid="terminal" data-active={String(!!active)} />
  )
}))

let api: SandtableApi

const tool = (name: string, summary: string, output: string | null = 'ok'): ConversationEntry => ({
  kind: 'tool',
  name,
  summary,
  input: '{}',
  output,
  error: false
})

const loaded = (entries: ConversationEntry[]): void => {
  vi.mocked(api.sessions.watchConversation).mockResolvedValue({
    from: 0,
    entries,
    facts: { todos: [], permissionMode: null, compactions: [] }
  })
}

function Live({
  session: s,
  actions,
  head,
  active,
  onOpenChanges
}: {
  session: SessionRecord
  actions?: React.ReactNode
  head?: React.ReactNode
  active?: boolean
  onOpenChanges?: () => void
}): React.JSX.Element {
  return (
    <SessionConversation
      session={s}
      conversation={useLiveConversation(s.id)}
      panel={<aside>Panel</aside>}
      actions={actions}
      head={head}
      active={active}
      onOpenChanges={onOpenChanges}
    />
  )
}

const show = (s: SessionRecord): ReturnType<typeof render> => render(<Live session={s} />)

const idle = session('T1', { id: 's1', state: 'idle' })
const asking = session('T1', { id: 's1', state: 'needsYou', asking: true })
const box = (): HTMLElement => screen.getByRole('combobox', { name: 'Message' })
const toggle = (): HTMLElement => screen.getByRole('button', { name: 'Terminal' })
const drawerOpen = (): boolean => toggle().getAttribute('aria-pressed') === 'true'
const terminalFocused = (): boolean => screen.getByTestId('terminal').dataset.active === 'true'

beforeEach(() => {
  api = fakeSandtable()
})

describe('SessionConversation', () => {
  describe('in the Terminal view', () => {
    beforeEach(() => localStorage.setItem('sessionView', '"terminal"'))

    it('fills the conversation and composer with the terminal, focused, and nothing else', async () => {
      loaded([{ kind: 'user', text: 'Go' }])
      show(session('T1', { id: 's1', state: 'running' }))
      await act(async () => {})
      expect(screen.getAllByTestId('terminal')).toHaveLength(1)
      expect(terminalFocused()).toBe(true)
      expect(screen.queryByRole('combobox', { name: 'Message' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Terminal' })).toBeNull()
      expect(screen.queryByText('Go')).toBeNull()
      expect(screen.queryByText('Claude is working…')).toBeNull()
      expect(screen.queryByRole('button', { name: 'Find in conversation' })).toBeNull()
      expect(screen.getByText('Panel')).toBeInTheDocument()
    })

    it('shows no question card while Claude asks', async () => {
      vi.mocked(api.sessions.prompt).mockResolvedValue({
        kind: 'permission',
        tool: 'Bash',
        summary: 'touch a.txt',
        input: '{}',
        choices: ['Yes', 'No']
      })
      show(asking)
      await vi.waitFor(() => expect(api.sessions.prompt).toHaveBeenCalled())
      await act(async () => {})
      expect(screen.queryByRole('region', { name: 'Claude needs your permission' })).toBeNull()
      expect(screen.getAllByTestId('terminal')).toHaveLength(1)
    })

    it("doesn't read the composer's suggestion it can't show", async () => {
      loaded([])
      show(idle)
      await act(async () => {})
      expect(api.sessions.suggestion).not.toHaveBeenCalled()
    })

    it('keeps the head above the terminal', () => {
      loaded([])
      render(<Live session={idle} head={<p>Head line</p>} />)
      expect(screen.getByText('Head line')).toBeInTheDocument()
      expect(screen.getAllByTestId('terminal')).toHaveLength(1)
    })

    it('says the session ended and shows the actions once it ends', async () => {
      loaded([])
      render(
        <Live
          session={session('T1', { id: 's1', state: 'finished' })}
          actions={<button>Resume</button>}
        />
      )
      expect(screen.getByText('The session ended.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument()
      expect(screen.queryByTestId('terminal')).toBeNull()
    })

    it('switches back to the conversation when the view changes', async () => {
      loaded([{ kind: 'user', text: 'Go' }])
      function Pick(): React.JSX.Element {
        const [, setView] = useSessionView()
        return <button onClick={() => setView('conversation')}>Pick</button>
      }
      render(
        <>
          <Live session={idle} />
          <Pick />
        </>
      )
      await act(async () => {})
      expect(screen.queryByRole('combobox', { name: 'Message' })).toBeNull()
      await userEvent.click(screen.getByRole('button', { name: 'Pick' }))
      expect(box()).toBeInTheDocument()
      expect(await screen.findByText('Go')).toBeInTheDocument()
    })
  })

  it('groups a run of tool calls', async () => {
    loaded([
      { kind: 'user', text: 'Go' },
      tool('Read', 'a.ts'),
      tool('Read', 'b.ts'),
      tool('Edit', 'c.ts'),
      tool('Bash', 'npm test'),
      { kind: 'assistant', text: 'Done' }
    ])
    show(idle)
    const group = await screen.findByRole('button', { name: /Ran 4 tools/ })
    expect(group).toHaveTextContent('Bash · npm test')
    expect(screen.queryByRole('button', { name: /a\.ts/ })).not.toBeInTheDocument()
    await userEvent.click(group)
    expect(group).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /a\.ts/ })).toBeInTheDocument()
    expect(screen.getByText('Panel')).toBeInTheDocument()
  })

  it('offers Copy on code in replies from Claude, not in yours', async () => {
    loaded([
      { kind: 'user', text: '```\nmine\n```' },
      { kind: 'assistant', text: '```\ntheirs\n```' }
    ])
    show(idle)
    expect(await screen.findAllByRole('button', { name: 'Copy code' })).toHaveLength(1)
  })

  it('links URLs in tool output', async () => {
    loaded([tool('Bash', 'gh pr create', 'Opened https://github.com/o/r/pull/1\n')])
    show(idle)
    await userEvent.click(await screen.findByRole('button', { name: /Ran 1 tool/ }))
    await userEvent.click(screen.getByRole('button', { name: /^Bash/ }))
    const link = screen.getByRole('link', { name: 'https://github.com/o/r/pull/1' })
    expect(link).toHaveAttribute('href', 'https://github.com/o/r/pull/1')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('shows a compact note', async () => {
    loaded([{ kind: 'compact', at: '2026-10-30T14:05:00', trigger: 'auto' }])
    show(idle)
    expect(await screen.findByText('Conversation compacted at 14:05')).toBeInTheDocument()
  })

  describe('automatic review rounds', () => {
    const round = (over: Partial<ReviewRound> = {}): ReviewRound => ({
      at: 2,
      round: 2,
      startedAt: '2026-10-31T14:02:00',
      files: 4,
      ...over
    })
    const live = (): Element | null =>
      document.querySelector('[aria-live="polite"][data-find-skip]')
    const rows = (): string[] =>
      within(screen.getByRole('list'))
        .getAllByRole('listitem')
        .map((li) => li.textContent ?? '')
    const three: ConversationEntry[] = [
      { kind: 'user', text: 'Go' },
      { kind: 'assistant', text: 'Done' },
      { kind: 'user', text: 'Again' }
    ]

    it('shows a running round before the entry it started at, with its round and time', async () => {
      loaded(three)
      show({ ...idle, reviewRounds: [round()] })
      await screen.findByText('Again')
      expect(rows()).toEqual([
        'YouGo',
        'ClaudeDone',
        'Automatic review · round 2 of 314:02Reviewing 4 changed files…',
        'YouAgain'
      ])
    })

    it('says 1 changed file', async () => {
      loaded(three)
      show({ ...idle, reviewRounds: [round({ files: 1 })] })
      expect(await screen.findByText('Reviewing 1 changed file…')).toBeInTheDocument()
    })

    it('puts a round inside a run of tool calls before the next row, and one at the end last', async () => {
      loaded([{ kind: 'user', text: 'Go' }, tool('Read', 'a.ts'), tool('Read', 'b.ts')])
      show({ ...idle, reviewRounds: [round({ at: 2, round: 1 }), round({ at: 9, round: 3 })] })
      await screen.findByText('Go')
      expect(rows().map((r) => r.slice(0, 31))).toEqual([
        'YouGo',
        'Ran 2 toolsRead · b.ts',
        'Automatic review · round 1 of 3',
        'Automatic review · round 3 of 3'
      ])
    })

    it('places rounds by the absolute entry index, leaving out one before the loaded start', async () => {
      vi.mocked(api.sessions.watchConversation).mockResolvedValue({
        from: 0,
        start: 5,
        entries: three,
        facts: { todos: [], permissionMode: null, compactions: [] }
      })
      show({ ...idle, reviewRounds: [round({ at: 4, round: 1 }), round({ at: 6, round: 2 })] })
      await screen.findByText('Again')
      expect(rows().map((r) => r.slice(0, 31))).toEqual([
        'YouGo',
        'Automatic review · round 2 of 3',
        'ClaudeDone',
        'YouAgain'
      ])
    })

    it('leaves out a round with no entry index', async () => {
      loaded(three)
      show({ ...idle, reviewRounds: [round({ at: undefined })] })
      await screen.findByText('Again')
      expect(rows()).toEqual(['YouGo', 'ClaudeDone', 'YouAgain'])
    })

    it.each([
      [{ sent: 1, waiting: 2 }, 'Sent 1 proposal to Claude. 2 wait for you.'],
      [{ sent: 2, waiting: 0 }, 'Sent 2 proposals to Claude. None wait for you.'],
      [{ sent: 0, waiting: 1 }, 'Sent nothing to Claude. 1 waits for you.'],
      [{ sent: 0, waiting: 0 }, 'Found nothing to fix.'],
      [{ found: 0, sent: 0, waiting: 0 }, 'Found nothing to fix.'],
      [{ found: 0, sent: 0, waiting: 2 }, 'Found nothing new. 2 wait for you.'],
      [{ found: 0, sent: 0, waiting: 1 }, 'Found nothing new. 1 waits for you.'],
      [{ found: 1, sent: 0, waiting: 3 }, 'Sent nothing to Claude. 3 wait for you.'],
      [{ error: 'The review failed: no diff.' }, 'The review failed: no diff.']
    ])('says how an ended round went: %o', async (outcome, text) => {
      loaded(three)
      show({ ...idle, reviewRounds: [round({ endedAt: '2026-10-31T14:04:00', ...outcome })] })
      await screen.findByText('Again')
      expect(within(screen.getByRole('list')).getByText(text)).toBeInTheDocument()
      expect(screen.queryByText(/Reviewing 4/)).toBeNull()
    })

    it('announces the newest stored round in one live region, even when its block is hidden', async () => {
      loaded(three)
      show({
        ...idle,
        reviewRounds: [
          round({ at: 2, round: 1, endedAt: '2026-10-31T13:31:00', sent: 1 }),
          round({ at: undefined, round: 2, startedAt: '2026-10-31T13:40:00' })
        ]
      })
      await screen.findByText('Again')
      expect(live()).toHaveTextContent('Automatic review round 2 of 3 started.')
    })

    it('announces how the round ended in the same live region', async () => {
      loaded(three)
      const { rerender } = show({ ...idle, reviewRounds: [round({ at: 3 })] })
      await screen.findByText('Again')
      const region = live()
      rerender(
        <Live
          session={{
            ...idle,
            reviewRounds: [round({ at: 3, endedAt: '2026-10-31T14:04:00', found: 0, waiting: 0 })]
          }}
        />
      )
      expect(live()).toBe(region)
      expect(region).toHaveTextContent('Found nothing to fix.')
    })

    it('offers Open Changes only when the view can open them', async () => {
      loaded(three)
      const onOpenChanges = vi.fn()
      const { unmount } = show({ ...idle, reviewRounds: [round()] })
      await screen.findByText('Again')
      expect(screen.queryByRole('button', { name: 'Open Changes' })).toBeNull()
      unmount()
      render(<Live session={{ ...idle, reviewRounds: [round()] }} onOpenChanges={onOpenChanges} />)
      await userEvent.click(await screen.findByRole('button', { name: 'Open Changes' }))
      expect(onOpenChanges).toHaveBeenCalledOnce()
    })

    it('keeps the round out of find and Your messages', async () => {
      loaded(three)
      show({ ...idle, reviewRounds: [round()] })
      await screen.findByText('Again')
      expect(
        screen.getByText('Reviewing 4 changed files…').closest('[data-find-skip]')
      ).not.toBeNull()
      await userEvent.click(screen.getByRole('button', { name: 'Your messages' }))
      expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Go', 'Again'])
    })
  })

  it('shows working with Stop', async () => {
    loaded([{ kind: 'user', text: 'Go' }])
    show({ ...idle, state: 'running' })
    expect(await screen.findByText(/Claude is working…/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(api.sessions.interrupt).toHaveBeenCalledWith('s1')
  })

  it('sends Stop once', async () => {
    vi.mocked(api.sessions.interrupt).mockReturnValue(new Promise(() => {}))
    show({ ...idle, state: 'running' })
    const stop = await screen.findByRole('button', { name: 'Stop' })
    await userEvent.dblClick(stop)
    await userEvent.click(stop)
    expect(api.sessions.interrupt).toHaveBeenCalledTimes(1)
  })

  it('sends on Enter, not Shift+Enter, and goes to the end', async () => {
    const scrolled = vi.spyOn(Element.prototype, 'scrollTo')
    show(idle)
    await userEvent.type(box(), 'one{Shift>}{Enter}{/Shift}two')
    expect(box()).toHaveValue('one\ntwo')
    expect(api.sessions.send).not.toHaveBeenCalled()
    await userEvent.type(box(), '{Enter}')
    expect(api.sessions.send).toHaveBeenCalledWith('s1', 'one\ntwo', [])
    expect(scrolled).toHaveBeenCalledWith({ top: 0, behavior: 'instant' })
    expect(box()).toHaveValue('')
  })

  const png = (name = 'image.png'): File => new File(['png'], name, { type: 'image/png' })
  const pngUrl = `data:image/png;base64,${btoa('png')}`
  const paste = (...files: File[]): boolean =>
    fireEvent.paste(box(), { clipboardData: { files, getData: () => '' } })

  it('sends a pasted image, with no text, and clears it', async () => {
    show(idle)
    paste(png())
    expect(await screen.findByText('image.png')).toBeInTheDocument()
    expect(screen.getByText('· 1 KB')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(api.sessions.send).toHaveBeenCalledWith('s1', '', [pngUrl])
    expect(screen.queryByText('image.png')).not.toBeInTheDocument()
  })

  it('keeps unsent text and images for this session only, until you send them', async () => {
    const first = show(idle)
    await userEvent.type(box(), 'Half a thought')
    paste(png())
    await screen.findByText('image.png')
    first.unmount()
    const other = show(session('T2', { id: 's2', state: 'idle' }))
    expect(box()).toHaveValue('')
    other.unmount()
    show(idle)
    expect(box()).toHaveValue('Half a thought')
    expect(screen.getByText('image.png')).toBeInTheDocument()
    expect(api.app.saveDraft).toHaveBeenCalledWith('session:s1', { text: 'Half a thought' })
    await userEvent.type(box(), '{Enter}')
    expect(api.app.saveDraft).toHaveBeenCalledWith('session:s1', { text: '' })
    expect(api.app.saveDraft).toHaveBeenLastCalledWith('session:s1', { images: [] })
  })

  it('shows the draft saved before a restart', async () => {
    vi.mocked(api.app.draft).mockResolvedValue({ text: 'From before', images: [] })
    show(idle)
    await vi.waitFor(() => expect(box()).toHaveValue('From before'))
    expect(api.app.draft).toHaveBeenCalledWith('session:s1')
  })

  it('adds a dropped image, and removes it', async () => {
    show(idle)
    fireEvent.drop(box().parentElement!, { dataTransfer: { files: [png('shot.png')] } })
    await userEvent.click(await screen.findByRole('button', { name: 'Remove image 1' }))
    expect(screen.queryByText('shot.png')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  })

  it('refuses a file it cannot send, naming the limit', async () => {
    show(idle)
    paste(new File(['%PDF'], 'trace.pdf', { type: 'application/pdf' }))
    expect(
      await screen.findByText(
        '"trace.pdf" wasn\'t attached. Sandtable sends PNG, JPEG, GIF, and WebP images.'
      )
    ).toBeInTheDocument()
    const big = png('big.png')
    Object.defineProperty(big, 'size', { value: 10 * 1024 * 1024 + 1 })
    paste(big)
    expect(
      await screen.findByText('"big.png" wasn\'t attached. Images over 10 MB can\'t be sent.')
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remove image/ })).not.toBeInTheDocument()
  })

  it('leaves a paste of text to the text box, even when it carries a picture too', () => {
    show(idle)
    expect(paste()).toBe(true)
    expect(
      fireEvent.paste(box(), { clipboardData: { files: [png()], getData: () => 'A1\tB1' } })
    ).toBe(true)
  })

  it('leaves a drag of text to the text box', () => {
    show(idle)
    expect(fireEvent.dragOver(box(), { dataTransfer: { types: ['text/plain'] } })).toBe(true)
    expect(screen.queryByText('Drop to attach')).not.toBeInTheDocument()
  })

  it("doesn't send until a pasted image is read", async () => {
    show(idle)
    fireEvent.change(box(), { target: { value: 'look' } })
    paste(png())
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(api.sessions.send).not.toHaveBeenCalled()
    await screen.findByText('image.png')
    fireEvent.keyDown(box(), { key: 'Enter' })
    await vi.waitFor(() => expect(api.sessions.send).toHaveBeenCalledWith('s1', 'look', [pngUrl]))
  })

  it('clears a refusal when you send', async () => {
    show(idle)
    paste(new File(['%PDF'], 'trace.pdf', { type: 'application/pdf' }))
    await screen.findByRole('alert')
    await userEvent.type(box(), 'hi{Enter}')
    await vi.waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('says an image was deleted when its file is gone', async () => {
    vi.mocked(api.sessions.image).mockImplementation(async (_id, path) => {
      if (path.endsWith('a.png')) throw new Error('ENOENT')
      return pngUrl
    })
    loaded([{ kind: 'user', text: '@"/data/images/s1/a.png" @"/data/images/s1/b.png"\n\nLook' }])
    show(idle)
    expect(await screen.findByText('Deleted')).toBeInTheDocument()
    expect(screen.queryByText(/ENOENT/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show image 2 larger' })).toBeEnabled()
  })

  it('shows a thumbnail of each image you sent, larger on click', async () => {
    loaded([{ kind: 'user', text: '@"/data/images/s1/a.png" @"/data/images/s1/b.png"\n\nLook' }])
    show(idle)
    expect(await screen.findByText('Look')).toBeInTheDocument()
    expect(screen.queryByText(/@"/)).not.toBeInTheDocument()
    const first = await screen.findByRole('button', { name: 'Show image 1 larger' })
    expect(screen.getByRole('button', { name: 'Show image 2 larger' })).toBeInTheDocument()
    expect(api.sessions.image).toHaveBeenCalledWith('s1', '/data/images/s1/a.png')
    await userEvent.click(first)
    expect(first).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('img', { name: 'Image 1' })).toBeInTheDocument()
  })

  const pushing = (): ((entries: ConversationEntry[]) => void) => {
    let push: Parameters<SandtableApi['sessions']['onConversation']>[0] = () => {}
    vi.mocked(api.sessions.onConversation).mockImplementation((cb) => {
      push = cb
      return () => {}
    })
    return (entries) =>
      act(() =>
        push('s1', {
          from: 0,
          entries,
          facts: { todos: [], permissionMode: null, compactions: [] }
        })
      )
  }
  const tray = (): HTMLElement | null =>
    screen.queryByRole('list', { name: 'Messages waiting for Claude' })
  const running = { ...idle, state: 'running' as const }

  it('shows a sent message at once as Queued while Claude works, until the conversation has it', async () => {
    const push = pushing()
    loaded([{ kind: 'user', text: 'Go' }])
    show(running)
    await screen.findByText('Go')
    await userEvent.type(box(), 'And tests{Enter}')
    expect(within(tray()!).getByText('Queued')).toBeInTheDocument()
    expect(within(tray()!).getByText('And tests')).toBeInTheDocument()
    expect(box()).toHaveValue('')
    push([
      { kind: 'user', text: 'Go' },
      { kind: 'user', text: 'And tests' }
    ])
    await vi.waitFor(() => expect(tray()).not.toBeInTheDocument())
    expect(screen.getAllByText('And tests')).toHaveLength(1)
  })

  it('says Sending while Claude is idle', async () => {
    vi.mocked(api.sessions.send).mockReturnValue(new Promise(() => {}))
    show(idle)
    await userEvent.type(box(), 'hello{Enter}')
    expect(within(tray()!).getByText('Sending')).toBeInTheDocument()
  })

  it('sends two messages in a row one at a time, and lands each once', async () => {
    const push = pushing()
    let typed: (text: string) => void = () => {}
    vi.mocked(api.sessions.send).mockReturnValueOnce(new Promise((r) => (typed = r)))
    loaded([])
    show(running)
    await userEvent.type(box(), 'Again{Enter}')
    await userEvent.type(box(), 'Again{Enter}')
    expect(within(tray()!).getAllByText('Again')).toHaveLength(2)
    expect(api.sessions.send).toHaveBeenCalledTimes(1)
    act(() => typed('Again'))
    await vi.waitFor(() => expect(api.sessions.send).toHaveBeenCalledTimes(2))
    push([{ kind: 'user', text: 'Again' }])
    await vi.waitFor(() => expect(within(tray()!).getAllByText('Again')).toHaveLength(1))
    push([
      { kind: 'user', text: 'Again' },
      { kind: 'user', text: 'Again' }
    ])
    await vi.waitFor(() => expect(tray()).not.toBeInTheDocument())
  })

  it('names a message of only images by its count', async () => {
    vi.mocked(api.sessions.send).mockReturnValue(new Promise(() => {}))
    show(idle)
    paste(png())
    await screen.findByText('image.png')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(within(tray()!).getByText('1 image')).toBeInTheDocument()
  })

  it('keeps a failed message with its error, to send again or remove', async () => {
    vi.mocked(api.sessions.send).mockRejectedValueOnce(new Error('Already sending'))
    show(idle)
    await userEvent.type(box(), 'hello{Enter}')
    expect(await within(tray()!).findByText('Already sending')).toBeInTheDocument()
    expect(within(tray()!).getByText('Not sent')).toBeInTheDocument()
    expect(within(tray()!).getByText('hello')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Send again' }))
    await vi.waitFor(() => expect(api.sessions.send).toHaveBeenCalledTimes(2))
    expect(api.sessions.send).toHaveBeenLastCalledWith('s1', 'hello', [])
    expect(within(tray()!).queryByText('Already sending')).not.toBeInTheDocument()
  })

  it('removes a failed message, back in the composer', async () => {
    vi.mocked(api.sessions.send).mockRejectedValueOnce(new Error('Already sending'))
    show(idle)
    await userEvent.type(box(), 'hello{Enter}')
    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    expect(tray()).not.toBeInTheDocument()
    expect(box()).toHaveFocus()
  })

  it('returns to the composer after Send again', async () => {
    vi.mocked(api.sessions.send).mockRejectedValueOnce(new Error('Already sending'))
    show(idle)
    await userEvent.type(box(), 'hello{Enter}')
    await userEvent.click(await screen.findByRole('button', { name: 'Send again' }))
    expect(box()).toHaveFocus()
  })

  it('lets a typed command leave the tray, since the conversation never shows it', async () => {
    show(idle)
    await userEvent.type(box(), '/model opus{Enter}')
    await vi.waitFor(() => expect(tray()).not.toBeInTheDocument())
  })

  it('empties the tray when the session stops being live', async () => {
    vi.mocked(api.sessions.send).mockReturnValue(new Promise(() => {}))
    const { rerender } = show(running)
    await userEvent.type(box(), 'hello{Enter}')
    expect(tray()).toBeInTheDocument()
    rerender(<Live session={{ ...idle, state: 'finished' }} />)
    expect(tray()).not.toBeInTheDocument()
  })

  it('clears a Stop error when you send', async () => {
    vi.mocked(api.sessions.interrupt).mockRejectedValueOnce(new Error('Already sending'))
    show(running)
    await userEvent.click(await screen.findByRole('button', { name: 'Stop' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Already sending')
    await userEvent.type(box(), 'hello{Enter}')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('disables the composer while asking', async () => {
    show(asking)
    expect(box()).toBeDisabled()
    await vi.waitFor(() =>
      expect(box()).toHaveAttribute('placeholder', 'Answer Claude in the terminal first')
    )
  })

  it("opens the drawer when Claude asks something the card can't show, and closes it after", async () => {
    const { rerender } = show(idle)
    expect(drawerOpen()).toBe(false)
    rerender(<Live session={asking} />)
    await vi.waitFor(() => expect(drawerOpen()).toBe(true))
    expect(box()).toHaveAttribute('placeholder', 'Answer Claude in the terminal first')
    expect(screen.getByText('Claude is asking you something')).toBeInTheDocument()
    rerender(<Live session={{ ...idle, state: 'running' }} />)
    expect(drawerOpen()).toBe(false)
  })

  it('Hide works while asking', async () => {
    show(asking)
    await vi.waitFor(() => expect(drawerOpen()).toBe(true))
    await userEvent.click(screen.getByRole('button', { name: 'Hide' }))
    expect(drawerOpen()).toBe(false)
    expect(toggle()).toHaveAttribute('aria-pressed', 'false')
    expect(box()).toBeDisabled()
  })

  it('answers a permission from the card, keeping the drawer shut until you open it', async () => {
    vi.mocked(api.sessions.prompt).mockResolvedValue({
      kind: 'permission',
      tool: 'Bash',
      summary: 'touch a.txt',
      input: '{}',
      choices: ['Yes', 'No']
    })
    show(asking)
    const card = await screen.findByRole('region', { name: 'Claude needs your permission' })
    expect(drawerOpen()).toBe(false)
    expect(box()).toHaveAttribute('placeholder', "Answer Claude's question to send a message")
    await userEvent.click(within(card).getByRole('button', { name: 'No' }))
    expect(api.sessions.answer).toHaveBeenCalledWith('s1', expect.anything(), {
      kind: 'choice',
      choice: 2,
      label: 'No'
    })
    expect(await within(card).findByRole('status')).toHaveTextContent('Sent')
    await userEvent.click(screen.getByRole('button', { name: 'Open in terminal' }))
    expect(drawerOpen()).toBe(true)
  })

  it('names the subagent that asks, and shows its next request after you answer', async () => {
    const request = (command: string): SessionPrompt => ({
      kind: 'permission',
      tool: 'Bash',
      summary: command,
      input: JSON.stringify({ command }),
      choices: ['Yes', 'No'],
      agent: 'general-purpose'
    })
    vi.mocked(api.sessions.prompt)
      .mockResolvedValueOnce(request('touch a'))
      .mockResolvedValue(request('touch b'))
    show(asking)
    const card = await screen.findByRole('region', { name: 'Claude needs your permission' })
    expect(card).toHaveTextContent('Bash · from the general-purpose agent')
    await userEvent.click(within(card).getByRole('button', { name: 'Yes' }))
    expect(await screen.findByText(/"touch b"/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Yes' })).toBeEnabled()
  })

  it('moves the focus from the disabled composer to the card, not to a choice', async () => {
    vi.mocked(api.sessions.prompt).mockResolvedValue({
      kind: 'plan',
      plan: '',
      choices: ['Yes', 'Tell Claude what to change']
    })
    const { rerender } = show(idle)
    expect(box()).toHaveFocus()
    rerender(<Live session={asking} />)
    expect(await screen.findByRole('region', { name: /approve a plan/ })).toHaveFocus()
  })

  it('answers questions step by step, with a note, Other, and a review', async () => {
    vi.mocked(api.sessions.prompt).mockResolvedValue({
      kind: 'questions',
      questions: [
        {
          question: 'Which color?',
          header: 'Color',
          multiSelect: false,
          options: [
            { label: 'Red', description: 'Warm.', preview: 'red box' },
            { label: 'Blue', description: 'Cool.', preview: 'blue box' }
          ]
        },
        {
          question: 'Which fruits?',
          header: 'Fruits',
          multiSelect: true,
          options: [
            { label: 'Apple', description: 'Crisp.' },
            { label: 'Pear', description: 'Soft.' }
          ]
        }
      ]
    })
    show(asking)
    const card = await screen.findByRole('region', { name: 'Claude is asking you something' })
    await userEvent.hover(within(card).getByRole('button', { name: /^Blue/ }))
    expect(within(card).getByLabelText('Preview of Blue')).toHaveTextContent('blue box')
    await userEvent.click(within(card).getByRole('button', { name: 'Add a note on Blue' }))
    await userEvent.type(
      within(card).getByRole('textbox', { name: 'Note on Blue' }),
      'darker{Enter}'
    )
    await userEvent.click(within(card).getByRole('checkbox', { name: /Pear/ }))
    await userEvent.click(within(card).getByRole('checkbox', { name: /Other/ }))
    await userEvent.type(within(card).getByRole('textbox', { name: 'Other answer' }), 'Mango')
    await userEvent.click(within(card).getByRole('button', { name: 'Next' }))
    expect(within(card).getByText('Blue (note: darker)')).toBeInTheDocument()
    expect(within(card).getByText('Pear, Mango')).toBeInTheDocument()
    await userEvent.click(within(card).getByRole('button', { name: 'Submit answers' }))
    expect(api.sessions.answer).toHaveBeenCalledWith('s1', expect.anything(), {
      kind: 'questions',
      answers: [
        { picked: [1], note: 'darker' },
        { picked: [1], other: 'Mango' }
      ]
    })
  })

  it('sends Chat about this for the whole set of questions', async () => {
    vi.mocked(api.sessions.prompt).mockResolvedValue({
      kind: 'questions',
      questions: [
        {
          question: 'Which season?',
          header: 'Season',
          multiSelect: false,
          options: [{ label: 'Spring', description: 'Mild.' }]
        }
      ]
    })
    show(asking)
    await userEvent.click(await screen.findByRole('button', { name: 'Chat about this' }))
    expect(api.sessions.answer).toHaveBeenCalledWith('s1', expect.anything(), { kind: 'chat' })
  })

  it('sends what to change in a plan', async () => {
    vi.mocked(api.sessions.prompt).mockResolvedValue({
      kind: 'plan',
      plan: '1. Add the file',
      choices: ['Yes, and use auto mode', 'Tell Claude what to change']
    })
    show(asking)
    const card = await screen.findByRole('region', { name: /approve a plan/ })
    expect(within(card).getByText('Add the file')).toBeInTheDocument()
    await userEvent.click(within(card).getByRole('button', { name: 'Tell Claude what to change' }))
    await userEvent.type(within(card).getByRole('textbox'), 'Shorter')
    await userEvent.click(within(card).getByRole('button', { name: 'Send changes' }))
    expect(api.sessions.answer).toHaveBeenCalledWith('s1', expect.anything(), {
      kind: 'choice',
      choice: 2,
      label: 'Tell Claude what to change',
      text: 'Shorter'
    })
  })

  it('stays open after asking ends when you opened it', async () => {
    const { rerender } = show(idle)
    await userEvent.click(toggle())
    expect(drawerOpen()).toBe(true)
    rerender(<Live session={asking} />)
    rerender(<Live session={idle} />)
    expect(drawerOpen()).toBe(true)
  })

  it("a finished session shows the owner's actions where the composer was, and no drawer", () => {
    render(<Live session={{ ...idle, state: 'finished' }} actions={<button>Resume</button>} />)
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByTestId('terminal')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument()
  })

  it('says so when the session has no conversation file', async () => {
    vi.mocked(api.sessions.watchConversation).mockResolvedValue({
      from: 0,
      entries: [],
      facts: { todos: [], permissionMode: null, compactions: [] },
      missing: true
    })
    show({ ...idle, state: 'finished' })
    expect(await screen.findByText('Conversation not found')).toBeInTheDocument()
  })

  it('shows the head while loading', () => {
    vi.mocked(api.sessions.watchConversation).mockReturnValue(new Promise(() => {}))
    render(<Live session={idle} head={<p>Toolbar</p>} />)
    expect(screen.getByText('Loading conversation')).toBeInTheDocument()
    expect(screen.getByText('Toolbar')).toBeInTheDocument()
  })

  it('shows an interrupt as a note, not your message', async () => {
    loaded([
      { kind: 'user', text: '[Request interrupted by user]' },
      { kind: 'user', text: '[Request interrupted by user for tool use]' }
    ])
    show(idle)
    expect(await screen.findAllByText('You stopped Claude.')).toHaveLength(2)
    expect(screen.queryByText(/Request interrupted/)).not.toBeInTheDocument()
  })

  it('leaves out the dot after a tool with no summary', async () => {
    loaded([tool('AskUserQuestion', '')])
    show(idle)
    const group = await screen.findByRole('button', { name: /Ran 1 tool/ })
    expect(group).toHaveTextContent(/AskUserQuestion$/)
  })

  it('keeps the working time out of the live region', async () => {
    vi.mocked(api.sessions.activity).mockResolvedValue({
      steps: [],
      since: new Date(Date.now() - 120_000).toISOString()
    })
    show({ ...idle, state: 'running' })
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Claude is working…')
    expect(await screen.findByText('2m')).toHaveAttribute('aria-hidden')
    expect(status).not.toHaveTextContent('2m')
    expect(screen.getByText(', for 2 minutes')).toHaveClass('sr-only')
  })

  it("shows Claude's latest step without announcing it", async () => {
    vi.mocked(api.sessions.activity).mockResolvedValue({
      steps: [
        { tool: 'Edit', target: 'src/a.ts', at: null },
        { tool: 'Read', target: 'src/b.ts', at: null }
      ],
      since: null
    })
    show({ ...idle, state: 'running' })
    expect(await screen.findByTitle('Editing src/a.ts')).toBeInTheDocument()
    expect(screen.queryByTitle('Reading src/b.ts')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/^Claude is working…$/)
  })

  it("leaves out the previous turn's last step", async () => {
    vi.mocked(api.sessions.activity).mockResolvedValue({
      steps: [{ tool: 'Bash', target: 'npm test', at: '2026-10-31T10:00:00.000Z' }],
      since: '2026-10-31T10:05:00.000Z'
    })
    show({ ...idle, state: 'running' })
    expect(await screen.findByRole('status')).toHaveTextContent('Claude is working…')
    expect(screen.getByRole('status')).not.toHaveClass('sr-only')
    expect(screen.queryByTitle('Running npm test')).not.toBeInTheDocument()
  })

  it('sends once on a double Enter', async () => {
    vi.mocked(api.sessions.send).mockReturnValue(new Promise(() => {}))
    show(idle)
    await userEvent.type(box(), 'hello{Enter}{Enter}')
    expect(api.sessions.send).toHaveBeenCalledTimes(1)
  })

  it('focuses Hide, not the terminal, when asking starts while you type', async () => {
    const { rerender } = show(idle)
    expect(box()).toHaveFocus()
    rerender(<Live session={asking} />)
    await vi.waitFor(() => expect(drawerOpen()).toBe(true))
    expect(terminalFocused()).toBe(false)
    expect(screen.getByRole('button', { name: 'Hide' })).toHaveFocus()
  })

  it('focuses the terminal when asking starts while you are elsewhere', async () => {
    const { rerender } = show(idle)
    box().blur()
    rerender(<Live session={asking} />)
    await vi.waitFor(() => expect(drawerOpen()).toBe(true))
    expect(terminalFocused()).toBe(true)
  })

  it('focuses the composer when it becomes active', () => {
    const { rerender } = render(<Live session={idle} active={false} />)
    expect(box()).not.toHaveFocus()
    rerender(<Live session={idle} active />)
    expect(box()).toHaveFocus()
  })

  const mine: ConversationEntry[] = [
    { kind: 'user', text: 'Fix the board scroll' },
    tool('Read', 'a.ts'),
    { kind: 'assistant', text: 'Fixed' },
    { kind: 'user', text: '[Request interrupted by user]' },
    { kind: 'user', text: 'Fix the drag flicker\nIt jumps.' },
    { kind: 'user', text: '@"/data/images/s1/a.png" @"/data/images/s1/b.png"' },
    { kind: 'user', text: 'Write the PR body' }
  ]
  const scrolled = (): Element =>
    vi.mocked(Element.prototype.scrollIntoView).mock.contexts.at(-1) as Element

  it('lists your messages and scrolls to the one you pick', async () => {
    vi.spyOn(Element.prototype, 'scrollIntoView')
    loaded(mine)
    show(idle)
    await userEvent.click(await screen.findByRole('button', { name: 'Your messages' }))
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Fix the board scroll',
      'Fix the drag flicker',
      '2 images',
      'Write the PR body'
    ])
    await userEvent.click(screen.getByRole('option', { name: 'Fix the board scroll' }))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(scrolled()).toHaveTextContent('Fix the board scroll')
    expect(scrolled().tagName).toBe('LI')
  })

  it('filters your messages and goes to the selected one on Enter', async () => {
    vi.spyOn(Element.prototype, 'scrollIntoView')
    loaded(mine)
    show(idle)
    await userEvent.click(await screen.findByRole('button', { name: 'Your messages' }))
    const filter = screen.getByRole('combobox', { name: 'Filter your messages' })
    await userEvent.type(filter, 'zzz')
    expect(screen.getByText('No message matches.')).toBeInTheDocument()
    await userEvent.clear(filter)
    await userEvent.type(filter, 'fix')
    expect(screen.getAllByRole('option')).toHaveLength(2)
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('option', { name: 'Fix the drag flicker' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await userEvent.keyboard('{Enter}')
    expect(scrolled()).toHaveTextContent('Fix the drag flicker')
  })

  it('has no Your messages button without your messages', async () => {
    loaded([{ kind: 'assistant', text: 'Hi' }])
    show(idle)
    expect(await screen.findByRole('button', { name: 'Find in conversation' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Your messages' })).not.toBeInTheDocument()
  })

  const found: ConversationEntry[] = [
    { kind: 'user', text: 'Look at the board' },
    tool('Read', 'a.ts', 'the board file'),
    { kind: 'assistant', text: 'The board scrolls' }
  ]
  const findBox = (): HTMLElement => screen.getByRole('textbox', { name: 'Find in conversation' })
  const counter = (): Element => screen.getByRole('search').querySelector('[aria-hidden]')!

  it('finds on Cmd+F, steps with Enter and Shift+Enter, and wraps', async () => {
    loaded(found)
    show(idle)
    await screen.findByText('Look at the board')
    await userEvent.keyboard('{Meta>}f{/Meta}')
    expect(findBox()).toHaveFocus()
    await userEvent.type(findBox(), 'BOARD')
    expect(counter()).toHaveTextContent(/^1 of 3$/)
    expect(screen.getByRole('status')).toHaveTextContent('1 of 3')
    await userEvent.keyboard('{Enter}')
    expect(counter()).toHaveTextContent(/^2 of 3$/)
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}')
    expect(counter()).toHaveTextContent(/^1 of 3$/)
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}')
    expect(counter()).toHaveTextContent(/^3 of 3$/)
    await userEvent.keyboard('{Enter}')
    expect(counter()).toHaveTextContent(/^1 of 3$/)
    await userEvent.clear(findBox())
    await userEvent.type(findBox(), 'zzz')
    expect(counter()).toHaveTextContent(/^No matches$/)
    expect(screen.getByRole('button', { name: 'Next match' })).toBeDisabled()
  })

  it('finds in code blocks and tables, not in their Copy bars', async () => {
    loaded([{ kind: 'assistant', text: '```\nboard one\n```\n\n| board |\n| - |\n| x |' }])
    show(idle)
    await userEvent.click(await screen.findByRole('button', { name: 'Find in conversation' }))
    await userEvent.type(findBox(), 'board')
    expect(counter()).toHaveTextContent(/^1 of 2$/)
    await userEvent.clear(findBox())
    await userEvent.type(findBox(), 'copy')
    expect(counter()).toHaveTextContent(/^No matches$/)
  })

  it('ignores Cmd+F while the conversation is not showing', async () => {
    loaded(found)
    render(<Live session={idle} active={false} />)
    await screen.findByText('Look at the board')
    await userEvent.keyboard('{Meta>}f{/Meta}')
    expect(screen.queryByRole('textbox', { name: 'Find in conversation' })).not.toBeInTheDocument()
  })

  it('opens the folded tool call that holds the match it steps to', async () => {
    loaded(found)
    show(idle)
    await userEvent.click(await screen.findByRole('button', { name: 'Find in conversation' }))
    await userEvent.type(findBox(), 'board')
    const group = screen.getByRole('button', { name: /Ran 1 tool/ })
    expect(group).toHaveAttribute('aria-expanded', 'false')
    await userEvent.keyboard('{Enter}')
    expect(counter()).toHaveTextContent(/^2 of 3$/)
    expect(group).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /^Read/ })).toHaveAttribute('aria-expanded', 'true')
  })

  it('closes the find bar on Esc and returns to the composer', async () => {
    loaded(found)
    show(idle)
    await screen.findByText('Look at the board')
    await userEvent.keyboard('{Meta>}f{/Meta}')
    expect(findBox()).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('textbox', { name: 'Find in conversation' })).not.toBeInTheDocument()
    expect(box()).toHaveFocus()
  })

  const facts = { todos: [], permissionMode: null, compactions: [] }
  const Fixed = ({ entries }: { entries: ConversationEntry[] }): React.JSX.Element => (
    <SessionConversation
      session={idle}
      conversation={{ entries, start: 0, facts, error: null, missing: false }}
      panel={null}
    />
  )
  const findWord = async (word: string): Promise<void> => {
    await userEvent.click(screen.getByRole('button', { name: 'Find in conversation' }))
    await userEvent.type(findBox(), word)
  }

  it('finds only conversation text, not its labels', async () => {
    render(
      <Fixed
        entries={[
          { kind: 'user', text: 'Thank you' },
          tool('Read', 'a.ts', null),
          { kind: 'user', text: '[Request interrupted by user]' },
          { kind: 'compact', at: '2026-10-30T14:05:00', trigger: 'auto' },
          { kind: 'assistant', text: 'Sure' }
        ]}
      />
    )
    await findWord('you')
    expect(counter()).toHaveTextContent(/^1 of 1$/)
    for (const word of ['claude', 'ran', 'compacted', 'input', 'output']) {
      await userEvent.clear(findBox())
      await userEvent.type(findBox(), word)
      expect(counter()).toHaveTextContent(/^No matches$/)
    }
    await userEvent.click(screen.getByRole('button', { name: /Ran 1 tool/ }))
    expect(screen.queryByText('Input')).not.toBeInTheDocument()
  })

  it('counts up to 1000 matches', async () => {
    render(<Fixed entries={[{ kind: 'assistant', text: 'a '.repeat(1200) }]} />)
    await findWord('a')
    expect(counter()).toHaveTextContent(/^1 of 1000\+$/)
  })

  it('keeps the current match when entries arrive', async () => {
    const { rerender } = render(<Fixed entries={found} />)
    await findWord('board')
    await userEvent.keyboard('{Enter}')
    expect(counter()).toHaveTextContent(/^2 of 3$/)
    rerender(<Fixed entries={[...found, { kind: 'assistant', text: 'One more board' }]} />)
    await vi.waitFor(() => expect(counter()).toHaveTextContent(/^2 of 4$/))
    expect(screen.getByRole('status')).toHaveTextContent('2 of 3')
  })

  it('starts at the first match when one arrives for a query with none', async () => {
    const { rerender } = render(<Fixed entries={found} />)
    await findWord('zzz')
    expect(counter()).toHaveTextContent(/^No matches$/)
    rerender(<Fixed entries={[...found, { kind: 'assistant', text: 'zzz' }]} />)
    await vi.waitFor(() => expect(counter()).toHaveTextContent(/^1 of 1$/))
  })

  it('paints the matches and the current one, and clears them on close', async () => {
    const registry = new Map<string, Set<Range>>()
    Object.defineProperty(CSS, 'highlights', { value: registry, configurable: true })
    vi.stubGlobal('Highlight', Set)
    try {
      render(<Fixed entries={found} />)
      await findWord('board')
      expect(registry.get('find')?.size).toBe(3)
      expect([...registry.get('find-current')!][0]!.toString().toLowerCase()).toBe('board')
      await userEvent.keyboard('{Escape}')
      expect(registry.size).toBe(0)
    } finally {
      Reflect.deleteProperty(CSS, 'highlights')
      vi.unstubAllGlobals()
    }
  })

  it('ignores Cmd+F while the conversation is hidden', async () => {
    vi.spyOn(Element.prototype, 'checkVisibility').mockReturnValue(false)
    render(<Fixed entries={found} />)
    await userEvent.keyboard('{Meta>}f{/Meta}')
    expect(screen.queryByRole('textbox', { name: 'Find in conversation' })).not.toBeInTheDocument()
  })

  it("doesn't step on Enter while composing", async () => {
    render(<Fixed entries={found} />)
    await findWord('board')
    fireEvent.keyDown(findBox(), { key: 'Enter', isComposing: true })
    expect(counter()).toHaveTextContent(/^1 of 3$/)
  })

  it('returns the focus to Find in conversation when there is no composer', async () => {
    render(
      <SessionConversation
        session={{ ...idle, state: 'finished' }}
        conversation={{ entries: found, start: 0, facts, error: null, missing: false }}
        panel={null}
      />
    )
    await findWord('board')
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'Find in conversation' })).toHaveFocus()
  })

  it('first selects the message you are on, and keeps it marked', async () => {
    render(<Fixed entries={mine} />)
    await userEvent.click(screen.getByRole('button', { name: 'Your messages' }))
    const last = screen.getByRole('option', { name: 'Write the PR body' })
    expect(last).toHaveAttribute('aria-current', 'true')
    expect(last).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{ArrowUp}')
    expect(last).toHaveAttribute('aria-selected', 'false')
    expect(last).toHaveAttribute('aria-current', 'true')
    const filter = screen.getByRole('combobox', { name: 'Filter your messages' })
    await userEvent.type(filter, 'zzz')
    expect(filter).toHaveAttribute('aria-expanded', 'false')
    expect(filter).not.toHaveAttribute('aria-controls')
    expect(screen.getByRole('status')).toHaveTextContent('No message matches.')
  })
})

describe('SessionConversation commands and suggestion', () => {
  const commands: SessionCommand[] = [
    {
      name: 'compact',
      description: 'Clear history but keep a summary',
      argumentHint: '<instructions>',
      source: 'Built into Claude Code',
      aliases: []
    },
    {
      name: 'init',
      description: 'Write a CLAUDE.md',
      argumentHint: '',
      source: 'Built into Claude Code',
      aliases: []
    },
    {
      name: 'context',
      description: 'Show context usage',
      argumentHint: '',
      source: 'Built into Claude Code',
      aliases: []
    },
    {
      name: 'code-review',
      description: 'Review the diff',
      argumentHint: '',
      source: 'Your command or skill',
      aliases: []
    },
    {
      name: 'deco',
      description: 'Decorate',
      argumentHint: '',
      source: "This repo's command or skill",
      aliases: []
    }
  ]
  const combo = (): HTMLElement => screen.getByRole('combobox', { name: 'Message' })
  const names = (): string[] =>
    within(screen.getByRole('listbox', { name: 'Commands' }))
      .getAllByRole('option')
      .map((o) => o.querySelector('span')?.textContent ?? '')

  beforeEach(() => {
    vi.mocked(api.sessions.commands).mockResolvedValue(commands)
    loaded([])
  })

  it('lists commands by name prefix, then by substring, and nothing else', async () => {
    show(idle)
    await userEvent.type(box(), '/co')
    await screen.findByRole('listbox', { name: 'Commands' })
    expect(names()).toEqual(['/compact', '/context', '/code-review', '/deco'])
    expect(combo()).toHaveAttribute('aria-expanded', 'true')
    expect(combo()).toHaveAttribute('aria-autocomplete', 'list')
    await userEvent.type(combo(), 'n')
    expect(names()).toEqual(['/context'])
    expect(api.sessions.commands).toHaveBeenCalledTimes(1)
    expect(api.sessions.commands).toHaveBeenCalledWith('s1')
  })

  it('lists an exact name or alias first, then prefix matches, then substrings', async () => {
    const cmd = (name: string, aliases: string[] = []): SessionCommand => ({
      ...commands[1],
      name,
      aliases
    })
    vi.mocked(api.sessions.commands).mockResolvedValue([
      cmd('debugging-x'),
      cmd('my-debug'),
      cmd('debug'),
      cmd('usage-report'),
      cmd('stats-x'),
      cmd('usage', ['cost', 'stats'])
    ])
    show(idle)
    await userEvent.type(box(), '/debug')
    await screen.findByRole('listbox', { name: 'Commands' })
    expect(names()).toEqual(['/debug', '/debugging-x', '/my-debug'])
    await userEvent.keyboard('{Enter}')
    expect(box()).toHaveValue('/debug')
    await userEvent.clear(box())
    await userEvent.type(box(), '/stats')
    expect(names()).toEqual(['/usage', '/stats-x'])
    await userEvent.clear(box())
    await userEvent.type(box(), '/co')
    expect(names()).toEqual(['/usage'])
  })

  it("names the active command's aliases in the detail", async () => {
    vi.mocked(api.sessions.commands).mockResolvedValue([
      { ...commands[1], name: 'usage', aliases: ['cost', 'stats'] }
    ])
    show(idle)
    await userEvent.type(box(), '/us')
    expect(await screen.findByText('Also /cost, /stats')).toBeInTheDocument()
  })

  it('leaves Shift+Tab to move the focus, with the palette open', async () => {
    show(idle)
    await userEvent.type(box(), '/comp')
    await screen.findByRole('option', { name: /compact/ })
    expect(fireEvent.keyDown(box(), { key: 'Tab', shiftKey: true })).toBe(true)
    expect(box()).toHaveValue('/comp')
  })

  it('does not load commands before the first slash, and stays a collapsed combobox', async () => {
    show(idle)
    expect(box()).toHaveAttribute('aria-expanded', 'false')
    await userEvent.type(box(), 'hello /co')
    expect(api.sessions.commands).not.toHaveBeenCalled()
    expect(box()).toHaveAttribute('aria-expanded', 'false')
  })

  it('fills the command on Down then Enter, without sending', async () => {
    show(idle)
    await userEvent.type(box(), '/co')
    await screen.findByRole('option', { name: /compact/ })
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(box()).toHaveValue('/context')
    expect(api.sessions.send).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('fills with a trailing space on Tab when the command takes an argument', async () => {
    show(idle)
    await userEvent.type(box(), '/comp')
    await screen.findByRole('option', { name: /compact/ })
    await userEvent.keyboard('{Tab}')
    expect(box()).toHaveValue('/compact ')
    expect(box()).toHaveFocus()
  })

  it('marks the active option, wrapping with Up and Down', async () => {
    show(idle)
    await userEvent.type(box(), '/co')
    const first = await screen.findByRole('option', { name: /compact/ })
    expect(first).toHaveAttribute('aria-selected', 'true')
    expect(combo()).toHaveAttribute('aria-activedescendant', first.id)
    expect(combo().getAttribute('aria-controls')).toBe(
      screen.getByRole('listbox', { name: 'Commands' }).id
    )
    await userEvent.keyboard('{ArrowUp}')
    const last = screen.getByRole('option', { name: /deco/ })
    expect(last).toHaveAttribute('aria-selected', 'true')
    expect(first).toHaveAttribute('aria-selected', 'false')
    expect(combo()).toHaveAttribute('aria-activedescendant', last.id)
    await userEvent.keyboard('{ArrowDown}')
    expect(combo()).toHaveAttribute('aria-activedescendant', first.id)
  })

  it("shows the active command's full hint, description, and source", async () => {
    show(idle)
    await userEvent.type(box(), '/comp')
    const detail = await screen.findByText('Clear history but keep a summary')
    expect(detail.parentElement).toHaveTextContent('/compact <instructions>')
    expect(detail.parentElement).toHaveTextContent('Built into Claude Code')
  })

  it('closes on Escape without passing it on, and opens again once the text changes', async () => {
    const outside = vi.fn()
    render(
      <div onKeyDown={(e) => e.key === 'Escape' && outside()}>
        <Live session={idle} />
      </div>
    )
    await userEvent.type(box(), '/co')
    await screen.findByRole('listbox', { name: 'Commands' })
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(outside).not.toHaveBeenCalled()
    expect(box()).toHaveAttribute('aria-expanded', 'false')
    await userEvent.type(box(), 'n')
    expect(names()).toEqual(['/context'])
  })

  it('highlights on hover and fills on a click', async () => {
    show(idle)
    await userEvent.type(box(), '/co')
    const review = await screen.findByRole('option', { name: /code-review/ })
    await userEvent.hover(review)
    expect(review).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(review)
    expect(box()).toHaveValue('/code-review')
    expect(box()).toHaveFocus()
  })

  it('says while loading and when loading fails as a status, collapsed with no options', async () => {
    let fail: (e: Error) => void = () => {}
    vi.mocked(api.sessions.commands).mockReturnValue(new Promise((_, no) => (fail = no)))
    show(idle)
    await userEvent.type(box(), '/')
    expect(screen.getByRole('status')).toHaveTextContent('Loading commands…')
    expect(box()).toHaveAttribute('aria-expanded', 'false')
    await act(async () => fail(new Error("Claude Code didn't list its commands")))
    expect(screen.getByRole('status')).toHaveTextContent("Claude Code didn't list its commands")
    expect(box()).toHaveAttribute('aria-expanded', 'false')
  })

  it('loads the commands again when you type / after a failed load', async () => {
    vi.mocked(api.sessions.commands).mockRejectedValueOnce(new Error('No list'))
    show(idle)
    await userEvent.type(box(), '/')
    expect(await screen.findByText('No list')).toBeInTheDocument()
    await userEvent.type(box(), '{Backspace}/')
    expect(await screen.findByRole('option', { name: /compact/ })).toBeInTheDocument()
    expect(api.sessions.commands).toHaveBeenCalledTimes(2)
  })

  it('says no command matches as a status', async () => {
    show(idle)
    await userEvent.type(box(), '/xyz')
    expect(await screen.findByRole('status')).toHaveTextContent('No command matches /xyz')
    expect(box()).toHaveAttribute('aria-expanded', 'false')
  })

  it('names each option with its full hint and description', async () => {
    const hint = '<path to the file you want reviewed>'
    vi.mocked(api.sessions.commands).mockResolvedValue([
      { ...commands[0], name: 'review', argumentHint: hint, description: 'Review a file' }
    ])
    show(idle)
    await userEvent.type(box(), '/rev')
    const option = await screen.findByRole('option', { selected: true })
    expect(option).toHaveAccessibleName(`/review ${hint}, Review a file`)
  })

  it('does not fill while composing with an input method', async () => {
    show(idle)
    await userEvent.type(box(), '/co')
    await screen.findByRole('option', { name: /compact/ })
    fireEvent.keyDown(box(), { key: 'Enter', isComposing: true })
    fireEvent.keyDown(box(), { key: 'Tab', isComposing: true })
    expect(box()).toHaveValue('/co')
    expect(api.sessions.send).not.toHaveBeenCalled()
  })

  it('closes the palette while Claude asks', async () => {
    const { rerender } = show(idle)
    await userEvent.type(box(), '/co')
    await screen.findByRole('listbox', { name: 'Commands' })
    rerender(<Live session={asking} />)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(box()).toHaveAttribute('aria-expanded', 'false')
  })

  it('leaves Tab alone when there is nothing to fill', async () => {
    show(idle)
    await act(async () => {})
    expect(fireEvent.keyDown(box(), { key: 'Tab' })).toBe(true)
    await userEvent.type(box(), '/xyz')
    await screen.findByText('No command matches /xyz')
    expect(fireEvent.keyDown(box(), { key: 'Tab' })).toBe(true)
  })

  it('shows the suggestion as the placeholder and fills it on Tab', async () => {
    vi.mocked(api.sessions.suggestion).mockResolvedValue('run the tests')
    show(idle)
    await vi.waitFor(() => expect(box()).toHaveAttribute('placeholder', 'run the tests'))
    expect(screen.getByText('Suggested · Tab')).toHaveAttribute('aria-hidden', 'true')
    expect(box()).toHaveAccessibleDescription('Suggestion: run the tests. Press Tab to use it.')
    expect(api.sessions.suggestion).toHaveBeenCalledWith('s1')
    box().focus()
    await userEvent.keyboard('{Tab}')
    expect(box()).toHaveValue('run the tests')
    expect(box()).toHaveFocus()
    expect(screen.queryByText('Suggested · Tab')).not.toBeInTheDocument()
    await userEvent.clear(box())
    expect(box()).toHaveAttribute('placeholder', 'run the tests')
  })

  it('leaves Shift+Tab to move the focus, with a suggestion shown', async () => {
    vi.mocked(api.sessions.suggestion).mockResolvedValue('run the tests')
    show(idle)
    await vi.waitFor(() => expect(box()).toHaveAttribute('placeholder', 'run the tests'))
    expect(fireEvent.keyDown(box(), { key: 'Tab', shiftKey: true })).toBe(true)
    expect(box()).toHaveValue('')
  })

  it('fills the suggestion on Right', async () => {
    vi.mocked(api.sessions.suggestion).mockResolvedValue('commit this')
    show(idle)
    await vi.waitFor(() => expect(box()).toHaveAttribute('placeholder', 'commit this'))
    box().focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(box()).toHaveValue('commit this')
  })

  it('shows no suggestion while Claude works', async () => {
    vi.mocked(api.sessions.suggestion).mockResolvedValue('run the tests')
    const { rerender } = show(idle)
    await vi.waitFor(() => expect(box()).toHaveAttribute('placeholder', 'run the tests'))
    rerender(<Live session={{ ...idle, state: 'running' }} />)
    expect(box()).toHaveAttribute('placeholder', 'Message Claude')
    expect(screen.queryByText('Suggested · Tab')).not.toBeInTheDocument()
  })

  it('does not ask for a suggestion while Claude works or asks', async () => {
    const { rerender } = show({ ...idle, state: 'running' })
    await screen.findByText(/Claude is working…/)
    rerender(<Live session={asking} />)
    await act(async () => {})
    expect(api.sessions.suggestion).not.toHaveBeenCalled()
  })

  it('announces a suggestion that arrives while you are in the field', async () => {
    let suggest: (text: string) => void = () => {}
    vi.mocked(api.sessions.suggestion).mockReturnValue(new Promise((yes) => (suggest = yes)))
    show(idle)
    box().focus()
    const regions = [...document.querySelectorAll('[aria-live=polite]')]
    await act(async () => suggest('run the tests'))
    expect(regions.map((r) => r.textContent)).toContain(
      'Suggestion: run the tests. Press Tab to use it.'
    )
  })

  it('drops the suggestion you sent', async () => {
    vi.mocked(api.sessions.suggestion)
      .mockResolvedValueOnce('run the tests')
      .mockReturnValue(new Promise(() => {}))
    show(idle)
    await vi.waitFor(() => expect(box()).toHaveAttribute('placeholder', 'run the tests'))
    box().focus()
    await userEvent.keyboard('{Tab}{Enter}')
    expect(api.sessions.send).toHaveBeenCalledWith('s1', 'run the tests', [])
    expect(box()).toHaveAttribute('placeholder', 'Message Claude')
  })

  describe('polling', () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }))
    afterEach(() => vi.useRealTimers())

    it('reads the suggestion every 3 s until the field has text', async () => {
      vi.mocked(api.sessions.suggestion).mockResolvedValue(null)
      show(idle)
      await act(async () => {})
      expect(api.sessions.suggestion).toHaveBeenCalledTimes(1)
      await act(async () => vi.advanceTimersByTime(3000))
      expect(api.sessions.suggestion).toHaveBeenCalledTimes(2)
      fireEvent.change(box(), { target: { value: 'hi' } })
      await act(async () => vi.advanceTimersByTime(9000))
      expect(api.sessions.suggestion).toHaveBeenCalledTimes(2)
    })

    it('does not read the suggestion while a message is still being typed', async () => {
      vi.mocked(api.sessions.suggestion).mockResolvedValue(null)
      let typed: (text: string) => void = () => {}
      vi.mocked(api.sessions.send).mockReturnValue(new Promise((yes) => (typed = yes)))
      show(idle)
      await act(async () => {})
      fireEvent.change(box(), { target: { value: 'hi' } })
      fireEvent.keyDown(box(), { key: 'Enter' })
      await act(async () => vi.advanceTimersByTime(9000))
      expect(api.sessions.send).toHaveBeenCalledWith('s1', 'hi', [])
      expect(api.sessions.suggestion).toHaveBeenCalledTimes(1)
      await act(async () => typed('hi'))
      expect(api.sessions.suggestion).toHaveBeenCalledTimes(2)
    })

    it('hides the suggestion when reading it fails', async () => {
      vi.mocked(api.sessions.suggestion)
        .mockResolvedValueOnce('run the tests')
        .mockRejectedValue(new Error('gone'))
      show(idle)
      expect(await screen.findByText('Suggested · Tab')).toBeInTheDocument()
      await act(async () => vi.advanceTimersByTime(3000))
      expect(screen.queryByText('Suggested · Tab')).not.toBeInTheDocument()
      expect(box()).toHaveAttribute('placeholder', 'Message Claude')
    })
  })

  it("shows a command's output in a card, and no output box when it printed nothing", async () => {
    loaded([
      { kind: 'command', name: '/context', args: '', output: 'Context Usage\n36.7k tokens' },
      { kind: 'command', name: '/rename', args: 'menu', output: '' }
    ])
    show(idle)
    const out = await screen.findByText(/36\.7k tokens/)
    expect(out.tagName).toBe('PRE')
    expect(out.closest('li')).toHaveTextContent('/contextCommand output')
    const rename = screen.getByText('/rename menu').closest('li')!
    expect(rename.querySelector('pre')).toBeNull()
  })
})

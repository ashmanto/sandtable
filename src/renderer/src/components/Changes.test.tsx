import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SandtableApi } from '../../../shared/api'
import type {
  FileDiff,
  Finding,
  FindingsState,
  PullRequestState,
  RepoChanges
} from '../../../shared/types'
import { fakeSandtable, session } from '../test/fixtures'
import { shortTime } from '../../../shared/time'
import { Changes } from './Changes'

let api: SandtableApi

const modified: FileDiff = {
  path: 'src/app.ts',
  change: 'modified',
  added: 1,
  removed: 1,
  hunks: [
    {
      header: '@@ -1,2 +1,2 @@',
      lines: [
        { kind: 'context', text: 'keep', old: 1, new: 1 },
        { kind: 'removed', text: 'old line', old: 2 },
        { kind: 'added', text: 'new line', new: 2 }
      ]
    }
  ]
}
const binary: FileDiff = {
  path: 'logo.png',
  change: 'added',
  added: 0,
  removed: 0,
  binary: true,
  hunks: []
}
const repo = (worktree: string, files: FileDiff[]): RepoChanges => ({
  worktree,
  base: 'origin/main',
  files
})

beforeEach(() => {
  api = fakeSandtable()
})

describe('Changes', () => {
  it('reports the file count while hidden, reads findings once active, and lists each file', async () => {
    vi.mocked(api.sessions.changes).mockResolvedValue([
      repo('/r/app-wt.noindex/b', [modified, binary])
    ])
    const s = session('T1')
    const onCount = vi.fn()
    const { rerender } = render(<Changes session={s} active={false} onCount={onCount} />)
    await vi.waitFor(() => expect(onCount).toHaveBeenLastCalledWith(2))
    expect(api.sessions.findings).not.toHaveBeenCalled()
    rerender(<Changes session={s} active onCount={onCount} />)

    const files = await screen.findByRole('list', { name: 'Changed files' })
    expect(
      within(files)
        .getAllByRole('button')
        .map((b) => b.textContent)
    ).toEqual(['app.ts+1 −1srcModified', 'logo.pngBinaryAdded'])
    expect(screen.getByText('2 files changed')).toBeInTheDocument()
    expect(api.sessions.changes).toHaveBeenCalledWith(s.id)
  })

  it('shows the first file, marks added and removed lines with words, and switches files', async () => {
    vi.mocked(api.sessions.changes).mockResolvedValue([
      repo('/r/app-wt.noindex/b', [modified, binary])
    ])
    render(<Changes session={session('T1')} active />)

    const diff = await screen.findByRole('table')
    expect(within(diff).getByText('old line').closest('tr')?.textContent).toContain('Removed')
    expect(within(diff).getByText('new line').closest('tr')?.textContent).toContain('Added')

    await userEvent.click(screen.getByRole('button', { name: /logo\.png/ }))
    expect(screen.getByText('Binary file, not shown.')).toBeInTheDocument()
    await userEvent.keyboard('{ArrowUp}')
    expect(screen.getByRole('table')).toBeInTheDocument()
  })

  it('heads each repo when the session has more than one', async () => {
    vi.mocked(api.sessions.changes).mockResolvedValue([
      repo('/r/app-wt.noindex/b', [modified]),
      repo('/r/docs-wt.noindex/b', [])
    ])
    render(
      <Changes
        session={session('T1', { worktrees: ['/r/app-wt.noindex/b', '/r/docs-wt.noindex/b'] })}
        active
      />
    )
    expect(await screen.findByRole('heading', { name: 'app' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'docs' })).toBeInTheDocument()
    expect(screen.getByText('No changes in this repo')).toBeInTheDocument()
  })

  it('says a clean worktree has no changes, beside the findings rail', async () => {
    vi.mocked(api.sessions.changes).mockResolvedValue([repo('/r/app-wt.noindex/b', [])])
    render(<Changes session={session('T1')} active />)
    expect(await screen.findByText('No changes')).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Findings' })).toBeInTheDocument()
    expect(
      screen.getByText('Nothing changed since the branch left origin/main.')
    ).toBeInTheDocument()
  })

  it("shows a repo's error under its heading and the other repo's files", async () => {
    vi.mocked(api.sessions.changes).mockResolvedValue([
      repo('/r/app-wt.noindex/b', [modified]),
      { worktree: '/r/docs-wt.noindex/b', base: '', files: [], error: 'no origin/HEAD' }
    ])
    render(
      <Changes
        session={session('T1', { worktrees: ['/r/app-wt.noindex/b', '/r/docs-wt.noindex/b'] })}
        active
      />
    )
    expect(await screen.findByText("Couldn't read the changes: no origin/HEAD")).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
  })

  it('shows the error with Retry when no repo could be read', async () => {
    vi.mocked(api.sessions.changes).mockResolvedValueOnce([
      { worktree: '/r/app-wt.noindex/b', base: '', files: [], error: 'no origin/HEAD' }
    ])
    render(<Changes session={session('T1')} active />)
    expect(await screen.findByText("Couldn't read the changes: no origin/HEAD")).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Findings' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('No changes')).toBeInTheDocument()
  })

  it('lists a type change as two rows you can move between', async () => {
    const link = { ...modified, path: 'link', change: 'deleted' as const }
    vi.mocked(api.sessions.changes).mockResolvedValue([
      repo('/r/app-wt.noindex/b', [link, { ...link, change: 'added' }])
    ])
    render(<Changes session={session('T1')} active />)
    await userEvent.click(await screen.findByRole('button', { name: /Deleted/ }))
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('button', { name: /Added/ })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: /Deleted/ })).not.toHaveAttribute('aria-current')
  })

  it('lets the file list and rail shrink so Send stays reachable in a narrow window', async () => {
    vi.mocked(api.sessions.changes).mockResolvedValue([repo('/r/app-wt.noindex/b', [modified])])
    render(<Changes session={session('T1')} active />)
    const files = await screen.findByRole('list', { name: 'Changed files' })
    expect(files.closest('aside')).toHaveClass('basis-75', 'shrink', 'min-w-48')
    expect(screen.getByRole('complementary', { name: 'Findings' })).toHaveClass(
      'basis-85',
      'shrink',
      'min-w-64'
    )
    expect(screen.getByRole('region', { name: 'src/app.ts' })).toHaveClass('min-w-60')
  })

  it('marks text-direction overrides so they show', async () => {
    const tricky: FileDiff = {
      ...modified,
      hunks: [{ header: '@@', lines: [{ kind: 'added', text: 'a\u202eb', new: 1 }] }]
    }
    vi.mocked(api.sessions.changes).mockResolvedValue([repo('/r/app-wt.noindex/b', [tricky])])
    render(<Changes session={session('T1')} active />)
    expect(await screen.findByText('a<U+202E>b')).toBeInTheDocument()
  })

  it('says the worktree was removed without reading it', () => {
    render(<Changes session={session('T1', { removedAt: '2026-10-25T00:00:00Z' })} active />)
    expect(screen.getByText('Worktree removed')).toBeInTheDocument()
    expect(api.sessions.changes).not.toHaveBeenCalled()
  })

  it('shows the error with Retry', async () => {
    vi.mocked(api.sessions.changes).mockRejectedValueOnce(new Error('git failed'))
    render(<Changes session={session('T1')} active />)
    expect(await screen.findByText("Couldn't read the changes: git failed")).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('No changes')).toBeInTheDocument()
  })

  it('reads again on Refresh and when the session stops running', async () => {
    const s = session('T1', { state: 'running' })
    const { rerender } = render(<Changes session={s} active />)
    await screen.findByText('No changes')
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(api.sessions.changes).toHaveBeenCalledTimes(2)
    rerender(<Changes session={{ ...s, state: 'needsYou' }} active />)
    await vi.waitFor(() => expect(api.sessions.changes).toHaveBeenCalledTimes(3))
    rerender(<Changes session={{ ...s, state: 'idle' }} active />)
    await screen.findByText('No changes')
    expect(api.sessions.changes).toHaveBeenCalledTimes(3)
  })

  it.each(['limitReached', 'apiError'] as const)(
    'reads again when a turn ends at %s',
    async (state) => {
      const s = session('T1', { state: 'running' })
      const { rerender } = render(<Changes session={s} active />)
      await screen.findByText('No changes')
      rerender(<Changes session={{ ...s, state }} active />)
      await vi.waitFor(() => expect(api.sessions.changes).toHaveBeenCalledTimes(2))
    }
  )

  it('reads again when an automatic review round starts after Claude stops', async () => {
    const s = session('T1', { state: 'running' })
    const { rerender } = render(<Changes session={s} active />)
    await screen.findByText('No changes')
    rerender(<Changes session={{ ...s, state: 'reviewing' }} active />)
    await vi.waitFor(() => expect(api.sessions.changes).toHaveBeenCalledTimes(2))
  })
})

const wt = '/r/app-wt.noindex/b'
const other: FileDiff = { ...modified, path: 'src/other.ts' }
const finding = (over: Partial<Finding>): Finding => ({
  id: 'f1',
  sessionId: 's-T1',
  source: 'you',
  text: 'Rename this',
  worktree: wt,
  path: 'src/app.ts',
  start: 2,
  end: 2,
  anchor: 'new line',
  checked: true,
  ...over
})
const withFindings = (findings: Finding[], over: Partial<FindingsState> = {}): void => {
  vi.mocked(api.sessions.findings).mockResolvedValue({ findings, reviewing: false, ...over })
}
const rail = (): HTMLElement => screen.getByRole('complementary', { name: 'Findings' })
const railShown = (): Promise<HTMLElement> =>
  screen.findByRole('complementary', { name: 'Findings' })
const send = (): HTMLElement => within(rail()).getByRole('button', { name: 'Send to session' })
const findingsList = (): HTMLElement => within(rail()).getAllByRole('list').at(-1)!

describe('Changes comments', () => {
  beforeEach(() => {
    vi.mocked(api.sessions.changes).mockResolvedValue([repo(wt, [modified, other])])
  })

  it('offers a comment only on lines with a new-side number', async () => {
    render(<Changes session={session('T1')} active />)
    await screen.findByRole('table')
    expect(
      screen.getAllByRole('button', { name: /^Comment on line/ }).map((b) => b.ariaLabel)
    ).toEqual(['Comment on line 1', 'Comment on line 2'])
  })

  it('adds a comment on a Shift-clicked range with Command-Enter', async () => {
    vi.mocked(api.sessions.addFinding).mockResolvedValue(finding({}))
    const user = userEvent.setup()
    render(<Changes session={session('T1')} active />)
    await user.click(await screen.findByRole('button', { name: 'Comment on line 1' }))
    await user.keyboard('{Shift>}')
    await user.click(screen.getByRole('button', { name: 'Comment on line 2' }))
    await user.keyboard('{/Shift}')
    expect(screen.getByText('Comment on app.ts, lines 1–2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add comment' })).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: 'Comment' }), 'Fix it')
    await user.keyboard('{Meta>}{Enter}{/Meta}')
    expect(api.sessions.addFinding).toHaveBeenCalledWith('s-T1', {
      source: 'you',
      worktree: wt,
      path: 'src/app.ts',
      start: 1,
      end: 2,
      anchor: 'keep',
      text: 'Fix it'
    })
    await vi.waitFor(() => expect(screen.queryByRole('textbox', { name: 'Comment' })).toBeNull())
  })

  it('closes the composer after an add even when the diff reloaded meanwhile', async () => {
    let added = (): void => {}
    vi.mocked(api.sessions.addFinding).mockReturnValue(
      new Promise((r) => (added = () => r(finding({}))))
    )
    render(<Changes session={session('T1')} active />)
    await userEvent.click(await screen.findByRole('button', { name: 'Comment on line 2' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Comment' }), 'Fix it')
    await userEvent.click(screen.getByRole('button', { name: 'Add comment' }))
    const shifted: FileDiff = {
      ...modified,
      hunks: [
        {
          header: '@@ -1,2 +1,3 @@',
          lines: [
            { kind: 'added', text: 'top', new: 1 },
            ...modified.hunks[0].lines.map((l) => ({ ...l, new: l.new && l.new + 1 }))
          ]
        }
      ]
    }
    vi.mocked(api.sessions.changes).mockResolvedValue([repo(wt, [shifted, other])])
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByText('Comment on app.ts, line 3')).toBeInTheDocument()
    await act(async () => added())
    expect(screen.queryByRole('textbox', { name: 'Comment' })).toBeNull()
  })

  it('keeps a selection made while the comment was being added', async () => {
    let added = (): void => {}
    vi.mocked(api.sessions.addFinding).mockReturnValue(
      new Promise((r) => (added = () => r(finding({}))))
    )
    render(<Changes session={session('T1')} active />)
    await userEvent.click(await screen.findByRole('button', { name: 'Comment on line 2' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Comment' }), 'Fix it')
    await userEvent.click(screen.getByRole('button', { name: 'Add comment' }))
    await userEvent.click(screen.getByRole('button', { name: 'Comment on line 1' }))
    await act(async () => added())
    expect(screen.getByText('Comment on app.ts, line 1')).toBeInTheDocument()
  })

  it("cancels a comment with Escape or Cancel and returns focus to the range's first +", async () => {
    render(<Changes session={session('T1')} active />)
    await userEvent.click(await screen.findByRole('button', { name: 'Comment on line 2' }))
    expect(screen.getByText('Comment on app.ts, line 2')).toBeInTheDocument()
    await userEvent.keyboard('Oops{Escape}')
    expect(screen.queryByRole('textbox', { name: 'Comment' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Comment on line 2' })).toHaveFocus()
    await userEvent.click(screen.getByRole('button', { name: 'Comment on line 1' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Comment on line 1' })).toHaveFocus()
    expect(api.sessions.addFinding).not.toHaveBeenCalled()
  })

  it('makes one + a tab stop and moves between them with Up and Down', async () => {
    render(<Changes session={session('T1')} active />)
    const [one, two] = await screen.findAllByRole('button', { name: /^Comment on line/ })
    expect([one.tabIndex, two.tabIndex]).toEqual([0, -1])
    expect(one).toHaveAttribute('title', 'Shift-click or Shift+Enter to select a range')
    one.focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(two).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}')
    expect(one).toHaveFocus()
    await userEvent.click(two)
    expect([one.tabIndex, two.tabIndex]).toEqual([-1, 0])
    expect(two).toHaveAttribute('aria-pressed', 'true')
    expect(one).toHaveAttribute('aria-pressed', 'false')
  })

  it('keeps a selection on its line when the diff reloads, and drops it when the line goes', async () => {
    const s = session('T1', { state: 'running' })
    const { rerender } = render(<Changes session={s} active />)
    await userEvent.click(await screen.findByRole('button', { name: 'Comment on line 2' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Comment' }), 'Draft')
    const shifted: FileDiff = {
      ...modified,
      hunks: [
        {
          header: '@@ -1,2 +1,3 @@',
          lines: [
            { kind: 'added', text: 'top', new: 1 },
            ...modified.hunks[0].lines.map((l) => ({ ...l, new: l.new && l.new + 1 }))
          ]
        }
      ]
    }
    vi.mocked(api.sessions.changes).mockResolvedValue([repo(wt, [shifted, other])])
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByText('Comment on app.ts, line 3')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Comment' })).toHaveValue('Draft')
    vi.mocked(api.sessions.changes).mockResolvedValue([repo(wt, [other])])
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await vi.waitFor(() => expect(screen.queryByRole('textbox', { name: 'Comment' })).toBeNull())
    vi.mocked(api.sessions.changes).mockResolvedValue([repo(wt, [modified])])
    rerender(<Changes session={{ ...s, state: 'needsYou' }} active />)
    await userEvent.click(await screen.findByRole('button', { name: 'Comment on line 1' }))
    expect(screen.getByRole('textbox', { name: 'Comment' })).toHaveValue('Draft')
  })

  it('shows why a comment could not be added', async () => {
    vi.mocked(api.sessions.addFinding).mockRejectedValue(new Error('No such session'))
    render(<Changes session={session('T1')} active />)
    await userEvent.click(await screen.findByRole('button', { name: 'Comment on line 2' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Comment' }), 'Fix it')
    await userEvent.click(screen.getByRole('button', { name: 'Add comment' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't add the comment: No such session"
    )
  })
})

describe('Changes comment details', () => {
  const three: FileDiff = {
    ...modified,
    hunks: [
      {
        header: '@@ -1,3 +1,3 @@',
        lines: [
          { kind: 'context', text: 'a', old: 1, new: 1 },
          { kind: 'context', text: 'b'.repeat(2000) + '…', old: 2, new: 2 },
          { kind: 'context', text: 'c', old: 3, new: 3 }
        ]
      }
    ]
  }
  beforeEach(() => {
    vi.mocked(api.sessions.changes).mockResolvedValue([repo(wt, [three])])
  })

  it('keeps the first-clicked line as the pivot of a Shift-click range', async () => {
    const user = userEvent.setup()
    render(<Changes session={session('T1')} active />)
    await user.click(await screen.findByRole('button', { name: 'Comment on line 3' }))
    await user.keyboard('{Shift>}')
    await user.click(screen.getByRole('button', { name: 'Comment on line 1' }))
    expect(screen.getByText('Comment on app.ts, lines 1–3')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Comment on line 2' }))
    await user.keyboard('{/Shift}')
    expect(screen.getByText('Comment on app.ts, lines 2–3')).toBeInTheDocument()
  })

  it("stores no anchor for a line the diff cut short, and returns focus to the line's +", async () => {
    vi.mocked(api.sessions.addFinding).mockResolvedValue(finding({}))
    render(<Changes session={session('T1')} active />)
    await userEvent.click(await screen.findByRole('button', { name: 'Comment on line 2' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Comment' }), 'Too long')
    await userEvent.click(screen.getByRole('button', { name: 'Add comment' }))
    expect(api.sessions.addFinding).toHaveBeenCalledWith(
      's-T1',
      expect.not.objectContaining({ anchor: expect.anything() })
    )
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: 'Comment on line 2' })).toHaveFocus()
    )
  })

  it('ignores Enter and Escape while an input method is composing', async () => {
    render(<Changes session={session('T1')} active />)
    await userEvent.click(await screen.findByRole('button', { name: 'Comment on line 1' }))
    const box = screen.getByRole('textbox', { name: 'Comment' })
    await userEvent.type(box, 'x')
    fireEvent.keyDown(box, { key: 'Escape', isComposing: true })
    fireEvent.keyDown(box, { key: 'Enter', metaKey: true, isComposing: true })
    expect(box).toBeInTheDocument()
    expect(api.sessions.addFinding).not.toHaveBeenCalled()
  })
})

describe('Changes findings rail', () => {
  beforeEach(() => {
    vi.mocked(api.sessions.changes).mockResolvedValue([repo(wt, [modified, other])])
  })

  it('counts findings on file rows and lists each with its source, place, and words', async () => {
    withFindings([
      finding({}),
      finding({ id: 'f2', anchor: 'gone', start: 9, end: 9, source: 'review', severity: 'high' }),
      finding({ id: 'f3', sentAt: '2026-10-27T00:00:00Z', checked: false, text: 'a\u202eb' }),
      finding({
        id: 'f4',
        path: undefined,
        start: undefined,
        source: 'check',
        title: 'lint',
        log: 'boom'
      }),
      finding({
        id: 'f5',
        source: 'thread',
        path: 'src/a\u202eb.ts',
        title: 'octo on src/a\u202eb.ts',
        author: 'octo'
      })
    ])
    render(<Changes session={session('T1', { state: 'needsYou' })} active />)
    const files = await screen.findByRole('list', { name: 'Changed files' })
    expect(await within(files).findByText('3 findings')).toBeInTheDocument()
    const items = within(findingsList()).getAllByRole('listitem')
    expect(items.map((i) => i.textContent)).toEqual([
      'Youapp.ts:2Rename thisDelete',
      'Claude reviewapp.ts:9HighOutdatedRename thisDelete',
      'PR checklintRename thisboomDelete',
      'PR comment · octoa<U+202E>b.ts:2OutdatedRename thisDelete'
    ])
    const marked = screen.getByText('new line').closest('tr')?.firstElementChild
    expect(marked).toHaveClass('shadow-[inset_2px_0_0_var(--fg-3)]')
    expect(marked).toHaveTextContent('Has a finding')
    expect(screen.getByText('keep').closest('tr')).not.toHaveTextContent('Has a finding')
  })

  it('says whether the pull request is held or free to open', async () => {
    const held =
      'Automatic review: holding the pull request until the review ends and you decide every proposal.'
    const open = 'Automatic review: Claude can open the pull request.'
    for (const [gate, text] of [
      ['held', held],
      ['open', open]
    ] as const) {
      withFindings([], { auto: { rounds: 1 }, gate })
      render(<Changes session={session('T1', { state: 'needsYou' })} active />)
      expect(await within(await railShown()).findByText(text)).toBeInTheDocument()
      cleanup()
    }
    withFindings([], { auto: { rounds: 1 } })
    render(<Changes session={session('T1', { state: 'needsYou' })} active />)
    await within(await railShown()).findByText('Automatic review: 1 of 3 rounds done.')
    expect(within(rail()).queryByText(held)).toBeNull()
    expect(within(rail()).queryByText(open)).toBeNull()
  })

  it('says where the automatic review stands, and nothing while it is off', async () => {
    for (const [auto, autoReviewing, text, reviewing = false] of [
      [
        { rounds: 0 },
        false,
        'Automatic review: waiting for Claude to end its turn with an open pull request.'
      ],
      [{ rounds: 0 }, true, 'Automatic review: round 1 of 3.'],
      [
        { rounds: 0 },
        false,
        'Automatic review: waiting for Claude to end its turn with an open pull request.',
        true
      ],
      [{ rounds: 2, reviewed: 'h' }, false, 'Automatic review: 2 of 3 rounds done.'],
      [
        { rounds: 1, stopped: 'clean' },
        false,
        'Automatic review stopped: the last review had no High line proposals.'
      ],
      [{ rounds: 3, stopped: 'rounds' }, false, 'Automatic review stopped after 3 rounds.'],
      [{ on: false, rounds: 1 }, false, 'Automatic review is off for this session.']
    ] as const) {
      withFindings([], { auto, reviewing, ...(autoReviewing && { autoReviewing }) })
      render(<Changes session={session('T1', { state: 'needsYou' })} active />)
      expect(await within(await railShown()).findByText(text)).toBeInTheDocument()
      cleanup()
    }
    withFindings([])
    render(<Changes session={session('T1', { state: 'needsYou' })} active />)
    await within(await railShown()).findByText(/No findings yet/)
    expect(within(rail()).queryByText(/Automatic review/)).toBeNull()
    expect(
      within(rail()).getByText("Claude review reads the branch's diff and proposes findings.")
    ).toBeInTheDocument()
    expect(within(rail()).getByRole('status')).toHaveTextContent('No findings to send.')
  })

  it("opens a finding's file and scrolls to its line", async () => {
    const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView')
    withFindings([finding({ path: 'src/other.ts' })])
    render(<Changes session={session('T1')} active />)
    await userEvent.click(
      await within(await railShown()).findByRole('button', { name: 'Go to src/other.ts:2' })
    )
    const files = screen.getByRole('list', { name: 'Changed files' })
    const row = within(files).getByRole('button', { name: /^other\.ts/ })
    expect(row).toHaveAttribute('aria-current', 'true')
    expect(scrolled).toHaveBeenCalledWith({ block: 'center' })
    expect(scrolled.mock.contexts).toContain(row)
    expect(scrolled).toHaveBeenCalledWith({ block: 'nearest' })
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: 'Comment on line 2' })).toHaveFocus()
    )
  })

  it('toggles and deletes a finding', async () => {
    withFindings([finding({})])
    render(<Changes session={session('T1')} active />)
    await userEvent.click(
      await within(await railShown()).findByRole('checkbox', { name: 'Send src/app.ts:2' })
    )
    expect(api.sessions.updateFinding).toHaveBeenCalledWith('s-T1', 'f1', { checked: false })
    await userEvent.click(within(rail()).getByRole('button', { name: 'Delete src/app.ts:2' }))
    expect(api.sessions.removeFinding).toHaveBeenCalledWith('s-T1', 'f1')
  })

  it('keeps or discards a review proposal', async () => {
    withFindings([finding({ source: 'review', proposed: true, severity: 'medium' })])
    render(<Changes session={session('T1')} active />)
    const proposals = await within(await railShown()).findByRole('list', {
      name: 'Review proposals'
    })
    expect(within(proposals).getByText('Medium')).toBeInTheDocument()
    await userEvent.click(within(proposals).getByRole('button', { name: 'Keep src/app.ts:2' }))
    expect(api.sessions.updateFinding).toHaveBeenCalledWith('s-T1', 'f1', { kept: true })
    await userEvent.click(within(proposals).getByRole('button', { name: 'Discard src/app.ts:2' }))
    expect(api.sessions.removeFinding).toHaveBeenCalledWith('s-T1', 'f1')
    expect(within(rail()).getByText('No findings yet. Comment on a line, or run Claude review.'))
  })

  it('sends while Claude works, and says why Send is off when nothing is checked', async () => {
    withFindings([finding({})])
    const s = session('T1', { state: 'running' })
    const { rerender } = render(<Changes session={s} active />)
    await within(await railShown()).findByText(/^Pastes 1 finding into the terminal/)
    expect(send()).toBeEnabled()
    withFindings([finding({ checked: false }), finding({ id: 'f2', proposed: true })])
    rerender(<Changes session={{ ...s, state: 'idle' }} active />)
    act(() => vi.mocked(api.board.onChange).mock.calls[0][0]('p1'))
    expect(
      await within(await railShown()).findByText('Check the findings to send, or use Send all.')
    ).toBeInTheDocument()
    expect(send()).toBeDisabled()
  })

  it.each([
    [
      { state: 'needsYou', asking: true },
      'Claude is asking you something. Answer it in the terminal first.'
    ],
    [{ state: 'finished' }, "The session isn't running. Resume it to send."]
  ] as const)('turns Send off and says why for %o', async (over, why) => {
    withFindings([finding({})])
    render(<Changes session={session('T1', over)} active />)
    expect(await within(await railShown()).findByText(why)).toBeInTheDocument()
    expect(send()).toBeDisabled()
  })

  it('shows nothing in the list until the findings load', async () => {
    vi.mocked(api.sessions.findings).mockReturnValue(new Promise(() => {}))
    render(<Changes session={session('T1')} active />)
    await railShown()
    expect(within(rail()).queryByText(/No findings yet/)).toBeNull()
  })

  it('moves focus to the next row after Delete, and to the heading when none is left', async () => {
    let changed: (projectId: string) => void = () => {}
    vi.mocked(api.board.onChange).mockImplementation((cb) => {
      changed = cb
      return () => {}
    })
    withFindings([finding({}), finding({ id: 'f2', path: 'src/other.ts' })])
    vi.mocked(api.sessions.removeFinding).mockImplementation(async (_s, id) => {
      withFindings(id === 'f1' ? [finding({ id: 'f2', path: 'src/other.ts' })] : [])
      changed('p1')
    })
    render(<Changes session={session('T1')} active />)
    await userEvent.click(
      await within(await railShown()).findByRole('button', { name: 'Delete src/app.ts:2' })
    )
    await vi.waitFor(() =>
      expect(within(rail()).getByRole('checkbox', { name: 'Send src/other.ts:2' })).toHaveFocus()
    )
    await userEvent.click(within(rail()).getByRole('button', { name: 'Delete src/other.ts:2' }))
    await vi.waitFor(() =>
      expect(within(rail()).getByRole('heading', { name: /^To send/ })).toHaveFocus()
    )
  })

  it('moves focus to the next proposal after Discard, then to the Findings heading', async () => {
    let changed: (projectId: string) => void = () => {}
    vi.mocked(api.board.onChange).mockImplementation((cb) => {
      changed = cb
      return () => {}
    })
    const p = (id: string, path: string): Finding =>
      finding({ id, path, source: 'review', proposed: true })
    withFindings([p('a', 'src/app.ts'), p('b', 'src/other.ts')])
    vi.mocked(api.sessions.removeFinding).mockImplementation(async (_s, id) => {
      withFindings(id === 'a' ? [p('b', 'src/other.ts')] : [])
      changed('p1')
    })
    render(<Changes session={session('T1')} active />)
    await userEvent.click(
      await within(await railShown()).findByRole('button', { name: 'Discard src/app.ts:2' })
    )
    await vi.waitFor(() =>
      expect(within(rail()).getByRole('button', { name: 'Keep src/other.ts:2' })).toHaveFocus()
    )
    await userEvent.click(within(rail()).getByRole('button', { name: 'Discard src/other.ts:2' }))
    await vi.waitFor(() =>
      expect(within(rail()).getByRole('heading', { name: /^To send/ })).toHaveFocus()
    )
  })

  it('says when a review found nothing to change, until the next review', async () => {
    vi.mocked(api.sessions.review).mockResolvedValueOnce(0)
    render(<Changes session={session('T1')} active />)
    await userEvent.click(
      await within(await railShown()).findByRole('button', { name: 'Claude review' })
    )
    expect(
      await within(rail()).findByText('The review found nothing to change.')
    ).toBeInTheDocument()
    vi.mocked(api.sessions.review).mockReturnValueOnce(new Promise(() => {}))
    await userEvent.click(within(rail()).getByRole('button', { name: 'Claude review' }))
    expect(within(rail()).queryByText('The review found nothing to change.')).toBeNull()
  })

  it('shows the check log on surface-3 and full titles on truncated PR lines', async () => {
    vi.mocked(api.sessions.pullRequests).mockResolvedValue([
      {
        repo: 'o/app',
        number: 7,
        title: 'A long title',
        url: 'u',
        reviewDecision: null,
        stage: 'open',
        checks: [],
        threads: [
          {
            id: 't1',
            path: 'a.ts',
            line: 1,
            startLine: null,
            anchor: null,
            author: 'octo',
            body: 'First line\nmore',
            url: 'u'
          }
        ]
      }
    ])
    withFindings([finding({ source: 'check', path: undefined, title: 'lint', log: 'boom' })])
    render(<Changes session={session('T1')} active />)
    expect(await within(await railShown()).findByText('boom')).toHaveClass('bg-surface-3')
    expect(within(rail()).getByRole('link', { name: '#7 A long title' })).toHaveAttribute(
      'title',
      '#7 A long title'
    )
    expect(within(rail()).getByText('First line')).toHaveAttribute('title', 'First line')
    expect(within(rail()).getByText('a.ts:1')).toHaveAttribute('title', 'a.ts:1')
  })

  it('sends the checked unsent findings and shows them Sent after the reload', async () => {
    let changed: (projectId: string) => void = () => {}
    vi.mocked(api.board.onChange).mockImplementation((cb) => {
      changed = cb
      return () => {}
    })
    withFindings([
      finding({}),
      finding({ id: 'f2', sentAt: '2026-10-27T00:00:00Z' }),
      finding({ id: 'f3', proposed: true })
    ])
    vi.mocked(api.sessions.sendFindings).mockImplementation(async () => {
      withFindings([finding({ sentAt: '2026-10-27T01:00:00Z' })])
      changed('p1')
    })
    render(<Changes session={session('T1', { state: 'needsYou' })} active />)
    expect(
      await within(await railShown()).findByText(
        "Pastes 1 finding into the terminal as one message, after anything typed there. Sent findings aren't sent again."
      )
    ).toBeInTheDocument()
    expect(within(rail()).getByRole('status')).toHaveTextContent(
      "Pastes 1 finding into the terminal as one message, after anything typed there. Sent findings aren't sent again."
    )
    await userEvent.click(send())
    expect(api.sessions.sendFindings).toHaveBeenCalledWith('s-T1', ['f1'])
    expect(await within(rail()).findByRole('radio', { name: 'Sent 1' })).toBeInTheDocument()
    expect(within(rail()).getByRole('status')).toHaveTextContent('Sent 1 finding to the session.')
  })

  it('lists sent findings collapsed under Sent, and opens one to show its text and Delete', async () => {
    withFindings([
      finding({}),
      finding({
        id: 'f2',
        source: 'review',
        severity: 'high',
        sentAt: '2026-10-27T00:00:00Z',
        text: 'Done already'
      })
    ])
    render(<Changes session={session('T1', { state: 'needsYou' })} active />)
    await userEvent.click(await within(await railShown()).findByRole('radio', { name: 'Sent 1' }))
    expect(
      within(rail()).getByText("These went to the session. They stay here and aren't sent again.")
    ).toBeInTheDocument()
    const row = within(rail()).getByRole('button', {
      name: 'Claude review src/app.ts:2, High, Sent'
    })
    expect(row).toHaveTextContent('Claude reviewapp.ts:2HighSent')
    expect(row).toHaveAttribute('aria-expanded', 'false')
    expect(within(rail()).queryByText('Done already')).toBeNull()
    await userEvent.click(row)
    expect(row).toHaveAttribute('aria-expanded', 'true')
    expect(within(rail()).getByText('Done already')).toBeInTheDocument()
    await userEvent.click(within(rail()).getByRole('button', { name: 'Delete src/app.ts:2' }))
    expect(api.sessions.removeFinding).toHaveBeenCalledWith('s-T1', 'f2')
    await userEvent.click(within(rail()).getByRole('radio', { name: 'To send 1' }))
    expect(within(rail()).getByText('Rename this')).toBeInTheDocument()
  })

  it('checks every unsent finding with Select all, and clears them when all are checked', async () => {
    withFindings([
      finding({}),
      finding({ id: 'f2', checked: false }),
      finding({ id: 'f3', checked: false, sentAt: '2026-10-27T00:00:00Z' })
    ])
    render(<Changes session={session('T1', { state: 'needsYou' })} active />)
    const all = await within(await railShown()).findByRole('checkbox', { name: 'Select all' })
    expect(within(rail()).getByRole('heading', { name: 'To send 2' })).toBeInTheDocument()
    expect(all).toHaveAttribute('aria-checked', 'mixed')
    await userEvent.click(all)
    expect(api.sessions.updateFinding).toHaveBeenCalledTimes(1)
    expect(api.sessions.updateFinding).toHaveBeenCalledWith('s-T1', 'f2', { checked: true })
    cleanup()
    vi.mocked(api.sessions.updateFinding).mockClear()
    withFindings([finding({}), finding({ id: 'f2' })])
    render(<Changes session={session('T1', { state: 'needsYou' })} active />)
    await userEvent.click(
      await within(await railShown()).findByRole('checkbox', { name: 'Select all' })
    )
    expect(api.sessions.updateFinding).toHaveBeenCalledWith('s-T1', 'f1', { checked: false })
    expect(api.sessions.updateFinding).toHaveBeenCalledWith('s-T1', 'f2', { checked: false })
  })

  it('sends every unsent finding with Send all, checked or not, and never a sent one', async () => {
    withFindings([
      finding({}),
      finding({ id: 'f2', checked: false }),
      finding({ id: 'f3', sentAt: '2026-10-27T00:00:00Z' }),
      finding({ id: 'f4', proposed: true })
    ])
    render(<Changes session={session('T1', { state: 'needsYou' })} active />)
    await userEvent.click(
      await within(await railShown()).findByRole('button', { name: 'Send all 2' })
    )
    expect(api.sessions.sendFindings).toHaveBeenCalledWith('s-T1', ['f1', 'f2'])
  })

  it('moves focus to the next sent row after Delete, and to the Sent switch when none is left', async () => {
    let changed: (projectId: string) => void = () => {}
    vi.mocked(api.board.onChange).mockImplementation((cb) => {
      changed = cb
      return () => {}
    })
    const sentAt = '2026-10-27T00:00:00Z'
    const b = finding({ id: 'b', path: 'src/other.ts', sentAt })
    withFindings([finding({ id: 'a', sentAt }), b])
    vi.mocked(api.sessions.removeFinding).mockImplementation(async (_s, id) => {
      withFindings(id === 'a' ? [b] : [])
      changed('p1')
    })
    render(<Changes session={session('T1')} active />)
    await userEvent.click(await within(await railShown()).findByRole('radio', { name: 'Sent 2' }))
    await userEvent.click(within(rail()).getByRole('button', { name: 'You src/app.ts:2, Sent' }))
    await userEvent.click(within(rail()).getByRole('button', { name: 'Delete src/app.ts:2' }))
    await vi.waitFor(() =>
      expect(within(rail()).getByRole('button', { name: 'You src/other.ts:2, Sent' })).toHaveFocus()
    )
    await userEvent.click(within(rail()).getByRole('button', { name: 'You src/other.ts:2, Sent' }))
    await userEvent.click(within(rail()).getByRole('button', { name: 'Delete src/other.ts:2' }))
    await vi.waitFor(() =>
      expect(within(rail()).getByRole('radio', { name: 'Sent 0' })).toHaveFocus()
    )
    expect(within(rail()).getByText('Nothing sent yet.')).toBeInTheDocument()
    expect(within(rail()).queryByText(/These went to the session/)).toBeNull()
  })

  it('says the findings could not be read on Sent too', async () => {
    vi.mocked(api.sessions.findings).mockRejectedValue(new Error('disk'))
    render(<Changes session={session('T1')} active />)
    await userEvent.click(await within(await railShown()).findByRole('radio', { name: 'Sent 0' }))
    expect(await within(rail()).findByText(/Couldn't read the findings/)).toBeInTheDocument()
    expect(within(rail()).queryByText('Nothing sent yet.')).toBeNull()
  })

  it('keeps every proposal with Keep all, then focuses the To send heading', async () => {
    let changed: (projectId: string) => void = () => {}
    vi.mocked(api.board.onChange).mockImplementation((cb) => {
      changed = cb
      return () => {}
    })
    vi.mocked(api.sessions.updateFinding).mockImplementation(async () => {
      withFindings([finding({}), finding({ id: 'f2' })])
      changed('p1')
    })
    withFindings([
      finding({ source: 'review', proposed: true }),
      finding({ id: 'f2', source: 'review', proposed: true })
    ])
    render(<Changes session={session('T1')} active />)
    await userEvent.click(
      await within(await railShown()).findByRole('button', { name: 'Keep all' })
    )
    expect(api.sessions.updateFinding).toHaveBeenCalledWith('s-T1', 'f1', { kept: true })
    expect(api.sessions.updateFinding).toHaveBeenCalledWith('s-T1', 'f2', { kept: true })
    await vi.waitFor(() =>
      expect(within(rail()).getByRole('heading', { name: 'To send 2' })).toHaveFocus()
    )
  })

  it('says when Claude last reviewed, and marks what the latest review added as New', async () => {
    const at = '2026-10-27T09:05:00Z'
    withFindings(
      [
        finding({ source: 'review', review: 2, proposed: true, text: 'Fresh' }),
        finding({ id: 'f2', source: 'review', review: 1, text: 'Older' }),
        finding({ id: 'f3', source: 'review', review: 2, text: 'Kept fresh' })
      ],
      { reviews: { count: 2, at } }
    )
    render(<Changes session={session('T1')} active />)
    expect(
      await within(await railShown()).findByText(`Last Claude review: review 2, ${shortTime(at)}.`)
    ).toBeInTheDocument()
    const proposals = within(rail()).getByRole('list', { name: 'Review proposals' })
    expect(within(proposals).getByText('New')).toBeInTheDocument()
    const kept = within(findingsList()).getAllByRole('listitem')
    expect(kept.map((i) => within(i).queryByText('New') !== null)).toEqual([false, true])
  })

  it("shows Send's error in the rail", async () => {
    withFindings([finding({})])
    vi.mocked(api.sessions.sendFindings).mockRejectedValue(new Error('tmux failed'))
    render(<Changes session={session('T1', { state: 'needsYou' })} active />)
    await within(await railShown()).findByText(
      "Pastes 1 finding into the terminal as one message, after anything typed there. Sent findings aren't sent again."
    )
    await userEvent.click(send())
    expect(
      await within(await railShown()).findByText("Couldn't send: tmux failed")
    ).toBeInTheDocument()
  })

  it('keeps Send off while it sends, even when another action runs meanwhile', async () => {
    withFindings([finding({}), finding({ id: 'f2' })])
    vi.mocked(api.sessions.sendFindings).mockReturnValue(new Promise(() => {}))
    render(<Changes session={session('T1', { state: 'needsYou' })} active />)
    await within(await railShown()).findByText(
      "Pastes 2 findings into the terminal as one message, after anything typed there. Sent findings aren't sent again."
    )
    await userEvent.click(send())
    expect(send()).toBeDisabled()
    await userEvent.click(within(rail()).getAllByRole('checkbox')[1])
    expect(api.sessions.updateFinding).toHaveBeenCalled()
    await act(async () => {})
    expect(send()).toBeDisabled()
  })

  it('says which action failed', async () => {
    vi.mocked(api.sessions.updateFinding).mockRejectedValue(new Error('gone'))
    vi.mocked(api.sessions.removeFinding).mockRejectedValue(new Error('locked'))
    withFindings([finding({})])
    render(<Changes session={session('T1')} active />)
    await userEvent.click(
      await within(await railShown()).findByRole('checkbox', { name: 'Send src/app.ts:2' })
    )
    expect(await within(rail()).findByText("Couldn't update the finding: gone")).toBeInTheDocument()
    await userEvent.click(within(rail()).getByRole('button', { name: 'Delete src/app.ts:2' }))
    expect(
      await within(rail()).findByText("Couldn't remove the finding: locked")
    ).toBeInTheDocument()
  })

  it('says when a check or thread could not be added', async () => {
    vi.mocked(api.sessions.pullRequests).mockResolvedValue([
      {
        repo: 'o/app',
        number: 7,
        title: 'Fix it',
        url: 'u',
        reviewDecision: null,
        stage: 'open',
        checks: [{ name: 'lint', state: 'failing', jobId: 11 }],
        threads: [
          {
            id: 't1',
            path: 'a.ts',
            line: 1,
            startLine: null,
            anchor: null,
            author: 'octo',
            body: 'b',
            url: 'u'
          }
        ]
      }
    ])
    vi.mocked(api.sessions.addCheck).mockRejectedValue(new Error('no log'))
    vi.mocked(api.sessions.addThread).mockRejectedValue(new Error('resolved'))
    render(<Changes session={session('T1')} active />)
    await userEvent.click(
      await within(await railShown()).findByRole('button', { name: 'Add lint' })
    )
    expect(await within(rail()).findByText("Couldn't add the check: no log")).toBeInTheDocument()
    await userEvent.click(within(rail()).getByRole('button', { name: "Add octo's thread" }))
    expect(await within(rail()).findByText("Couldn't add the thread: resolved")).toBeInTheDocument()
  })

  it('runs a review, says Reviewing while it runs, and shows its error', async () => {
    withFindings([], { reviewing: true })
    const { unmount } = render(<Changes session={session('T1')} active />)
    expect(
      await within(await railShown()).findByRole('button', { name: 'Reviewing' })
    ).toBeDisabled()
    unmount()
    withFindings([], { reviewError: 'No changes to review' })
    render(<Changes session={session('T1')} active />)
    expect(
      await within(await railShown()).findByText(
        "Couldn't review the changes: No changes to review"
      )
    ).toBeInTheDocument()
    await userEvent.click(within(rail()).getByRole('button', { name: 'Claude review' }))
    expect(api.sessions.review).toHaveBeenCalledWith('s-T1')
  })

  it('says when the branch has no open pull request, and shows a load error', async () => {
    const { unmount } = render(<Changes session={session('T1')} active />)
    expect(
      await within(await railShown()).findByText('No open pull request for branch.')
    ).toBeInTheDocument()
    unmount()
    vi.mocked(api.sessions.pullRequests).mockRejectedValue(new Error('gh failed'))
    render(<Changes session={session('T1')} active />)
    expect(
      await within(await railShown()).findByText("Couldn't read the pull request: gh failed")
    ).toBeInTheDocument()
  })

  it("shows the pull request's checks, decision, and threads, and adds them as findings", async () => {
    const pr: PullRequestState = {
      repo: 'o/app',
      number: 7,
      title: 'Fix it',
      url: 'https://github.com/o/app/pull/7',
      reviewDecision: 'changesRequested',
      stage: 'changesRequested',
      checks: [
        { name: 'lint', state: 'failing', jobId: 11 },
        { name: 'test', state: 'passing' },
        { name: 'e2e', state: 'failing', jobId: 12 }
      ],
      threads: [
        {
          id: 't1',
          path: 'src/app.ts',
          line: 2,
          startLine: null,
          anchor: 'new line',
          author: 'octo',
          body: 'Why this?\nMore',
          url: 'u'
        }
      ]
    }
    vi.mocked(api.sessions.pullRequests).mockResolvedValue([pr])
    withFindings([
      finding({ source: 'check', ref: '12', path: undefined, title: 'e2e', log: 'boom' }),
      finding({ id: 'f2', source: 'check', ref: '11', path: undefined, title: 'CI lint' })
    ])
    render(<Changes session={session('T1')} active />)
    const link = await within(await railShown()).findByRole('link', { name: '#7 Fix it' })
    expect(link).toHaveAttribute('href', pr.url)
    expect(within(rail()).getByText('lint').parentElement?.textContent).toContain('Failing')
    expect(within(rail()).getByText('test').parentElement?.textContent).toContain('Passing')
    expect(within(rail()).getByText('Changes requested')).toBeInTheDocument()
    expect(within(rail()).getByText('src/app.ts:2')).toBeInTheDocument()
    expect(within(rail()).getByText('Why this?')).toBeInTheDocument()
    expect(within(rail()).getByRole('button', { name: 'Added e2e' })).toBeDisabled()
    await userEvent.click(within(rail()).getByRole('button', { name: 'Add lint' }))
    expect(api.sessions.addCheck).toHaveBeenCalledWith('s-T1', 'o/app', 11, 'lint')
    await userEvent.click(within(rail()).getByRole('button', { name: "Add octo's thread" }))
    expect(api.sessions.addThread).toHaveBeenCalledWith('s-T1', 'o/app', 't1')
  })

  it('reads the findings again when the project changes', async () => {
    render(<Changes session={session('T1')} active />)
    await screen.findByRole('table')
    expect(api.sessions.findings).toHaveBeenCalledTimes(1)
    act(() => vi.mocked(api.board.onChange).mock.calls[0][0]('p1'))
    act(() => vi.mocked(api.board.onChange).mock.calls[0][0]('p2'))
    await vi.waitFor(() => expect(api.sessions.findings).toHaveBeenCalledTimes(2))
  })
})

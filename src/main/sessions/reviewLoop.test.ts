import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  Finding,
  FindingsState,
  LastView,
  NewFinding,
  Project,
  PullRequestState,
  RepoChanges,
  SessionRecord,
  Ticket
} from '../../shared/types'
import {
  project,
  session,
  settle,
  setup,
  tempDir,
  tempWorktree,
  ticket,
  timedOut,
  writeTranscript
} from '../test/orchestrator'
import { diffText, reviewArgs, reviewPrompt } from './review'
import { sessionDraft } from '../../shared/drafts'

vi.mock('../env/tools', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../env/tools')>()),
  stopChildren: vi.fn()
}))

beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }))
afterEach(() => {
  vi.useRealTimers()
})

describe('findings', () => {
  const tmux = 'st-p1-octo-shop-147'
  const ready = async (
    over: Partial<SessionRecord> = {},
    findings?: Finding[]
  ): Promise<ReturnType<typeof setup>> => {
    const t = setup({ sessions: [session({ state: 'needsYou', ...over })], findings })
    t.live.add(tmux)
    await t.orch.reconnect()
    await settle()
    return t
  }
  const mine = (over: Partial<Finding> = {}): Finding => ({
    id: 'f1',
    sessionId: 's1',
    source: 'you',
    text: 'Off by one.',
    checked: true,
    ...over
  })

  it('adds a checked finding of yours that survives a restart', async () => {
    const t = await ready()
    const changes: string[] = []
    t.orch.onChange((id) => changes.push(id))
    const added = await t.orch.addFinding('s1', {
      source: 'you',
      text: 'Off by one.',
      worktree: '/repos/shop-wt.noindex/147-dark-mode-toggle',
      path: 'src/a.ts',
      start: 3,
      end: 4,
      anchor: 'let i = 0'
    })
    expect(added).toEqual({
      id: expect.any(String),
      sessionId: 's1',
      source: 'you',
      text: 'Off by one.',
      worktree: '/repos/shop-wt.noindex/147-dark-mode-toggle',
      path: 'src/a.ts',
      start: 3,
      end: 4,
      anchor: 'let i = 0',
      checked: true
    })
    expect(changes).toEqual(['p1'])
    await t.orch.flush()
    const again = await ready({}, t.saved().findings)
    expect(await again.orch.findings('s1')).toEqual({ findings: [added], reviewing: false })
  })

  const wt = '/repos/shop-wt.noindex/147-dark-mode-toggle'

  it('accepts only a finding of yours with a positive line range', async () => {
    const t = await ready()
    for (const bad of [
      { source: 'review' },
      { source: 'check' },
      { start: 0 },
      { start: 1.5 },
      { start: 3, end: 2 },
      { start: 1, end: 2.5 },
      { end: 2 }
    ])
      await expect(
        t.orch.addFinding('s1', {
          source: 'you',
          text: 'x',
          worktree: wt,
          path: 'a.ts',
          ...bad
        } as NewFinding),
        JSON.stringify(bad)
      ).rejects.toThrow('Not a valid finding')
  })

  it('removes an unknown finding without complaint', async () => {
    const t = await ready()
    await expect(t.orch.removeFinding('s1', 'gone')).resolves.toBeUndefined()
  })

  it('refuses an empty finding', async () => {
    const t = await ready()
    await expect(t.orch.addFinding('s1', { source: 'you', text: '  ' })).rejects.toThrow(
      'Enter a finding'
    )
    await expect(
      t.orch.addFinding('s1', { source: 'you', text: 'x', worktree: '/etc', path: 'passwd' })
    ).rejects.toThrow('Not a worktree of this session')
    for (const path of ['/etc/passwd', '../other/a.ts', 'src/../../a.ts'])
      await expect(
        t.orch.addFinding('s1', { source: 'you', text: 'x', worktree: wt, path })
      ).rejects.toThrow('Not a file in this worktree')
    await expect(
      t.orch.addFinding('s1', { source: 'you', text: 'x', path: 'a.ts' })
    ).rejects.toThrow('Not a file in this worktree')
  })

  it('stores only the fields of a new finding, with a one-line range when end is missing', async () => {
    const t = await ready()
    const added = await t.orch.addFinding('s1', {
      source: 'you',
      text: 'x',
      worktree: wt,
      path: 'src/a.ts',
      start: 7,
      anchor: 'a',
      sentAt: '2026-10-01T00:00:00.000Z',
      proposed: true,
      id: 'mine'
    } as NewFinding)
    expect(added).toEqual({
      id: expect.not.stringMatching(/^mine$/),
      sessionId: 's1',
      source: 'you',
      text: 'x',
      worktree: wt,
      path: 'src/a.ts',
      start: 7,
      end: 7,
      anchor: 'a',
      checked: true
    })
  })

  it('checks, keeps, and removes a finding', async () => {
    const t = await ready({}, [mine({ id: 'p', proposed: true, source: 'review' })])
    await t.orch.updateFinding('s1', 'p', { checked: false })
    expect((await t.orch.findings('s1')).findings[0]).toMatchObject({
      checked: false,
      proposed: true
    })
    await t.orch.updateFinding('s1', 'p', { kept: true })
    expect((await t.orch.findings('s1')).findings[0]).not.toHaveProperty('proposed')
    await t.orch.removeFinding('s1', 'p')
    expect((await t.orch.findings('s1')).findings).toEqual([])
    await t.orch.flush()
    expect(t.saved().findings).toEqual([])
    await expect(t.orch.updateFinding('s1', 'p', { checked: true })).rejects.toThrow(
      'Unknown finding'
    )
  })

  it("lists only the session's own findings", async () => {
    const t = await ready({}, [mine(), mine({ id: 'f2', sessionId: 's2' })])
    expect((await t.orch.findings('s1')).findings.map((f) => f.id)).toEqual(['f1'])
  })

  it('drops the findings of a session no longer in the store', async () => {
    const t = await ready({}, [mine(), mine({ id: 'gone', sessionId: 'nope' })])
    await t.orch.removeFinding('s1', 'f1')
    await t.orch.flush()
    expect(t.saved().findings).toEqual([])
    await expect(t.orch.findings('nope')).rejects.toThrow('Unknown session')
  })

  it('drops the findings of a session whose project is gone at load', async () => {
    const t = setup({
      sessions: [session({ state: 'needsYou' }), session({ id: 's9', projectId: 'gone' })],
      findings: [mine(), mine({ id: 'orphan', sessionId: 's9' })]
    })
    await t.orch.reconnect()
    await t.orch.flush()
    expect(t.saved().findings.map((f) => f.id)).toEqual(['f1'])
  })

  it('anchors a CRLF file, and skips a link or a file over 5 MB', async () => {
    const wt = tempDir('st-wt-')
    writeFileSync(join(wt, 'crlf.ts'), 'a\r\nb\r\nlet i = 0\r\n')
    writeFileSync(join(wt, 'real.ts'), 'a\nlet i = 0\n')
    symlinkSync(join(wt, 'real.ts'), join(wt, 'link.ts'))
    writeFileSync(join(wt, 'big.ts'), 'let i = 0\n' + 'x'.repeat(5_000_001))
    const at = (id: string, path: string): Finding =>
      mine({ id, worktree: wt, path, start: 9, end: 9, anchor: 'let i = 0' })
    const t = await ready({ worktrees: [wt] }, [
      at('c', 'crlf.ts'),
      at('l', 'link.ts'),
      at('b', 'big.ts')
    ])
    await t.orch.sendFindings('s1', ['c', 'l', 'b'])
    const text = t.deps.tmux.pasteTmux.mock.calls[0][1]
    expect(text).toContain('1. crlf.ts:3\n')
    expect(text).toContain('2. link.ts:9\n')
    expect(text).toContain('3. big.ts:9\n')
  })

  it("drops a removed project's findings", async () => {
    const t = await ready({}, [mine()])
    await t.orch.removeProject('p1')
    expect(t.saved().findings).toEqual([])
  })

  it('refuses to send while the session is finished', async () => {
    const t = await ready({ state: 'finished' }, [mine()])
    await expect(t.orch.sendFindings('s1', ['f1'])).rejects.toThrow(
      "The session isn't running. Resume it to send."
    )
    expect(t.deps.tmux.pasteTmux).not.toHaveBeenCalled()
  })

  it('sends while Claude is working, for Claude Code to queue', async () => {
    const t = await ready({ state: 'running' }, [mine()])
    await t.orch.sendFindings('s1', ['f1'])
    expect(t.deps.tmux.pasteTmux).toHaveBeenCalledTimes(1)
    expect(t.deps.tmux.enterTmux).toHaveBeenCalledTimes(1)
  })

  const asking = 'Claude is asking you something. Answer it in the terminal first.'

  it('refuses to send while Claude asks you something, until the turn moves on', async () => {
    const t = await ready({}, [mine()])
    t.emit('s1', 'needsYou', true)
    expect(t.orch.session('s1')?.asking).toBe(true)
    await expect(t.orch.sendFindings('s1', ['f1'])).rejects.toThrow(asking)
    t.emit('s1', 'idle', true)
    await expect(t.orch.sendFindings('s1', ['f1'])).rejects.toThrow(asking)
    expect(t.deps.tmux.pasteTmux).not.toHaveBeenCalled()
    t.emit('s1', 'needsYou', false)
    await t.orch.sendFindings('s1', ['f1'])
    expect(t.deps.tmux.pasteTmux).toHaveBeenCalledTimes(1)
    await t.orch.flush()
    expect(t.saved().sessions[0]).not.toHaveProperty('asking')
  })

  it('saves and announces asking even when the state stays', async () => {
    const t = await ready({}, [mine()])
    const changes: string[] = []
    t.orch.onChange((id) => changes.push(id))
    t.emit('s1', null, true)
    expect(changes).toEqual(['p1'])
    await t.orch.flush()
    expect(t.saved().sessions[0].asking).toBe(true)
  })

  it('refuses to send while the session is resuming', async () => {
    const t = await ready({ worktrees: [tempWorktree()], remoteControl: true }, [mine()])
    let release = (): void => undefined
    t.deps.tmux.startTmux.mockImplementationOnce(
      (name) => new Promise((r) => (release = () => r(void t.live.add(name))))
    )
    const restarted = t.orch.setRemoteControl('s1', false)
    await vi.waitFor(() => expect(t.deps.tmux.startTmux).toHaveBeenCalled())
    t.orch.session('s1')!.state = 'needsYou'
    await expect(t.orch.sendFindings('s1', ['f1'])).rejects.toThrow(
      'The session is still starting.'
    )
    release()
    await restarted
    expect(t.deps.tmux.pasteTmux).not.toHaveBeenCalled()
  })

  it('checks the state again after reading the files, right before pasting', async () => {
    const wt = tempDir('st-wt-')
    writeFileSync(join(wt, 'a.ts'), 'x\n')
    const t = await ready({ worktrees: [wt] }, [
      mine({ worktree: wt, path: 'a.ts', start: 1, end: 1, anchor: 'x' })
    ])
    const sending = t.orch.sendFindings('s1', ['f1'])
    t.emit('s1', 'needsYou', true)
    await expect(sending).rejects.toThrow('Claude is asking you something')
    expect(t.deps.tmux.pasteTmux).not.toHaveBeenCalled()
  })

  it('marks the findings sent when the paste landed but Enter did not', async () => {
    const t = await ready({}, [mine()])
    t.deps.tmux.enterTmux.mockRejectedValueOnce(new Error('tmux send-keys failed'))
    await expect(t.orch.sendFindings('s1', ['f1'])).rejects.toThrow(
      "Pasted, but Enter didn't reach the session. Press Enter in the terminal."
    )
    expect((await t.orch.findings('s1')).findings[0].sentAt).toBe('2026-10-24T12:00:00.000Z')
    await t.orch.flush()
    expect(t.saved().findings[0].sentAt).toBe('2026-10-24T12:00:00.000Z')
  })

  it('strips control characters from the whole message, so nothing ends the bracketed paste', async () => {
    const t = await ready({}, [
      mine({ worktree: '/w', path: 'src/\x1b[201~evil.ts', start: 1, end: 1 })
    ])
    await t.orch.sendFindings('s1', ['f1'])
    const text = t.deps.tmux.pasteTmux.mock.calls[0][1]
    expect(text).not.toContain('\x1b')
    expect(text).toContain('1. src/[201~evil.ts:1\n')
  })

  it('pastes the unsent findings anchored to the worktree file, then marks them sent', async () => {
    const wt = tempDir('st-wt-')
    mkdirSync(join(wt, 'src'))
    writeFileSync(join(wt, 'src/a.ts'), 'import x\n\nlet i = 0\ni++\n')
    const t = await ready({ state: 'idle', worktrees: [wt] }, [
      mine({ worktree: wt, path: 'src/a.ts', start: 1, end: 2, anchor: 'let i = 0' }),
      mine({ id: 'old', worktree: wt, path: 'src/a.ts', start: 9, end: 9, anchor: 'gone' }),
      mine({ id: 'p', proposed: true, text: 'Proposed.' }),
      mine({ id: 'sent', sentAt: '2026-10-23T00:00:00.000Z', text: 'Sent.' })
    ])
    const changes: string[] = []
    t.orch.onChange((id) => changes.push(id))
    t.deps.tmux.pasteTmux.mockImplementationOnce(async () => {
      expect(
        (await t.orch.findings('s1')).findings.every((f) => f.id === 'sent' || !f.sentAt)
      ).toBe(true)
    })
    await t.orch.sendFindings('s1', ['f1', 'old', 'p', 'sent'])
    expect(t.deps.tmux.pasteTmux).toHaveBeenCalledWith(
      tmux,
      [
        'Review findings to address:',
        '',
        '1. src/a.ts:3-4',
        '   Off by one.',
        '2. src/a.ts:9',
        '   Off by one.'
      ].join('\n')
    )
    const sent = (await t.orch.findings('s1')).findings
    expect(sent.map((f) => [f.id, f.sentAt])).toEqual([
      ['f1', '2026-10-24T12:00:00.000Z'],
      ['old', '2026-10-24T12:00:00.000Z'],
      ['p', undefined],
      ['sent', '2026-10-23T00:00:00.000Z']
    ])
    expect(changes).toEqual(['p1'])
    await t.orch.flush()
    expect(t.saved().findings[0].sentAt).toBe('2026-10-24T12:00:00.000Z')
  })

  it('leaves the findings unsent when the paste fails', async () => {
    const t = await ready({}, [mine()])
    t.deps.tmux.pasteTmux.mockRejectedValueOnce(new Error('tmux paste-buffer failed'))
    await expect(t.orch.sendFindings('s1', ['f1'])).rejects.toThrow('tmux paste-buffer failed')
    expect((await t.orch.findings('s1')).findings[0].sentAt).toBeUndefined()
  })

  it('refuses a second send while the first is pasting', async () => {
    const t = await ready({}, [mine(), mine({ id: 'f2' })])
    let release = (): void => undefined
    t.deps.tmux.pasteTmux.mockImplementationOnce(() => new Promise((r) => (release = () => r())))
    const first = t.orch.sendFindings('s1', ['f1'])
    await settle()
    await expect(t.orch.sendFindings('s1', ['f2'])).rejects.toThrow('Already sending')
    release()
    await first
    expect(t.deps.tmux.pasteTmux).toHaveBeenCalledTimes(1)
  })

  it('pastes nothing when no chosen finding is left to send', async () => {
    const t = await ready({}, [mine({ proposed: true })])
    await t.orch.sendFindings('s1', ['f1'])
    expect(t.deps.tmux.pasteTmux).not.toHaveBeenCalled()
  })
})

describe('review', () => {
  const diff = (): Omit<RepoChanges, 'worktree'> => ({
    base: 'origin/main',
    files: [
      {
        path: 'src/a.ts',
        change: 'modified',
        added: 1,
        removed: 0,
        hunks: [{ header: '@@ -0,0 +1 @@', lines: [{ kind: 'added', text: 'let i = 1', new: 1 }] }]
      }
    ]
  })
  const reply = (reason: string): { stdout: string; stderr: string; code: number } => ({
    stdout: JSON.stringify({
      is_error: false,
      structured_output: {
        findings: [{ path: 'src/a.ts', start: 1, end: 1, severity: 'high', reason }]
      }
    }),
    stderr: '',
    code: 0
  })
  const ready = async (
    findings: Finding[] = []
  ): Promise<ReturnType<typeof setup> & { wt: string }> => {
    const wt = tempDir('st-wt-')
    const t = setup({ sessions: [session({ state: 'needsYou', worktrees: [wt] })], findings })
    t.deps.git.changes.mockResolvedValue(diff())
    await t.orch.reconnect()
    return { ...t, wt }
  }
  const old = (over: Partial<Finding>): Finding => ({
    id: 'x',
    sessionId: 's1',
    source: 'review',
    text: 'Old.',
    checked: true,
    ...over
  })

  it('runs a read-only review in the first worktree, records it, and stores proposals', async () => {
    const t = await ready()
    t.deps.claude.print.mockResolvedValueOnce(reply('Starts at 1.'))
    await t.orch.review('s1')
    const [cwd, args, env, timeout] = t.deps.claude.print.mock.calls[0]
    const runId = args[args.indexOf('--session-id') + 1]
    expect([cwd, env, timeout]).toEqual([t.wt, undefined, 600_000])
    expect(args).toEqual(
      reviewArgs(reviewPrompt(diffText([{ worktree: t.wt, ...diff() }])), runId, '#147')
    )
    expect(t.saved().runs).toEqual([
      { projectId: 'p1', ticketKey: 'octo/shop#147', claudeDir: t.claudeDir, id: runId }
    ])
    expect(await t.orch.findings('s1')).toEqual({
      reviewing: false,
      reviews: { count: 1, at: '2026-10-24T12:00:00.000Z' },
      findings: [
        {
          id: expect.any(String),
          sessionId: 's1',
          source: 'review',
          text: 'Starts at 1.',
          worktree: t.wt,
          path: 'src/a.ts',
          start: 1,
          end: 1,
          anchor: 'let i = 1',
          severity: 'high',
          review: 1,
          proposed: true,
          checked: true
        }
      ]
    })
    await t.orch.flush()
    expect(t.saved().findings).toHaveLength(1)
    expect(t.saved().sessions[0].reviews).toEqual({ count: 1, at: '2026-10-24T12:00:00.000Z' })
  })

  const promptOf = (t: ReturnType<typeof setup>, call = 0): string =>
    t.deps.claude.print.mock.calls[call][1].at(-1)!
  const withCriteria = ticket({ body: 'Add a toggle.\n\n## Done when\n\n- A works\n- B works' })
  const synced = async (note?: string): Promise<ReturnType<typeof setup> & { wt: string }> => {
    const wt = tempDir('st-wt-')
    const t = setup({
      sessions: [session({ state: 'needsYou', worktrees: [wt], ...(note && { note }) })],
      tickets: [withCriteria]
    })
    t.deps.git.changes.mockResolvedValue(diff())
    await t.orch.reconnect()
    await t.orch.sync('p1')
    return { ...t, wt }
  }

  it('reviews against the ticket and its note', async () => {
    const t = await synced('Also rename X.')
    t.deps.claude.print.mockResolvedValueOnce(reply('r'))
    await t.orch.review('s1')
    expect(promptOf(t)).toContain('<issue>\nYour note for this session:\nAlso rename X.')
    expect(promptOf(t)).toContain('- B works\n</issue>')
  })

  it('falls back to the diff-only prompt when the ticket left the sync', async () => {
    const t = await ready()
    t.deps.board.tickets.mockResolvedValue([])
    await t.orch.sync('p1')
    t.deps.claude.print.mockResolvedValueOnce(reply('r'))
    await t.orch.review('s1')
    expect(promptOf(t)).toBe(reviewPrompt(diffText([{ worktree: t.wt, ...diff() }])))
  })

  it('numbers each review and its proposals, and leaves the count when a review fails', async () => {
    const t = await ready()
    t.deps.claude.print.mockResolvedValueOnce(reply('One.'))
    await t.orch.review('s1')
    t.deps.claude.print.mockRejectedValueOnce(new Error('boom'))
    await expect(t.orch.review('s1')).rejects.toThrow()
    t.deps.claude.print.mockResolvedValueOnce({
      stdout: JSON.stringify({ is_error: false, structured_output: {} }),
      stderr: '',
      code: 0
    })
    await expect(t.orch.review('s1')).rejects.toThrow("Claude didn't return an answer")
    expect((await t.orch.findings('s1')).reviews?.count).toBe(1)
    t.deps.claude.print.mockResolvedValueOnce(reply('Two.'))
    await t.orch.review('s1')
    const state = await t.orch.findings('s1')
    expect(state.reviews?.count).toBe(2)
    expect(state.findings.map((f) => [f.text, f.review])).toEqual([['Two.', 2]])
  })

  it('resolves with how many proposals it stored', async () => {
    const t = await ready()
    t.deps.claude.print.mockResolvedValueOnce(reply('r'))
    expect(await t.orch.review('s1')).toBe(1)
    t.deps.claude.print.mockResolvedValueOnce({
      stdout: JSON.stringify({ is_error: false, structured_output: { findings: [] } }),
      stderr: '',
      code: 0
    })
    expect(await t.orch.review('s1')).toBe(0)
  })

  it('stores nothing when the project or worktree goes while the review runs', async () => {
    const t = await ready()
    t.deps.claude.print.mockImplementationOnce(async () => {
      t.orch.session('s1')!.removedAt = '2026-10-24T12:00:00.000Z'
      return reply('r')
    })
    await expect(t.orch.review('s1')).rejects.toThrow('The worktree was removed')
    expect((await t.orch.findings('s1')).findings).toEqual([])
    delete t.orch.session('s1')!.removedAt
    t.deps.claude.print.mockImplementationOnce(async () => {
      await t.orch.removeProject('p1')
      return reply('r')
    })
    await expect(t.orch.review('s1')).rejects.toThrow('Unknown project')
    await t.orch.flush()
    expect(t.saved().findings).toEqual([])
  })

  it('replaces the proposals you have not decided on and keeps the rest', async () => {
    const t = await ready([
      old({ id: 'undecided', proposed: true }),
      old({ id: 'kept' }),
      old({ id: 'other', sessionId: 's2', proposed: true })
    ])
    t.deps.claude.print.mockResolvedValueOnce(reply('New.'))
    await t.orch.review('s1')
    expect((await t.orch.findings('s1')).findings.map((f) => f.id === 'kept' || f.text)).toEqual([
      true,
      'New.'
    ])
  })

  it('shows the review while it runs and refuses a second one', async () => {
    const t = await ready()
    let release = (): void => undefined
    t.deps.claude.print.mockImplementationOnce(
      () => new Promise((r) => (release = () => r(reply('r'))))
    )
    const first = t.orch.review('s1')
    await settle()
    expect((await t.orch.findings('s1')).reviewing).toBe(true)
    await expect(t.orch.review('s1')).rejects.toThrow('A review is already running')
    release()
    await first
    expect((await t.orch.findings('s1')).reviewing).toBe(false)
  })

  it('keeps the last failure until the next review and leaves the proposals', async () => {
    const t = await ready([old({ id: 'undecided', proposed: true })])
    t.deps.claude.print.mockImplementationOnce(timedOut(600_000))
    await expect(t.orch.review('s1')).rejects.toThrow("Review didn't finish within 10 minutes")
    expect(await t.orch.findings('s1')).toMatchObject({
      reviewing: false,
      reviewError: "Review didn't finish within 10 minutes",
      findings: [{ id: 'undecided' }]
    })
    t.deps.claude.print.mockResolvedValueOnce(reply('r'))
    await t.orch.review('s1')
    expect(await t.orch.findings('s1')).not.toHaveProperty('reviewError')
  })

  it('lets a review of several worktrees read the others', async () => {
    const [first, other] = [tempDir('st-wt-'), tempDir('st-wt-')]
    const t = setup({ sessions: [session({ state: 'needsYou', worktrees: [first, other] })] })
    t.deps.git.changes.mockResolvedValue(diff())
    t.deps.claude.print.mockResolvedValueOnce(reply('r'))
    await t.orch.reconnect()
    await t.orch.review('s1')
    const [cwd, args] = t.deps.claude.print.mock.calls[0]
    expect(cwd).toBe(first)
    expect(args.slice(args.indexOf('--add-dir'), args.indexOf('--add-dir') + 2)).toEqual([
      '--add-dir',
      other
    ])
  })

  it('skips a session with no changes', async () => {
    const t = await ready()
    t.deps.git.changes.mockResolvedValue({ base: 'origin/main', files: [] })
    await expect(t.orch.review('s1')).rejects.toThrow('No changes to review')
    expect(t.deps.claude.print).not.toHaveBeenCalled()
  })
})

describe('automatic review', () => {
  const tmux = 'st-p1-octo-shop-147'
  const diff = (text = 'let i = 1'): Omit<RepoChanges, 'worktree'> => ({
    base: 'origin/main',
    files: [
      {
        path: 'src/a.ts',
        change: 'modified',
        added: 1,
        removed: 0,
        hunks: [{ header: '@@ -0,0 +1 @@', lines: [{ kind: 'added', text, new: 1 }] }]
      }
    ]
  })
  const reply = (
    ...severities: ('high' | 'medium' | 'low')[]
  ): { stdout: string; stderr: string; code: number } => ({
    stdout: JSON.stringify({
      is_error: false,
      structured_output: {
        findings: severities.map((severity, i) => ({
          path: 'src/a.ts',
          start: 1,
          end: 1,
          severity,
          reason: `${severity} ${i}`
        }))
      }
    }),
    stderr: '',
    code: 0
  })
  const pr: PullRequestState = {
    repo: 'octo/shop',
    number: 12,
    title: 'Dark mode',
    url: 'https://github.com/octo/shop/pull/12',
    reviewDecision: null,
    stage: 'checksFailing',
    checks: [
      { name: 'test', state: 'failing', jobId: 501 },
      { name: 'lint', state: 'failing' },
      { name: 'build', state: 'passing', jobId: 502 }
    ],
    threads: [
      {
        id: 'T_1',
        path: 'src/a.ts',
        line: 1,
        startLine: null,
        anchor: null,
        author: 'rev',
        body: 'Off by one.',
        url: 'u1'
      }
    ]
  }
  const ready = async (
    over: Partial<Project> = { autoReview: true },
    tickets?: Ticket[],
    own: Partial<SessionRecord> = {}
  ): Promise<ReturnType<typeof setup>> => {
    const base = tempDir('st-auto-')
    const wt = join(base, 'shop-wt.noindex', '147-dark-mode-toggle')
    mkdirSync(wt, { recursive: true })
    const repos = [{ github: 'octo/shop', path: join(base, 'shop') }]
    const t = setup({
      projects: [{ ...project, repos, ...over }],
      sessions: [session({ worktrees: [wt], ...own })],
      tickets
    })
    t.live.add(tmux)
    t.deps.git.changes.mockResolvedValue(diff())
    t.deps.pullRequests.mockResolvedValue([{ ...pr, checks: [], threads: [] }])
    t.deps.claude.print.mockResolvedValue(reply('high', 'medium'))
    await t.orch.reconnect()
    await settle()
    return t
  }
  const auto = async (t: ReturnType<typeof setup>): Promise<FindingsState['auto']> =>
    (await t.orch.findings('s1')).auto
  const endTurn = async (t: ReturnType<typeof setup>, rounds: number): Promise<void> => {
    t.emit('s1', 'running')
    t.emit('s1', 'needsYou')
    await vi.waitFor(async () => expect((await auto(t))?.rounds).toBe(rounds))
    await settle()
  }
  const reviewNotices = (t: ReturnType<typeof setup>): string[] =>
    t.deps.notify.mock.calls.filter(([title]) => title.startsWith('Review: ')).map((c) => c[1])

  const held = (t: ReturnType<typeof setup>): (() => void) => {
    let release = (): void => undefined
    let printed = (): void => undefined
    const started = new Promise<void>((r) => (printed = r))
    t.deps.board.tickets.mockImplementation(async () => {
      await started
      return [ticket()]
    })
    const answer = t.deps.claude.print.getMockImplementation()
    t.deps.claude.print.mockImplementationOnce(async (...args) => {
      printed()
      await new Promise<void>((r) => (release = r))
      return answer!(...args)
    })
    return () => release()
  }
  const titles = (t: ReturnType<typeof setup>): string[] =>
    t.deps.notify.mock.calls.map(([title]) => title)

  it('notifies once when a round starts, with the ticket title, and opens Changes on click', async () => {
    const t = await ready()
    const opened: LastView[] = []
    t.orch.onOpen((v) => opened.push(v))
    await endTurn(t, 1)
    const notices = t.deps.notify.mock.calls.filter(([title]) => title === 'Reviewing: shop#147')
    expect(notices.map((n) => n[1])).toEqual(['Dark mode toggle'])
    notices[0][2]()
    expect(opened).toEqual([{ projectId: 'p1', ticketKey: 'octo/shop#147', tab: 'changes' }])
  })

  it('shows Reviewing while the round runs, keeps it at a Needs you event, and Needs you after', async () => {
    const t = await ready()
    const release = held(t)
    t.emit('s1', 'needsYou')
    await vi.waitFor(() => expect(t.deps.claude.print).toHaveBeenCalled())
    expect(t.orch.session('s1')?.state).toBe('reviewing')
    t.emit('s1', 'needsYou')
    await settle()
    expect(t.orch.session('s1')?.state).toBe('reviewing')
    expect(t.orch.needsYouCount([])).toBe(0)
    release()
    await vi.waitFor(async () => expect((await auto(t))?.rounds).toBe(1))
    await settle()
    expect(t.orch.session('s1')?.state).toBe('needsYou')
  })

  it('lets Running win during the round', async () => {
    const t = await ready()
    const release = held(t)
    t.emit('s1', 'needsYou')
    await vi.waitFor(() => expect(t.deps.claude.print).toHaveBeenCalled())
    t.emit('s1', 'running')
    expect(t.orch.session('s1')?.state).toBe('running')
    release()
    await vi.waitFor(() => expect(t.orch.session('s1')?.reviewRounds?.[0].endedAt).toBeDefined())
    expect(t.orch.session('s1')?.state).toBe('running')
  })

  it("doesn't change the state or record a round for a review you start", async () => {
    const t = await ready({}, undefined, { state: 'needsYou' })
    const reviewed = t.orch.review('s1')
    await vi.waitFor(() => expect(t.deps.claude.print).toHaveBeenCalled())
    expect(t.orch.session('s1')?.state).toBe('needsYou')
    await reviewed
    expect(t.orch.session('s1')?.state).toBe('needsYou')
    expect(t.orch.session('s1')).not.toHaveProperty('reviewRounds')
    expect(titles(t).filter((x) => x.startsWith('Reviewing'))).toEqual([])
  })

  it('sends the held Needs you at the end of a round that found nothing', async () => {
    const t = await ready()
    t.deps.claude.print.mockResolvedValue(reply())
    const release = held(t)
    t.emit('s1', 'needsYou')
    await vi.waitFor(() => expect(t.deps.claude.print).toHaveBeenCalled())
    await settle()
    expect(titles(t)).toEqual(['Reviewing: shop#147'])
    release()
    await vi.waitFor(() =>
      expect(titles(t)).toEqual(['Reviewing: shop#147', 'Needs you: shop#147'])
    )
  })

  it.each([
    ['sent', ['high'] as const, ['Reviewing: shop#147']],
    ['left waiting', ['medium'] as const, ['Reviewing: shop#147', 'Review: shop#147']]
  ])("doesn't send the held Needs you when a proposal was %s", async (_, severities, expected) => {
    const t = await ready()
    t.deps.claude.print.mockResolvedValue(reply(...severities))
    const release = held(t)
    t.emit('s1', 'needsYou')
    await vi.waitFor(() => expect(t.deps.claude.print).toHaveBeenCalled())
    await settle()
    release()
    await vi.waitFor(() => expect(t.orch.session('s1')?.reviewRounds?.[0].endedAt).toBeDefined())
    await settle()
    expect(titles(t)).toEqual(expected)
  })

  it('records each round with where it started in the conversation, what it sent, and what waits', async () => {
    const t = await ready()
    const say = (text: string): string =>
      JSON.stringify({ type: 'user', message: { role: 'user', content: text } })
    writeTranscript(join(t.claudeDir, 'projects', 'x', 's1.jsonl'), `${say('a')}\n${say('b')}`)
    await endTurn(t, 1)
    expect(t.orch.session('s1')?.reviewRounds).toEqual([
      {
        at: 2,
        round: 1,
        startedAt: expect.any(String),
        files: 1,
        endedAt: expect.any(String),
        found: 2,
        sent: 1,
        waiting: 1
      }
    ])
  })

  it('counts where a round started before the review writes anything', async () => {
    const t = await ready()
    const say = (text: string): string =>
      JSON.stringify({ type: 'user', message: { role: 'user', content: text } })
    const file = join(t.claudeDir, 'projects', 'x', 's1.jsonl')
    writeTranscript(file, `${say('a')}\n${say('b')}`)
    const answer = t.deps.claude.print.getMockImplementation()!
    t.deps.claude.print.mockImplementationOnce(async (...args) => {
      writeTranscript(file, `${say('a')}\n${say('b')}\n${say('c')}`)
      return answer(...args)
    })
    await endTurn(t, 1)
    expect(t.orch.session('s1')?.reviewRounds?.[0].at).toBe(2)
  })

  it("doesn't show Reviewing at a later turn end of a round that started while Claude worked", async () => {
    const t = await ready()
    const release = held(t)
    const prs = t.deps.pullRequests.getMockImplementation()!
    t.deps.pullRequests.mockImplementationOnce(async (...args) => {
      t.emit('s1', 'running')
      return prs(...args)
    })
    t.emit('s1', 'needsYou')
    await vi.waitFor(async () => expect((await t.orch.findings('s1')).reviewing).toBe(true))
    expect(t.orch.session('s1')?.state).toBe('running')
    t.emit('s1', 'needsYou')
    expect(t.orch.session('s1')?.state).toBe('needsYou')
    release()
    await vi.waitFor(() => expect(t.orch.session('s1')?.reviewRounds?.[0].endedAt).toBeDefined())
  })

  it("doesn't show Reviewing again when you sent a message during the round and Claude ends that turn", async () => {
    const t = await ready()
    const release = held(t)
    t.emit('s1', 'needsYou')
    await vi.waitFor(() => expect(t.orch.session('s1')?.state).toBe('reviewing'))
    t.emit('s1', 'running')
    t.emit('s1', 'needsYou')
    expect(t.orch.session('s1')?.state).toBe('needsYou')
    release()
    await vi.waitFor(() => expect(t.orch.session('s1')?.reviewRounds?.[0].endedAt).toBeDefined())
  })

  it('records a round that starts while Claude works as soon as it starts', async () => {
    const t = await ready()
    const release = held(t)
    const prs = t.deps.pullRequests.getMockImplementation()!
    t.deps.pullRequests.mockImplementationOnce(async (...args) => {
      t.emit('s1', 'running')
      return prs(...args)
    })
    t.emit('s1', 'needsYou')
    await vi.waitFor(async () => expect((await t.orch.findings('s1')).reviewing).toBe(true))
    await settle()
    const saved = t.deps.store.save.mock.calls.at(-1)?.[0]
    expect(saved?.sessions.find((x) => x.id === 's1')?.reviewRounds).toHaveLength(1)
    release()
    await vi.waitFor(() => expect(t.orch.session('s1')?.reviewRounds?.[0].endedAt).toBeDefined())
  })

  it('waits for the board sync before sending a held Needs you, so a ticket moved to Done gets none', async () => {
    const t = await ready()
    let open = (): void => undefined
    const gate = new Promise<void>((r) => (open = r))
    t.deps.board.tickets.mockImplementation(async () => {
      await gate
      return [ticket({ status: 'Done' })]
    })
    t.deps.pullRequests.mockResolvedValue([])
    t.emit('s1', 'needsYou')
    await settle()
    open()
    await settle()
    expect(titles(t)).toEqual([])
  })

  it('holds the Needs you for a round that ends before the board sync does', async () => {
    const t = await ready()
    let open = (): void => undefined
    const gate = new Promise<void>((r) => (open = r))
    t.deps.board.tickets.mockImplementation(async () => {
      await gate
      return [ticket()]
    })
    t.deps.claude.print.mockResolvedValue(reply('medium'))
    t.emit('s1', 'needsYou')
    await vi.waitFor(() => expect(t.orch.session('s1')?.reviewRounds?.[0].endedAt).toBeDefined())
    open()
    await settle()
    expect(titles(t)).toEqual(['Reviewing: shop#147', 'Review: shop#147'])
  })

  it('leaves out where a round started when the conversation count fails, and still records it', async () => {
    const t = await ready()
    mkdirSync(join(t.claudeDir, 'projects', 'x', 's1.jsonl'), { recursive: true })
    await endTurn(t, 1)
    expect(t.orch.session('s1')?.reviewRounds?.[0]).not.toHaveProperty('at')
    expect(t.orch.session('s1')?.reviewRounds?.[0]).toMatchObject({ round: 1, sent: 1 })
  })

  it('holds the Needs you when the board sync finishes before the round starts', async () => {
    const t = await ready()
    t.deps.claude.print.mockResolvedValue(reply())
    let open = (): void => undefined
    const gate = new Promise<void>((r) => (open = r))
    const prs = t.deps.pullRequests.getMockImplementation()!
    t.deps.pullRequests.mockImplementation(async (...args) => {
      await gate
      return prs(...args)
    })
    t.emit('s1', 'needsYou')
    await vi.waitFor(() => expect(t.deps.board.tickets).toHaveBeenCalledTimes(2))
    await settle()
    expect(titles(t)).toEqual([])
    open()
    await vi.waitFor(() =>
      expect(titles(t)).toEqual(['Reviewing: shop#147', 'Needs you: shop#147'])
    )
  })

  it('sends the held Needs you once when the round finds no pull request', async () => {
    const t = await ready()
    let open = (): void => undefined
    const gate = new Promise<void>((r) => (open = r))
    t.deps.pullRequests.mockImplementation(async () => {
      await gate
      return []
    })
    t.emit('s1', 'needsYou')
    await vi.waitFor(() => expect(t.deps.board.tickets).toHaveBeenCalledTimes(2))
    await settle()
    expect(titles(t)).toEqual([])
    open()
    await vi.waitFor(() => expect(titles(t)).toEqual(['Needs you: shop#147']))
    await settle()
    expect(titles(t)).toEqual(['Needs you: shop#147'])
  })

  it('shows Needs you and notifies right away when Claude asks during the round', async () => {
    const t = await ready()
    const release = held(t)
    t.emit('s1', 'needsYou')
    await vi.waitFor(() => expect(t.deps.claude.print).toHaveBeenCalled())
    t.emit('s1', 'running')
    t.emit('s1', 'needsYou', true)
    expect(t.orch.session('s1')?.state).toBe('needsYou')
    await vi.waitFor(() => expect(titles(t)).toContain('Needs you: shop#147'))
    release()
    await vi.waitFor(() => expect(t.orch.session('s1')?.reviewRounds?.[0].endedAt).toBeDefined())
  })

  const gated = (t: ReturnType<typeof setup>): (() => void) => {
    let open = (): void => undefined
    const gate = new Promise<void>((r) => (open = r))
    const prs = t.deps.pullRequests.getMockImplementation()!
    t.deps.pullRequests.mockImplementationOnce(async (...args) => {
      await gate
      return prs(...args)
    })
    return () => open()
  }

  it("doesn't show Reviewing for a round that starts while Claude asks, and notifies Needs you", async () => {
    const t = await ready()
    const open = gated(t)
    const release = held(t)
    t.emit('s1', 'needsYou')
    await vi.waitFor(() => expect(t.deps.pullRequests).toHaveBeenCalled())
    t.emit('s1', 'running')
    t.emit('s1', 'needsYou', true)
    open()
    await vi.waitFor(() => expect(t.deps.claude.print).toHaveBeenCalled())
    expect(t.orch.session('s1')?.state).toBe('needsYou')
    await vi.waitFor(() => expect(titles(t)).toContain('Needs you: shop#147'))
    expect(titles(t).filter((x) => x.startsWith('Reviewing'))).toEqual([])
    release()
    await vi.waitFor(() => expect(t.orch.session('s1')?.reviewRounds?.[0].endedAt).toBeDefined())
  })

  it("doesn't hold a capped session's Needs you during a pending round", async () => {
    const t = await ready()
    const open = gated(t)
    t.emit('s1', 'needsYou')
    await vi.waitFor(() => expect(t.deps.pullRequests).toHaveBeenCalled())
    t.emit('s1', 'running')
    t.orch.session('s1')!.capped = true
    t.emit('s1', 'needsYou')
    await vi.waitFor(() =>
      expect(t.deps.notify).toHaveBeenCalledWith(
        'Needs you: shop#147',
        'Reached its token cap',
        expect.any(Function)
      )
    )
    open()
    await settle()
    expect(t.orch.session('s1')?.state).toBe('needsYou')
    expect(titles(t).filter((x) => x.startsWith('Reviewing'))).toEqual([])
  })

  it('records no round when you start a review before the round does', async () => {
    const t = await ready()
    const open = gated(t)
    t.emit('s1', 'needsYou')
    await vi.waitFor(() => expect(t.deps.pullRequests).toHaveBeenCalled())
    const manual = t.orch.review('s1')
    open()
    await manual
    await settle()
    expect(t.orch.session('s1')).not.toHaveProperty('reviewRounds')
    expect(t.orch.session('s1')?.state).toBe('needsYou')
  })

  it('runs the round and refuses your review when you click Review as the round starts', async () => {
    const t = await ready()
    let manual: Promise<unknown> | undefined
    t.deps.notify.mockImplementation((title) => {
      if (title.startsWith('Reviewing'))
        manual = t.orch.review('s1').catch((err: Error) => err.message)
    })
    t.emit('s1', 'needsYou')
    await vi.waitFor(() => expect(t.orch.session('s1')?.reviewRounds?.[0].endedAt).toBeDefined())
    expect(await manual).toBe('A review is already running')
    expect(t.orch.session('s1')?.reviewRounds?.[0]).not.toHaveProperty('error')
    expect(t.orch.session('s1')?.reviewRounds?.[0]).toMatchObject({ sent: 1 })
  })

  it('keeps only the latest 20 rounds', async () => {
    const old = Array.from({ length: 20 }, (_, i) => ({
      round: 1,
      startedAt: `2026-10-24T00:00:${String(i).padStart(2, '0')}.000Z`,
      files: 1,
      endedAt: '2026-10-24T00:01:00.000Z',
      error: 'The review failed: boom'
    }))
    const t = await ready({ autoReview: true }, undefined, { reviewRounds: old })
    await endTurn(t, 1)
    const rounds = t.orch.session('s1')?.reviewRounds ?? []
    expect(rounds).toHaveLength(20)
    expect(rounds[0].startedAt).toBe(old[1].startedAt)
    expect(rounds.at(-1)).toMatchObject({ sent: 1 })
  })

  it('finishes the round when its start notification fails', async () => {
    const t = await ready()
    t.deps.notify.mockImplementation((title) => {
      if (title.startsWith('Reviewing')) throw new Error('no notifications')
    })
    t.emit('s1', 'needsYou')
    await vi.waitFor(() => expect(t.orch.session('s1')?.reviewRounds?.[0].endedAt).toBeDefined())
    expect(t.orch.session('s1')?.reviewRounds?.[0]).not.toHaveProperty('error')
    expect(t.orch.session('s1')?.reviewRounds?.[0]).toMatchObject({ sent: 1 })
    expect(await auto(t)).toMatchObject({ rounds: 1 })
  })

  it('ends a round whose start and review both fail', async () => {
    const t = await ready()
    t.deps.notify.mockImplementation((title) => {
      if (title.startsWith('Reviewing')) throw new Error('no notifications')
    })
    t.deps.claude.print.mockRejectedValueOnce(new Error('claude crashed'))
    t.emit('s1', 'needsYou')
    await vi.waitFor(() => expect(t.orch.session('s1')?.reviewRounds?.[0].endedAt).toBeDefined())
    await vi.waitFor(async () => expect((await t.orch.findings('s1')).reviewing).toBe(false))
    expect(t.orch.session('s1')?.reviewRounds?.[0].error).toBe('The review failed: claude crashed')
  })

  it("doesn't notify a round start when you started typing before it", async () => {
    const t = await ready()
    let open = (): void => undefined
    const gate = new Promise<void>((r) => (open = r))
    const prs = t.deps.pullRequests.getMockImplementation()!
    t.deps.pullRequests.mockImplementationOnce(async (...args) => {
      await gate
      return prs(...args)
    })
    t.emit('s1', 'needsYou')
    await vi.waitFor(() => expect(t.deps.pullRequests).toHaveBeenCalled())
    t.emit('s1', 'running')
    open()
    await vi.waitFor(() => expect(t.orch.session('s1')?.reviewRounds?.[0].endedAt).toBeDefined())
    expect(titles(t).filter((x) => x.startsWith('Reviewing'))).toEqual([])
  })

  it("doesn't notify a round or its waiting proposals on a Done ticket with its session open", async () => {
    const t = await ready({ autoReview: true }, [ticket({ status: 'Done' })])
    t.deps.claude.print.mockResolvedValue(reply('medium'))
    await endTurn(t, 1)
    expect(titles(t).filter((x) => x.startsWith('Review'))).toEqual([])
  })

  it('records a round turned off and on again during its review', async () => {
    const t = await ready()
    t.deps.claude.print.mockImplementationOnce(async () => {
      await t.orch.setAutoReview('s1', false)
      await t.orch.setAutoReview('s1', true)
      return reply('high')
    })
    t.emit('s1', 'needsYou')
    await vi.waitFor(() =>
      expect(t.orch.session('s1')?.reviewRounds?.[0]).toMatchObject({
        error: 'Automatic review was turned off and on again.'
      })
    )
  })

  it('records the error of a round whose review failed', async () => {
    const t = await ready()
    t.deps.claude.print.mockRejectedValueOnce(new Error('claude crashed'))
    t.emit('s1', 'needsYou')
    await vi.waitFor(() =>
      expect(t.orch.session('s1')?.reviewRounds?.[0]).toMatchObject({
        endedAt: expect.any(String),
        error: 'The review failed: claude crashed'
      })
    )
    expect(t.orch.session('s1')?.state).toBe('needsYou')
  })

  it('records a failed review once as one redacted line of at most 300 characters', async () => {
    const t = await ready()
    t.deps.claude.print.mockResolvedValueOnce({
      stdout: '',
      stderr: `boom\n ghp_abcdefghijklmnop ${'x'.repeat(400)}`,
      code: 1
    })
    t.emit('s1', 'needsYou')
    await vi.waitFor(() => expect(t.orch.session('s1')?.reviewRounds?.[0].endedAt).toBeDefined())
    const error = t.orch.session('s1')?.reviewRounds?.[0].error ?? ''
    expect(error.startsWith('The review failed: boom [redacted] xxx')).toBe(true)
    expect(error).toHaveLength(300)
  })

  it('ends a round left open when Sandtable quit, and shows Needs you', async () => {
    const t = await ready({ autoReview: true }, undefined, {
      state: 'reviewing',
      reviewRounds: [{ at: 0, round: 1, startedAt: '2026-10-24T00:00:00.000Z', files: 1 }]
    })
    expect(t.orch.session('s1')?.state).toBe('needsYou')
    expect(t.orch.session('s1')?.reviewRounds).toEqual([
      {
        at: 0,
        round: 1,
        startedAt: '2026-10-24T00:00:00.000Z',
        files: 1,
        endedAt: expect.any(String),
        error: 'Sandtable quit during this review.'
      }
    ])
  })

  it('reviews when Claude ends its turn with an open pull request and sends only the High proposals', async () => {
    const t = await ready()
    expect(await auto(t)).toEqual({ rounds: 0 })
    await endTurn(t, 1)
    expect(t.deps.claude.print).toHaveBeenCalledTimes(1)
    expect(t.deps.tmux.pasteTmux).toHaveBeenCalledTimes(1)
    const text = t.deps.tmux.pasteTmux.mock.calls[0][1]
    expect(text).toContain('From an automated reviewer')
    expect(text).toContain('```\n   high 0\n   ```')
    expect(text).not.toContain('medium 1')
    const { findings } = await t.orch.findings('s1')
    expect(findings.map((f) => [f.severity, !!f.proposed, !!f.sentAt])).toEqual([
      ['high', false, true],
      ['medium', true, false]
    ])
    expect(await auto(t)).toEqual({ rounds: 1, reviewed: expect.any(String) })
    await t.orch.flush()
    expect(t.saved().sessions[0].autoReview).toEqual({ rounds: 1, reviewed: expect.any(String) })
  })

  it('notifies how many proposals wait and opens the Changes tab on click', async () => {
    const t = await ready()
    const opened: LastView[] = []
    t.orch.onOpen((v) => opened.push(v))
    await endTurn(t, 1)
    const notice = t.deps.notify.mock.calls.find(([title]) => title === 'Review: shop#147')
    expect(notice?.[1]).toBe('1 review proposal waiting')
    notice?.[2]()
    expect(opened).toEqual([{ projectId: 'p1', ticketKey: 'octo/shop#147', tab: 'changes' }])
  })

  it('does nothing while the switch is off, and existing projects stay off', async () => {
    const t = await ready({})
    expect(await t.orch.findings('s1')).not.toHaveProperty('auto')
    t.emit('s1', 'needsYou')
    await vi.waitFor(() => expect(t.deps.board.tickets).toHaveBeenCalled())
    await settle()
    expect(t.deps.claude.print).not.toHaveBeenCalled()
    expect(t.deps.pullRequests).not.toHaveBeenCalled()
  })

  it('waits for an open pull request', async () => {
    const t = await ready()
    t.deps.pullRequests.mockResolvedValue([])
    t.emit('s1', 'needsYou')
    await vi.waitFor(() => expect(t.deps.pullRequests).toHaveBeenCalled())
    await settle()
    expect(t.deps.claude.print).not.toHaveBeenCalled()
    expect(await auto(t)).toEqual({ rounds: 0 })
  })

  it('skips a session with no changes', async () => {
    const t = await ready()
    t.deps.git.changes.mockResolvedValue({ base: 'origin/main', files: [] })
    t.emit('s1', 'needsYou')
    await vi.waitFor(() => expect(t.deps.git.changes).toHaveBeenCalled())
    await settle()
    expect(t.deps.claude.print).not.toHaveBeenCalled()
  })

  it("doesn't start a round while the composer holds a draft", async () => {
    const t = await ready()
    t.deps.draft.mockResolvedValue({ text: 'wait', images: [] })
    t.emit('s1', 'needsYou')
    await vi.waitFor(() => expect(t.deps.draft).toHaveBeenCalledWith(sessionDraft('s1')))
    await settle()
    expect(t.deps.claude.print).not.toHaveBeenCalled()
  })

  it('keeps the High proposals unsent when a draft appears during the review', async () => {
    const t = await ready()
    t.deps.draft.mockResolvedValueOnce(null).mockResolvedValue({ text: 'typed', images: [] })
    await endTurn(t, 1)
    expect(t.deps.tmux.pasteTmux).not.toHaveBeenCalled()
    const { findings } = await t.orch.findings('s1')
    expect(findings.map((f) => [f.severity, !!f.proposed, !!f.sentAt])).toEqual([
      ['high', false, false],
      ['medium', true, false]
    ])
    expect(reviewNotices(t)).toEqual(['2 review proposals waiting'])
  })

  it("doesn't review while Claude asks you something", async () => {
    const t = await ready()
    t.emit('s1', 'needsYou', true)
    await vi.waitFor(() => expect(t.deps.board.tickets).toHaveBeenCalled())
    await settle()
    expect(t.deps.claude.print).not.toHaveBeenCalled()
  })

  it('keeps the High proposals unsent when Claude starts asking during the review', async () => {
    const t = await ready()
    t.deps.claude.print.mockImplementationOnce(async () => {
      t.askingFiles.add(session().eventsFile)
      return reply('high', 'low')
    })
    await endTurn(t, 1)
    expect(t.deps.tmux.pasteTmux).not.toHaveBeenCalled()
    expect((await t.orch.findings('s1')).findings.filter((f) => f.sentAt)).toEqual([])
    expect(reviewNotices(t)).toEqual(['2 review proposals waiting'])
  })

  it('reviews again only after the changes differ, and stops after a review with no High', async () => {
    const t = await ready()
    await endTurn(t, 1)
    t.emit('s1', 'running')
    t.emit('s1', 'needsYou')
    await vi.waitFor(() => expect(t.deps.git.changes).toHaveBeenCalledTimes(3))
    await settle()
    expect(t.deps.claude.print).toHaveBeenCalledTimes(1)
    t.deps.git.changes.mockResolvedValue(diff('let i = 2'))
    t.deps.claude.print.mockResolvedValue(reply('medium'))
    await endTurn(t, 2)
    expect(await auto(t)).toMatchObject({ rounds: 2, stopped: 'clean' })
    t.deps.git.changes.mockResolvedValue(diff('let i = 3'))
    const syncs = t.deps.board.tickets.mock.calls.length
    t.emit('s1', 'running')
    t.emit('s1', 'needsYou')
    await vi.waitFor(() => expect(t.deps.board.tickets).toHaveBeenCalledTimes(syncs + 1))
    await settle()
    expect(t.deps.claude.print).toHaveBeenCalledTimes(2)
  })

  it('stops after 3 rounds', async () => {
    const t = await ready()
    for (const round of [1, 2, 3]) {
      t.deps.git.changes.mockResolvedValue(diff(`let i = ${round}`))
      await endTurn(t, round)
    }
    expect(await auto(t)).toMatchObject({ rounds: 3, stopped: 'rounds' })
    expect(t.deps.tmux.pasteTmux).toHaveBeenCalledTimes(3)
  })

  it('turns off for the session and saves that with the session', async () => {
    const t = await ready()
    await t.orch.setAutoReview('s1', false)
    expect(await auto(t)).toEqual({ on: false, rounds: 0 })
    t.emit('s1', 'needsYou')
    await vi.waitFor(() => expect(t.deps.board.tickets).toHaveBeenCalled())
    await settle()
    expect(t.deps.claude.print).not.toHaveBeenCalled()
    await t.orch.flush()
    expect(t.saved().sessions[0].autoReview).toEqual({ on: false, rounds: 0 })
  })

  it('turns on for one session while the project is off', async () => {
    const t = await ready({})
    await t.orch.setAutoReview('s1', true)
    expect(await auto(t)).toEqual({ on: true, rounds: 0 })
    await endTurn(t, 1)
    expect(t.deps.tmux.pasteTmux).toHaveBeenCalledTimes(1)
  })

  it('starts over when turned on again after it stopped', async () => {
    const t = await ready()
    t.deps.claude.print.mockResolvedValue(reply('medium'))
    await endTurn(t, 1)
    expect(await auto(t)).toMatchObject({ stopped: 'clean' })
    await t.orch.setAutoReview('s1', true)
    expect(await auto(t)).toEqual({ on: true, rounds: 0 })
    await endTurn(t, 1)
    expect(t.deps.claude.print).toHaveBeenCalledTimes(2)
  })

  it('stops the round when turned off during the review, leaving the proposals', async () => {
    const t = await ready()
    t.deps.claude.print.mockImplementationOnce(async () => {
      await t.orch.setAutoReview('s1', false)
      return reply('high', 'medium')
    })
    t.emit('s1', 'needsYou')
    await vi.waitFor(async () => expect((await t.orch.findings('s1')).findings).toHaveLength(2))
    await settle()
    expect(t.deps.tmux.pasteTmux).not.toHaveBeenCalled()
    expect((await t.orch.findings('s1')).findings.every((f) => f.proposed)).toBe(true)
    expect(await auto(t)).toEqual({ on: false, rounds: 0 })
    expect(t.orch.session('s1')?.reviewRounds?.[0]).toMatchObject({
      error: 'Automatic review was turned off.'
    })
  })

  it('sends only while the session still needs you', async () => {
    const t = await ready()
    t.deps.claude.print.mockImplementationOnce(async () => {
      t.emit('s1', 'running')
      return reply('high', 'medium')
    })
    t.emit('s1', 'needsYou')
    await vi.waitFor(async () => expect((await auto(t))?.rounds).toBe(1))
    await settle()
    expect(t.deps.tmux.pasteTmux).not.toHaveBeenCalled()
    expect(reviewNotices(t)).toEqual(['2 review proposals waiting'])
  })

  it("doesn't send over text typed at the terminal prompt", async () => {
    const t = await ready()
    t.deps.tmux.captureTmux.mockResolvedValue('────\n\x1b[39m❯\u00a0half a thought\n────')
    await endTurn(t, 1)
    expect(t.deps.tmux.captureTmux).toHaveBeenCalledWith(tmux, true)
    expect(t.deps.tmux.pasteTmux).not.toHaveBeenCalled()
    expect(reviewNotices(t)).toEqual(['2 review proposals waiting'])
  })

  it("doesn't send when the terminal can't be read", async () => {
    const t = await ready()
    t.deps.tmux.captureTmux.mockRejectedValue(new Error('no pane'))
    await endTurn(t, 1)
    expect(t.deps.tmux.pasteTmux).not.toHaveBeenCalled()
    expect(reviewNotices(t)).toEqual(['2 review proposals waiting'])
  })

  it('checks the terminal prompt again right before pasting', async () => {
    const t = await ready()
    t.deps.tmux.captureTmux
      .mockResolvedValueOnce('')
      .mockResolvedValue('────\n\x1b[39m❯ started typing\n────')
    await endTurn(t, 1)
    expect(t.deps.tmux.captureTmux).toHaveBeenCalledTimes(2)
    expect(t.deps.tmux.pasteTmux).not.toHaveBeenCalled()
    expect(reviewNotices(t)).toEqual(['2 review proposals waiting'])
  })

  it('counts nothing when turned off and on again during the review', async () => {
    const t = await ready()
    t.deps.claude.print.mockImplementationOnce(async () => {
      await t.orch.setAutoReview('s1', false)
      await t.orch.setAutoReview('s1', true)
      return reply('high', 'medium')
    })
    t.emit('s1', 'needsYou')
    await vi.waitFor(async () => expect((await t.orch.findings('s1')).findings).toHaveLength(2))
    await settle()
    expect(t.deps.tmux.pasteTmux).not.toHaveBeenCalled()
    expect(await auto(t)).toEqual({ on: true, rounds: 0 })
  })

  it('stops the round when the project setting is turned off during the review', async () => {
    const t = await ready()
    t.deps.claude.print.mockImplementationOnce(async () => {
      const p = (await t.orch.listProjects()).find((x) => x.id === 'p1')!
      await t.orch.saveProject({ ...p, autoReview: undefined })
      return reply('high', 'medium')
    })
    t.emit('s1', 'needsYou')
    await vi.waitFor(async () => expect((await t.orch.findings('s1')).findings).toHaveLength(2))
    await settle()
    expect(t.deps.tmux.pasteTmux).not.toHaveBeenCalled()
    expect(t.orch.session('s1')?.autoReview).toEqual({ rounds: 0 })
  })

  it('leaves the rounds as they were when the review fails', async () => {
    const t = await ready()
    t.deps.claude.print.mockRejectedValueOnce(new Error('claude crashed'))
    t.emit('s1', 'needsYou')
    await vi.waitFor(async () =>
      expect((await t.orch.findings('s1')).reviewError).toBe('claude crashed')
    )
    await settle()
    expect(await auto(t)).toEqual({ rounds: 0 })
  })

  it('marks the review it runs as automatic, and not one you start', async () => {
    const t = await ready()
    let release = (): void => undefined
    t.deps.claude.print.mockImplementation(
      () => new Promise((r) => (release = () => r(reply('medium'))))
    )
    const mine = t.orch.review('s1')
    await settle()
    expect(await t.orch.findings('s1')).not.toHaveProperty('autoReviewing')
    release()
    await mine
    t.emit('s1', 'needsYou')
    await vi.waitFor(async () => expect((await t.orch.findings('s1')).autoReviewing).toBe(true))
    release()
    await vi.waitFor(async () => expect((await auto(t))?.rounds).toBe(1))
    expect(await t.orch.findings('s1')).not.toHaveProperty('autoReviewing')
  })

  it('reviews again when only a file shown as counts changed', async () => {
    const t = await ready()
    const withBig = (added: number): Omit<RepoChanges, 'worktree'> => ({
      ...diff(),
      files: [
        ...diff().files,
        { path: 'src/big.ts', change: 'modified', added, removed: 0, hunks: [] }
      ]
    })
    t.deps.git.changes.mockResolvedValue(withBig(2_000))
    await endTurn(t, 1)
    t.deps.git.changes.mockResolvedValue(withBig(2_001))
    await endTurn(t, 2)
    expect(t.deps.claude.print).toHaveBeenCalledTimes(2)
  })

  it('keeps Done when findings apart, replaces them by criterion, and never sends them', async () => {
    const body = 'Add a toggle.\n\n## Done when\n\n- A works\n- B works'
    const t = await ready(undefined, [ticket({ body })])
    await t.orch.sync('p1')
    const answer = (...criteria: string[]): { stdout: string; stderr: string; code: number } => ({
      stdout: JSON.stringify({
        is_error: false,
        structured_output: {
          ...JSON.parse(reply('high').stdout).structured_output,
          unmet: criteria.map((c, i) => ({ criterion: c, severity: 'high', reason: `${c} ${i}` }))
        }
      }),
      stderr: '',
      code: 0
    })
    t.deps.claude.print.mockResolvedValue(answer('A works', 'B works'))
    await endTurn(t, 1)
    t.deps.git.changes.mockResolvedValue(diff('let i = 2'))
    t.deps.claude.print.mockResolvedValue(answer('A works'))
    await endTurn(t, 2)
    const all = (await t.orch.findings('s1')).findings
    expect(all.filter((f) => f.title).map((f) => [f.text, !!f.proposed, !!f.sentAt])).toEqual([
      ['B works 1', true, false],
      ['A works 0', true, false]
    ])
    expect(all.filter((f) => f.path && f.sentAt)).toHaveLength(2)
  })

  it('replaces an earlier proposal on the same lines instead of adding a copy', async () => {
    const t = await ready()
    t.deps.claude.print.mockResolvedValue(reply('high', 'medium'))
    await endTurn(t, 1)
    t.deps.git.changes.mockResolvedValue(diff('let i = 2'))
    await endTurn(t, 2)
    const proposed = (await t.orch.findings('s1')).findings.filter((f) => f.proposed)
    expect(proposed).toHaveLength(1)
    expect(reviewNotices(t)).toEqual(['1 review proposal waiting', '1 review proposal waiting'])
  })

  it('counts an unsent High from an earlier round as waiting', async () => {
    const t = await ready()
    t.deps.tmux.captureTmux.mockResolvedValueOnce('────\n\x1b[39m❯\u00a0typed\n────')
    await endTurn(t, 1)
    t.deps.git.changes.mockResolvedValue(diff('let i = 2'))
    t.deps.claude.print.mockResolvedValue(reply('high'))
    await endTurn(t, 2)
    expect(t.deps.tmux.pasteTmux).toHaveBeenCalledTimes(1)
    expect(reviewNotices(t)).toEqual(['2 review proposals waiting', '1 review proposal waiting'])
  })

  it("keeps an earlier round's undecided proposals", async () => {
    const t = await ready()
    await endTurn(t, 1)
    t.deps.git.changes.mockResolvedValue({
      ...diff(),
      files: [...diff().files, { ...diff('let j = 1').files[0], path: 'src/b.ts' }]
    })
    t.deps.claude.print.mockResolvedValue({
      stdout: JSON.stringify({
        is_error: false,
        structured_output: {
          findings: [{ path: 'src/b.ts', start: 1, end: 1, severity: 'low', reason: 'low b' }]
        }
      }),
      stderr: '',
      code: 0
    })
    await endTurn(t, 2)
    const proposed = (await t.orch.findings('s1')).findings.filter((f) => f.proposed)
    expect(proposed.map((f) => f.text)).toEqual(['medium 1', 'low b'])
  })

  it("doesn't review a capped session", async () => {
    const t = await ready({ autoReview: true }, undefined, { capped: true })
    t.emit('s1', 'needsYou')
    await vi.waitFor(() => expect(t.deps.board.tickets).toHaveBeenCalled())
    await settle()
    expect(t.deps.claude.print).not.toHaveBeenCalled()
  })

  it('waits while a review you started runs', async () => {
    const t = await ready()
    let release = (): void => undefined
    t.deps.claude.print.mockImplementationOnce(
      () => new Promise((r) => (release = () => r(reply('medium'))))
    )
    const mine = t.orch.review('s1')
    await settle()
    t.emit('s1', 'needsYou')
    await vi.waitFor(() => expect(t.deps.board.tickets).toHaveBeenCalled())
    await settle()
    release()
    await mine
    await settle()
    expect(t.deps.claude.print).toHaveBeenCalledTimes(1)
    expect(await auto(t)).toEqual({ rounds: 0 })
  })

  it('refuses a switch value that is not on or off, and sessions without a ticket or worktree', async () => {
    const t = await ready()
    await expect(t.orch.setAutoReview('s1', 'yes' as unknown as boolean)).rejects.toThrow()
    t.orch.session('s1')!.removedAt = '2026-10-24T12:00:00.000Z'
    await expect(t.orch.setAutoReview('s1', true)).rejects.toThrow()
    const u = await ready({}, undefined, { ticketKey: undefined })
    await expect(u.orch.setAutoReview('s1', true)).rejects.toThrow()
    expect(u.orch.session('s1')).not.toHaveProperty('autoReview')
  })

  const withPr = (t: ReturnType<typeof setup>): void =>
    void t.deps.pullRequests.mockResolvedValue([pr])

  it('adds failing checks and threads after a sync, unchecked, at most once each, and sends none', async () => {
    const t = await ready()
    withPr(t)
    const before = t.deps.pullRequests.mock.calls.length
    await t.orch.sync('p1')
    await vi.waitFor(async () => expect((await t.orch.findings('s1')).findings).toHaveLength(2))
    expect(t.deps.pullRequests).toHaveBeenCalledTimes(before + 1)
    const [check, thread] = (await t.orch.findings('s1')).findings
    expect([check.source, check.ref, thread.source, thread.ref]).toEqual([
      'check',
      '501',
      'thread',
      'T_1'
    ])
    expect([check.checked, thread.checked]).toEqual([false, false])
    await t.orch.removeFinding('s1', check.id)
    const reads = t.deps.pullRequests.mock.calls.length
    await t.orch.sync('p1')
    await vi.waitFor(() => expect(t.deps.pullRequests).toHaveBeenCalledTimes(reads + 1))
    await settle()
    expect((await t.orch.findings('s1')).findings).toEqual([thread])
    expect(t.deps.failedLog).toHaveBeenCalledTimes(1)
    expect(t.deps.tmux.pasteTmux).not.toHaveBeenCalled()
    await t.orch.flush()
    expect(t.saved().sessions[0].autoReview?.added).toEqual(['check:501', 'thread:T_1'])
  })

  it('pastes only the High proposal after a sync added pull request findings', async () => {
    const t = await ready()
    withPr(t)
    await t.orch.sync('p1')
    await vi.waitFor(async () => expect((await t.orch.findings('s1')).findings).toHaveLength(2))
    await endTurn(t, 1)
    const text = t.deps.tmux.pasteTmux.mock.calls[0][1]
    expect(text).toContain('high 0')
    expect(text).not.toContain('Off by one.')
    expect(text).not.toContain('check failed')
  })

  it('adds pull request findings on a ticket from any tracker', async () => {
    const t = await ready({ autoReview: true }, [ticket({ prStage: null })])
    withPr(t)
    await t.orch.sync('p1')
    await vi.waitFor(async () => expect((await t.orch.findings('s1')).findings).toHaveLength(2))
  })

  it('adds pull request findings for a session turned on while the project is off', async () => {
    const t = await ready({})
    withPr(t)
    await t.orch.setAutoReview('s1', true)
    await t.orch.sync('p1')
    await vi.waitFor(async () => expect((await t.orch.findings('s1')).findings).toHaveLength(2))
  })

  it('adds nothing when turned off while a pull request finding is read', async () => {
    const t = await ready()
    withPr(t)
    t.deps.failedLog.mockImplementationOnce(async () => {
      await t.orch.setAutoReview('s1', false)
      return 'log'
    })
    await t.orch.sync('p1')
    await vi.waitFor(() => expect(t.deps.failedLog).toHaveBeenCalled())
    await settle()
    expect((await t.orch.findings('s1')).findings).toEqual([])
    expect(t.orch.session('s1')?.autoReview?.added).toBeUndefined()
  })

  it('leaves a check you added by hand, without its log and sent, as it is', async () => {
    const t = await ready()
    withPr(t)
    t.deps.failedLog.mockRejectedValueOnce(new Error('rate limited'))
    const mine = await t.orch.addCheck('s1', 'octo/shop', 501, 'test')
    await t.orch.sendFindings('s1', [mine.id])
    const sent = (await t.orch.findings('s1')).findings.find((f) => f.id === mine.id)
    await t.orch.sync('p1')
    await vi.waitFor(async () => expect((await t.orch.findings('s1')).findings).toHaveLength(2))
    await settle()
    expect((await t.orch.findings('s1')).findings.find((f) => f.source === 'check')).toEqual(sent)
    expect(t.deps.failedLog).toHaveBeenCalledTimes(1)
  })

  it('adds no pull request findings when off, turned off, finished, or the session has no branch', async () => {
    for (const [over, own] of [
      [{}, {}],
      [{ autoReview: true }, { autoReview: { on: false, rounds: 0 } }],
      [{ autoReview: true }, { branch: undefined }],
      [{ autoReview: true }, { state: 'finished' }]
    ] as const) {
      const t = await ready(over, undefined, own)
      withPr(t)
      t.deps.pullRequests.mockClear()
      await t.orch.sync('p1')
      await settle()
      expect(t.deps.pullRequests).not.toHaveBeenCalled()
    }
  })
})

describe('pull requests', () => {
  const branch = '147-dark-mode-toggle'
  const pr = (over: Partial<PullRequestState> = {}): PullRequestState => ({
    repo: 'octo/shop',
    number: 12,
    title: 'Dark mode',
    url: 'https://github.com/octo/shop/pull/12',
    reviewDecision: null,
    stage: 'checksFailing',
    checks: [
      { name: 'test', state: 'failing', jobId: 501 },
      { name: 'lint', state: 'passing', jobId: 502 },
      { name: 'build', state: 'failing', jobId: 503, url: 'https://ci.example/\u202e503' }
    ],
    threads: [
      {
        id: 'T_1',
        path: 'src/a.ts',
        line: 3,
        startLine: 2,
        anchor: 'let i = 0',
        author: 'rev',
        body: 'Off by one.',
        url: 'u1'
      },
      {
        id: 'T_2',
        path: '../../etc/x',
        line: null,
        startLine: null,
        anchor: null,
        author: 'rev',
        body: 'Hm',
        url: 'u2'
      },
      {
        id: 'T_3',
        path: 'src/gone.ts',
        line: 1,
        startLine: null,
        anchor: null,
        author: 'rev',
        body: 'Gone',
        url: 'u3'
      }
    ],
    ...over
  })
  const ready = async (): Promise<ReturnType<typeof setup> & { main: string }> => {
    const base = tempDir('st-prs-')
    const main = join(base, 'shop-wt.noindex', branch)
    const front = join(base, 'shop-web-wt.noindex', branch)
    mkdirSync(join(main, 'src'), { recursive: true })
    writeFileSync(join(main, 'src/a.ts'), 'import x\nlocal edit\ni++\n')
    const t = setup({
      projects: [
        {
          ...project,
          repos: [
            { github: 'octo/shop', path: join(base, 'shop') },
            { github: 'octo/shop-web', path: join(base, 'shop-web') }
          ]
        }
      ],
      sessions: [session({ state: 'needsYou', worktrees: [main, front] })]
    })
    t.deps.pullRequests.mockImplementation(async (repo) => (repo === 'octo/shop' ? [pr()] : []))
    await t.orch.reconnect()
    return { ...t, main }
  }

  it("reads each worktree repo's open pull requests for the session branch", async () => {
    const t = await ready()
    expect(await t.orch.pullRequests('s1')).toEqual([pr()])
    expect(t.deps.pullRequests.mock.calls).toEqual([
      ['octo/shop', branch],
      ['octo/shop-web', branch]
    ])
  })

  it('returns the repos that answered and throws only when none did', async () => {
    const t = await ready()
    t.deps.pullRequests.mockImplementation(async (repo) => {
      if (repo === 'octo/shop-web') throw new Error('rate limited')
      return [pr()]
    })
    expect(await t.orch.pullRequests('s1')).toEqual([pr()])
    t.deps.pullRequests.mockRejectedValue(new Error('rate limited'))
    await expect(t.orch.pullRequests('s1')).rejects.toThrow('rate limited')
  })

  it('adds a failing check with its failed log, once', async () => {
    const t = await ready()
    const changes: string[] = []
    t.orch.onChange((id) => changes.push(id))
    t.deps.failedLog.mockResolvedValueOnce('Error\u200b: expected 1')
    const added = await t.orch.addCheck('s1', 'octo/shop', 501, 'test')
    expect(added).toEqual({
      id: expect.any(String),
      sessionId: 's1',
      source: 'check',
      ref: '501',
      title: 'test',
      text: 'This check failed. Fix what its failed log shows.',
      log: 'Error: expected 1',
      checked: true
    })
    expect(t.deps.failedLog).toHaveBeenCalledWith('octo/shop', 501)
    expect(changes).toEqual(['p1'])
    expect(await t.orch.addCheck('s1', 'octo/shop', 501, 'test')).toEqual(added)
    expect((await t.orch.findings('s1')).findings).toHaveLength(1)
    await t.orch.flush()
    expect(t.saved().findings).toEqual([added])
  })

  it('replaces a check added without its log when you add it again', async () => {
    const t = await ready()
    t.deps.failedLog.mockRejectedValueOnce(new Error('rate limited'))
    const first = await t.orch.addCheck('s1', 'octo/shop', 501, 'test')
    expect(first).not.toHaveProperty('log')
    const second = await t.orch.addCheck('s1', 'octo/shop', 501, 'test')
    expect(second.log).toBe('Error: expected 1')
    expect((await t.orch.findings('s1')).findings).toEqual([second])
  })

  it('stores nothing when the project goes while a check or thread is read', async () => {
    const t = await ready()
    t.deps.failedLog.mockImplementationOnce(async () => {
      await t.orch.removeProject('p1')
      return 'log'
    })
    await expect(t.orch.addCheck('s1', 'octo/shop', 501, 'test')).rejects.toThrow('Unknown project')
    await t.orch.flush()
    expect(t.saved().findings).toEqual([])
  })

  it('stores nothing when the worktree is removed while a thread is read', async () => {
    const t = await ready()
    t.deps.pullRequests.mockImplementationOnce(async () => {
      t.orch.session('s1')!.removedAt = '2026-10-24T12:00:00.000Z'
      return [pr()]
    })
    await expect(t.orch.addThread('s1', 'octo/shop', 'T_1')).rejects.toThrow(
      'The worktree was removed'
    )
    expect((await t.orch.findings('s1')).findings).toEqual([])
  })

  it("adds a check whose log Sandtable can't read, saying why and where to look", async () => {
    const t = await ready()
    t.deps.failedLog.mockRejectedValue(
      new Error("Couldn't read the failed log: log\u202e not found\u200b")
    )
    expect(await t.orch.addCheck('s1', 'octo/shop', 503, 'build')).toEqual({
      id: expect.any(String),
      sessionId: 's1',
      source: 'check',
      ref: '503',
      title: 'build',
      text: "This check failed. Sandtable couldn't read its log: Couldn't read the failed log: log not found. Details: https://ci.example/503",
      checked: true
    })
    expect((await t.orch.addCheck('s1', 'octo/shop', 501, 'test')).text).toContain(
      'Details: https://github.com/octo/shop/pull/12'
    )
  })

  it('refuses a check the pull request does not have failing', async () => {
    const t = await ready()
    for (const [repo, job, name] of [
      ['octo/shop', 502, 'lint'],
      ['octo/shop', 999, 'test'],
      ['octo/shop', 501, 'lint'],
      ['octo/shop-web', 501, 'test']
    ] as const)
      await expect(t.orch.addCheck('s1', repo, job, name)).rejects.toThrow(
        'Not a failing check of this pull request'
      )
    expect(t.deps.failedLog).not.toHaveBeenCalled()
  })

  it("adds a thread in its repo's worktree with its start line's text from GitHub, once", async () => {
    const t = await ready()
    const added = await t.orch.addThread('s1', 'octo/shop', 'T_1')
    expect(added).toEqual({
      id: expect.any(String),
      sessionId: 's1',
      source: 'thread',
      ref: 'T_1',
      title: 'rev on src/a.ts',
      author: 'rev',
      text: 'Off by one.',
      worktree: t.main,
      path: 'src/a.ts',
      start: 2,
      end: 3,
      anchor: 'let i = 0',
      checked: true
    })
    expect(await t.orch.addThread('s1', 'octo/shop', 'T_1')).toEqual(added)
    expect(await t.orch.addThread('s1', 'octo/shop', 'T_2')).toEqual({
      id: expect.any(String),
      sessionId: 's1',
      source: 'thread',
      ref: 'T_2',
      title: 'rev',
      author: 'rev',
      text: 'Hm',
      worktree: t.main,
      checked: true
    })
    expect(await t.orch.addThread('s1', 'octo/shop', 'T_3')).not.toHaveProperty('anchor')
    await expect(t.orch.addThread('s1', 'octo/shop', 'T_9')).rejects.toThrow(
      'Not an open thread of this pull request'
    )
  })
})

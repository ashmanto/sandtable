import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Chat, Project, SessionRecord } from '../../shared/types'
import {
  inputOf,
  runTranscript,
  project,
  session,
  settle,
  setup,
  tempDir,
  ticket,
  timedOut,
  readLine,
  untilStopped
} from '../test/orchestrator'
import { folderError } from '../../shared/repo'
import { CHAT_RULES, chatArgs, chatPrompt, DRAFT_PROMPT, rewritePrompt } from './chat'
import { summaryArgs, summaryPrompt } from './summary'

vi.mock('../env/tools', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../env/tools')>()),
  stopChildren: vi.fn()
}))

beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }))
afterEach(() => {
  vi.useRealTimers()
})

describe('chat', () => {
  const answer = (result: string): { stdout: string; stderr: string; code: number } => ({
    stdout: `${JSON.stringify({ type: 'system', subtype: 'init' })}\n${JSON.stringify({ type: 'result', is_error: false, result })}\n`,
    stderr: '',
    code: 0
  })
  const key = 'octo/shop#147'
  const ready = async (
    opts: Parameters<typeof setup>[0] = {}
  ): Promise<ReturnType<typeof setup> & { repo: string }> => {
    const repo = tempDir('st-repo-')
    const base = (opts.projects?.[0] as Project | undefined) ?? project
    const t = setup({
      ...opts,
      projects: [{ ...base, repos: [{ github: 'octo/shop', path: repo }] }],
      folders: opts.folders ?? { [repo]: ['octo/shop'] }
    })
    await t.orch.reconnect()
    await t.orch.sync('p1')
    return { ...t, repo }
  }
  const comments = [{ author: 'ann', createdAt: '2026-10-03T00:00:00Z', body: 'Theme?' }]
  const args = (prompt: string, conversationId: string, resume: boolean): string[] =>
    chatArgs({ prompt, conversationId, resume, name: 'Sandtable chat #147', rules: CHAT_RULES })

  it('starts a conversation with the fresh body in the repo, as the project account', async () => {
    const dir = tempDir('st-work-')
    const t = await ready({
      accounts: [{ name: 'Work', dir }],
      projects: [{ ...project, claudeDir: dir }]
    })
    t.deps.ticketDetails.mockResolvedValueOnce({
      body: 'Fresh body',
      labels: [],
      comments,
      pullRequests: []
    })
    t.deps.claude.print.mockResolvedValueOnce(answer('In Settings.'))
    const chat = await t.orch.sendChat('p1', key, '  Where?  ')
    const [cwd, sent, env] = t.deps.claude.print.mock.calls[0]
    expect(cwd).toBe(t.repo)
    expect(env).toEqual({ CLAUDE_CONFIG_DIR: dir })
    expect(t.deps.ticketDetails).toHaveBeenCalledWith('octo/shop', 147)
    expect(sent).toEqual(
      args(
        chatPrompt(ticket({ body: 'Fresh body' }), comments, 'Where?', 'GitHub'),
        chat.conversationId,
        false
      )
    )
    expect(chat).toEqual({
      projectId: 'p1',
      ticketKey: key,
      conversationId: chat.conversationId,
      claudeDir: dir,
      cwd: t.repo,
      messages: [
        { role: 'user', text: 'Where?' },
        { role: 'assistant', text: 'In Settings.' }
      ]
    })
    expect(await t.orch.chat('p1', key)).toEqual({ chat, answering: false })
    expect(t.saved().chats).toEqual([chat])
  })

  it('stores the default account when the project has none', async () => {
    const t = await ready()
    t.deps.claude.print.mockResolvedValueOnce(answer('A'))
    const chat = await t.orch.sendChat('p1', key, 'One')
    expect(chat.claudeDir).toBe(t.claudeDir)
    expect(t.deps.claude.print.mock.calls[0][2]).toBeUndefined()
  })

  it('resumes the same conversation with only the message, markup kept', async () => {
    const t = await ready()
    t.deps.claude.print.mockResolvedValueOnce(answer('A')).mockResolvedValueOnce(answer('B'))
    const first = await t.orch.sendChat('p1', key, 'One')
    const second = await t.orch.sendChat('p1', key, 'Why does <TicketView> crash?\u0007')
    expect(t.deps.claude.print.mock.calls[1][1]).toEqual(
      args('Why does <TicketView> crash?', first.conversationId, true)
    )
    expect(t.deps.ticketDetails).toHaveBeenCalledTimes(1)
    expect(second.messages.map((m) => m.text)).toEqual([
      'One',
      'A',
      'Why does <TicketView> crash?\u0007',
      'B'
    ])
  })

  it("keeps resuming with the chat's own account and folder after the project switches", async () => {
    const work = tempDir('st-work-')
    const t = await ready({ accounts: [{ name: 'Work', dir: work }] })
    t.deps.claude.print.mockResolvedValue(answer('A'))
    await t.orch.sendChat('p1', key, 'One')
    const p = (await t.orch.listProjects())[0]
    await t.orch.saveProject({ ...p, claudeDir: work, repos: [{ ...p.repos[0], path: '/moved' }] })
    await t.orch.sendChat('p1', key, 'Two')
    const [cwd, , env] = t.deps.claude.print.mock.calls[1]
    expect(cwd).toBe(t.repo)
    expect(env).toBeUndefined()
  })

  it("asks for Start over when the chat's folder is gone", async () => {
    const t = await ready()
    t.deps.claude.print.mockResolvedValueOnce(answer('A'))
    await t.orch.sendChat('p1', key, 'One')
    rmSync(t.repo, { recursive: true })
    await expect(t.orch.sendChat('p1', key, 'Two')).rejects.toThrow(
      "This chat's repo folder is gone. Use Start over."
    )
    expect(t.deps.claude.print).toHaveBeenCalledTimes(1)
  })

  it('asks for Start over when Claude Code lost the conversation, and keeps the chat', async () => {
    const t = await ready()
    t.deps.claude.print.mockResolvedValueOnce(answer('A')).mockResolvedValueOnce({
      stdout: `${JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['No conversation found with session ID: c1'] })}\n`,
      stderr: '',
      code: 1
    })
    const first = await t.orch.sendChat('p1', key, 'One')
    await expect(t.orch.sendChat('p1', key, 'Two')).rejects.toThrow(
      "Claude Code no longer has this chat's conversation. Use Start over."
    )
    expect(await t.orch.chat('p1', key)).toEqual({ chat: first, answering: false })
  })

  it('saves nothing when a turn fails, and a retry starts a new conversation', async () => {
    const t = await ready()
    t.deps.claude.print
      .mockResolvedValueOnce({ stdout: '', stderr: 'Not logged in', code: 1 })
      .mockImplementationOnce(timedOut(180_000))
      .mockResolvedValueOnce(answer('A'))
    await expect(t.orch.sendChat('p1', key, 'Hi')).rejects.toThrow('Chat failed: Not logged in')
    await expect(t.orch.sendChat('p1', key, 'Hi')).rejects.toThrow(
      "Claude didn't answer within 3 minutes"
    )
    expect(await t.orch.chat('p1', key)).toEqual({ chat: null, answering: false })
    await t.orch.sendChat('p1', key, 'Hi')
    const ids = t.deps.claude.print.mock.calls.map((c) => c[1][c[1].indexOf('--session-id') + 1])
    expect(new Set(ids).size).toBe(3)
  })

  it('records the conversation on the first turn, so its tokens stay after Start over', async () => {
    const t = await ready()
    t.deps.claude.print.mockImplementation(async (_cwd, sent) => {
      runTranscript(t.claudeDir, sent, sent.includes('--resume') ? 2 : 1)
      return answer('A')
    })
    const chat = await t.orch.sendChat('p1', key, 'One')
    await t.orch.sendChat('p1', key, 'Two')
    await t.orch.clearChat('p1', key)
    expect(t.saved().runs).toEqual([
      { projectId: 'p1', ticketKey: key, claudeDir: t.claudeDir, id: chat.conversationId }
    ])
    expect(await inputOf(t, key)).toBe(3)
  })

  it("reports Claude's own error", async () => {
    const t = await ready()
    t.deps.claude.print.mockResolvedValueOnce({
      stdout: JSON.stringify({
        type: 'result',
        is_error: true,
        result: 'Credit balance is too low'
      }),
      stderr: '',
      code: 1
    })
    await expect(t.orch.sendChat('p1', key, 'Hi')).rejects.toThrow(
      'Chat failed: Credit balance is too low'
    )
  })

  it('pushes the steps so far for the ticket while Claude answers', async () => {
    const t = await ready()
    const pushed: unknown[] = []
    t.orch.onChatSteps((...args) => pushed.push(args))
    t.deps.claude.print.mockImplementationOnce(async (_cwd, _args, _env, _timeoutMs, live) => {
      live?.onStdout?.(readLine(`${t.repo}/src/a.ts`))
      return answer('A')
    })
    await t.orch.sendChat('p1', key, 'One')
    expect(pushed).toEqual([['p1', key, [{ tool: 'Read', target: 'src/a.ts', at: null }]]])
  })

  it('stops a running answer, saving no turn, and lets the next message start fresh', async () => {
    const t = await ready()
    t.deps.claude.print
      .mockImplementationOnce(untilStopped(readLine('/x')))
      .mockResolvedValueOnce(answer('A'))
    const sending = t.orch.sendChat('p1', key, 'One')
    await settle()
    await t.orch.stopChat('p1', key)
    await expect(sending).rejects.toThrow('Chat stopped')
    expect(await t.orch.chat('p1', key)).toEqual({ chat: null, answering: false })
    await t.orch.stopChat('p1', key)
    expect((await t.orch.sendChat('p1', key, 'One')).messages).toHaveLength(2)
  })

  it('refuses an empty or too long message, an unknown ticket, and a second message while one runs', async () => {
    const t = await ready()
    await expect(t.orch.sendChat('p1', key, '  ')).rejects.toThrow('Type a message first')
    await expect(t.orch.sendChat('p1', key, 'é'.repeat(50_001))).rejects.toThrow(
      'The message is too long'
    )
    await expect(t.orch.sendChat('p1', 'octo/shop#9', 'Hi')).rejects.toThrow('Unknown ticket')
    let finish = (): void => undefined
    t.deps.claude.print.mockImplementationOnce(
      () => new Promise((r) => (finish = () => r(answer('A'))))
    )
    const first = t.orch.sendChat('p1', key, 'One')
    await settle()
    expect(await t.orch.chat('p1', key)).toEqual({ chat: null, answering: true })
    await expect(t.orch.sendChat('p1', key, 'Two')).rejects.toThrow('Claude is still answering')
    await expect(t.orch.clearChat('p1', key)).rejects.toThrow('Claude is still answering')
    finish()
    await first
    t.deps.claude.print.mockResolvedValueOnce(answer('B'))
    await expect(t.orch.sendChat('p1', key, 'Two')).resolves.toBeTruthy()
    expect(t.deps.claude.print).toHaveBeenCalledTimes(2)
  })

  it('reports a change for the project when a turn ends, even a failed one', async () => {
    const t = await ready()
    const seen: string[] = []
    t.orch.onChange((id) => seen.push(id))
    t.deps.claude.print.mockResolvedValueOnce(answer('A'))
    await t.orch.sendChat('p1', key, 'One')
    expect(seen).toContain('p1')
    seen.length = 0
    t.deps.claude.print.mockResolvedValueOnce({ stdout: '', stderr: 'x', code: 1 })
    await expect(t.orch.sendChat('p1', key, 'Two')).rejects.toThrow()
    expect(seen).toContain('p1')
  })

  it('checks the folder before running claude', async () => {
    const t = await ready({ folders: {} })
    await expect(t.orch.sendChat('p1', key, 'Hi')).rejects.toThrow(folderError('octo/shop'))
    expect(t.deps.claude.print).not.toHaveBeenCalled()
  })

  it("doesn't save a chat for a project removed while Claude answers", async () => {
    const t = await ready()
    let finish = (): void => undefined
    t.deps.claude.print.mockImplementationOnce(
      () => new Promise((r) => (finish = () => r(answer('A'))))
    )
    const turn = t.orch.sendChat('p1', key, 'One')
    await settle()
    await t.orch.removeProject('p1')
    finish()
    await expect(turn).rejects.toThrow()
    expect(t.saved().chats).toEqual([])
  })

  it('keeps the previous chat when a resumed turn fails', async () => {
    const t = await ready()
    t.deps.claude.print
      .mockResolvedValueOnce(answer('A'))
      .mockResolvedValueOnce({ stdout: '', stderr: 'Not logged in', code: 1 })
    const first = await t.orch.sendChat('p1', key, 'One')
    await expect(t.orch.sendChat('p1', key, 'Two')).rejects.toThrow('Chat failed: Not logged in')
    expect(await t.orch.chat('p1', key)).toEqual({ chat: first, answering: false })
    expect(t.saved().chats).toEqual([first])
  })

  it("doesn't keep an exchange whose save failed, so sending it again doesn't double it", async () => {
    const t = await ready()
    t.deps.claude.print.mockResolvedValue(answer('A'))
    const first = await t.orch.sendChat('p1', key, 'One')
    t.deps.store.save.mockRejectedValueOnce(new Error('disk full'))
    await expect(t.orch.sendChat('p1', key, 'Two')).rejects.toThrow('disk full')
    expect((await t.orch.chat('p1', key)).chat).toEqual(first)
    const again = await t.orch.sendChat('p1', key, 'Two')
    expect(again.messages.map((m) => m.text)).toEqual(['One', 'A', 'Two', 'A'])
  })

  it('drafts a comment in the same conversation, and keeps it without invisible characters', async () => {
    const t = await ready()
    await expect(t.orch.draftComment('p1', key)).rejects.toThrow('Ask Claude something first')
    t.deps.claude.print
      .mockResolvedValueOnce(answer('A'))
      .mockResolvedValueOnce(answer('  Dr\u{E0041}a​ft  '))
    const chat = await t.orch.sendChat('p1', key, 'One')
    expect(await t.orch.draftComment('p1', key)).toBe('Draft')
    expect(t.deps.claude.print.mock.calls[1][1]).toEqual(
      args(DRAFT_PROMPT, chat.conversationId, true)
    )
    const after = (await t.orch.chat('p1', key)).chat
    expect(after?.messages).toEqual(chat.messages)
    expect(after?.draft).toBe('Draft')
    expect(t.saved().chats[0].draft).toBe('Draft')
  })

  it('keeps the draft when another message is sent', async () => {
    const t = await ready()
    t.deps.claude.print.mockResolvedValue(answer('Draft'))
    await t.orch.sendChat('p1', key, 'One')
    await t.orch.draftComment('p1', key)
    expect((await t.orch.sendChat('p1', key, 'Two')).draft).toBe('Draft')
  })

  it('keeps a draft discarded while a message is answered discarded', async () => {
    const t = await ready()
    t.deps.claude.print.mockResolvedValue(answer('Draft'))
    await t.orch.sendChat('p1', key, 'One')
    await t.orch.draftComment('p1', key)
    let finish = (): void => undefined
    t.deps.claude.print.mockImplementationOnce(
      () => new Promise((r) => (finish = () => r(answer('B'))))
    )
    const turn = t.orch.sendChat('p1', key, 'Two')
    await settle()
    await t.orch.discardDraft('p1', key)
    finish()
    expect((await turn).draft).toBeUndefined()
  })

  it('posts a comment without invisible characters and clears the draft', async () => {
    const t = await ready()
    t.deps.claude.print.mockResolvedValue(answer('Draft'))
    await t.orch.sendChat('p1', key, 'One')
    await t.orch.draftComment('p1', key)
    await t.orch.postComment('p1', key, '  Do\u{E0041}ne​.  ')
    expect(t.deps.postComment).toHaveBeenCalledWith('octo/shop', 147, 'Done.')
    expect((await t.orch.chat('p1', key)).chat?.draft).toBeUndefined()
    expect(t.saved().chats[0].draft).toBeUndefined()
    await expect(t.orch.postComment('p1', 'other/repo#1', 'x')).rejects.toThrow(
      'Repo not in this project'
    )
    await expect(t.orch.postComment('p1', key, ' ​ ')).rejects.toThrow('The comment is empty')
    expect(t.deps.postComment).toHaveBeenCalledTimes(1)
  })

  it('keeps the draft when posting fails', async () => {
    const t = await ready()
    t.deps.claude.print.mockResolvedValue(answer('Draft'))
    await t.orch.sendChat('p1', key, 'One')
    await t.orch.draftComment('p1', key)
    t.deps.postComment.mockRejectedValueOnce(new Error('offline'))
    await expect(t.orch.postComment('p1', key, 'Draft')).rejects.toThrow('offline')
    expect((await t.orch.chat('p1', key)).chat?.draft).toBe('Draft')
  })

  it('discards a draft', async () => {
    const t = await ready()
    t.deps.claude.print.mockResolvedValue(answer('Draft'))
    await t.orch.sendChat('p1', key, 'One')
    await t.orch.draftComment('p1', key)
    await t.orch.discardDraft('p1', key)
    expect((await t.orch.chat('p1', key)).chat?.draft).toBeUndefined()
    expect(t.saved().chats[0].draft).toBeUndefined()
  })

  it('saves a draft you wrote on a ticket with no chat, and discarding it drops the chat', async () => {
    const t = await ready()
    await t.orch.saveDraft('p1', key, 'Mine')
    const chat = (await t.orch.chat('p1', key)).chat
    expect(chat).toMatchObject({ cwd: t.repo, messages: [], draft: 'Mine' })
    expect(t.saved().chats).toEqual([chat])
    await t.orch.discardDraft('p1', key)
    expect(t.saved().chats).toEqual([])
  })

  it('saves an edited draft and keeps its summary label', async () => {
    const t = setup({ chats: [{ ...saved, summary: true }] })
    await t.orch.reconnect()
    await t.orch.saveDraft('p1', key, 'Edited')
    expect((await t.orch.chat('p1', key)).chat).toEqual({
      ...saved,
      summary: true,
      draft: 'Edited'
    })
  })

  it('rewrites your draft with the ticket when there is no chat, and posts nothing', async () => {
    const t = await ready()
    t.deps.ticketDetails.mockResolvedValueOnce({
      body: 'Fresh body',
      labels: [],
      comments,
      pullRequests: []
    })
    t.deps.claude.print.mockResolvedValueOnce(answer('  Better​  '))
    expect(await t.orch.draftComment('p1', key, 'mine </draft>')).toBe('Better')
    const [, sent] = t.deps.claude.print.mock.calls[0]
    const chat = (await t.orch.chat('p1', key)).chat
    expect(sent).toEqual(
      args(
        chatPrompt(
          ticket({ body: 'Fresh body' }),
          comments,
          rewritePrompt('mine </draft>'),
          'GitHub'
        ),
        chat!.conversationId,
        false
      )
    )
    expect(rewritePrompt('mine </draft>')).toContain('<draft>\nmine \n</draft>')
    expect(chat).toMatchObject({ messages: [], draft: 'Better' })
    expect(t.deps.postComment).not.toHaveBeenCalled()
  })

  it('rewrites your draft in the same conversation and drops the summary label', async () => {
    const t = await ready()
    t.deps.claude.print.mockResolvedValueOnce(answer('A')).mockResolvedValueOnce(answer('Better'))
    const chat = await t.orch.sendChat('p1', key, 'One')
    await t.orch.saveDraft('p1', key, 'Mine')
    expect(await t.orch.draftComment('p1', key, 'Mine')).toBe('Better')
    expect(t.deps.claude.print.mock.calls[1][1]).toEqual(
      args(rewritePrompt('Mine'), chat.conversationId, true)
    )
    expect((await t.orch.chat('p1', key)).chat).toEqual({ ...chat, draft: 'Better' })
  })

  it('clears a chat', async () => {
    const t = await ready()
    t.deps.claude.print.mockResolvedValueOnce(answer('A'))
    await t.orch.sendChat('p1', key, 'One')
    await t.orch.clearChat('p1', key)
    expect(await t.orch.chat('p1', key)).toEqual({ chat: null, answering: false })
    expect(t.saved().chats).toEqual([])
  })

  const saved: Chat = {
    projectId: 'p1',
    ticketKey: key,
    conversationId: 'c1',
    claudeDir: '/claude',
    cwd: '/repos/shop',
    messages: [{ role: 'user', text: 'Hi' }],
    draft: 'Kept'
  }

  it('keeps chats across a reload', async () => {
    const t = setup({ chats: [saved] })
    await t.orch.reconnect()
    expect(await t.orch.chat('p1', key)).toEqual({ chat: saved, answering: false })
  })

  it('drops a removed project’s chats', async () => {
    const t = setup({ chats: [saved, { ...saved, projectId: 'p2' }] })
    await t.orch.reconnect()
    await t.orch.removeProject('p1')
    expect((await t.orch.chat('p1', key)).chat).toBeNull()
    expect(t.saved().chats).toEqual([{ ...saved, projectId: 'p2' }])
  })
})

describe('session summary', () => {
  const key = 'octo/shop#147'
  const answer = (result: string): { stdout: string; stderr: string; code: number } => ({
    stdout: JSON.stringify({ type: 'result', is_error: false, result }),
    stderr: '',
    code: 0
  })
  const untilChanged = (t: ReturnType<typeof setup>, done: () => Promise<boolean>): Promise<void> =>
    new Promise((resolve) => {
      const check = async (): Promise<void> => {
        if (!(await done())) return
        off()
        resolve()
      }
      const off = t.orch.onChange(() => void check())
    })
  const holdPrint = (
    t: ReturnType<typeof setup>,
    result: string
  ): { called: Promise<void>; finish: () => void } => {
    let finish = (): void => undefined
    const called = new Promise<void>((resolve) =>
      t.deps.claude.print.mockImplementationOnce(() => {
        resolve()
        return new Promise((r) => (finish = () => r(answer(result))))
      })
    )
    return { called, finish: () => finish() }
  }
  const ready = async (
    over: Partial<SessionRecord> = {},
    chats?: Chat[]
  ): Promise<ReturnType<typeof setup> & { repo: string }> => {
    const repo = tempDir('st-repo-')
    const t = setup({
      projects: [{ ...project, repos: [{ github: 'octo/shop', path: repo }] }],
      folders: { [repo]: ['octo/shop'] },
      sessions: [session(over)],
      chats
    })
    t.live.add(session(over).tmuxName)
    await t.orch.reconnect()
    await t.orch.sync('p1')
    return { ...t, repo }
  }
  const writeTranscript = (claudeDir: string, id = 's1'): void => {
    const folder = join(claudeDir, 'projects', 'x')
    mkdirSync(folder, { recursive: true })
    writeFileSync(
      join(folder, `${id}.jsonl`),
      [
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'Add the toggle' } }),
        JSON.stringify({
          type: 'assistant',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Opened PR #9' }] }
        })
      ].join('\n')
    )
  }
  const expectedPrompt = summaryPrompt(
    'Dark mode toggle\nhttps://github.com/octo/shop/issues/147',
    [
      { kind: 'user', text: 'Add the toggle' },
      { kind: 'assistant', text: 'Opened PR #9' }
    ]
  )
  const draftOf = async (t: ReturnType<typeof setup>): Promise<Chat | null> =>
    (await t.orch.chat('p1', key)).chat

  it('drafts a summary when a ticket session finishes, records the run, and posts nothing', async () => {
    const t = await ready()
    writeTranscript(t.claudeDir)
    t.deps.claude.print.mockResolvedValueOnce(answer('  Sum​mary  '))
    const drafted = untilChanged(t, async () => !!(await draftOf(t))?.draft)
    await t.orch.end('s1')
    await drafted
    const [cwd, sent, env] = t.deps.claude.print.mock.calls[0]
    const runId = sent[sent.indexOf('--session-id') + 1]
    expect(cwd).toBe(t.repo)
    expect(env).toBeUndefined()
    expect(sent).toEqual(summaryArgs(expectedPrompt, runId, '#147'))
    expect(await draftOf(t)).toMatchObject({ draft: 'Summary', summary: true, messages: [] })
    expect(t.saved().runs).toEqual([
      { projectId: 'p1', ticketKey: key, claudeDir: t.claudeDir, id: runId }
    ])
    expect(t.deps.postComment).not.toHaveBeenCalled()
  })

  it("runs in the ticket's repo folder, not the worktree that End and remove deletes", async () => {
    const wt = tempDir('st-wt-')
    const t = await ready({ worktrees: [wt] })
    writeTranscript(t.claudeDir)
    t.deps.claude.print.mockResolvedValueOnce(answer('S'))
    await t.orch.summarize('s1')
    expect(t.deps.claude.print.mock.calls[0][0]).toBe(t.repo)
    t.deps.githubReposOf.mockResolvedValueOnce([])
    await expect(t.orch.summarize('s1')).rejects.toThrow(folderError('octo/shop'))
  })

  it("doesn't replace an open draft when the session finishes, but Summarize session does", async () => {
    const chat: Chat = {
      projectId: 'p1',
      ticketKey: key,
      conversationId: 'c1',
      claudeDir: '/claude',
      cwd: '/repos/shop',
      messages: [{ role: 'user', text: 'Hi' }],
      draft: 'Mine'
    }
    const t = await ready({}, [chat])
    writeTranscript(t.claudeDir)
    t.deps.claude.print.mockResolvedValue(answer('Summary'))
    await t.orch.end('s1')
    await settle()
    expect(t.deps.claude.print).not.toHaveBeenCalled()
    expect((await draftOf(t))?.draft).toBe('Mine')
    await t.orch.summarize('s1')
    expect(await draftOf(t)).toEqual({ ...chat, draft: 'Summary', summary: true })
  })

  it('skips a finished session with no transcript without an error', async () => {
    const t = await ready()
    await t.orch.end('s1')
    await vi.waitFor(async () => expect((await t.orch.chat('p1', key)).answering).toBe(false))
    expect(t.deps.claude.print).not.toHaveBeenCalled()
    expect(await t.orch.chat('p1', key)).toEqual({ chat: null, answering: false })
    await expect(t.orch.summarize('s1')).rejects.toThrow(
      "Claude Code hasn't written this session's conversation"
    )
  })

  it('gives a session without a ticket no summary', async () => {
    const t = await ready({ ticketKey: undefined, name: 'Spike' })
    writeTranscript(t.claudeDir)
    await t.orch.end('s1')
    await settle()
    await expect(t.orch.summarize('s1')).rejects.toThrow('Only a ticket session has a summary')
    expect(t.deps.claude.print).not.toHaveBeenCalled()
  })

  it('shows a failed summary and keeps the earlier draft, until the next one works', async () => {
    const t = await ready()
    writeTranscript(t.claudeDir)
    t.deps.claude.print.mockResolvedValueOnce(answer('First'))
    await t.orch.summarize('s1')
    t.deps.claude.print.mockImplementationOnce(timedOut(180_000))
    await expect(t.orch.summarize('s1')).rejects.toThrow("Summary didn't finish within 3 minutes")
    expect(await t.orch.chat('p1', key)).toMatchObject({
      chat: { draft: 'First' },
      answering: false,
      failed: "Summary didn't finish within 3 minutes"
    })
    t.deps.claude.print.mockResolvedValueOnce(answer('Second'))
    await t.orch.summarize('s1')
    const after = await t.orch.chat('p1', key)
    expect(after.failed).toBeUndefined()
    expect(after.chat?.draft).toBe('Second')
  })

  it('says it is summarizing and blocks a chat turn while it runs', async () => {
    const t = await ready()
    writeTranscript(t.claudeDir)
    const { called, finish } = holdPrint(t, 'S')
    const running = t.orch.summarize('s1')
    await called
    expect(await t.orch.chat('p1', key)).toEqual({
      chat: null,
      answering: true,
      summarizing: true
    })
    await expect(t.orch.sendChat('p1', key, 'Hi')).rejects.toThrow('Claude is still answering')
    finish()
    await running
    expect((await t.orch.chat('p1', key)).answering).toBe(false)
  })

  it('starts a fresh chat beside a summary, keeps it, and Draft with Claude replaces its label', async () => {
    const t = await ready()
    writeTranscript(t.claudeDir)
    t.deps.claude.print.mockResolvedValueOnce(answer('S'))
    await t.orch.summarize('s1')
    await expect(t.orch.draftComment('p1', key)).rejects.toThrow('Ask Claude something first')
    t.deps.claude.print.mockResolvedValueOnce(answer('A')).mockResolvedValueOnce(answer('D'))
    const chat = await t.orch.sendChat('p1', key, 'Why?')
    expect(t.deps.claude.print.mock.calls[1][1]).toEqual(
      chatArgs({
        prompt: chatPrompt(ticket({ body: 'b' }), [], 'Why?', 'GitHub'),
        conversationId: chat.conversationId,
        resume: false,
        name: 'Sandtable chat #147',
        rules: CHAT_RULES
      })
    )
    expect(chat).toMatchObject({ draft: 'S', summary: true, cwd: t.repo })
    await t.orch.draftComment('p1', key)
    expect((await draftOf(t))?.summary).toBeUndefined()
  })

  it('clears the label when the summary is posted or discarded', async () => {
    const t = await ready()
    writeTranscript(t.claudeDir)
    t.deps.claude.print.mockResolvedValue(answer('S'))
    await t.orch.summarize('s1')
    await t.orch.postComment('p1', key, 'S')
    expect(t.deps.postComment).toHaveBeenCalledWith('octo/shop', 147, 'S')
    expect((await draftOf(t))?.summary).toBeUndefined()
    expect(await draftOf(t)).toBeNull()
    await t.orch.summarize('s1')
    await t.orch.discardDraft('p1', key)
    expect(await draftOf(t)).toBeNull()
    expect(t.saved().chats).toEqual([])
  })

  it("doesn't summarize when Remote Control restarts the session", async () => {
    const wt = tempDir('st-wt-')
    const t = await ready({ state: 'needsYou', worktrees: [wt], remoteControl: true })
    writeTranscript(t.claudeDir)
    await t.orch.setRemoteControl('s1', false)
    await settle()
    expect(t.deps.claude.print).not.toHaveBeenCalled()
  })

  it('shows why Summarize session did nothing while Claude is answering', async () => {
    const t = await ready()
    writeTranscript(t.claudeDir)
    const { called, finish } = holdPrint(t, 'A')
    const turn = t.orch.sendChat('p1', key, 'Hi')
    await called
    await expect(t.orch.summarize('s1')).rejects.toThrow('Claude is still answering')
    finish()
    await turn
    expect((await t.orch.chat('p1', key)).failed).toBe('Claude is still answering')
  })

  it('sends the transcript without unsafe characters or known token shapes', async () => {
    const t = await ready()
    const folder = join(t.claudeDir, 'projects', 'x')
    mkdirSync(folder, { recursive: true })
    writeFileSync(
      join(folder, 's1.jsonl'),
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: 'Use ghp_abcdefghijklmnopqrstuvwxyz0123456789\u{E0041}' }
      })
    )
    t.deps.claude.print.mockResolvedValueOnce(answer('S'))
    await t.orch.summarize('s1')
    const prompt = t.deps.claude.print.mock.calls[0][1].at(-1)
    expect(prompt).toContain('You: Use [redacted]')
    expect(prompt).not.toContain('ghp_')
    expect(prompt).not.toContain('\u{E0041}')
  })
})

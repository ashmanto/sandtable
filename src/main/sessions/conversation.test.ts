import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tempDirs } from '../test/tempDirs'
import {
  conversationParser,
  findConversation,
  parseConversation,
  readLastEntries,
  waitingTool
} from './conversation'

const user = (content: unknown, over: object = {}): object => ({
  type: 'user',
  message: { role: 'user', content },
  ...over
})
const assistant = (content: unknown[]): object => ({
  type: 'assistant',
  message: { role: 'assistant', content }
})
const toolUse = (id: string, name: string, input: object): object => ({
  type: 'tool_use',
  id,
  name,
  input
})
const result = (id: string, content: unknown, isError?: boolean): object => ({
  type: 'tool_result',
  tool_use_id: id,
  content,
  ...(isError !== undefined && { is_error: isError })
})

const queued = (attachment: object): object => ({
  type: 'attachment',
  isSidechain: false,
  attachment: { type: 'queued_command', ...attachment }
})

describe('parseConversation', () => {
  it('keeps what you typed, the replies, and each tool call with its result', () => {
    const lines = [
      user('Fix the bug'),
      user('Caveat: injected', { isMeta: true }),
      user('<task-notification>\n<task-id>x</task-id>\n</task-notification>'),
      user(
        '<command-name>/clear</command-name>\n  <command-message>clear</command-message>\n  <command-args></command-args>'
      ),
      user('From a subagent', { isSidechain: true }),
      { type: 'system', content: 'hook ran' },
      'not json {',
      assistant([
        { type: 'thinking', thinking: 'hmm' },
        { type: 'text', text: 'Looking now.' },
        toolUse('t1', 'Bash', { command: 'ls', description: 'List files' }),
        toolUse('t2', 'Read', { file_path: '/a.ts' }),
        toolUse('t3', 'Grep', { pattern: 'foo' }),
        toolUse('t4', 'TodoWrite', { todos: [] }),
        toolUse('t5', 'ToolSearch', { query: 'select:Read' })
      ]),
      user([
        result('t1', 'a.ts\nb.ts', false),
        result('t2', [
          { type: 'text', text: 'line 1' },
          { type: 'image', source: {} },
          { type: 'text', text: 'line 2' }
        ]),
        result('t3', 'No such file', true),
        result('t5', [{ type: 'tool_reference', tool_name: 'Read' }])
      ]),
      user([{ type: 'text', text: 'Thanks' }]),
      user('This session is being continued from a previous conversation.', {
        isCompactSummary: true
      }),
      queued({ commandMode: 'prompt', prompt: 'Also check the tests' }),
      queued({ commandMode: 'prompt', prompt: 'From a peer', isMeta: true }),
      queued({
        commandMode: 'task-notification',
        prompt: '<task-notification>\n<task-id>y</task-id>\n</task-notification>'
      }),
      queued({ commandMode: 'prompt', prompt: '<system-reminder>x</system-reminder>' })
    ]
    const text = lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n')

    expect(parseConversation(text)).toEqual([
      { kind: 'user', text: 'Fix the bug' },
      { kind: 'assistant', text: 'Looking now.' },
      {
        kind: 'tool',
        name: 'Bash',
        summary: 'List files',
        input: JSON.stringify({ command: 'ls', description: 'List files' }, null, 2),
        output: 'a.ts\nb.ts',
        error: false
      },
      {
        kind: 'tool',
        name: 'Read',
        summary: '/a.ts',
        input: JSON.stringify({ file_path: '/a.ts' }, null, 2),
        output: 'line 1\n[image]\nline 2',
        error: false
      },
      {
        kind: 'tool',
        name: 'Grep',
        summary: 'foo',
        input: JSON.stringify({ pattern: 'foo' }, null, 2),
        output: 'No such file',
        error: true
      },
      {
        kind: 'tool',
        name: 'TodoWrite',
        summary: '',
        input: JSON.stringify({ todos: [] }, null, 2),
        output: null,
        error: false
      },
      {
        kind: 'tool',
        name: 'ToolSearch',
        summary: '',
        input: JSON.stringify({ query: 'select:Read' }, null, 2),
        output: '',
        error: false
      },
      { kind: 'user', text: 'Thanks' },
      { kind: 'user', text: 'Also check the tests' }
    ])
  })

  it('marks an interrupt as stopped', () => {
    const lines = [
      user('[Request interrupted by user]'),
      user([{ type: 'text', text: '[Request interrupted by user for tool use]' }]),
      user('Fix it')
    ]
    expect(parseConversation(lines.map((l) => JSON.stringify(l)).join('\n'))).toEqual([
      { kind: 'user', text: '[Request interrupted by user]', stopped: true },
      { kind: 'user', text: '[Request interrupted by user for tool use]', stopped: true },
      { kind: 'user', text: 'Fix it' }
    ])
  })

  it('keeps a message that mixes tags and text, quickly', () => {
    const list = '<li>x</li>\n'.repeat(1000) + 'done'
    const mixed = '<b>hi</b> what does this do? <i>x</i>'
    const unclosed = '<a><b>'.repeat(50_000) + '</c>'
    const open = '<a '.repeat(50_000)
    const unended = '<' + 'a'.repeat(50_000)
    const text = [list, mixed, unclosed, open, unended]
      .map((t) => JSON.stringify(user(t)))
      .join('\n')
    const started = performance.now()
    expect(parseConversation(text)).toEqual([
      { kind: 'user', text: list },
      { kind: 'user', text: mixed },
      { kind: 'user', text: unclosed },
      { kind: 'user', text: open },
      { kind: 'user', text: unended }
    ])
    expect(performance.now() - started).toBeLessThan(100)
  })

  it('cuts a long input and output at 20,000 characters', () => {
    const long = 'x'.repeat(25_000)
    const text = [
      assistant([toolUse('t1', 'Write', { content: long })]),
      user([result('t1', long)])
    ]
      .map((l) => JSON.stringify(l))
      .join('\n')
    const [entry] = parseConversation(text)
    const cut = '\n[Cut at 20,000 characters]'
    expect(entry).toMatchObject({ output: 'x'.repeat(20_000) + cut })
    expect(entry.kind === 'tool' && entry.input.endsWith(cut)).toBe(true)
    expect(entry.kind === 'tool' && entry.input.length).toBe(20_000 + cut.length)
  })
})

describe('findConversation', () => {
  const tempDir = tempDirs()
  const claudeDir = (): string => tempDir('st-claude-')

  it('finds the file in any project folder', async () => {
    const dir = claudeDir()
    mkdirSync(join(dir, 'projects', 'a'), { recursive: true })
    mkdirSync(join(dir, 'projects', 'b'))
    writeFileSync(join(dir, 'projects', 'b', 's1.jsonl'), '')
    expect(await findConversation(dir, 's1')).toBe(join(dir, 'projects', 'b', 's1.jsonl'))
  })

  it('returns null when no folder has the file', async () => {
    const dir = claudeDir()
    mkdirSync(join(dir, 'projects', 'a'), { recursive: true })
    expect(await findConversation(dir, 's1')).toBeNull()
  })

  it('returns null when there is no projects folder', async () => {
    expect(await findConversation(claudeDir(), 's1')).toBeNull()
  })
})

describe('conversationParser', () => {
  const jsonl = (rows: object[]): string => rows.map((r) => JSON.stringify(r)).join('\n') + '\n'

  it('parses across reads', () => {
    const text = jsonl([
      user('Fix it'),
      assistant([toolUse('t1', 'Bash', { command: 'ls' })]),
      user([result('t1', 'ok')])
    ])
    const p = conversationParser()
    p.add(text.slice(0, 40))
    p.add(text.slice(40))
    expect(p.entries).toEqual(parseConversation(text))
    expect(p.entries).toHaveLength(2)
  })

  it('reports the first changed entry', () => {
    const p = conversationParser()
    expect(p.add(jsonl([user('a'), assistant([toolUse('t1', 'Bash', { command: 'ls' })])]))).toBe(0)
    expect(p.add(jsonl([user('b')]))).toBe(2)
    expect(p.add(jsonl([user([result('t1', 'ok')])]))).toBe(1)
    expect(p.add('')).toBe(3)
  })

  it('adds compact entries', () => {
    const p = conversationParser()
    p.add(
      jsonl([
        {
          type: 'system',
          subtype: 'compact_boundary',
          timestamp: '2026-10-30T10:00:00.000Z',
          compactMetadata: { trigger: 'auto' }
        }
      ])
    )
    expect(p.entries).toEqual([
      { kind: 'compact', at: '2026-10-30T10:00:00.000Z', trigger: 'auto' }
    ])
    expect(p.facts.compactions).toEqual(['2026-10-30T10:00:00.000Z'])
  })

  it('keeps the latest to-dos', () => {
    const p = conversationParser()
    const write = (todos: object[]): object => assistant([toolUse('t', 'TodoWrite', { todos })])
    p.add(jsonl([write([{ content: 'a', status: 'pending' }])]))
    p.add(jsonl([write([{ content: 'b', status: 'completed', activeForm: 'Doing b' }])]))
    expect(p.facts.todos).toEqual([{ content: 'b', status: 'completed' }])
  })

  const local = (content: string): object => ({
    type: 'system',
    subtype: 'local_command',
    content,
    isMeta: false
  })
  const named = (name: string, args = ''): string =>
    `<command-name>/${name}</command-name>\n            <command-message>${name}</command-message>\n            <command-args>${args}</command-args>`

  it('adds a command you ran with its output, without color codes', () => {
    const p = conversationParser()
    p.add(jsonl([local(named('context'))]))
    expect(
      p.add(
        jsonl([
          local(
            '<local-command-stdout> \u001b[1mContext Usage\u001b[22m\n\u001b[38;5;244m⛁ \u001b[39m  Haiku 5.5</local-command-stdout>'
          )
        ])
      )
    ).toBe(0)
    expect(p.entries).toEqual([
      { kind: 'command', name: '/context', args: '', output: ' Context Usage\n⛁   Haiku 5.5' }
    ])
  })

  it('reads commands written as user rows and skips the caveat', () => {
    const entries = parseConversation(
      jsonl([
        user(
          '<local-command-caveat>The command below was run directly in Claude Code…</local-command-caveat>',
          { isMeta: true }
        ),
        user(named('effort')),
        user('<local-command-stdout>Cancelled</local-command-stdout>'),
        user('<local-command-stderr>Oops</local-command-stderr>'),
        user(named('skill-doctor')),
        user('<local-command-stdout>(no content)</local-command-stdout>')
      ])
    )
    expect(entries).toEqual([
      { kind: 'command', name: '/effort', args: '', output: 'Cancelled\nOops' },
      { kind: 'command', name: '/skill-doctor', args: '', output: '' }
    ])
  })

  it('adds a skill with its arguments and no output', () => {
    const entries = parseConversation(
      jsonl([
        user(
          '<command-message>simplify</command-message>\n<command-name>/simplify</command-name>\n<command-args> src/main </command-args>'
        )
      ])
    )
    expect(entries).toEqual([
      { kind: 'command', name: '/simplify', args: 'src/main', output: null }
    ])
  })

  it('leaves out /clear and /compact and their output, and output with no command', () => {
    const entries = parseConversation(
      jsonl([
        local('<local-command-stdout>Orphan</local-command-stdout>'),
        local(named('context')),
        local('<local-command-stdout>Usage</local-command-stdout>'),
        user(named('compact')),
        user('<local-command-stdout>Compacted (ctrl+o to see full summary)</local-command-stdout>'),
        local(named('clear')),
        local('<local-command-stdout>Cleared</local-command-stdout>')
      ])
    )
    expect(entries).toEqual([{ kind: 'command', name: '/context', args: '', output: 'Usage' }])
  })

  it('reads output in the command row, and only right after its command', () => {
    const entries = parseConversation(
      jsonl([
        local(`${named('color')}<local-command-stdout>Orange</local-command-stdout>`),
        local(named('context')),
        user('Hello'),
        local('<local-command-stdout>Late</local-command-stdout>')
      ])
    )
    expect(entries).toEqual([
      { kind: 'command', name: '/color', args: '', output: 'Orange' },
      { kind: 'command', name: '/context', args: '', output: null },
      { kind: 'user', text: 'Hello' }
    ])
  })

  it('cuts long command output at 20,000 characters', () => {
    const [entry] = parseConversation(
      jsonl([
        local(named('context')),
        local(`<local-command-stdout>${'x'.repeat(25_000)}</local-command-stdout>`)
      ])
    )
    expect(entry).toMatchObject({ output: 'x'.repeat(20_000) + '\n[Cut at 20,000 characters]' })
  })

  it('reads the permission mode', () => {
    const p = conversationParser()
    expect(p.facts.permissionMode).toBeNull()
    p.add(jsonl([{ type: 'permission-mode', permissionMode: 'auto', sessionId: 's' }]))
    expect(p.facts.permissionMode).toBe('auto')
  })
})

describe('waitingTool', () => {
  it('skips a call answered with no text, such as ToolSearch, for the one still waiting', () => {
    const entries = parseConversation(
      [
        assistant([
          toolUse('t1', 'ToolSearch', { query: 'select:ExitPlanMode' }),
          toolUse('t2', 'ExitPlanMode', { plan: 'x' })
        ]),
        user([{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'tool_reference' }] }])
      ]
        .map((r) => JSON.stringify(r))
        .join('\n')
    )
    expect(waitingTool(entries)?.name).toBe('ExitPlanMode')
  })
})

describe('readLastEntries', () => {
  const tempDir = tempDirs()
  const write = (rows: object[]): string => {
    const file = join(tempDir('st-tail-'), 's.jsonl')
    writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
    return file
  }
  const ask = assistant([toolUse('q', 'AskUserQuestion', { questions: [] })])

  it('finds the waiting call in a transcript bigger than the tail', async () => {
    const filler = Array.from({ length: 50 }, (_, i) => user(`message ${i} ${'x'.repeat(100)}`))
    const file = write([...filler, assistant([{ type: 'text', text: 'Asking.' }]), ask])
    const entries = await readLastEntries(file, 1024)
    expect(entries.length).toBeLessThan(10)
    expect(waitingTool(entries)?.name).toBe('AskUserQuestion')
  })

  it('reads further back until the tool calls that end the file are whole', async () => {
    const calls = Array.from({ length: 30 }, (_, i) => [
      assistant([toolUse(`t${i}`, 'Bash', { command: `echo ${'y'.repeat(100)}` })]),
      user([result(`t${i}`, 'ok')])
    ]).flat()
    const big = assistant([toolUse('w', 'Write', { content: 'z'.repeat(5000) })])
    expect(waitingTool(await readLastEntries(write([user('Start'), big]), 1024))?.name).toBe(
      'Write'
    )
    const long = write([user('Start'), ...calls, ask])
    const entries = await readLastEntries(long, 1024)
    expect(entries[0]).toMatchObject({ kind: 'user' })
    expect(waitingTool(entries)?.name).toBe('AskUserQuestion')
  })
})

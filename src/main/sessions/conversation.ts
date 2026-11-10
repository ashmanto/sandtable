import { existsSync } from 'node:fs'
import { open, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { parseJson } from '../../shared/json'
import type { ConversationEntry, Todo, TranscriptFacts } from '../../shared/types'

/** A parsed JSON object from a transcript line. */
type Row = Record<string, unknown>
type ToolEntry = Extract<ConversationEntry, { kind: 'tool' }>
type CommandEntry = Extract<ConversationEntry, { kind: 'command' }>

const LIMIT = 20_000
const OPEN_TAG = /\s*<([\w-]+)(?![\w-])[^>]*>/y
const NOT_COMMANDS = ['/clear', '/compact']
const SUMMARY_KEYS = ['description', 'command', 'file_path', 'pattern', 'url', 'skill', 'prompt']

/** Whether `v` is a plain JSON object. */
export const isRow = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v)
/** The object blocks of a message's content, or none when it isn't an array. */
export const blocks = (v: unknown): Row[] => (Array.isArray(v) ? v.filter(isRow) : [])
const cut = (s: string): string =>
  s.length > LIMIT ? `${s.slice(0, LIMIT)}\n[Cut at 20,000 characters]` : s
const tagText = (text: string, tag: string): string | null =>
  new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text)?.[1] ?? null
const tagsOnly = (text: string): boolean => {
  let i = 0
  for (;;) {
    OPEN_TAG.lastIndex = i
    const open = OPEN_TAG.exec(text)
    if (!open) return text.slice(i).trim() === ''
    const close = text.indexOf(`</${open[1]}>`, OPEN_TAG.lastIndex)
    if (close === -1) return false
    i = close + open[1].length + 3
  }
}
/** Whether `v` is text a person typed, not only tags Claude Code injected. */
export const typed = (v: unknown): v is string => typeof v === 'string' && !tagsOnly(v)

const resultText = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : blocks(content)
        .flatMap((b) =>
          b.type === 'image' ? ['[image]'] : typeof b.text === 'string' ? [b.text] : []
        )
        .join('\n')

/** The first string among a tool input's `keys`, or "" when none is a string. */
export const summaryOf = (input: unknown, keys = SUMMARY_KEYS): string => {
  const value = isRow(input) && keys.map((k) => input[k]).find((v) => typeof v === 'string')
  return typeof value === 'string' ? value : ''
}

/** The path of session `id`'s conversation file under `<claudeDir>/projects/*`, or `null` when there's none. */
export async function findConversation(claudeDir: string, id: string): Promise<string | null> {
  const projects = join(claudeDir, 'projects')
  const folders = await readdir(projects).catch(() => [])
  for (const folder of folders) {
    const file = join(projects, folder, `${id}.jsonl`)
    if (existsSync(file)) return file
  }
  return null
}

const TODO_STATUSES = ['pending', 'in_progress', 'completed']

const todosOf = (input: unknown): Todo[] =>
  blocks(isRow(input) ? input.todos : null).flatMap((t) =>
    typeof t.content === 'string' && TODO_STATUSES.includes(t.status as string)
      ? [{ content: t.content, status: t.status as Todo['status'] }]
      : []
  )

const INTERRUPTED = /^\[Request interrupted by user( for tool use)?\]$/
const userEntry = (text: string): ConversationEntry => ({
  kind: 'user',
  text,
  ...(INTERRUPTED.test(text) && { stopped: true as const })
})

/** A parser that takes a Claude Code conversation file's text in pieces, as it grows. */
export function conversationParser(): {
  add(text: string): number
  entries: ConversationEntry[]
  facts: TranscriptFacts
} {
  const entries: ConversationEntry[] = []
  const facts: TranscriptFacts = { todos: [], permissionMode: null, compactions: [] }
  const tools = new Map<string, { entry: ToolEntry; index: number }>()
  let command: { entry: CommandEntry; index: number } | null = null
  let rest = ''
  let changed = 0
  const touch = (i: number): void => {
    changed = Math.min(changed, i)
  }

  const addCommand = (text: string): void => {
    const name = tagText(text, 'command-name')
    if (name !== null) {
      const entry: CommandEntry = {
        kind: 'command',
        name,
        args: tagText(text, 'command-args')?.trim() ?? '',
        output: null
      }
      command = NOT_COMMANDS.includes(name) ? null : { entry, index: entries.length }
      if (command) entries.push(entry)
    }
    const out = tagText(text, 'local-command-stdout') ?? tagText(text, 'local-command-stderr')
    if (out === null || command?.index !== entries.length - 1) return
    const clean = out === '(no content)' ? '' : stripVTControlCharacters(out)
    const { entry } = command
    entry.output = cut(entry.output === null ? clean : `${entry.output}\n${clean}`)
    touch(command.index)
  }

  const addRow = (row: Row): void => {
    if (row.type === 'permission-mode' && typeof row.permissionMode === 'string')
      facts.permissionMode = row.permissionMode
    if (row.isSidechain === true) return
    if (row.type === 'system' && row.subtype === 'compact_boundary') {
      const at = typeof row.timestamp === 'string' ? row.timestamp : ''
      const meta = row.compactMetadata
      entries.push({
        kind: 'compact',
        at,
        trigger: isRow(meta) && meta.trigger === 'auto' ? 'auto' : 'manual'
      })
      facts.compactions.push(at)
    }
    if (row.type === 'system' && row.subtype === 'local_command' && typeof row.content === 'string')
      addCommand(row.content)
    const a = row.attachment
    if (
      row.type === 'attachment' &&
      isRow(a) &&
      a.type === 'queued_command' &&
      a.commandMode === 'prompt' &&
      a.isMeta !== true &&
      typed(a.prompt)
    )
      entries.push(userEntry(a.prompt))
    if (!isRow(row.message)) return
    const content = row.message.content
    if (row.type === 'user') {
      const meta = row.isMeta === true || row.isCompactSummary === true
      if (!meta && typed(content)) entries.push(userEntry(content))
      else if (!meta && typeof content === 'string') addCommand(content)
      for (const b of blocks(content)) {
        if (b.type === 'text' && !meta && typed(b.text)) entries.push(userEntry(b.text))
        const tool = b.type === 'tool_result' && tools.get(b.tool_use_id as string)
        if (!tool) continue
        tool.entry.output = cut(resultText(b.content))
        tool.entry.error = b.is_error === true
        touch(tool.index)
      }
    } else if (row.type === 'assistant')
      for (const b of blocks(content)) {
        if (b.type === 'text' && typeof b.text === 'string' && b.text.trim())
          entries.push({ kind: 'assistant', text: b.text })
        if (b.type !== 'tool_use' || typeof b.id !== 'string' || typeof b.name !== 'string')
          continue
        const entry: ToolEntry = {
          kind: 'tool',
          name: b.name,
          summary: summaryOf(b.input),
          input: cut(JSON.stringify(b.input ?? {}, null, 2)),
          output: null,
          error: false
        }
        if (b.name === 'TodoWrite') facts.todos = todosOf(b.input)
        tools.set(b.id, { entry, index: entries.length })
        entries.push(entry)
      }
  }

  return {
    entries,
    facts,
    add(text) {
      const before = entries.length
      changed = Infinity
      const lines = (rest + text).split('\n')
      rest = lines.pop() ?? ''
      for (const line of lines) {
        const row = parseJson(line)
        if (isRow(row)) addRow(row)
      }
      touch(before)
      return Math.min(changed, entries.length)
    }
  }
}

/** The messages and tool calls in a Claude Code conversation file, oldest first. */
export function parseConversation(text: string): ConversationEntry[] {
  const parser = conversationParser()
  parser.add(`${text}\n`)
  return parser.entries
}

/** The entries at the end of a transcript file, read from its last `tail` bytes and further back until the tool calls that end it are whole. */
export async function readLastEntries(
  file: string,
  tail = 256 * 1024
): Promise<ConversationEntry[]> {
  const handle = await open(file)
  try {
    const { size } = await handle.stat()
    for (let length = Math.min(size, tail); ; length = Math.min(size, length * 2)) {
      const buffer = Buffer.alloc(length)
      await handle.read(buffer, 0, length, size - length)
      const text = buffer.toString('utf8')
      const entries = parseConversation(length < size ? text.slice(text.indexOf('\n') + 1) : text)
      if (length === size || entries.some((e) => e.kind !== 'tool')) return entries
    }
  } finally {
    await handle.close()
  }
}

const NOT_PERMISSION = ['Agent', 'Task', 'AskUserQuestion', 'ExitPlanMode']

/** The first unanswered call among the tool calls that end `entries`, or undefined when there's none. */
export function waitingTool(entries: ConversationEntry[]): ToolEntry | undefined {
  let first: ToolEntry | undefined
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]
    if (e.kind !== 'tool') break
    if (e.output === null) first = e
  }
  return first
}

/** The first unanswered call among the tool calls that end `entries`, as `Bash(<command>)` or its tool name; null when none, or when it asks something other than a permission. */
export function pendingTool(entries: ConversationEntry[]): string | null {
  const first = waitingTool(entries)
  if (!first || NOT_PERMISSION.includes(first.name)) return null
  const input = parseJson(first.input)
  return first.name === 'Bash' && isRow(input) && typeof input.command === 'string'
    ? `Bash(${input.command})`
    : first.name
}

import { parseJson } from '../../shared/json'
import type { SessionCommand } from '../../shared/types'

const PANELS = new Set([
  'usage',
  'model',
  'effort',
  'config',
  'mcp',
  'fast',
  'advisor',
  'autocompact',
  'skill-doctor',
  'auto-mode-setup',
  'usage-credits',
  'extra-usage',
  'ultrareview',
  'workflow-launch-exec',
  'goal',
  'send-to-project'
])

type Listed = {
  name?: unknown
  description?: unknown
  argumentHint?: unknown
  builtin?: unknown
  aliases?: unknown
}

const aliasesOf = (c: Listed): string[] =>
  Array.isArray(c.aliases) ? c.aliases.filter((a): a is string => typeof a === 'string') : []

const sourceName = (it: string): string =>
  it === 'user'
    ? 'Your command or skill'
    : it === 'project'
      ? "This repo's command or skill"
      : it === 'claude.ai sync'
        ? 'Synced from claude.ai'
        : `From ${it}`

const commandOf = (c: Listed): SessionCommand => {
  const name = String(c.name)
  const text = typeof c.description === 'string' ? c.description.trim() : ''
  const argumentHint = typeof c.argumentHint === 'string' ? c.argumentHint : ''
  const aliases = aliasesOf(c)
  if (c.builtin)
    return { name, description: text, argumentHint, source: 'Built into Claude Code', aliases }
  const m = /^(.*?)\s*\(([^()]+)\)$/s.exec(text)
  return m
    ? { name, description: m[1], argumentHint, source: sourceName(m[2]), aliases }
    : { name, description: text, argumentHint, source: '', aliases }
}

/** The commands in the `initialize` control response that `claude -p` printed, less the ones that open a panel. */
export function commandsOf(stdout: string): SessionCommand[] {
  for (const line of stdout.split('\n')) {
    const row = parseJson(line) as
      | { type?: unknown; response?: { error?: unknown; response?: { commands?: unknown } } }
      | undefined
    if (row?.type === 'control_response' && typeof row.response?.error === 'string')
      throw new Error(`Claude Code didn't list its commands: ${row.response.error}`)
    const commands = row?.type === 'control_response' && row.response?.response?.commands
    if (!Array.isArray(commands)) continue
    return (commands as Listed[])
      .filter(
        (c) =>
          typeof c.name === 'string' &&
          !c.name.startsWith('__') &&
          ![c.name, ...aliasesOf(c)].some((n) => PANELS.has(n))
      )
      .map(commandOf)
  }
  throw new Error("Claude Code didn't list its commands")
}

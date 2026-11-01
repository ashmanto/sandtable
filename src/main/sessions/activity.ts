import { open, stat } from 'node:fs/promises'
import { parseJson } from '../../shared/json'
import type { Activity, Step } from '../../shared/types'
import { blocks, isRow, summaryOf, typed } from './conversation'
import { redact } from './claudeLaunch'

const TARGET_KEYS = [
  'command',
  'file_path',
  'notebook_path',
  'pattern',
  'url',
  'query',
  'skill',
  'description',
  'prompt'
]
// shortcut: reads only the last 256 KB, so a turn whose prompt is older shows no time; read further back if that's common.
const TAIL = 256 * 1024

const targetOf = (input: unknown, cwd: unknown): string => {
  const value = summaryOf(input, TARGET_KEYS)
  const short =
    typeof cwd === 'string' && cwd
      ? value
          .replace(
            new RegExp(`^cd (["']?)${cwd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\1\\s*(;|&&)\\s*`),
            ''
          )
          .replaceAll(`${cwd}/`, '')
      : value
  return redact(short).replace(/\s+/g, ' ').trim().slice(0, 300)
}

/** The tool steps in one transcript or `stream-json` row, in order, with paths relative to its `cwd` or the given one. */
export function stepsOf(row: unknown, cwd?: string): Step[] {
  if (!isRow(row) || row.type !== 'assistant' || row.isSidechain === true || !isRow(row.message))
    return []
  const at = typeof row.timestamp === 'string' ? row.timestamp : null
  return blocks(row.message.content).flatMap((b) =>
    b.type === 'tool_use' && typeof b.name === 'string' && b.name !== 'StructuredOutput'
      ? [{ tool: b.name, target: targetOf(b.input, row.cwd ?? cwd), at }]
      : []
  )
}

/** The tool steps, newest first, and the latest prompt's time in a Claude Code transcript's text. */
export function activityOf(text: string): Activity {
  const steps: Step[] = []
  let since: string | null = null
  for (const line of text.split('\n')) {
    const row = parseJson(line)
    if (!isRow(row) || row.isSidechain === true || !isRow(row.message)) continue
    const at = typeof row.timestamp === 'string' ? row.timestamp : null
    const content = row.message.content
    if (row.type === 'user') {
      if (row.isMeta === true || row.isCompactSummary === true) continue
      if (typed(content) || blocks(content).some((b) => b.type === 'text' && typed(b.text)))
        since = at
    } else steps.push(...stepsOf(row))
  }
  return { steps: steps.slice(-5).reverse(), since }
}

const cache = new Map<string, { size: number; mtimeMs: number; activity: Activity }>()

/** The activity in the tail of a transcript file, reread only when its size or mtime changed. */
export async function readActivity(file: string): Promise<Activity> {
  const { size, mtimeMs } = await stat(file)
  const hit = cache.get(file)
  if (hit && hit.size === size && hit.mtimeMs === mtimeMs) return hit.activity
  const handle = await open(file)
  try {
    const length = Math.min(size, TAIL)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, size - length)
    const read = activityOf(buffer.toString('utf8'))
    const activity = {
      steps: read.steps.length ? read.steps : (hit?.activity.steps ?? []),
      since: read.since ?? hit?.activity.since ?? null
    }
    cache.set(file, { size, mtimeMs, activity })
    return activity
  } finally {
    await handle.close()
  }
}

import { open, stat } from 'node:fs/promises'
import { parseJson } from '../../shared/json'
import type { Activity, SessionStop, Step } from '../../shared/types'
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

type Row = Record<string, unknown> & { message: Record<string, unknown> }

const mainRows = (text: string): Row[] =>
  text
    .split('\n')
    .map(parseJson)
    .filter((row): row is Row => isRow(row) && row.isSidechain !== true && isRow(row.message))

const isPrompt = (row: Row): boolean => {
  if (row.type !== 'user' || row.isMeta === true || row.isCompactSummary === true) return false
  const content = row.message.content
  return typed(content) || blocks(content).some((b) => b.type === 'text' && typed(b.text))
}

/** The tool steps, newest first, and the latest prompt's time in a Claude Code transcript's text. */
export function activityOf(text: string): Activity {
  const steps: Step[] = []
  let since: string | null = null
  for (const row of mainRows(text)) {
    if (isPrompt(row)) since = typeof row.timestamp === 'string' ? row.timestamp : null
    else if (row.type !== 'user') steps.push(...stepsOf(row))
  }
  return { steps: steps.slice(-5).reverse(), since }
}

/** A failed turn's stop, and whether a plan limit caused it. */
export type Stopped = SessionStop & { limit: boolean }

/** The stop a transcript's text ends on: its last main-chain API error row, unless a prompt or a reply came after it. */
export function stopOf(text: string): Stopped | null {
  let stop: Stopped | null = null
  for (const row of mainRows(text)) {
    if (isPrompt(row)) stop = null
    if (row.type !== 'assistant') continue
    if (row.isApiErrorMessage !== true) {
      stop = null
      continue
    }
    const said = blocks(row.message.content).find((b) => b.type === 'text')?.text
    const params = isRow(row.apiErrorParams) ? row.apiErrorParams : {}
    const at = isRow(params.rate_limit_info) ? params.rate_limit_info.resetsAt : undefined
    stop = {
      limit: row.apiError === 'usage_limit_reached',
      message: typeof said === 'string' ? said : '',
      ...(typeof at === 'number' && { resetsAt: at * 1000 })
    }
  }
  return stop
}

const cache = new Map<string, { size: number; mtimeMs: number; activity: Activity }>()

/** The activity in the tail of a transcript file, reread only when its size or mtime changed. */
export async function readActivity(file: string): Promise<Activity> {
  const { size, mtimeMs } = await stat(file)
  const hit = cache.get(file)
  if (hit && hit.size === size && hit.mtimeMs === mtimeMs) return hit.activity
  const read = activityOf(await readTail(file, size))
  const activity = {
    steps: read.steps.length ? read.steps : (hit?.activity.steps ?? []),
    since: read.since ?? hit?.activity.since ?? null
  }
  cache.set(file, { size, mtimeMs, activity })
  return activity
}

async function readTail(file: string, size: number): Promise<string> {
  const handle = await open(file)
  try {
    const length = Math.min(size, TAIL)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, size - length)
    return buffer.toString('utf8')
  } finally {
    await handle.close()
  }
}

/** The stop in the tail of a transcript file. */
export const readStop = async (file: string): Promise<Stopped | null> =>
  stopOf(await readTail(file, (await stat(file)).size))

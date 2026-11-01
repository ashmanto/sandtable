import { open, stat } from 'node:fs/promises'
import { baseModel, mergeUsage, messagePrice, modelName } from '../../shared/pricing'
import { weekOf } from '../../shared/time'
import { parseJson } from '../../shared/json'
import type { ModelUsage, TicketUsage, WeekUsage } from '../../shared/types'
import { readAppended } from './appended'
import { isRow } from './conversation'

type Message = { id: string | null; at: number; usage: ModelUsage }
type Turn = { id: string | null; at: number; stamp: number; ms: number }
type Read = { messages: Message[]; turns: Turn[] }
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

const once = (messages: Message[]): Message[] => {
  const byId = new Map<string, Message>()
  const anonymous: Message[] = []
  for (const m of messages) {
    if (m.id === null) anonymous.push(m)
    else if (m.usage.output >= (byId.get(m.id)?.usage.output ?? -1)) byId.set(m.id, m)
  }
  return [...anonymous, ...byId.values()]
}

const turnsOnce = (turns: Turn[]): Turn[] => [
  ...turns.filter((t) => t.id === null),
  ...new Map(turns.flatMap((t) => (t.id === null ? [] : [[t.id, t] as const]))).values()
]

const usageOf = (messages: Message[]): ModelUsage[] => mergeUsage(messages.map((m) => m.usage))
const workOf = (turns: Turn[]): number => turns.reduce((n, t) => n + t.ms, 0)

const timeOf = (row: Record<string, unknown>, mtimeMs: number): number => {
  const at = typeof row.timestamp === 'string' ? Date.parse(row.timestamp) : NaN
  return Number.isFinite(at) ? at : mtimeMs
}

function parseTurn(line: string, mtimeMs: number, since: number): Turn | null {
  if (!line.includes('"turn_duration"')) return null
  const row = parseJson(line)
  if (!isRow(row) || row.type !== 'system' || row.subtype !== 'turn_duration') return null
  const stamp = typeof row.timestamp === 'string' ? Date.parse(row.timestamp) : NaN
  const ms = Math.max(0, num(row.durationMs))
  return {
    id: typeof row.uuid === 'string' ? row.uuid : null,
    at: timeOf(row, mtimeMs),
    stamp,
    // A turn Claude Code starts from a background task can report time back over turns it already counted.
    ms: stamp - since < ms ? Math.max(0, stamp - since) : ms
  }
}

function parseLine(line: string, mtimeMs: number): Message | null {
  if (!line.includes('"usage"')) return null
  const row = parseJson(line)
  if (!isRow(row) || row.type !== 'assistant' || !isRow(row.message)) return null
  const { id, model, usage } = row.message
  if (typeof model !== 'string' || model === '<synthetic>' || !isRow(usage)) return null
  const cacheWrite = num(usage.cache_creation_input_tokens)
  const cacheWrite1h = isRow(usage.cache_creation)
    ? num(usage.cache_creation.ephemeral_1h_input_tokens)
    : 0
  const counts = {
    input: num(usage.input_tokens),
    output: num(usage.output_tokens),
    cacheRead: num(usage.cache_read_input_tokens)
  }
  return {
    id: typeof id === 'string' ? id : null,
    at: timeOf(row, mtimeMs),
    usage: {
      model: baseModel(model),
      name: modelName(model),
      ...counts,
      cacheWrite,
      price: messagePrice(model, {
        ...counts,
        cacheWrite5m: cacheWrite - cacheWrite1h,
        cacheWrite1h,
        fast: usage.speed === 'fast'
      })
    }
  }
}

async function readLines(
  file: string,
  start: number,
  size: number,
  mtimeMs: number,
  since: number
): Promise<Read & { offset: number }> {
  const messages: Message[] = []
  const turns: Turn[] = []
  const handle = await open(file, 'r')
  try {
    const offset = await readAppended(handle, start, size, (text) => {
      for (const l of text.split('\n')) {
        const m = parseLine(l, mtimeMs)
        if (m) messages.push(m)
        const t = m ? null : parseTurn(l, mtimeMs, since)
        if (t) turns.push(t)
        if (Number.isFinite(t?.stamp)) since = t!.stamp
      }
    })
    return { messages, turns, offset }
  } finally {
    await handle.close()
  }
}

const cache = new Map<
  string,
  Read & { ino: number; size: number; mtimeMs: number; offset: number }
>()

/** Drops the cached reads of transcripts not in `files`, the ones a full scan no longer sees. */
export function keepCached(files: Set<string>): void {
  for (const file of cache.keys()) if (!files.has(file)) cache.delete(file)
}

async function readTranscripts(files: string[]): Promise<Read> {
  const all: Read[] = []
  for (const file of files) {
    const stats = await stat(file).catch(() => null)
    if (!stats) {
      cache.delete(file)
      continue
    }
    const { ino, size, mtimeMs } = stats
    try {
      const hit = cache.get(file)
      if (hit && hit.size === size && hit.mtimeMs === mtimeMs) {
        all.push(hit)
        continue
      }
      const grown = hit && hit.ino === ino && size > hit.size ? hit : null
      const since = grown?.turns.findLast((t) => Number.isFinite(t.stamp))?.stamp ?? NaN
      const read = await readLines(file, grown?.offset ?? 0, size, mtimeMs, since)
      const messages = grown ? [...grown.messages, ...read.messages] : read.messages
      const turns = grown ? [...grown.turns, ...read.turns] : read.turns
      const next = { ino, size, mtimeMs, offset: read.offset, messages, turns }
      cache.set(file, next)
      all.push(next)
    } catch {
      continue
    }
  }
  return {
    messages: once(all.flatMap((r) => r.messages)),
    turns: turnsOnce(all.flatMap((r) => r.turns))
  }
}

/** The transcripts' usage summed by model, counting each message once across files, largest first; it reads files one at a time, only the bytes appended since the last read, and skips unreadable ones. */
export const transcriptUsage = async (files: string[]): Promise<ModelUsage[]> =>
  usageOf((await readTranscripts(files)).messages)

/** The transcripts' usage by model and the milliseconds Claude spent running turns, counting each turn once across files and from where the previous one in its file ended. */
export async function transcriptTotals(files: string[]): Promise<TicketUsage> {
  const { messages, turns } = await readTranscripts(files)
  return { usage: usageOf(messages), workMs: workOf(turns) }
}

/** The transcripts' usage and working time by local week, newest first, counting each message and turn once across files in its timestamp's week, or its file's when it has none. */
export async function weeklyUsage(files: string[]): Promise<WeekUsage[]> {
  const { messages, turns } = await readTranscripts(files)
  const byWeek = Map.groupBy(messages, (m) => weekOf(m.at))
  const work = Map.groupBy(turns, (t) => weekOf(t.at))
  return [...new Set([...byWeek.keys(), ...work.keys()])]
    .map((week) => ({
      week,
      usage: usageOf(byWeek.get(week) ?? []),
      workMs: workOf(work.get(week) ?? [])
    }))
    .filter((w) => w.usage.length || w.workMs)
    .sort((a, b) => b.week.localeCompare(a.week))
}

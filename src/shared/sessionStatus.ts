import { clock } from './time'

/** A rate-limit window: percent used and when it resets, in ms since the epoch. */
export type LimitWindow = { pct: number; resetsAt: number }
/** A background task a session has running. */
export type BackgroundTask = { type: string; description: string }
/** What Claude Code's status-line JSON says about a session. */
export type SessionStatus = {
  model: string | null
  effort: string | null
  contextPct: number | null
  contextSize: number | null
  contextUsed: number | null
  fiveHour: LimitWindow | null
  sevenDay: LimitWindow | null
  costUsd: number | null
  durationMs: number | null
  apiDurationMs: number | null
  linesAdded: number
  linesRemoved: number
  background: BackgroundTask[]
}

/** Context percent from which the meter warns. */
export const CONTEXT_WARN = 80
/** Rate-limit percent from which the meter warns. */
export const LIMIT_WARN = 90
/** The plan-limit percents a notification can be set to. */
export const LIMIT_PCTS = [50, 60, 70, 80, 90, 95]

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : {}
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

function windowOf(v: unknown): LimitWindow | null {
  const { used_percentage, resets_at } = obj(v)
  const pct = num(used_percentage)
  const at = num(resets_at)
  return pct === null || at === null ? null : { pct, resetsAt: at * 1000 }
}

/** Reads a status-line JSON value; null when it isn't an object. */
export function parseStatus(json: unknown): SessionStatus | null {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return null
  const s = json as Obj
  const ctx = obj(s.context_window)
  const cost = obj(s.cost)
  const limits = obj(s.rate_limits)
  const usage =
    typeof ctx.current_usage === 'object' && ctx.current_usage !== null
      ? obj(ctx.current_usage)
      : null
  const used = usage
    ? [
        usage.input_tokens,
        usage.cache_read_input_tokens,
        usage.cache_creation_input_tokens
      ].reduce<number>((sum, n) => sum + (num(n) ?? 0), 0)
    : null
  return {
    model: str(obj(s.model).display_name),
    effort: str(obj(s.effort).level),
    contextPct: num(ctx.used_percentage),
    contextSize: num(ctx.context_window_size),
    contextUsed: used,
    fiveHour: windowOf(limits.five_hour),
    sevenDay: windowOf(limits.seven_day),
    costUsd: num(cost.total_cost_usd),
    durationMs: num(cost.total_duration_ms),
    apiDurationMs: num(cost.total_api_duration_ms),
    linesAdded: num(cost.total_lines_added) ?? 0,
    linesRemoved: num(cost.total_lines_removed) ?? 0,
    background: []
  }
}

/** "Resets 16:00" today, "Resets Mon 09:00" later, "Reset at 16:00" once past. */
export function resetsText(resetsAt: number, now: Date): string {
  const at = new Date(resetsAt)
  const time = clock(at)
  if (resetsAt <= now.getTime()) return `Reset at ${time}`
  if (at.toDateString() === now.toDateString()) return `Resets ${time}`
  return `Resets ${at.toLocaleDateString('en-US', { weekday: 'short' })} ${time}`
}

import { mergeUsage, tokenCount } from '../../../shared/pricing'
import { weekOf } from '../../../shared/time'
import type { MergedTicket, ModelUsage } from '../../../shared/types'
import { plural } from './utils'

const compactFormat = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
const fullFormat = new Intl.NumberFormat('en')
const usd = new Intl.NumberFormat('en', { style: 'currency', currency: 'USD' })

/** The four shades a bar of shares cycles through, darkest first. */
export const SHADES = ['bg-fg', 'bg-fg-2', 'bg-fg-3', 'bg-fg-4'] as const

/** A count as "32.1M". */
export const compact = (n: number): string => compactFormat.format(n)

/** A count in full, as "32,123,456", for hover text. */
export const full = (n: number): string => fullFormat.format(n)

/** A dollar amount as "$18.88", or "<$0.01" for a positive amount under a cent. */
export const money = (n: number): string => (n > 0 && n < 0.01 ? '<$0.01' : usd.format(n))

/** A share as a whole percent, or "<1%" for a share above 0 that rounds to 0. */
export function percent(part: number, all: number): string {
  const n = Math.round((part / all) * 100)
  return n === 0 && part > 0 ? '<1%' : `${n}%`
}

/** All models' tokens. */
export const totalTokens = (usage: ModelUsage[]): number =>
  usage.reduce((n, u) => n + tokenCount(u), 0)

/** The summed price of the models that have one. */
export const pricedTotal = (usage: ModelUsage[]): number =>
  usage.reduce((n, u) => n + (u.price ?? 0), 0)

/** Whether any model has a price. */
export const hasPrice = (usage: ModelUsage[]): boolean => usage.some((u) => u.price !== null)

/** Whether any model has no price. */
export const hasUnpriced = (usage: ModelUsage[]): boolean => usage.some((u) => u.price === null)

/** Usage as one line of text: tokens, then the API estimate, marked with * when it leaves out a model with no price; null with no tokens. */
export function cardUsage(usage: ModelUsage[]): string | null {
  const total = totalTokens(usage)
  if (total === 0) return null
  const tokens = `${compact(total)} tokens`
  if (!hasPrice(usage)) return tokens
  return `${tokens} · ${money(pricedTotal(usage))}${hasUnpriced(usage) ? '*' : ''} API estimate`
}

const day = (d: Date, year = false): string =>
  d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(year && { year: 'numeric' })
  })

/** A week starting on local Monday `week` ("2026-10-12") as "This week", "Last week", or "Oct 12 – Oct 18", with its year outside the current year. */
export function weekLabel(week: string, now = new Date()): string {
  const before = new Date(now)
  before.setDate(before.getDate() - 7)
  if (week === weekOf(now.getTime())) return 'This week'
  if (week === weekOf(before.getTime())) return 'Last week'
  const [y, m, d] = week.split('-').map(Number)
  const start = new Date(y, m - 1, d)
  const end = new Date(y, m - 1, d + 6)
  if (start.getFullYear() !== end.getFullYear()) return `${day(start, true)} – ${day(end, true)}`
  const year = start.getFullYear() === now.getFullYear() ? '' : `, ${start.getFullYear()}`
  return `${day(start)} – ${day(end)}${year}`
}

/** A span of milliseconds as "under 1m", "44m", "23h", or "1d 2h", or in words, as "1 day 2 hours". */
export function duration(ms: number, words = false): string {
  if (ms < 60_000) return words ? 'under 1 minute' : 'under 1m'
  const unit = (n: number, short: string, long: string): string =>
    words ? plural(n, long) : `${n}${short}`
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return unit(minutes, 'm', 'minute')
  const hours = Math.round(minutes / 60)
  if (hours < 24) return unit(hours, 'h', 'hour')
  const days = unit(Math.floor(hours / 24), 'd', 'day')
  return hours % 24 ? `${days} ${unit(hours % 24, 'h', 'hour')}` : days
}

/** One week's merged tickets, with times in milliseconds and Needs you per ticket. */
type WeekThroughput = {
  week: string
  merged: number
  median: number
  slowest: number
  usage: ModelUsage[]
  needsYou: number
}

/** The merged tickets grouped by the local week they merged in, newest first. */
export function throughputByWeek(tickets: MergedTicket[]): WeekThroughput[] {
  const byWeek = Map.groupBy(tickets, (t) => weekOf(Date.parse(t.mergedAt)))
  return [...byWeek]
    .map(([week, ts]) => {
      const spans = ts
        .map((t) => Date.parse(t.mergedAt) - Date.parse(t.startedAt))
        .sort((a, b) => a - b)
      const mid = spans.length / 2
      return {
        week,
        merged: ts.length,
        median: spans.length % 2 ? spans[Math.floor(mid)] : (spans[mid - 1] + spans[mid]) / 2,
        slowest: spans[spans.length - 1],
        usage: mergeUsage(ts.flatMap((t) => t.usage)),
        needsYou: ts.reduce((n, t) => n + t.needsYou, 0) / ts.length
      }
    })
    .sort((a, b) => b.week.localeCompare(a.week))
}

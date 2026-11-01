/** A timestamp as "Oct 25, 14:32" in local time. */
export const shortTime = (iso: string): string =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  })

/** The local Monday that starts the week of `ms`, as "2026-10-26". */
export function weekOf(ms: number): string {
  const d = new Date(ms)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}

/** A timestamp's local time as "14:05". */
export const clock = (at: string | number | Date): string =>
  new Date(at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

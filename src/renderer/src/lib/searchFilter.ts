import { ticketLabel } from '../../../shared/repo'

/** Whether the ticket's number label starts with the query, or its title contains it, ignoring case; `#` searches only numbers. */
export function passesSearch(
  query: string,
  t: { key: string; number: number; title: string }
): boolean {
  const q = query.trim().toLowerCase()
  const number = `#${t.number}`
  return (
    ticketLabel(t).toLowerCase().startsWith(q) ||
    number.startsWith(q) ||
    number.startsWith(`#${q}`) ||
    (!q.startsWith('#') && t.title.toLowerCase().includes(q))
  )
}

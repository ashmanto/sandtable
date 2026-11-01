import { isTrackerKey, issueLabel, sameRepo } from './repo'
import type { Ticket } from './types'

export const AREA_PREFIX = 'area:'

/** The first label that names an area, or undefined. */
export const areaOf = (labels: { name: string }[]): string | undefined =>
  labels.find((l) => l.name.startsWith(AREA_PREFIX))?.name

/** "Blocked by #<n>", with the blocker's repo before the number when it's another repo, or the Linear or Jira key. */
export const blockedByText = (b: Ticket['blockedBy'][number], repo: string): string =>
  `Blocked by ${issueLabel(b, repo)}`

/** What stops you starting `ticket`: its open blockers. */
export const startProblems = (ticket: Omit<Ticket, 'body'>): string[] =>
  ticket.blockedBy.map((b) => `${blockedByText(b, ticket.repo)}: ${b.title}`)

/** The `busy` tickets in `ticket`'s repo and area that Claude checks for real overlap. */
export function overlapCandidates<T extends Omit<Ticket, 'body'>>(
  ticket: Omit<Ticket, 'body'>,
  tickets: T[],
  busy: string[]
): T[] {
  const area = areaOf(ticket.labels)
  if (!area) return []
  return tickets.filter(
    (t) =>
      t.key !== ticket.key &&
      busy.includes(t.key) &&
      (isTrackerKey(ticket.key) || sameRepo(t.repo, ticket.repo)) &&
      areaOf(t.labels) === area
  )
}

/** How a triage apply's error starts when the labels landed but the board refresh failed. */
export const APPLIED_BUT = 'Applied, but'

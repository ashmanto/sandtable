const known = new Map<string, string>()

/** The pull request at `url`'s mergeable value, or its last known one while GitHub reports `UNKNOWN` after a push. */
export function knownMergeable(url: string, mergeable: string): string {
  // shortcut: one short entry per pull request seen, never evicted; prune if the main process ever runs for months.
  if (mergeable !== 'UNKNOWN') known.set(url, mergeable)
  return known.get(url) ?? mergeable
}

import type { ConversationEntry } from '../../../shared/types'

/** A message sent from the composer that the conversation doesn't show yet: `typed` once it's in the session, `from` the conversation's length when it was sent. */
export type Queued = {
  id: string
  text: string
  images: string[]
  from: number
  typed: string | null
  error: string | null
}

const squeezed = (s: string): string => s.replace(/\s+/g, ' ').trim()
const command = (q: Queued): boolean => !q.error && /^[/!]/.test(q.typed?.trim() ?? '')

/** The queued messages `entries`, past its first `start`, doesn't show yet. */
export function waiting(queued: Queued[], entries: ConversationEntry[], start = 0): Queued[] {
  let last = -1
  let after = 0
  queued.forEach((q, i) => {
    if (q.typed === null || q.error || command(q)) return
    const text = squeezed(q.typed)
    const j = entries.findIndex(
      (e, j) =>
        start + j >= Math.max(q.from, after) && e.kind === 'user' && squeezed(e.text) === text
    )
    if (j < 0) return
    last = i
    after = start + j + 1
  })
  return queued.flatMap((q, i) =>
    (i > last || q.typed === null || q.error) && !command(q)
      ? [{ ...q, from: Math.max(q.from, after) }]
      : []
  )
}

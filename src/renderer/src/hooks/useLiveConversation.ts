import { useEffect, useState } from 'react'
import { fanOut } from '@/lib/fanOut'
import type { ConversationChunk, ConversationEntry, TranscriptFacts } from '../../../shared/types'
import { errorMessage } from '@/lib/utils'

const follow = fanOut<ConversationChunk>((cb) => window.sandtable.sessions.onConversation(cb))

const NO_FACTS: TranscriptFacts = { todos: [], permissionMode: null, compactions: [] }
type Shown = {
  id: string
  entries: ConversationEntry[] | null
  start: number
  facts: TranscriptFacts
  error: string | null
  missing: boolean
}

/** A session's conversation entries, how many earlier ones it left out, and its facts: watched while mounted with a session ID, with each pushed chunk spliced in at its `from`. */
export function useLiveConversation(sessionId: string): Omit<Shown, 'id'> {
  const [shown, setShown] = useState<Shown | null>(null)
  useEffect(() => {
    if (!sessionId) return
    let live = true
    let ready = false
    const apply = (c: ConversationChunk): void =>
      setShown((s) => ({
        id: sessionId,
        entries: (s?.id === sessionId ? (s.entries ?? []) : []).slice(0, c.from).concat(c.entries),
        start: c.start ?? 0,
        facts: c.facts,
        error: null,
        missing: !!c.missing
      }))
    const unfollow = follow((id, chunk) => {
      if (id !== sessionId || !live) return
      if (ready) apply(chunk)
    })
    window.sandtable.sessions
      .watchConversation(sessionId)
      .then((chunk) => {
        if (!live) return
        apply(chunk)
        ready = true
      })
      .catch((err: unknown) => {
        if (live)
          setShown({
            id: sessionId,
            entries: null,
            start: 0,
            facts: NO_FACTS,
            error: errorMessage(err),
            missing: false
          })
      })
    return () => {
      live = false
      unfollow()
      void window.sandtable.sessions.unwatchConversation(sessionId)
    }
  }, [sessionId])
  return shown?.id === sessionId
    ? shown
    : { entries: null, start: 0, facts: NO_FACTS, error: null, missing: false }
}

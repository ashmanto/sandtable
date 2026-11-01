import { useEffect, useState } from 'react'
import { fanOut } from '@/lib/fanOut'
import type { Activity, SessionRecord } from '../../../shared/types'
import { useFollowed } from './useFollowed'

type Stamped = Activity & { at: number }
const follow = fanOut<Stamped>((cb) =>
  window.sandtable.sessions.onActivity((id, a) => cb(id, { ...a, at: Date.now() }))
)
const load = (id: string): Promise<Stamped | null> =>
  window.sandtable.sessions.activity(id).then((a) => a && { ...a, at: Date.now() })

/** A session's latest steps while it's Running, following pushes, and the time now, renewed every 30 s so its times move. */
export function useActivity(
  session: Pick<SessionRecord, 'id' | 'state'> | undefined
): (Activity & { now: number }) | null {
  const id = session?.state === 'running' ? session.id : null
  const stamped = useFollowed(follow, load, id)
  const [tick, setTick] = useState(Date.now)
  useEffect(() => {
    if (!id) return
    const timer = setInterval(() => setTick(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [id])
  if (!stamped) return null
  const { at, ...activity } = stamped
  return { ...activity, now: Math.max(tick, at) }
}

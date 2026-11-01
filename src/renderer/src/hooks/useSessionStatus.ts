import { fanOut } from '@/lib/fanOut'
import type { SessionStatus } from '../../../shared/sessionStatus'
import { useFollowed } from './useFollowed'

const follow = fanOut<SessionStatus>((cb) => window.sandtable.sessions.onStatus(cb))
const load = (id: string): Promise<SessionStatus | null> => window.sandtable.sessions.status(id)

/** A session's live status, loaded once and then following pushes. */
export const useSessionStatus = (sessionId: string): SessionStatus | null =>
  useFollowed(follow, load, sessionId)

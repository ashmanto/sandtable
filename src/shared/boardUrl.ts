import type { BoardSource } from './types'

/** Parses a GitHub Projects board URL into a BoardSource. */
export function parseBoardUrl(raw: string): BoardSource {
  const url = raw.trim()
  const m = /^https:\/\/github\.com\/(users|orgs)\/([^/]+)\/projects\/(\d+)(?:\/|$)/.exec(url)
  if (!m) throw new Error('Not a GitHub Projects board URL')
  return {
    url,
    ownerType: m[1] === 'users' ? 'user' : 'org',
    owner: m[2],
    number: Number(m[3])
  }
}

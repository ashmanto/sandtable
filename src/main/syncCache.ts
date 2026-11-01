import { promises as fs } from 'node:fs'
import { parseJson } from '../shared/json'
import type { Ticket } from '../shared/types'
import { writeAtomic } from './store'

export type SyncCache = Record<string, { tickets: Ticket[]; syncedAt: string }>
export type SyncCacheStore = { load(): Promise<SyncCache>; save(c: SyncCache): Promise<void> }

/** A JSON file of each project's last synced tickets; an unreadable file loads as empty. */
export function createSyncCache(file: string): SyncCacheStore {
  return {
    async load() {
      const data = parseJson(await fs.readFile(file, 'utf8').catch(() => ''))
      if (typeof data !== 'object' || data === null || Array.isArray(data)) return {}
      return Object.fromEntries(
        Object.entries(data).filter(
          ([, e]) => Array.isArray(e?.tickets) && typeof e.syncedAt === 'string'
        )
      )
    },
    save: (c) => writeAtomic(file, JSON.stringify(c))
  }
}

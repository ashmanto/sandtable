import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSyncCache, type SyncCache } from './syncCache'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'sandtable-cache-'))
})
afterEach(() => fs.rm(dir, { recursive: true, force: true }))

describe('createSyncCache', () => {
  it('loads an empty cache when the file is missing', async () => {
    expect(await createSyncCache(join(dir, 'sync-cache.json')).load()).toEqual({})
  })

  it('round-trips a saved cache', async () => {
    const cache = createSyncCache(join(dir, 'nested', 'sync-cache.json'))
    const data: SyncCache = { p1: { tickets: [], syncedAt: '2026-10-25T00:00:00.000Z' } }
    await cache.save(data)
    expect(await cache.load()).toEqual(data)
  })

  it.each(['{not json', '[]', 'null', '"x"'])('ignores a file containing %s', async (text) => {
    const file = join(dir, 'sync-cache.json')
    await fs.writeFile(file, text)
    expect(await createSyncCache(file).load()).toEqual({})
  })

  it('drops malformed entries and keeps valid ones', async () => {
    const file = join(dir, 'sync-cache.json')
    const good = { tickets: [], syncedAt: '2026-10-25T00:00:00.000Z' }
    await fs.writeFile(
      file,
      JSON.stringify({
        good,
        empty: {},
        noTickets: { tickets: null, syncedAt: 'x' },
        noDate: { tickets: [] },
        str: 'x',
        nul: null
      })
    )
    expect(await createSyncCache(file).load()).toEqual({ good })
  })
})

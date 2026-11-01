import { EventEmitter } from 'node:events'
import { appendFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { SessionState } from '../../shared/types'
import { watchEvents } from './hookEvents'

vi.mock('node:fs', async (orig) => ({
  ...(await orig<typeof import('node:fs')>()),
  watch: () => Object.assign(new EventEmitter(), { close: vi.fn() })
}))

let dir: string
let stop: (() => void) | undefined

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  dir = await mkdtemp(join(tmpdir(), 'hook-rescan-'))
})

afterEach(async () => {
  stop?.()
  stop = undefined
  vi.useRealTimers()
  await rm(dir, { recursive: true, force: true })
})

it('picks up appends by rescanning when fs.watch delivers nothing', async () => {
  const calls: [string, SessionState | null][] = []
  stop = watchEvents(dir, (id, s) => calls.push([id, s]))
  await appendFile(join(dir, 's1.jsonl'), JSON.stringify({ hook_event_name: 'Stop' }) + '\n')
  await vi.advanceTimersByTimeAsync(2000)
  await vi.waitFor(() => expect(calls).toEqual([['s1', 'needsYou']]))
})

it('survives the directory being deleted', async () => {
  stop = watchEvents(dir, () => undefined)
  await rm(dir, { recursive: true, force: true })
  await vi.advanceTimersByTimeAsync(2500)
})

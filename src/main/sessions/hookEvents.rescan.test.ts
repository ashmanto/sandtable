import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { SessionState } from '../../shared/types'
import { watchEvents } from './hookEvents'

vi.mock('node:fs', async (orig) => {
  const fs = await orig<typeof import('node:fs')>()
  return {
    ...fs,
    readFileSync: vi.fn(fs.readFileSync),
    watch: () => Object.assign(new EventEmitter(), { close: vi.fn() })
  }
})

let dir: string
let stop: (() => void) | undefined
const line = (name: string): string => JSON.stringify({ hook_event_name: name }) + '\n'

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
  stop = watchEvents(dir, (id, s) => calls.push([id, s]), { seed: [], live: () => ['s1'] })
  await appendFile(join(dir, 's1.jsonl'), line('Stop'))
  await vi.advanceTimersByTimeAsync(2000)
  await vi.waitFor(() => expect(calls).toEqual([['s1', 'needsYou']]))
})

it('rescans only live sessions', async () => {
  const calls: [string, SessionState | null][] = []
  stop = watchEvents(dir, (id, s) => calls.push([id, s]), { seed: [], live: () => ['s1'] })
  await appendFile(join(dir, 'gone.jsonl'), line('Stop'))
  await appendFile(join(dir, 's1.jsonl'), line('Stop'))
  await vi.advanceTimersByTimeAsync(2000)
  await vi.waitFor(() => expect(calls).toEqual([['s1', 'needsYou']]))
  await vi.advanceTimersByTimeAsync(2000)
  expect(calls).toEqual([['s1', 'needsYou']])
})

it('does not replay a seeded session that goes live later', async () => {
  await writeFile(join(dir, 'f.jsonl'), (line('UserPromptSubmit') + line('Stop')).repeat(3))
  const live: string[] = []
  const calls: [string, SessionState | null][] = []
  stop = watchEvents(dir, (id, s) => calls.push([id, s]), { seed: ['f'], live: () => live })
  live.push('f')
  await appendFile(join(dir, 'f.jsonl'), line('UserPromptSubmit'))
  await vi.advanceTimersByTimeAsync(2000)
  await vi.waitFor(() => expect(calls).toEqual([['f', 'running']]))
})

it('reads only seeded files at startup', async () => {
  await writeFile(join(dir, 'a.jsonl'), line('Stop'))
  await writeFile(join(dir, 'gone.jsonl'), line('Stop'))
  vi.mocked(readFileSync).mockClear()
  stop = watchEvents(dir, () => undefined, { seed: ['a'], live: () => [] })
  expect(readFileSync).toHaveBeenCalledWith(join(dir, 'a.jsonl'))
  expect(readFileSync).not.toHaveBeenCalledWith(join(dir, 'gone.jsonl'))
})

it('survives the directory being deleted', async () => {
  stop = watchEvents(dir, () => undefined, { seed: [], live: () => ['s1'] })
  await rm(dir, { recursive: true, force: true })
  await vi.advanceTimersByTimeAsync(2500)
})

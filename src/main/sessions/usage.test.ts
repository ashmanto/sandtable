import { appendFileSync, mkdtempSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelUsage } from '../../shared/types'
import { keepCached, transcriptTotals, transcriptUsage, weeklyUsage } from './usage'

type U = {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  cache_creation?: { ephemeral_5m_input_tokens: number; ephemeral_1h_input_tokens: number }
  speed?: string
}
const line = (id: string, model: string, usage: U, timestamp?: string): string =>
  JSON.stringify({ type: 'assistant', timestamp, message: { id, model, usage } })
const turn = (uuid: string | undefined, durationMs: number, timestamp?: string): string =>
  JSON.stringify({ type: 'system', subtype: 'turn_duration', durationMs, timestamp, uuid })

describe('transcriptUsage of one transcript', () => {
  let dir = ''
  let n = 0
  beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), 'usage-'))))
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  const parseUsage = (text: string): Promise<ModelUsage[]> => {
    const file = join(dir, `${n++}.jsonl`)
    writeFileSync(file, `${text}\n`)
    return transcriptUsage([file])
  }

  it('counts each message once, sums by model, and sorts by total tokens', async () => {
    const u = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 1_000_000 }
    const text = [
      line('m1', 'claude-opus-5-5', u),
      line('m1', 'claude-opus-5-5', u),
      'not json',
      JSON.stringify({ type: 'user', message: { content: 'hi' } }),
      line('m2', 'claude-haiku-4-5-20251001', { input_tokens: 5 }),
      line('m3', 'claude-opus-5-5', { input_tokens: 1_000_000, output_tokens: 0 })
    ].join('\n')
    expect(await parseUsage(text)).toEqual([
      {
        model: 'claude-opus-5-5',
        name: 'Opus 5.5',
        input: 1_000_010,
        output: 20,
        cacheWrite: 0,
        cacheRead: 1_000_000,
        price: expect.closeTo(4.20044, 6)
      },
      {
        model: 'claude-haiku-4-5',
        name: 'Haiku 4.5',
        input: 5,
        output: 0,
        cacheWrite: 0,
        cacheRead: 0,
        price: expect.closeTo(0.000005, 9)
      }
    ])
  })

  it('splits cache writes into 5-minute and 1-hour, treating them all as 5-minute without the split', async () => {
    const [split] = await parseUsage(
      line('a', 'claude-opus-5-5', {
        cache_creation_input_tokens: 2_000_000,
        cache_creation: {
          ephemeral_5m_input_tokens: 1_000_000,
          ephemeral_1h_input_tokens: 1_000_000
        }
      })
    )
    expect(split).toMatchObject({ cacheWrite: 2_000_000, price: expect.closeTo(13, 6) })
    const [plain] = await parseUsage(
      line('a', 'claude-opus-5-5', { cache_creation_input_tokens: 1_000_000 })
    )
    expect(plain.price).toBeCloseTo(5)
  })

  it('prices fast mode, and has no price for a model when any message has none', async () => {
    const [fast] = await parseUsage(
      line('a', 'claude-opus-5-5', { output_tokens: 1_000_000, speed: 'fast' })
    )
    expect(fast.price).toBeCloseTo(40)
    const [mixed] = await parseUsage(
      [
        line('a', 'claude-sonnet-5', { output_tokens: 5 }),
        line('b', 'claude-sonnet-5', { output_tokens: 5, speed: 'fast' })
      ].join('\n')
    )
    expect(mixed).toMatchObject({ output: 10, price: null })
  })

  it('shows tokens without a price or name for an unknown model', async () => {
    expect(await parseUsage(line('a', 'claude-future-9', { input_tokens: 3 }))).toEqual([
      {
        model: 'claude-future-9',
        name: null,
        input: 3,
        output: 0,
        cacheWrite: 0,
        cacheRead: 0,
        price: null
      }
    ])
  })

  it('keeps the copy of a repeated message with the most output tokens, in either order', async () => {
    const partial = line('m1', 'claude-opus-5-5', { output_tokens: 7 })
    const whole = line('m1', 'claude-opus-5-5', { output_tokens: 250 })
    expect((await parseUsage([partial, whole].join('\n')))[0].output).toBe(250)
    expect((await parseUsage([whole, partial].join('\n')))[0].output).toBe(250)
  })

  it('parses only lines that mention usage', async () => {
    const parse = vi.spyOn(JSON, 'parse')
    const user = JSON.stringify({ type: 'user', message: { content: 'hi' } })
    await parseUsage([user, line('a', 'claude-opus-5-5', { input_tokens: 1 })].join('\n'))
    expect(parse).toHaveBeenCalledTimes(1)
    parse.mockRestore()
  })

  it('leaves out <synthetic> rows and models with no tokens', async () => {
    expect(
      await parseUsage(
        [
          line('a', '<synthetic>', { input_tokens: 0, output_tokens: 0 }),
          line('b', 'claude-opus-5-5', { input_tokens: 0 })
        ].join('\n')
      )
    ).toEqual([])
  })
})

describe('transcriptUsage', () => {
  let dir = ''
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const total = async (files: string[]): Promise<number> =>
    (await transcriptUsage(files))[0]?.input ?? 0
  const at = (file: string, ms: number): void => utimesSync(file, ms / 1000, ms / 1000)

  it('sums files by model and skips unreadable ones', async () => {
    dir = mkdtempSync(join(tmpdir(), 'usage-'))
    const a = join(dir, 'a.jsonl')
    const b = join(dir, 'b.jsonl')
    writeFileSync(a, line('m1', 'claude-opus-5-5', { input_tokens: 1 }) + '\n')
    writeFileSync(b, line('m2', 'claude-opus-5-5', { input_tokens: 2 }) + '\n')
    expect(await total([a, b, join(dir, 'missing.jsonl')])).toBe(3)
  })

  it('counts a message once across files, as when a conversation continues in a new file', async () => {
    dir = mkdtempSync(join(tmpdir(), 'usage-'))
    const old = join(dir, 'old.jsonl')
    const next = join(dir, 'next.jsonl')
    writeFileSync(old, line('m1', 'claude-opus-5-5', { input_tokens: 1 }) + '\n')
    writeFileSync(
      next,
      [
        line('m1', 'claude-opus-5-5', { input_tokens: 1 }),
        line('m2', 'claude-opus-5-5', { input_tokens: 10 })
      ].join('\n') + '\n'
    )
    expect(await total([old, next])).toBe(11)
    expect(await total([old, next])).toBe(11)
  })

  it('keeps the copy with the most output tokens across files, in either order', async () => {
    dir = mkdtempSync(join(tmpdir(), 'usage-'))
    const partial = join(dir, 'partial.jsonl')
    const whole = join(dir, 'whole.jsonl')
    writeFileSync(partial, line('m1', 'claude-opus-5-5', { output_tokens: 7 }) + '\n')
    writeFileSync(whole, line('m1', 'claude-opus-5-5', { output_tokens: 250 }) + '\n')
    expect((await transcriptUsage([partial, whole]))[0].output).toBe(250)
    expect((await transcriptUsage([whole, partial]))[0].output).toBe(250)
  })

  it('keeps an unchanged file from the cache and rereads one whose modified time alone changed', async () => {
    dir = mkdtempSync(join(tmpdir(), 'usage-'))
    const a = join(dir, 'a.jsonl')
    writeFileSync(a, line('m1', 'claude-opus-5-5', { input_tokens: 1 }) + '\n')
    at(a, 1_000_000)
    expect(await total([a])).toBe(1)
    writeFileSync(a, line('m1', 'claude-opus-5-5', { input_tokens: 7 }) + '\n')
    at(a, 1_000_000)
    expect(await total([a])).toBe(1)
    at(a, 2_000_000)
    expect(await total([a])).toBe(7)
  })

  it('parses only the lines appended since the last read and adds their usage', async () => {
    dir = mkdtempSync(join(tmpdir(), 'usage-'))
    const a = join(dir, 'a.jsonl')
    writeFileSync(a, line('m1', 'claude-opus-5-5', { input_tokens: 1 }) + '\n')
    expect(await total([a])).toBe(1)
    appendFileSync(a, line('m2', 'claude-opus-5-5', { input_tokens: 10 }) + '\n')
    const parse = vi.spyOn(JSON, 'parse')
    expect(await total([a])).toBe(11)
    expect(parse).toHaveBeenCalledTimes(1)
    parse.mockRestore()
  })

  it('counts a trailing partial line once it is completed', async () => {
    dir = mkdtempSync(join(tmpdir(), 'usage-'))
    const a = join(dir, 'a.jsonl')
    const next = line('m2', 'claude-opus-5-5', { input_tokens: 10 }) + '\n'
    writeFileSync(a, line('m1', 'claude-opus-5-5', { input_tokens: 1 }) + '\n' + next.slice(0, 20))
    expect(await total([a])).toBe(1)
    appendFileSync(a, next.slice(20))
    expect(await total([a])).toBe(11)
    expect(await total([a])).toBe(11)
  })

  it('reads a line that spans two 1 MB chunks', async () => {
    dir = mkdtempSync(join(tmpdir(), 'usage-'))
    const a = join(dir, 'a.jsonl')
    const usage = line('m1', 'claude-opus-5-5', { input_tokens: 3 })
    writeFileSync(a, 'x'.repeat((1 << 20) - 10) + '\n' + usage + '\n')
    expect(await total([a])).toBe(3)
  })

  it('rereads a file rewritten shorter from the start', async () => {
    dir = mkdtempSync(join(tmpdir(), 'usage-'))
    const a = join(dir, 'a.jsonl')
    writeFileSync(
      a,
      [
        line('m1', 'claude-opus-5-5', { input_tokens: 1 }),
        line('m2', 'claude-opus-5-5', { input_tokens: 10 })
      ].join('\n') + '\n'
    )
    expect(await total([a])).toBe(11)
    writeFileSync(a, line('m3', 'claude-opus-5-5', { input_tokens: 5 }) + '\n')
    expect(await total([a])).toBe(5)
  })

  it('rereads a file replaced by a larger one from the start', async () => {
    dir = mkdtempSync(join(tmpdir(), 'usage-'))
    const a = join(dir, 'a.jsonl')
    const b = join(dir, 'b.jsonl')
    writeFileSync(a, line('m1', 'claude-opus-5-5', { input_tokens: 1 }) + '\n')
    expect(await total([a])).toBe(1)
    writeFileSync(
      b,
      [
        line('m9', 'claude-opus-5-5', { input_tokens: 5 }),
        line('m8', 'claude-opus-5-5', { input_tokens: 7 })
      ].join('\n') + '\n'
    )
    renameSync(b, a)
    expect(await total([a])).toBe(12)
  })

  it('forgets cached files a scan did not see and keeps the ones it saw', async () => {
    dir = mkdtempSync(join(tmpdir(), 'usage-'))
    const a = join(dir, 'a.jsonl')
    const b = join(dir, 'b.jsonl')
    for (const f of [a, b]) {
      writeFileSync(f, line(f, 'claude-opus-5-5', { input_tokens: 1 }) + '\n')
      at(f, 1_000_000)
    }
    expect(await total([a, b])).toBe(2)
    for (const f of [a, b]) {
      writeFileSync(f, line(f, 'claude-opus-5-5', { input_tokens: 7 }) + '\n')
      at(f, 1_000_000)
    }
    keepCached(new Set([a]))
    expect(await total([a])).toBe(1)
    expect(await total([b])).toBe(7)
  })

  it('forgets a file it can no longer read', async () => {
    dir = mkdtempSync(join(tmpdir(), 'usage-'))
    const a = join(dir, 'a.jsonl')
    writeFileSync(a, line('m1', 'claude-opus-5-5', { input_tokens: 1 }) + '\n')
    at(a, 1_000_000)
    expect(await total([a])).toBe(1)
    rmSync(a)
    expect(await total([a])).toBe(0)
    writeFileSync(a, line('m1', 'claude-opus-5-5', { input_tokens: 7 }) + '\n')
    at(a, 1_000_000)
    expect(await total([a])).toBe(7)
  })
})

describe('working time', () => {
  const work = async (files: string[]): Promise<number> => (await transcriptTotals(files)).workMs
  let dir = ''
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('sums turn durations, counting a turn once across files and keeping ones with no uuid', async () => {
    dir = mkdtempSync(join(tmpdir(), 'usage-'))
    const a = join(dir, 'a.jsonl')
    const b = join(dir, 'b.jsonl')
    writeFileSync(
      a,
      [
        turn('t1', 1000),
        turn(undefined, 20),
        JSON.stringify({ type: 'system', subtype: 'compact_boundary', durationMs: 9e9 })
      ].join('\n') + '\n'
    )
    writeFileSync(b, [turn('t1', 1000), turn('t2', 300), turn(undefined, 4)].join('\n') + '\n')
    expect(await work([a, b, join(dir, 'missing.jsonl')])).toBe(1324)
  })

  it('reads turns appended since the last read', async () => {
    dir = mkdtempSync(join(tmpdir(), 'usage-'))
    const a = join(dir, 'a.jsonl')
    writeFileSync(a, turn('t1', 1000) + '\n')
    expect(await work([a])).toBe(1000)
    appendFileSync(a, turn('t2', 500) + '\n')
    expect(await work([a])).toBe(1500)
  })

  it('counts a turn only from where the previous one in its file ended, and never below 0', async () => {
    dir = mkdtempSync(join(tmpdir(), 'usage-'))
    const a = join(dir, 'a.jsonl')
    const at = (m: number): string => new Date(Date.UTC(2026, 9, 26, 10, m)).toISOString()
    writeFileSync(a, [turn('t1', 60_000, at(0)), turn('t2', 600_000, at(2))].join('\n') + '\n')
    expect(await work([a])).toBe(180_000)
    appendFileSync(a, [turn('t3', 3_600_000, at(3)), turn('t4', -5, at(9))].join('\n') + '\n')
    expect(await work([a])).toBe(240_000)
  })
})

describe('weeklyUsage', () => {
  let dir = ''
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const opus = (id: string, input: number, at?: Date): string =>
    line('m' + id, 'claude-opus-5-5', { input_tokens: input }, at?.toISOString())
  const inputs = (weeks: Awaited<ReturnType<typeof weeklyUsage>>): [string, number][] =>
    weeks.map((w) => [w.week, w.usage.reduce((sum, u) => sum + u.input, 0)])

  it('sums by week, newest first, counting a message once across files in its timestamp week', async () => {
    dir = mkdtempSync(join(tmpdir(), 'usage-'))
    const a = join(dir, 'a.jsonl')
    const b = join(dir, 'b.jsonl')
    writeFileSync(
      a,
      [opus('1', 1, new Date(2026, 9, 19, 9)), opus('2', 10, new Date(2026, 9, 25, 23))].join(
        '\n'
      ) + '\n'
    )
    writeFileSync(
      b,
      [opus('2', 10, new Date(2026, 9, 25, 23)), opus('3', 100, new Date(2026, 9, 26, 1))].join(
        '\n'
      ) + '\n'
    )
    expect(inputs(await weeklyUsage([a, b]))).toEqual([
      ['2026-10-26', 100],
      ['2026-10-19', 11]
    ])
  })

  it("puts a message without a timestamp in its file's week and keeps an unpriced model's tokens", async () => {
    dir = mkdtempSync(join(tmpdir(), 'usage-'))
    const a = join(dir, 'a.jsonl')
    writeFileSync(
      a,
      [opus('1', 1), line('m2', 'claude-future-9', { input_tokens: 5 }, 'not a date')].join('\n') +
        '\n'
    )
    const modified = new Date(2026, 9, 14, 12).getTime()
    utimesSync(a, modified / 1000, modified / 1000)
    expect(await weeklyUsage([a])).toEqual([
      {
        week: '2026-10-12',
        usage: [
          expect.objectContaining({ model: 'claude-future-9', input: 5, price: null }),
          expect.objectContaining({ model: 'claude-opus-5-5', input: 1 })
        ],
        workMs: 0
      }
    ])
  })

  it("counts a message split across files once, in its largest copy's week", async () => {
    dir = mkdtempSync(join(tmpdir(), 'usage-'))
    const a = join(dir, 'a.jsonl')
    const b = join(dir, 'b.jsonl')
    const sunday = new Date(2026, 9, 25, 23).toISOString()
    const monday = new Date(2026, 9, 26, 1).toISOString()
    writeFileSync(a, line('m', 'claude-opus-5-5', { output_tokens: 1 }, sunday) + '\n')
    writeFileSync(b, line('m', 'claude-opus-5-5', { output_tokens: 5 }, monday) + '\n')
    expect(await weeklyUsage([a, b])).toEqual([
      { week: '2026-10-26', usage: [expect.objectContaining({ output: 5 })], workMs: 0 }
    ])
  })

  it("adds each week's working time and keeps a week with only work", async () => {
    dir = mkdtempSync(join(tmpdir(), 'usage-'))
    const a = join(dir, 'a.jsonl')
    writeFileSync(
      a,
      [
        opus('1', 1, new Date(2026, 9, 19, 9)),
        turn('t1', 60_000, new Date(2026, 9, 19, 10).toISOString()),
        turn('t2', 5_000, new Date(2026, 9, 26, 10).toISOString())
      ].join('\n') + '\n'
    )
    expect(await weeklyUsage([a])).toEqual([
      { week: '2026-10-26', usage: [], workMs: 5_000 },
      { week: '2026-10-19', usage: [expect.objectContaining({ input: 1 })], workMs: 60_000 }
    ])
  })

  it('leaves out weeks without tokens', async () => {
    dir = mkdtempSync(join(tmpdir(), 'usage-'))
    const a = join(dir, 'a.jsonl')
    writeFileSync(a, opus('1', 0, new Date(2026, 9, 19, 9)) + '\n')
    expect(await weeklyUsage([a])).toEqual([])
  })
})

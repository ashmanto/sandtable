import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { logToFile } from './log'

let dir: string
const { error, warn } = console

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'sandtable-log-'))
  console.error = vi.fn()
  console.warn = vi.fn()
})

afterEach(async () => {
  console.error = error
  console.warn = warn
  await fs.rm(dir, { recursive: true, force: true })
})

describe('logToFile', () => {
  it('writes errors and warnings as timestamped lines, creating the folder', async () => {
    const printError = console.error
    const printWarn = console.warn
    const file = join(dir, 'logs', 'main.log')
    logToFile(join(dir, 'logs'))
    console.error('Saving the store failed', new Error('disk full'))
    console.warn('careful')
    const text = await fs.readFile(file, 'utf8')
    expect(text).toMatch(
      /^\d{4}-\d\d-\d\dT\S+ error Saving the store failed Error: disk full\n\s+at /
    )
    expect(text).toMatch(/\n\d{4}-\d\d-\d\dT\S+ warn careful\n$/)
    expect(printError).toHaveBeenCalledOnce()
    expect(printWarn).toHaveBeenCalledOnce()
  })

  it('rotates before a line would pass the cap, replacing an older main.old.log', async () => {
    await fs.writeFile(join(dir, 'main.old.log'), 'stale')
    logToFile(dir, 100)
    for (const c of 'abc') console.error(c.repeat(40))
    const log = await fs.readFile(join(dir, 'main.log'), 'utf8')
    const old = await fs.readFile(join(dir, 'main.old.log'), 'utf8')
    expect(log).toMatch(/^\S+ error c{40}\n$/)
    expect(old).toMatch(/^\S+ error b{40}\n$/)
    expect(log.length).toBeLessThanOrEqual(100)
  })

  it('cuts an entry longer than the cap to fit', async () => {
    logToFile(dir, 100)
    console.error('x'.repeat(500))
    expect((await fs.stat(join(dir, 'main.log'))).size).toBe(100)
  })

  it('recreates the folder when it is deleted while running', async () => {
    const file = join(dir, 'logs', 'main.log')
    logToFile(join(dir, 'logs'))
    console.error('before')
    await fs.rm(join(dir, 'logs'), { recursive: true })
    console.error('after')
    expect(await fs.readFile(file, 'utf8')).toMatch(/ error after\n$/)
  })

  it("keeps working when the file can't be written", async () => {
    const print = console.error
    await fs.writeFile(join(dir, 'a-file'), '')
    logToFile(join(dir, 'a-file'))
    expect(() => console.error('x')).not.toThrow()
    expect(print).toHaveBeenCalledWith('x')
  })
})

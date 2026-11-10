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
    logToFile(file)
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

  it('rotates to main.old.log past the cap, replacing an older one', async () => {
    const file = join(dir, 'main.log')
    await fs.writeFile(join(dir, 'main.old.log'), 'stale')
    logToFile(file, 100)
    for (let i = 0; i < 3; i++) console.error('x'.repeat(60))
    expect(await fs.readFile(join(dir, 'main.old.log'), 'utf8')).not.toContain('stale')
    expect((await fs.stat(file)).size).toBeLessThanOrEqual(200)
  })

  it('recreates the folder when it is deleted while running', async () => {
    const file = join(dir, 'logs', 'main.log')
    logToFile(file)
    console.error('before')
    await fs.rm(join(dir, 'logs'), { recursive: true })
    console.error('after')
    expect(await fs.readFile(file, 'utf8')).toMatch(/ error after\n$/)
  })

  it("keeps working when the file can't be written", async () => {
    const print = console.error
    await fs.writeFile(join(dir, 'a-file'), '')
    logToFile(join(dir, 'a-file', 'main.log'))
    expect(() => console.error('x')).not.toThrow()
    expect(print).toHaveBeenCalledWith('x')
  })
})

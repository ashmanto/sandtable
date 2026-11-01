import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readAppended } from './appended'

describe('readAppended', () => {
  let dir = ''
  beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), 'appended-'))))
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const read = async (text: string, start = 0): Promise<{ texts: string[]; offset: number }> => {
    const file = join(dir, 'f')
    writeFileSync(file, text)
    const handle = await open(file, 'r')
    try {
      const texts: string[] = []
      const offset = await readAppended(handle, start, Buffer.byteLength(text), (t) =>
        texts.push(t)
      )
      return { texts, offset }
    } finally {
      await handle.close()
    }
  }

  it('hands over complete lines and returns the offset after the last one', async () => {
    expect(await read('a\nbé\npart')).toEqual({ texts: ['a\nbé\n'], offset: 6 })
    expect(await read('a\nb\n', 2)).toEqual({ texts: ['b\n'], offset: 4 })
    expect(await read('part')).toEqual({ texts: [], offset: 0 })
  })

  it('carries a line across chunks', async () => {
    const long = 'x'.repeat(1.5 * (1 << 20))
    const { texts, offset } = await read(`${long}\ny\nz`)
    expect(texts.join('')).toBe(`${long}\ny\n`)
    expect(offset).toBe(long.length + 3)
  })

  it("passes each chunk's end offset with its lines", async () => {
    const file = join(dir, 'f')
    const first = `${'x'.repeat((1 << 20) - 1)}\n`
    writeFileSync(file, `${first}b\n`)
    const handle = await open(file, 'r')
    const ends: number[] = []
    try {
      await readAppended(handle, 0, first.length + 2, (_, end) => ends.push(end))
    } finally {
      await handle.close()
    }
    expect(ends).toEqual([1 << 20, (1 << 20) + 2])
  })
})

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWindowState, placeWindow } from './windowState'

const screen = { x: 0, y: 0, width: 1920, height: 1080 }
const right = { x: 1920, y: 0, width: 1440, height: 900 }

describe('placeWindow', () => {
  it('keeps bounds that fit', () => {
    const saved = { x: 2000, y: 100, width: 1000, height: 700 }
    expect(placeWindow(saved, [screen, right], screen)).toEqual(saved)
  })

  it('centers the default size on the primary display when off every display', () => {
    expect(placeWindow({ x: 5000, y: 5000, width: 1000, height: 700 }, [screen], screen)).toEqual({
      x: 360,
      y: 140,
      width: 1200,
      height: 800
    })
  })

  it('centers the default size when nothing is saved, capped to the display', () => {
    const small = { x: 0, y: 25, width: 1000, height: 600 }
    expect(placeWindow(undefined, [small], small)).toEqual(small)
  })

  it('widens bounds saved narrower than the minimum before keeping them on the display', () => {
    expect(placeWindow({ x: 1500, y: 0, width: 600, height: 700 }, [screen], screen)).toEqual({
      x: 1160,
      y: 0,
      width: 760,
      height: 700
    })
  })

  it('moves partly-off bounds inside the display they overlap most', () => {
    expect(
      placeWindow({ x: 3000, y: -50, width: 800, height: 600 }, [screen, right], screen)
    ).toEqual({ x: 2560, y: 0, width: 800, height: 600 })
  })

  it('gives the default for bounds with a missing field', () => {
    const broken = { x: 10, y: 10, width: 500 } as unknown as Parameters<typeof placeWindow>[0]
    expect(placeWindow(broken, [screen], screen)).toEqual({
      x: 360,
      y: 140,
      width: 1200,
      height: 800
    })
  })

  it('caps bounds larger than the display', () => {
    expect(placeWindow({ x: -10, y: 0, width: 3000, height: 2000 }, [screen], screen)).toEqual(
      screen
    )
  })
})

describe('createWindowState', () => {
  let dir: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'sandtable-window-'))
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('is empty when the file is missing, broken, or not an object', async () => {
    const file = join(dir, 'window-state.json')
    const state = createWindowState(file)
    await state.load()
    expect(state.get()).toEqual({})
    for (const text of ['not json', '[1]', 'null']) {
      await fs.writeFile(file, JSON.stringify({ bounds: { x: 0, y: 0, width: 1, height: 1 } }))
      await state.load()
      expect(state.get()).not.toEqual({})
      await fs.writeFile(file, text)
      await state.load()
      expect(state.get()).toEqual({})
    }
  })

  it('ends a burst of updates with the last state in the file', async () => {
    const file = join(dir, 'window-state.json')
    const state = createWindowState(file)
    await state.load()
    const updates = Array.from({ length: 20 }, (_, i) =>
      state.update({ bounds: { x: i, y: 0, width: 100, height: 100 } })
    )
    await Promise.all(updates)
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({
      bounds: { x: 19, y: 0, width: 100, height: 100 }
    })
  })

  it('saves quick updates in order', async () => {
    const file = join(dir, 'window-state.json')
    const state = createWindowState(file)
    await state.load()
    const bounds = { x: 1, y: 2, width: 300, height: 400 }
    void state.update({ bounds })
    await state.update({ view: { projectId: 'p1', ticketKey: 'k', tab: 'details' } })
    expect(state.get()).toEqual({
      bounds,
      view: { projectId: 'p1', ticketKey: 'k', tab: 'details' }
    })
    const reread = createWindowState(file)
    await reread.load()
    expect(reread.get()).toEqual(state.get())
  })

  it('flush waits for the pending write', async () => {
    const file = join(dir, 'window-state.json')
    const state = createWindowState(file)
    await state.load()
    void state.update({ sidebarHidden: true })
    await state.flush()
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ sidebarHidden: true })
  })
})

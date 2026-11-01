import type { Rectangle } from 'electron'
import { promises as fs } from 'node:fs'
import { parseJson } from '../shared/json'
import type { LastView } from '../shared/types'
import { serial, writeAtomic } from './store'

type WindowState = {
  bounds?: Rectangle
  maximized?: boolean
  fullScreen?: boolean
  sidebarHidden?: boolean
  sidebarWidth?: number
  view?: LastView
}

const overlap = (a: Rectangle, b: Rectangle): number =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))

const clamp = (n: number, min: number, max: number): number => Math.min(Math.max(n, min), max)

/** The narrowest the window gets. */
export const MIN_WIDTH = 760

/** The bounds to open at: `saved` moved and shrunk onto the display it overlaps most, or the default size centered on `primary`. */
export function placeWindow(
  saved: Rectangle | undefined,
  workAreas: Rectangle[],
  primary: Rectangle
): Rectangle {
  const area = saved && workAreas.toSorted((a, b) => overlap(saved, b) - overlap(saved, a))[0]
  if (!saved || !area || !(overlap(saved, area) > 0)) {
    const width = Math.min(1200, primary.width)
    const height = Math.min(800, primary.height)
    return {
      x: primary.x + Math.round((primary.width - width) / 2),
      y: primary.y + Math.round((primary.height - height) / 2),
      width,
      height
    }
  }
  const width = Math.min(Math.max(saved.width, MIN_WIDTH), area.width)
  const height = Math.min(saved.height, area.height)
  return {
    x: clamp(saved.x, area.x, area.x + area.width - width),
    y: clamp(saved.y, area.y, area.y + area.height - height),
    width,
    height
  }
}

/** The window state in memory, with its file. */
export type WindowStateStore = {
  load(): Promise<void>
  get(): WindowState
  update(patch: WindowState): Promise<void>
  flush(): Promise<void>
}

/** A window state saved to `file` after every change, one write at a time, with at most one write queued. */
export function createWindowState(file: string): WindowStateStore {
  let state: WindowState = {}
  const write = serial()
  let saving = Promise.resolve()
  let queued = false
  return {
    async load() {
      const data = parseJson(await fs.readFile(file, 'utf8').catch(() => ''))
      state = typeof data === 'object' && data && !Array.isArray(data) ? data : {}
    },
    get: () => state,
    update(patch) {
      state = { ...state, ...patch }
      if (queued) return saving
      queued = true
      saving = write(() => {
        queued = false
        return writeAtomic(file, JSON.stringify(state))
      }).catch((err) => console.error('Sandtable could not save the window state', err))
      return saving
    },
    flush: write.flush
  }
}

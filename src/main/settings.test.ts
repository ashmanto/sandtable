import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { NotificationSettings } from '../shared/types'
import {
  limitAlerts,
  loadSettings,
  notificationOptions,
  pickerStart,
  saveSettings
} from './settings'

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'sandtable-settings-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const notifications: NotificationSettings = {
  notify: true,
  sound: true,
  quietWhenFocused: false,
  limitPct: 80
}
const defaults = { theme: 'system', keepAwake: false, notifications, remoteControl: false }

describe('settings', () => {
  it('is the defaults when the file is missing', async () => {
    expect(await loadSettings(join(dir, 'settings.json'))).toEqual(defaults)
  })

  it('loads saved settings', async () => {
    const file = join(dir, 'settings.json')
    const saved = {
      theme: 'dark' as const,
      keepAwake: true,
      notifications: { notify: false, sound: false, quietWhenFocused: true, limitPct: null },
      remoteControl: true,
      lastFolder: '/code/sandtable'
    }
    await saveSettings(file, saved)
    expect(await loadSettings(file)).toEqual(saved)
  })

  it('loads a file from before Keep awake, Notifications, and Remote Control existed', async () => {
    const file = join(dir, 'settings.json')
    await fs.writeFile(file, '{"theme":"light"}')
    expect(await loadSettings(file)).toEqual({ ...defaults, theme: 'light' })
  })

  it('is the defaults for unknown values or broken JSON', async () => {
    const file = join(dir, 'settings.json')
    await fs.writeFile(
      file,
      '{"theme":"blue","keepAwake":"yes","notifications":{"notify":0,"sound":null,"limitPct":"80"},"remoteControl":1,"lastFolder":3}'
    )
    expect(await loadSettings(file)).toEqual(defaults)
    await fs.writeFile(file, 'not json')
    expect(await loadSettings(file)).toEqual(defaults)
  })
})

describe('notificationOptions', () => {
  it('sends with sound by default, focused or not', () => {
    expect(notificationOptions(notifications, false)).toEqual({ silent: false })
    expect(notificationOptions(notifications, true)).toEqual({ silent: false })
  })

  it('sends nothing with Notify off', () => {
    expect(notificationOptions({ ...notifications, notify: false }, false)).toBeNull()
  })

  it('sends silently with Play a sound off', () => {
    expect(notificationOptions({ ...notifications, sound: false }, false)).toEqual({ silent: true })
  })

  it('skips only while focused with Do not notify while in front on', () => {
    const quiet = { ...notifications, quietWhenFocused: true }
    expect(notificationOptions(quiet, true)).toBeNull()
    expect(notificationOptions(quiet, false)).toEqual({ silent: false })
  })
})

describe('limitAlerts', () => {
  const now = new Date(2026, 9, 31, 12, 0)
  const at = (h: number, day = 31): number => new Date(2026, 9, day, h, 0).getTime()
  const status = (five: number | null, week: number | null): Parameters<typeof limitAlerts>[0] => ({
    fiveHour: five === null ? null : { pct: five, resetsAt: at(16) },
    sevenDay: week === null ? null : { pct: week, resetsAt: at(9, 33) }
  })
  const me = { name: 'Default', dir: '/c' }
  const alerts = (
    s: Parameters<typeof limitAlerts>[0],
    sent = new Map<string, number>(),
    prefs: Partial<NotificationSettings> = {},
    account = me
  ): ReturnType<typeof limitAlerts> =>
    limitAlerts(s, { ...notifications, ...prefs }, sent, now, account)

  it('names each window past the threshold and when it resets', () => {
    expect(alerts(status(85, 80))).toEqual([
      { title: '5-hour limit 85% used', body: 'Resets 16:00', silent: false },
      { title: '7-day limit 80% used', body: 'Resets Mon 09:00', silent: false }
    ])
  })

  it('sends while in front and with Notify off, silently with Play a sound off', () => {
    const prefs = { notify: false, quietWhenFocused: true, sound: false }
    expect(alerts(status(85, null), undefined, prefs)).toEqual([
      { title: '5-hour limit 85% used', body: 'Resets 16:00', silent: true }
    ])
  })

  it('sends nothing with the threshold off, and sends later once it is on', () => {
    const sent = new Map<string, number>()
    expect(alerts(status(100, 100), sent, { limitPct: null })).toEqual([])
    expect(alerts(status(100, 100), sent)).toHaveLength(2)
  })

  it('sends nothing under the threshold or without limits, as on an API-key session', () => {
    expect(alerts(status(79, 10))).toEqual([])
    expect(alerts(status(null, null))).toEqual([])
  })

  it('sends once per window, even when the reset time moves by seconds, and again for the next', () => {
    const sent = new Map<string, number>()
    expect(alerts(status(81, null), sent)).toHaveLength(1)
    const moved = { fiveHour: { pct: 95, resetsAt: at(16) + 1000 }, sevenDay: null }
    expect(alerts(moved, sent)).toEqual([])
    const next = { fiveHour: { pct: 90, resetsAt: at(21) }, sevenDay: null }
    expect(alerts(next, sent)).toEqual([
      { title: '5-hour limit 90% used', body: 'Resets 21:00', silent: false }
    ])
  })

  it('forgets windows that have reset', () => {
    const sent = new Map([['/c:fiveHour:1', at(11)]])
    alerts(status(81, null), sent)
    expect([...sent.values()]).toEqual([at(16)])
  })

  it("tracks each account's windows apart and names only a known added account", () => {
    const sent = new Map<string, number>()
    expect(alerts(status(81, null), sent)).toHaveLength(1)
    expect(alerts(status(81, null), sent, {}, { name: 'Work', dir: '/w' })).toEqual([
      { title: '5-hour limit 81% used', body: 'Resets 16:00, on Work', silent: false }
    ])
    expect(alerts(status(81, null), sent, {}, { name: '', dir: '/gone' })).toEqual([
      { title: '5-hour limit 81% used', body: 'Resets 16:00', silent: false }
    ])
  })

  it('skips a window that has already reset', () => {
    expect(alerts({ fiveHour: { pct: 100, resetsAt: at(11) }, sevenDay: null })).toEqual([])
  })
})

describe('pickerStart', () => {
  it('is the parent of the last picked folder', async () => {
    await fs.mkdir(join(dir, 'repo'))
    expect(await pickerStart(join(dir, 'repo'), '/home')).toBe(dir)
  })

  it('is the home folder with no earlier pick', async () => {
    expect(await pickerStart(undefined, '/home')).toBe('/home')
  })

  it('is the home folder when the parent of the last pick is gone', async () => {
    expect(await pickerStart(join(dir, 'gone', 'repo'), '/home')).toBe('/home')
  })
})

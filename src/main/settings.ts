import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { parseJson } from '../shared/json'
import { LIMIT_PCTS, resetsText, type SessionStatus } from '../shared/sessionStatus'
import type { Account, NotificationSettings, Theme } from '../shared/types'
import { writeAtomic } from './store'

type AppSettings = {
  theme: Theme
  keepAwake: boolean
  notifications: NotificationSettings
  remoteControl: boolean
  lastFolder?: string
}

const themes: Theme[] = ['system', 'light', 'dark']

const flag = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback

type Saved = {
  theme?: unknown
  keepAwake?: unknown
  notifications?: Record<string, unknown>
  remoteControl?: unknown
  lastFolder?: unknown
}

/** Reads the saved settings, using the default for any that are missing or can't be read. */
export async function loadSettings(file: string): Promise<AppSettings> {
  const saved = ((await fs
    .readFile(file, 'utf8')
    .then(parseJson)
    .catch(() => null)) ?? {}) as Saved
  const n = saved.notifications ?? {}
  return {
    theme: themes.find((t) => t === saved.theme) ?? 'system',
    keepAwake: flag(saved.keepAwake, false),
    notifications: {
      notify: flag(n.notify, true),
      sound: flag(n.sound, true),
      quietWhenFocused: flag(n.quietWhenFocused, false),
      limitPct:
        n.limitPct === null || LIMIT_PCTS.includes(n.limitPct as number)
          ? (n.limitPct as number | null)
          : 80
    },
    remoteControl: flag(saved.remoteControl, false),
    lastFolder: typeof saved.lastFolder === 'string' ? saved.lastFolder : undefined
  }
}

/** The folder the repo picker opens in: the parent of the last pick, or `home` when there's none or it's gone. */
export async function pickerStart(last: string | undefined, home: string): Promise<string> {
  if (!last) return home
  const parent = dirname(last)
  const isDir = await fs.stat(parent).then(
    (s) => s.isDirectory(),
    () => false
  )
  return isDir ? parent : home
}

/** Saves the settings to `file`. */
export const saveSettings = (file: string, settings: AppSettings): Promise<void> =>
  writeAtomic(file, JSON.stringify(settings))

/** The options for the next **Needs you** notification, or `null` to skip it. */
export const notificationOptions = (
  settings: NotificationSettings,
  focused: boolean
): { silent: boolean } | null =>
  !settings.notify || (settings.quietWhenFocused && focused) ? null : { silent: !settings.sound }

const WINDOWS = [
  ['fiveHour', '5-hour'],
  ['sevenDay', '7-day']
] as const

/** A notification for each of `account`'s plan-limit windows at or past the threshold in `prefs` that isn't in `sent`, which maps each sent window to its reset time; it adds them and drops windows that have reset. */
export function limitAlerts(
  status: Pick<SessionStatus, 'fiveHour' | 'sevenDay'>,
  prefs: NotificationSettings,
  sent: Map<string, number>,
  now: Date,
  account: Account
): { title: string; body: string; silent: boolean }[] {
  const { limitPct } = prefs
  if (limitPct === null) return []
  for (const [id, resetsAt] of sent) if (resetsAt <= now.getTime()) sent.delete(id)
  const named = account.name && account.name !== 'Default' ? `, on ${account.name}` : ''
  return WINDOWS.flatMap(([key, name]) => {
    const w = status[key]
    if (!w || w.pct < limitPct || w.resetsAt <= now.getTime()) return []
    const id = `${account.dir}:${key}:${Math.round(w.resetsAt / 60_000)}`
    if (sent.has(id)) return []
    sent.set(id, w.resetsAt)
    return [
      {
        title: `${name} limit ${Math.round(w.pct)}% used`,
        body: `${resetsText(w.resetsAt, now)}${named}`,
        silent: !prefs.sound
      }
    ]
  })
}

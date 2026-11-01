import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { messageOf } from '../../../shared/errors'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/** Keeps an event from reaching the card or row around it. */
export const stop = (e: React.SyntheticEvent): void => e.stopPropagation()

/** The ID of the option at `at` in the listbox whose ID is `list`. */
export const optionId = (list: string, at: number): string => `${list}-${at}`

/** A count and a word, with an "s" unless the count is 1. */
export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** A path with the home folder shown as `~`. */
export const home = (path: string): string => path.replace(/^\/Users\/[^/]+/, '~')

/** A timestamp as "Oct 12". */
export const shortDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

/** A timestamp as "Oct 12, 2026, 14:05", for hover text. */
export const fullTime = (iso: string): string =>
  new Date(iso).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    hourCycle: 'h23'
  })

/** An error's message without the "Error invoking remote method" prefix Electron adds over IPC. */
export function errorMessage(err: unknown): string {
  const message = messageOf(err)
  return message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
}

/** Whether the user asked for reduced motion. */
export const still = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches

/** Whether the user asked for reduced motion, and a curve token's value, ease-out if unset. */
export function motion(curve: string): { still: boolean; easing: string } {
  return {
    still: still(),
    easing: getComputedStyle(document.documentElement).getPropertyValue(curve) || 'ease-out'
  }
}

/** Saves a value as JSON under the key in localStorage. */
export const saveSaved = (key: string, value: unknown): void =>
  localStorage.setItem(key, JSON.stringify(value))

/** A saved board filter: whether it shows only or hides tickets with the values in `field`. */
export type SavedFilter<F extends string> = { mode: 'only' | 'hide' } & Record<F, string[]>

/** Whether a filter with `values` lets an item show: no values, or any matching it exactly when it shows only. */
export const passesFilter = (
  f: { mode: 'only' | 'hide' },
  values: string[],
  match: (value: string) => boolean
): boolean => values.length === 0 || values.some(match) === (f.mode === 'only')

/** The filter saved under `key`, or no filter if it's missing or bad. */
export const loadFilter = <F extends string>(key: string, field: F): SavedFilter<F> =>
  loadSaved(key, { mode: 'only', [field]: [] } as SavedFilter<F>, (f) => {
    const values: unknown = f?.[field]
    return (f?.mode === 'only' || f?.mode === 'hide') &&
      Array.isArray(values) &&
      values.every((v) => typeof v === 'string')
      ? ({ mode: f.mode, [field]: values } as SavedFilter<F>)
      : null
  })

/** The JSON saved under `key`, as `read` makes of it, or `fallback` if it's missing or bad. */
export function loadSaved<T>(
  key: string,
  fallback: T,
  read: (v: Partial<T> | null) => T | null
): T {
  try {
    return read(JSON.parse(localStorage.getItem(key) ?? 'null')) ?? fallback
  } catch {
    return fallback
  }
}

/** Text with each character that reverses its direction shown as `<U+202E>` and the like. */
export const visible = (text: string): string =>
  text.replace(
    /[\u202a-\u202e\u2066-\u2069]/g,
    (c) => `<U+${c.charCodeAt(0).toString(16).toUpperCase()}>`
  )

/** The promise, failing as "Couldn't <what>: <message>" when it fails. */
export const couldnt = <T>(what: string, p: Promise<T>): Promise<T> =>
  p.catch((err) => {
    throw new Error(`Couldn't ${what}: ${errorMessage(err)}`, { cause: err })
  })

/** A key handler that runs `fn` on Enter instead of the default action. */
export const onEnter =
  (fn: () => void) =>
  (e: React.KeyboardEvent): void => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    fn()
  }

/** The ids with `id` added, or removed when it's there. */
export const flip = (ids: string[], id: string): string[] =>
  ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]

/** A button or anchor styled as an inline text link. */
export const textLink = 'rounded-sm text-accent-bright outline-none hover:underline focus-ring'

/** The ring a drop target gains while a dragged card is over it, and its fade. */
export const overRing = 'ring-1 ring-line-2 ring-inset'
export const ringFade = 'transition-shadow duration-(--speed-highlight-out) ease-(--ease-out-quad)'

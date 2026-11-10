import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { format } from 'node:util'

/** Copies every `console.error` and `console.warn` to `main.log` in `dir`, moving it to `main.old.log` before it would pass `cap` bytes. */
export function logToFile(dir: string, cap = 1_000_000): void {
  const file = join(dir, 'main.log')
  for (const level of ['error', 'warn'] as const) {
    const print = console[level]
    console[level] = (...args: unknown[]) => {
      print(...args)
      try {
        const line = Buffer.from(`${new Date().toISOString()} ${level} ${format(...args)}\n`)
        mkdirSync(dir, { recursive: true })
        const size = statSync(file, { throwIfNoEntry: false })?.size ?? 0
        if (size > 0 && size + line.length > cap) renameSync(file, join(dir, 'main.old.log'))
        appendFileSync(file, line.subarray(0, cap))
      } catch {
        // Logging never breaks the caller.
      }
    }
  }
}

import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { format } from 'node:util'

/** Copies every `console.error` and `console.warn` to `file`, moving it to `.old.log` past `cap` bytes. */
export function logToFile(file: string, cap = 1_000_000): void {
  const oldFile = file.replace(/\.log$/, '.old.log')
  try {
    mkdirSync(dirname(file), { recursive: true })
  } catch {
    // The writes below fail quietly too.
  }
  for (const level of ['error', 'warn'] as const) {
    const print = console[level]
    console[level] = (...args: unknown[]) => {
      print(...args)
      try {
        if ((statSync(file, { throwIfNoEntry: false })?.size ?? 0) > cap) renameSync(file, oldFile)
        appendFileSync(file, `${new Date().toISOString()} ${level} ${format(...args)}\n`)
      } catch {
        // Logging never breaks the caller.
      }
    }
  }
}

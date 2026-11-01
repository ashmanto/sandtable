import { promises as fs } from 'node:fs'

/** Calls `show` unless `marker` exists, and creates `marker` so it never shows again. */
export async function warnNotificationsOffOnce(
  marker: string,
  show: () => void | Promise<unknown>
): Promise<void> {
  try {
    await fs.writeFile(marker, '', { flag: 'wx' })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return
    throw err
  }
  await show()
}

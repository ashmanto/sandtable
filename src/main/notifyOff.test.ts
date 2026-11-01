import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { warnNotificationsOffOnce } from './notifyOff'

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'sandtable-notify-off-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('warnNotificationsOffOnce', () => {
  it('shows the first time and writes the marker', async () => {
    const marker = join(dir, 'notifications-off-shown')
    const show = vi.fn()
    await warnNotificationsOffOnce(marker, show)
    expect(show).toHaveBeenCalledOnce()
    await expect(fs.access(marker)).resolves.toBeUndefined()
  })

  it('shows only once, even for failures back to back', async () => {
    const marker = join(dir, 'notifications-off-shown')
    const show = vi.fn()
    await Promise.all([
      warnNotificationsOffOnce(marker, show),
      warnNotificationsOffOnce(marker, show)
    ])
    await warnNotificationsOffOnce(marker, show)
    expect(show).toHaveBeenCalledOnce()
  })

  it("doesn't show when an earlier run left the marker", async () => {
    const marker = join(dir, 'notifications-off-shown')
    await fs.writeFile(marker, '')
    const show = vi.fn()
    await warnNotificationsOffOnce(marker, show)
    expect(show).not.toHaveBeenCalled()
  })
})

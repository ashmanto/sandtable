import { describe, expect, it, vi } from 'vitest'
import { createDockBadge } from './dockBadge'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const setup = () => {
  const setBadge = vi.fn()
  return { setBadge, badge: createDockBadge(setBadge) }
}

describe('dockBadge', () => {
  it('shows the count, and clears when it drops to zero', () => {
    const t = setup()
    t.badge.setCount(3)
    expect(t.setBadge).toHaveBeenLastCalledWith('3')
    t.badge.setCount(0)
    expect(t.setBadge).toHaveBeenLastCalledWith('')
  })

  it('hides while Sandtable is the active app and comes back when it is not', () => {
    const t = setup()
    t.badge.setActive(true)
    t.badge.setCount(2)
    expect(t.setBadge).toHaveBeenLastCalledWith('')
    t.badge.setActive(false)
    expect(t.setBadge).toHaveBeenLastCalledWith('2')
  })
})

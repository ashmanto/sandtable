import { describe, expect, it, vi } from 'vitest'
import { createKeepAwake } from './keepAwake'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const setup = (enabled: boolean, running = true) => {
  const state = { running }
  const blocker = { start: vi.fn(() => 7), stop: vi.fn() }
  const onActive = vi.fn()
  const keepAwake = createKeepAwake({ blocker, running: () => state.running, enabled, onActive })
  return { state, blocker, onActive, keepAwake }
}

describe('keepAwake', () => {
  it('blocks app suspension while it is on and a session runs', () => {
    const t = setup(true)
    t.keepAwake.update()
    expect(t.blocker.start).toHaveBeenCalledWith('prevent-app-suspension')
    expect(t.keepAwake.active()).toBe(true)
    expect(t.onActive).toHaveBeenLastCalledWith(true)
  })

  it('starts the block only once while sessions keep running', () => {
    const t = setup(true)
    t.keepAwake.update()
    t.keepAwake.update()
    expect(t.blocker.start).toHaveBeenCalledTimes(1)
    expect(t.onActive).toHaveBeenCalledTimes(1)
  })

  it('stops the block when no session runs, and starts it again when one does', () => {
    const t = setup(true)
    t.keepAwake.update()
    t.state.running = false
    t.keepAwake.update()
    expect(t.blocker.stop).toHaveBeenCalledWith(7)
    expect(t.keepAwake.active()).toBe(false)
    expect(t.onActive).toHaveBeenLastCalledWith(false)
    t.state.running = true
    t.keepAwake.update()
    expect(t.blocker.start).toHaveBeenCalledTimes(2)
  })

  it('never blocks while it is off', () => {
    const t = setup(false)
    t.keepAwake.update()
    expect(t.blocker.start).not.toHaveBeenCalled()
    expect(t.keepAwake.active()).toBe(false)
  })

  it('starts and stops with the setting', () => {
    const t = setup(false)
    t.keepAwake.setEnabled(true)
    expect(t.keepAwake.enabled()).toBe(true)
    expect(t.blocker.start).toHaveBeenCalledTimes(1)
    t.keepAwake.setEnabled(false)
    expect(t.blocker.stop).toHaveBeenCalledWith(7)
    expect(t.keepAwake.active()).toBe(false)
  })
})

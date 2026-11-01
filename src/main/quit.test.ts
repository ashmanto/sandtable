import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import { quitAfter } from './quit'

const event = (): { preventDefault: Mock<() => void> } => ({ preventDefault: vi.fn() })

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('quitAfter', () => {
  it('holds every quit until the one flush finishes, then quits once', async () => {
    let finish!: () => void
    const flush = vi.fn(() => new Promise<void>((r) => (finish = r)))
    const quit = vi.fn()
    const onQuit = quitAfter(flush, quit)
    const first = event()
    const second = event()
    onQuit(first)
    onQuit(second)
    expect(first.preventDefault).toHaveBeenCalled()
    expect(second.preventDefault).toHaveBeenCalled()
    await Promise.resolve()
    expect(flush).toHaveBeenCalledTimes(1)
    expect(quit).not.toHaveBeenCalled()
    finish()
    await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1))
    const last = event()
    onQuit(last)
    expect(last.preventDefault).not.toHaveBeenCalled()
  })

  it('quits after 5 seconds when the flush never finishes', async () => {
    vi.useFakeTimers()
    const quit = vi.fn()
    quitAfter(() => new Promise(() => undefined), quit)(event())
    await vi.advanceTimersByTimeAsync(4999)
    expect(quit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(quit).toHaveBeenCalledTimes(1)
  })

  it('quits when the flush fails', async () => {
    const quit = vi.fn()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    quitAfter(() => Promise.reject(new Error('disk full')), quit)(event())
    await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1))
  })
  it('quits when the flush throws before returning a promise', async () => {
    const quit = vi.fn()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const onQuit = quitAfter(() => {
      throw new Error('disk full')
    }, quit)
    onQuit(event())
    await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1))
    const last = event()
    onQuit(last)
    expect(last.preventDefault).not.toHaveBeenCalled()
  })
})

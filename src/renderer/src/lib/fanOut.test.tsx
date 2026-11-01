import { describe, expect, it, vi } from 'vitest'
import { fanOut, listenerSet } from './fanOut'

describe('listenerSet', () => {
  it('tells every listener, and opens on the first and closes after the last, once each', () => {
    const close = vi.fn()
    const open = vi.fn(() => close)
    const { subscribe, changed } = listenerSet<[number]>(open)
    const a = vi.fn()
    const b = vi.fn()
    const offA = subscribe(a)
    const offB = subscribe(b)
    expect(open).toHaveBeenCalledTimes(1)
    changed(3)
    expect(a).toHaveBeenCalledWith(3)
    expect(b).toHaveBeenCalledWith(3)
    offA()
    expect(close).not.toHaveBeenCalled()
    offB()
    offB()
    expect(close).toHaveBeenCalledTimes(1)
    subscribe(a)
    expect(open).toHaveBeenCalledTimes(2)
  })
})

describe('fanOut', () => {
  it('shares one subscription and passes on each push', () => {
    let push: (id: string, value: number) => void = () => undefined
    const off = vi.fn()
    const sub = vi.fn((cb: typeof push) => {
      push = cb
      return off
    })
    const follow = fanOut(sub)
    const a = vi.fn()
    const stopA = follow(a)
    const stopB = follow(vi.fn())
    push('s1', 2)
    expect(a).toHaveBeenCalledWith('s1', 2)
    expect(sub).toHaveBeenCalledTimes(1)
    stopA()
    stopB()
    expect(off).toHaveBeenCalledTimes(1)
  })
})

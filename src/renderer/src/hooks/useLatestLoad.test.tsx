import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useLatestLoad } from './useLatestLoad'

const deferred = <T,>(): { promise: Promise<T>; resolve: (v: T) => void } => {
  let resolve: (v: T) => void = () => {}
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe('useLatestLoad', () => {
  it('keeps only the latest load', async () => {
    const { result } = renderHook(() => useLatestLoad<string>())
    const first = deferred<string>()
    const second = deferred<string>()
    let a: Promise<void> = Promise.resolve()
    let b: Promise<void> = Promise.resolve()
    act(() => {
      a = result.current.load(() => first.promise)
    })
    act(() => {
      b = result.current.load(() => second.promise)
    })
    expect(result.current.loading).toBe(true)
    await act(async () => {
      second.resolve('second')
      await b
    })
    await act(async () => {
      first.resolve('first')
      await a
    })
    expect(result.current.data).toBe('second')
    expect(result.current.loading).toBe(false)
  })

  it('turns a failed load or a throwing apply into error', async () => {
    const { result } = renderHook(() => useLatestLoad<string[]>())
    await act(() => result.current.load(() => Promise.reject(new Error('No network'))))
    expect(result.current.error).toBe('No network')
    await act(() =>
      result.current.load(
        () => Promise.resolve([]),
        () => {
          throw new Error('Run `linear auth login`.')
        }
      )
    )
    expect(result.current.data).toEqual([])
    expect(result.current.error).toBe('Run `linear auth login`.')
    expect(result.current.loading).toBe(false)
  })

  it('drops a cancelled load and stops loading', async () => {
    const { result } = renderHook(() => useLatestLoad('kept'))
    const pending = deferred<string>()
    let load: Promise<void> = Promise.resolve()
    act(() => {
      load = result.current.load(() => pending.promise)
    })
    act(() => result.current.cancel())
    expect(result.current.loading).toBe(false)
    await act(async () => {
      pending.resolve('late')
      await load
    })
    expect(result.current.data).toBe('kept')
  })

  it('clears the error when cancelled', async () => {
    const { result } = renderHook(() => useLatestLoad<string>())
    await act(() => result.current.load(() => Promise.reject(new Error('No network'))))
    act(() => result.current.cancel())
    expect(result.current.error).toBeNull()
  })
})

import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useLoad } from './useLoad'

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

it('ignores a response that arrives after its deps changed', async () => {
  const first = deferred<string>()
  const second = deferred<string>()
  const load = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  const { result, rerender } = renderHook(({ id }) => useLoad(() => load(id), [id]), {
    initialProps: { id: 'a' }
  })
  rerender({ id: 'b' })
  await act(async () => second.resolve('b'))
  await act(async () => first.resolve('a'))
  expect(result.current).toMatchObject({ data: 'b', error: null })
})

it('keeps the last data and reports the error message when a reload fails', async () => {
  const load = vi
    .fn()
    .mockResolvedValueOnce('a')
    .mockRejectedValueOnce(new Error("Error invoking remote method 'x': Error: down"))
  const { result, rerender } = renderHook(({ n }) => useLoad(load, [n]), {
    initialProps: { n: 0 }
  })
  await waitFor(() => expect(result.current.data).toBe('a'))
  rerender({ n: 1 })
  await waitFor(() => expect(result.current).toMatchObject({ data: 'a', error: 'down' }))
})

it("doesn't load while disabled", () => {
  const load = vi.fn().mockResolvedValue('a')
  renderHook(() => useLoad(load, [], false))
  expect(load).not.toHaveBeenCalled()
})

it('clears the error on reload until the next result', async () => {
  const next = deferred<string>()
  const load = vi.fn().mockRejectedValueOnce(new Error('down')).mockReturnValueOnce(next.promise)
  const { result } = renderHook(() => useLoad(load, []))
  await waitFor(() => expect(result.current.error).toBe('down'))
  act(() => result.current.reload())
  expect(result.current.error).toBeNull()
  expect(load).toHaveBeenCalledTimes(2)
  await act(async () => next.resolve('a'))
  expect(result.current.data).toBe('a')
})

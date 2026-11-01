import { act, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { ModelUsage } from '../../../shared/types'
import { fakeSandtable } from '../test/fixtures'
import { useLiveUsage } from './useLiveUsage'

const opus = (input: number): ModelUsage => ({
  model: 'claude-opus-5-5',
  name: 'Opus 5.5',
  input,
  output: 0,
  cacheWrite: 0,
  cacheRead: 0,
  price: null
})

function Shown({ id }: { id: string }): React.JSX.Element {
  return <p>{`${id}:${useLiveUsage()[id]?.[0].input ?? 'none'}`}</p>
}

it('shares one subscription across callers, loads once, follows pushes, and leaves with the last caller', async () => {
  const api = fakeSandtable()
  const off = vi.fn()
  let push: (u: Record<string, ModelUsage[]>) => void = () => {}
  vi.mocked(api.sessions.onLiveUsage).mockImplementation((cb) => {
    push = cb
    return off
  })
  vi.mocked(api.sessions.liveUsage).mockResolvedValue({ a: [opus(1)] })
  const { unmount } = render(
    <>
      <Shown id="a" />
      <Shown id="b" />
    </>
  )
  expect(await screen.findByText('a:1')).toBeInTheDocument()
  expect(api.sessions.onLiveUsage).toHaveBeenCalledTimes(1)
  expect(api.sessions.liveUsage).toHaveBeenCalledTimes(1)
  act(() => push({ a: [opus(2)], b: [opus(3)] }))
  expect(screen.getByText('a:2')).toBeInTheDocument()
  expect(screen.getByText('b:3')).toBeInTheDocument()
  unmount()
  expect(off).toHaveBeenCalledTimes(1)
})

it('keeps a push that arrives before the first load', async () => {
  const api = fakeSandtable()
  let push: (u: Record<string, ModelUsage[]>) => void = () => {}
  vi.mocked(api.sessions.onLiveUsage).mockImplementation((cb) => {
    push = cb
    return () => {}
  })
  let load: (u: Record<string, ModelUsage[]>) => void = () => {}
  vi.mocked(api.sessions.liveUsage).mockReturnValue(new Promise((r) => (load = r)))
  render(<Shown id="a" />)
  act(() => push({ a: [opus(5)] }))
  await act(async () => load({ a: [opus(1)] }))
  expect(screen.getByText('a:5')).toBeInTheDocument()
})

it("returns one session's usage, and keeps its reference when a push changes only another session", async () => {
  const api = fakeSandtable()
  let push: (u: Record<string, ModelUsage[]>) => void = () => {}
  vi.mocked(api.sessions.onLiveUsage).mockImplementation((cb) => {
    push = cb
    return () => {}
  })
  vi.mocked(api.sessions.liveUsage).mockResolvedValue({ a: [opus(1)], b: [opus(1)] })
  const renders = vi.fn()
  function One(): React.JSX.Element {
    const usage = useLiveUsage('a')
    renders(usage)
    return <p>{`a:${usage?.[0].input ?? 'none'}`}</p>
  }
  render(<One />)
  expect(await screen.findByText('a:1')).toBeInTheDocument()
  const before = renders.mock.calls.length
  act(() => push({ a: [opus(1)], b: [opus(2)] }))
  expect(renders).toHaveBeenCalledTimes(before)
  act(() => push({ a: [opus(3)], b: [opus(2)] }))
  expect(screen.getByText('a:3')).toBeInTheDocument()
})

it('stays empty when the first load fails', async () => {
  const api = fakeSandtable()
  vi.mocked(api.sessions.liveUsage).mockRejectedValue(new Error('gone'))
  render(<Shown id="a" />)
  await act(async () => {})
  expect(screen.getByText('a:none')).toBeInTheDocument()
})

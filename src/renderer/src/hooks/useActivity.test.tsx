import { act, render, screen } from '@testing-library/react'
import { expect, it, onTestFinished, vi } from 'vitest'
import type { Activity } from '../../../shared/types'
import { fakeSandtable } from '../test/fixtures'
import { useActivity } from './useActivity'

function Shown({ state }: { state: 'running' | 'idle' }): React.JSX.Element {
  const activity = useActivity({ id: 'a', state })
  return <p>{activity ? JSON.stringify(activity.steps) : 'none'}</p>
}

it('follows pushes after a failed load, and shows nothing once not running', async () => {
  const api = fakeSandtable()
  let push: (id: string, a: Activity) => void = () => {}
  vi.mocked(api.sessions.onActivity).mockImplementation((cb) => {
    push = cb
    return () => {}
  })
  let fail: (err: Error) => void = () => {}
  vi.mocked(api.sessions.activity).mockReturnValue(new Promise((_, r) => (fail = r)))
  const { rerender } = render(<Shown state="running" />)
  await act(async () => fail(new Error('gone')))
  act(() => push('a', { steps: ['Read a file'] } as unknown as Activity))
  expect(screen.getByText('["Read a file"]')).toBeInTheDocument()
  rerender(<Shown state="idle" />)
  expect(screen.getByText('none')).toBeInTheDocument()
})

it('renews now on each push and every 30 s', () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'], now: 0 })
  onTestFinished(() => {
    vi.useRealTimers()
  })
  const api = fakeSandtable()
  let push: (id: string, a: Activity) => void = () => {}
  vi.mocked(api.sessions.onActivity).mockImplementation((cb) => {
    push = cb
    return () => {}
  })
  vi.mocked(api.sessions.activity).mockReturnValue(new Promise(() => {}))
  function Now(): React.JSX.Element {
    return <p>{useActivity({ id: 'a', state: 'running' })?.now ?? 'none'}</p>
  }
  render(<Now />)
  vi.setSystemTime(10_000)
  act(() => push('a', { steps: [] } as unknown as Activity))
  expect(screen.getByText('10000')).toBeInTheDocument()
  act(() => {
    vi.advanceTimersByTime(30_000)
  })
  expect(screen.getByText('40000')).toBeInTheDocument()
})

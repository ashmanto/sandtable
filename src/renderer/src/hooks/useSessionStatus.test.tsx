import { act, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { SessionStatus } from '../../../shared/sessionStatus'
import { fakeSandtable } from '../test/fixtures'
import { useSessionStatus } from './useSessionStatus'

const status = (n: number): SessionStatus => ({ n }) as unknown as SessionStatus

function Shown({ id }: { id: string }): React.JSX.Element {
  return <p>{`${id}:${JSON.stringify(useSessionStatus(id))}`}</p>
}

it('status follows onStatus for its own session, loading once', async () => {
  const api = fakeSandtable()
  let push: (id: string, s: SessionStatus) => void = () => {}
  const off = vi.fn()
  vi.mocked(api.sessions.onStatus).mockImplementation((cb) => {
    push = cb
    return off
  })
  vi.mocked(api.sessions.status).mockResolvedValue(status(1))
  const { unmount } = render(<Shown id="a" />)
  expect(await screen.findByText('a:{"n":1}')).toBeInTheDocument()
  act(() => push('b', status(9)))
  expect(screen.getByText('a:{"n":1}')).toBeInTheDocument()
  act(() => push('a', status(2)))
  expect(screen.getByText('a:{"n":2}')).toBeInTheDocument()
  unmount()
  expect(off).toHaveBeenCalledTimes(1)
})

it('keeps a push that arrives before the first load', async () => {
  const api = fakeSandtable()
  let push: (id: string, s: SessionStatus) => void = () => {}
  vi.mocked(api.sessions.onStatus).mockImplementation((cb) => {
    push = cb
    return () => {}
  })
  let load: (s: SessionStatus) => void = () => {}
  vi.mocked(api.sessions.status).mockReturnValue(new Promise((r) => (load = r)))
  render(<Shown id="a" />)
  act(() => push('a', status(5)))
  await act(async () => load(status(1)))
  expect(screen.getByText('a:{"n":5}')).toBeInTheDocument()
})

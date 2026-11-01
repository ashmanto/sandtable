import { act, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { SetupProgress } from '../../../shared/types'
import { fakeSandtable } from '../test/fixtures'
import { useWorktreeSetup } from './useWorktreeSetup'

const progress = (state: SetupProgress['state']): SetupProgress => ({
  repo: 'octo/shop',
  state,
  notes: [],
  lines: [],
  startedAt: '2026-10-29T10:00:00Z'
})

function Shown({ target }: { target: string }): React.JSX.Element {
  return <p>{`${target}:${useWorktreeSetup(target)?.state ?? 'none'}`}</p>
}

it('shares one subscription, loads each target once, follows pushes, and leaves with the last caller', async () => {
  const api = fakeSandtable()
  const off = vi.fn()
  let push: (target: string, p: SetupProgress | null) => void = () => {}
  vi.mocked(api.setup.onProgress).mockImplementation((cb) => {
    push = cb
    return off
  })
  vi.mocked(api.setup.progress).mockImplementation(async (t) =>
    t === 'a' ? progress('failed') : null
  )
  const { unmount } = render(
    <>
      <Shown target="a" />
      <Shown target="a" />
      <Shown target="b" />
    </>
  )
  expect(await screen.findAllByText('a:failed')).toHaveLength(2)
  expect(api.setup.onProgress).toHaveBeenCalledTimes(1)
  expect(api.setup.progress).toHaveBeenCalledTimes(2)
  act(() => push('b', progress('running')))
  expect(screen.getByText('b:running')).toBeInTheDocument()
  act(() => push('a', null))
  expect(screen.getAllByText('a:none')).toHaveLength(2)
  unmount()
  expect(off).toHaveBeenCalledTimes(1)
})

it('keeps a push that arrives before the first load', async () => {
  const api = fakeSandtable()
  let push: (target: string, p: SetupProgress | null) => void = () => {}
  vi.mocked(api.setup.onProgress).mockImplementation((cb) => {
    push = cb
    return () => {}
  })
  let load: (p: SetupProgress | null) => void = () => {}
  vi.mocked(api.setup.progress).mockReturnValue(new Promise((r) => (load = r)))
  render(<Shown target="a" />)
  act(() => push('a', null))
  await act(async () => load(progress('failed')))
  expect(screen.getByText('a:none')).toBeInTheDocument()
})

import { renderHook } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { fakeSandtable } from '../test/fixtures'
import { useBoard } from './useBoard'

let state: DocumentVisibilityState
beforeEach(() => {
  window.sandtable = fakeSandtable()
  state = 'visible'
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => state)
})

it('tells the main process which project is open and whether the window shows', () => {
  const { rerender } = renderHook(({ id }) => useBoard(id), { initialProps: { id: 'p1' } })
  rerender({ id: 'p2' })
  state = 'hidden'
  document.dispatchEvent(new Event('visibilitychange'))
  expect(vi.mocked(window.sandtable.board.watch).mock.calls).toEqual([
    ['p1', true],
    ['p2', true],
    ['p2', false]
  ])
})

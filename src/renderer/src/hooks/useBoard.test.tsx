import { renderHook } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { boardView, fakeSandtable } from '../test/fixtures'
import { useStartFailure } from './useOverlapCheck'
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

it("hands the project's saved start failures to the cards", async () => {
  const failure = {
    kind: 'ticket' as const,
    name: 'Dark mode toggle',
    ticketKey: 'octo/shop#1',
    at: '2026-10-24T10:00:00.000Z',
    reason: 'tmux broke',
    repo: null
  }
  vi.mocked(window.sandtable.board.get).mockResolvedValue(
    boardView({ couldntStart: { p1: [failure] } })
  )
  renderHook(() => useBoard('p1'))
  const { result } = renderHook(() => useStartFailure('p1', 'octo/shop#1'))
  await vi.waitFor(() => expect(result.current).toEqual({ reason: 'tmux broke', repo: null }))
})

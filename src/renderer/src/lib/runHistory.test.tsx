import { expect, it, vi } from 'vitest'
import { dropRunHistoryAsk, onRunHistoryAsk, openRunHistory } from './runHistory'

it("keeps a Run history ask while you're on that project's board", () => {
  openRunHistory('p1', 'r1')
  dropRunHistoryAsk('p1')
  const open = vi.fn()
  onRunHistoryAsk('p1', ['r1'], open)()
  expect(open).toHaveBeenCalledWith('r1')
})

it("drops a Run history ask once you're anywhere but that project's board", () => {
  openRunHistory('p1', 'r1')
  dropRunHistoryAsk(null)
  const open = vi.fn()
  onRunHistoryAsk('p1', ['r1'], open)()
  expect(open).not.toHaveBeenCalled()
})

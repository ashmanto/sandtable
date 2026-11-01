import { act, render, renderHook, screen, type RenderHookResult } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Overlap } from '../../../shared/types'
import { folderError } from '../../../shared/repo'
import { OverlapCheck } from '../components/OverlapCheck'
import { fakeSandtable } from '../test/fixtures'
import { refineMessage, useOverlapCheck, usePendingAsk, type OverlapRun } from './useOverlapCheck'

const busy = [{ key: 'octo/shop#67', number: 67, title: 'Sort cards' }]
const pass = { overlap: busy, ready: false }
const overlap = [{ key: 'octo/shop#67', number: 67, title: 'Sort cards', reason: 'Same file.' }]
let finish: ((o: Overlap[]) => void)[]
let fail: ((e: Error) => void)[]

beforeEach(() => {
  window.sandtable = fakeSandtable()
  finish = []
  fail = []
  vi.mocked(window.sandtable.tickets.checkOverlap).mockImplementation(
    () =>
      new Promise((resolve, reject) => {
        finish.push(resolve)
        fail.push(reject)
      })
  )
})

const mount = (
  key: string,
  start = vi.fn(),
  onRefine?: () => void
): RenderHookResult<OverlapRun, unknown> =>
  renderHook(() => useOverlapCheck('p1', key, start, onRefine))

describe('useOverlapCheck', () => {
  it('starts with its note when Claude finds no overlap even after the card unmounts', async () => {
    const start = vi.fn()
    const card = mount('t#1', start)
    act(() => card.result.current.begin(['extra'], undefined, pass, 'A note'))
    card.unmount()
    await act(async () => finish[0]([]))
    expect(start).toHaveBeenCalledWith(['extra'], undefined, 'A note')
  })

  it('shows the same check after a remount and in another view of the ticket', async () => {
    const card = mount('t#2')
    act(() => card.result.current.begin([], undefined, pass))
    card.unmount()
    const view = mount('t#2')
    expect(view.result.current.check).toMatchObject({ kind: 'waiting' })
    await act(async () => finish[0](overlap))
    expect(view.result.current.check).toMatchObject({ kind: 'overlaps', overlaps: overlap })
    act(() => view.result.current.cancel())
    expect(view.result.current.check).toBeNull()
  })

  it('ignores the first run after Cancel and a new Start', async () => {
    const start = vi.fn()
    const card = mount('t#3', start)
    act(() => card.result.current.begin([], undefined, pass))
    act(() => card.result.current.cancel())
    act(() => card.result.current.begin([], undefined, pass))
    await act(async () => finish[0]([]))
    expect(start).not.toHaveBeenCalled()
    expect(card.result.current.check).toMatchObject({ kind: 'waiting' })
    await act(async () => finish[1](overlap))
    expect(card.result.current.check).toMatchObject({ kind: 'overlaps' })
    act(() => card.result.current.cancel())
  })

  it('goes straight to start on a folder error so Choose folder can run', async () => {
    const start = vi.fn()
    const card = mount('t#4', start)
    act(() => card.result.current.begin([], undefined, pass))
    await act(async () => fail[0](new Error(folderError('octo/shop'))))
    expect(start).toHaveBeenCalledWith([], undefined, undefined)
    expect(card.result.current.check).toBeNull()
  })
})

describe('the readiness step', () => {
  const ready = { overlap: busy, ready: true }
  const gaps = ['No way to tell when it’s done']
  let answer: ((g: string[]) => void)[]
  let refuse: ((e: Error) => void)[]
  beforeEach(() => {
    answer = []
    refuse = []
    vi.mocked(window.sandtable.tickets.checkReady).mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          answer.push(resolve)
          refuse.push(reject)
        })
    )
  })

  it('goes on to the overlap check with the candidates as they are after the wait', async () => {
    vi.mocked(window.sandtable.tickets.checkStart).mockResolvedValue({
      triage: false,
      problems: [],
      overlap: busy,
      ready: false
    })
    const card = mount('r#1')
    act(() => card.result.current.begin([], undefined, { overlap: [], ready: true }))
    expect(card.result.current.check).toMatchObject({ kind: 'readying' })
    expect(window.sandtable.tickets.checkReady).toHaveBeenCalledWith('p1', 'r#1')
    await act(async () => answer[0]([]))
    expect(card.result.current.check).toMatchObject({ kind: 'waiting', candidates: busy })
    act(() => card.result.current.cancel())
  })

  it('starts at once with no gaps when nothing overlaps any more', async () => {
    const start = vi.fn()
    const card = mount('r#2', start)
    act(() => card.result.current.begin(['x'], 'a/b', ready, 'n'))
    await act(async () => answer[0]([]))
    expect(start).toHaveBeenCalledWith(['x'], 'a/b', 'n')
    expect(card.result.current.check).toBeNull()
  })

  it('shows the gaps, and Start anyway goes on to the overlap check', async () => {
    const card = mount('r#3')
    act(() => card.result.current.begin([], undefined, ready))
    await act(async () => answer[0](gaps))
    expect(card.result.current.check).toMatchObject({ kind: 'gaps', gaps })
    vi.mocked(window.sandtable.tickets.checkStart).mockResolvedValue({
      triage: false,
      problems: [],
      overlap: busy,
      ready: false
    })
    await act(async () => card.result.current.startAnyway())
    expect(card.result.current.check).toMatchObject({ kind: 'waiting' })
    expect(window.sandtable.tickets.checkOverlap).toHaveBeenCalledWith('p1', 'r#3')
    act(() => card.result.current.cancel())
  })

  it('shows a failure with no gaps, and goes straight to start on a folder error', async () => {
    const start = vi.fn()
    const card = mount('r#4', start)
    act(() => card.result.current.begin([], undefined, ready))
    await act(async () => refuse[0](new Error("Readiness check didn't finish within 3 minutes")))
    expect(card.result.current.check).toMatchObject({
      kind: 'gaps',
      gaps: [],
      error: "Readiness check didn't finish within 3 minutes"
    })
    act(() => card.result.current.begin([], undefined, ready))
    await act(async () => refuse[1](new Error(folderError('octo/shop'))))
    expect(start).toHaveBeenCalledWith([], undefined, undefined)
  })

  it('Refine in chat clears the check and leaves the gaps for the chat', async () => {
    const onRefine = vi.fn()
    const card = mount('r#5', vi.fn(), onRefine)
    const pending = renderHook(() => usePendingAsk('p1', 'r#5'))
    act(() => card.result.current.begin([], undefined, ready))
    await act(async () => answer[0](gaps))
    act(() => card.result.current.refine())
    expect(card.result.current.check).toBeNull()
    expect(onRefine).toHaveBeenCalled()
    expect(pending.result.current[0]).toBe(refineMessage(gaps))
    expect(refineMessage(gaps)).toContain('\n> - No way to tell when it’s done\n\nHelp me')
    act(() => expect(pending.result.current[1]()).toBe(refineMessage(gaps)))
    expect(pending.result.current[0]).toBeNull()
    expect(pending.result.current[1]()).toBeNull()
  })
})

describe('OverlapCheck', () => {
  it('leaves the area out of the fallback when the ticket has none', () => {
    const check: OverlapRun['check'] = {
      kind: 'failed',
      error: 'Boom',
      extraRepos: [],
      candidates: busy
    }
    render(
      <OverlapCheck
        check={check}
        begin={vi.fn()}
        cancel={vi.fn()}
        startAnyway={vi.fn()}
        refine={vi.fn()}
        area={undefined}
      />
    )
    expect(
      screen.getByText('By area label: #67 is in progress in the same area.')
    ).toBeInTheDocument()
  })
})

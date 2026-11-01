import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FollowScroller } from '@/components/ChatParts'
import { useFollowEnd } from './useFollowEnd'

let grow: () => void
let height: number
let reduced: boolean

beforeEach(() => {
  height = 1000
  reduced = false
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: () => void) {
        grow = () => act(cb)
      }
      observe = vi.fn()
      disconnect = vi.fn()
    }
  )
  vi.stubGlobal('matchMedia', () => ({ matches: reduced }))
})
afterEach(() => vi.unstubAllGlobals())

function View(): React.JSX.Element {
  const { ref, follow, away } = useFollowEnd()
  return (
    <FollowScroller follower={ref} away={away} onEnd={follow} data-testid="view">
      <button onClick={follow}>Send</button>
      <textarea aria-label="Draft" />
    </FollowScroller>
  )
}

function setup(): {
  el: HTMLElement
  scrollTo: ReturnType<typeof vi.fn>
  scroll: (top: number) => void
  place: (top: number) => void
} {
  const { getByTestId } = render(<View />)
  const el = getByTestId('view')
  let top = 0
  const place = (to: number): void => {
    top = to
  }
  const scroll = (to: number): void => {
    place(to)
    act(() => {
      el.dispatchEvent(new Event('scroll'))
    })
  }
  const scrollTo = vi.fn()
  Object.defineProperties(el, {
    scrollHeight: { get: () => height },
    clientHeight: { value: 200 },
    scrollTop: { get: () => top, configurable: true },
    scrollTo: { value: scrollTo }
  })
  grow()
  scroll(800)
  el.dispatchEvent(new Event('scrollend'))
  return { el, scrollTo, scroll, place }
}

describe('useFollowEnd', () => {
  it('jumps into a loaded conversation, then glides as content grows with no new entry', () => {
    const { scrollTo } = setup()
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 1000, behavior: 'instant' })
    height = 1150
    grow()
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 1150, behavior: 'smooth' })
  })

  it("doesn't read its own glide's scroll events as you scrolling away", () => {
    const { scrollTo, scroll } = setup()
    height = 1150
    grow()
    scroll(850)
    height = 1250
    grow()
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 1250, behavior: 'smooth' })
  })

  it('stays where you scrolled up to read, and follows again once you return to the end', () => {
    const { el, scrollTo, scroll } = setup()
    scroll(400)
    el.dispatchEvent(new Event('scrollend'))
    scrollTo.mockClear()
    height = 1300
    grow()
    expect(scrollTo).not.toHaveBeenCalled()
    scroll(1100)
    height = 1450
    grow()
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 1450, behavior: 'smooth' })
  })

  it('keeps following when content shrinks and grows again before the scroll event', () => {
    const { scrollTo, scroll, place } = setup()
    height = 970
    place(770)
    grow()
    height = 1270
    scroll(770)
    grow()
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 1270, behavior: 'instant' })
  })

  it("stays on a find match whose fold grows before the match's scroll event", () => {
    const { el, scrollTo } = setup()
    scrollTo.mockClear()
    Object.defineProperty(el, 'scrollTop', { get: () => 300 })
    height = 1300
    grow()
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('glides to the end when you send, and jumps when the end is over a view away', () => {
    const { el, scrollTo, scroll } = setup()
    scroll(700)
    el.querySelector('button')!.click()
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 1000, behavior: 'smooth' })
    height = 1050
    grow()
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 1050, behavior: 'smooth' })
    scroll(100)
    el.querySelector('button')!.click()
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 1050, behavior: 'instant' })
  })

  it("doesn't follow while you type in a box that grows", () => {
    const { el, scrollTo } = setup()
    scrollTo.mockClear()
    el.querySelector('textarea')!.focus()
    height = 1150
    grow()
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('shows Scroll to end only while you are away from the end, and follows again after it', () => {
    const { scrollTo, scroll } = setup()
    expect(screen.queryByRole('button', { name: 'Scroll to end' })).toBeNull()
    scroll(400)
    fireEvent.click(screen.getByRole('button', { name: 'Scroll to end' }))
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 1000, behavior: 'instant' })
    expect(screen.queryByRole('button', { name: 'Scroll to end' })).toBeNull()
    scroll(800)
    height = 1150
    grow()
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 1150, behavior: 'smooth' })
  })

  it('stops following on a short scroll up right after its own jump', () => {
    reduced = true
    const { scrollTo, scroll, place } = setup()
    scrollTo.mockImplementation(({ top }: { top: number }) => place(top - 200))
    height = 1300
    grow()
    scroll(1000)
    expect(screen.getByRole('button', { name: 'Scroll to end' })).toBeTruthy()
  })

  it('follows again when the view grows to show the end with no scroll', () => {
    const { scroll } = setup()
    scroll(400)
    height = 600
    grow()
    expect(screen.queryByRole('button', { name: 'Scroll to end' })).toBeNull()
  })

  it('glides back from under a view away, and jumps under reduced motion', () => {
    const { scrollTo, scroll } = setup()
    scroll(700)
    fireEvent.click(screen.getByRole('button', { name: 'Scroll to end' }))
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 1000, behavior: 'smooth' })
    reduced = true
    scroll(650)
    fireEvent.click(screen.getByRole('button', { name: 'Scroll to end' }))
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 1000, behavior: 'instant' })
  })

  it('jumps with no animation under reduced motion', () => {
    reduced = true
    const { scrollTo } = setup()
    height = 1150
    grow()
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 1150, behavior: 'instant' })
  })
})

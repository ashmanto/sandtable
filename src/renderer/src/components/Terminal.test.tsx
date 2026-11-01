import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SandtableApi } from '../../../shared/api'
import { fakeSandtable } from '../test/fixtures'

const { calls, terms, FakeTerm } = vi.hoisted(() => {
  const calls: string[] = []
  const terms: InstanceType<typeof FakeTerm>[] = []
  class FakeTerm {
    cols = 80
    rows = 24
    options = {}
    written: string[] = []
    dataHandler: (d: string) => void = () => {}
    keyHandler: (e: KeyboardEvent) => boolean = () => true
    attachCustomKeyEventHandler = (h: (e: KeyboardEvent) => boolean): void => {
      this.keyHandler = h
    }
    constructor() {
      terms.push(this)
    }
    loadAddon = vi.fn()
    open = vi.fn()
    focus = vi.fn()
    write = (d: string): void => void this.written.push(d)
    onData = (cb: (d: string) => void): { dispose: () => void } => {
      this.dataHandler = cb
      return { dispose: () => void calls.push('input.dispose') }
    }
    dispose = (): void => void calls.push('dispose')
  }
  return { calls, terms, FakeTerm }
})

vi.mock('@xterm/xterm', () => ({ Terminal: FakeTerm }))
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = vi.fn()
  }
}))

import { Terminal } from './Terminal'

let api: SandtableApi
let resizeCb: () => void
let dataCb: (id: string, data: string) => void
const off = vi.fn(() => void calls.push('offData'))

beforeEach(() => {
  calls.length = 0
  terms.length = 0
  api = fakeSandtable()
  vi.mocked(api.terminal.onData).mockImplementation((cb) => {
    dataCb = cb
    return off
  })
  vi.mocked(api.terminal.close).mockImplementation(() => void calls.push('close'))
  vi.mocked(api.terminal.open).mockImplementation(async () => void calls.push('open'))
  globalThis.ResizeObserver = class {
    constructor(cb: () => void) {
      resizeCb = cb
    }
    observe = vi.fn()
    disconnect = vi.fn()
  } as unknown as typeof ResizeObserver
  window.matchMedia = vi.fn(() => ({
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  })) as unknown as typeof window.matchMedia
})

describe('Terminal', () => {
  it('moves the focus out on F6, and back on Shift+F6, leaving other keys to the terminal', () => {
    render(
      <>
        <button>Before</button>
        <Terminal sessionId="s1" />
        <button>After</button>
      </>
    )
    const key = (init: KeyboardEventInit, type = 'keydown'): boolean =>
      terms[0].keyHandler(new KeyboardEvent(type, init))
    expect(key({ key: 'Tab' })).toBe(true)
    expect(key({ key: 'F6' }, 'keyup')).toBe(false)
    expect(document.body).toHaveFocus()
    expect(key({ key: 'F6' })).toBe(false)
    expect(document.activeElement).toHaveTextContent('After')
    expect(key({ key: 'F6', shiftKey: true })).toBe(false)
    expect(document.activeElement).toHaveTextContent('Before')
  })

  it('opens once with the fitted size and routes data by session', () => {
    render(<Terminal sessionId="s1" />)
    expect(api.terminal.open).toHaveBeenCalledTimes(1)
    expect(api.terminal.open).toHaveBeenCalledWith('s1', 80, 24)
    dataCb('other', 'nope')
    dataCb('s1', 'yes')
    expect(terms[0].written).toEqual(['yes'])
    terms[0].dataHandler('ls')
    expect(api.terminal.write).toHaveBeenCalledWith('s1', 'ls')
  })

  it('unsubscribes, closes, then disposes on unmount', () => {
    const { unmount } = render(<Terminal sessionId="s1" />)
    calls.length = 0
    unmount()
    expect(calls).toEqual(['offData', 'input.dispose', 'close', 'dispose'])
    expect(api.terminal.close).toHaveBeenCalledWith('s1')
  })

  it('resizes only when the size changed', () => {
    render(<Terminal sessionId="s1" />)
    resizeCb()
    expect(api.terminal.resize).not.toHaveBeenCalled()
    terms[0].cols = 100
    resizeCb()
    expect(api.terminal.resize).toHaveBeenCalledWith('s1', 100, 24)
  })

  it('shows a stripped error when open fails', async () => {
    vi.mocked(api.terminal.open).mockRejectedValue(
      new Error("Error invoking remote method 'terminal.open': Error: Unknown session")
    )
    render(<Terminal sessionId="s1" />)
    await vi.waitFor(() => expect(terms[0].written.join('')).toContain('Unknown session'))
    expect(terms[0].written.join('')).not.toContain('Error invoking')
  })

  it('takes focus only while active', () => {
    const { rerender } = render(<Terminal sessionId="s1" active={false} />)
    expect(terms[0].focus).not.toHaveBeenCalled()
    rerender(<Terminal sessionId="s1" active />)
    expect(terms[0].focus).toHaveBeenCalled()
  })

  it('opens, closes, opens under StrictMode', () => {
    render(<Terminal sessionId="s1" />, { reactStrictMode: true })
    expect(calls.filter((c) => c === 'open' || c === 'close')).toEqual(['open', 'close', 'open'])
  })
})

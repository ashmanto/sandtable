import { FitAddon } from '@xterm/addon-fit'
import { Terminal as Xterm, type ITheme } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef } from 'react'
import { errorMessage } from '@/lib/utils'

const token = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim()

const ansi = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const

const theme = (): ITheme => ({
  background: token('--panel'),
  foreground: token('--fg'),
  cursor: token('--fg'),
  cursorAccent: token('--panel'),
  selectionBackground: token('--line-2'),
  ...Object.fromEntries(
    ansi.flatMap((name, i) => [
      [name, token(`--ansi-${i}`)],
      [`bright${name[0].toUpperCase()}${name.slice(1)}`, token(`--ansi-${i + 8}`)]
    ])
  )
})

const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

const leave = (from: HTMLElement, back: boolean): void => {
  const all = [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !from.contains(el) && el.checkVisibility()
  )
  const after = (el: HTMLElement): boolean =>
    !!(from.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
  ;(back ? all.filter((el) => !after(el)).at(-1) : all.find(after))?.focus()
}

/** An xterm.js view of a session's tmux client, sized to fill its container; F6 and Shift+F6 move the focus out, since it keeps Tab. */
export function Terminal({
  sessionId,
  active = true
}: {
  sessionId: string
  active?: boolean
}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const xterm = useRef<Xterm>(null)

  useEffect(() => {
    const el = host.current!
    const api = window.sandtable.terminal
    const term = new Xterm({
      fontFamily: token('--font-mono'),
      fontSize: 13,
      cursorBlink: true,
      theme: theme()
    })
    const fit = new FitAddon()
    xterm.current = term
    term.loadAddon(fit)
    term.open(el)
    fit.fit()

    const offData = api.onData((id, data) => {
      if (id === sessionId) term.write(data)
    })
    term.attachCustomKeyEventHandler((e) => {
      if (e.key !== 'F6') return true
      if (e.type === 'keydown') leave(el, e.shiftKey)
      return false
    })
    const input = term.onData((data) => api.write(sessionId, data))
    let size = [term.cols, term.rows]
    api
      .open(sessionId, term.cols, term.rows)
      .catch((err) => term.write(`\r\n${errorMessage(err)}\r\n`))

    const refit = (): void => {
      fit.fit()
      if (term.cols === size[0] && term.rows === size[1]) return
      size = [term.cols, term.rows]
      api.resize(sessionId, term.cols, term.rows)
    }
    const observer = new ResizeObserver(refit)
    observer.observe(el)
    const scheme = window.matchMedia('(prefers-color-scheme: dark)')
    const retheme = (): void => {
      term.options.theme = theme()
    }
    scheme.addEventListener('change', retheme)

    return () => {
      scheme.removeEventListener('change', retheme)
      observer.disconnect()
      offData()
      input.dispose()
      api.close(sessionId)
      term.dispose()
    }
  }, [sessionId])

  useEffect(() => {
    if (active) xterm.current?.focus()
  }, [active, sessionId])

  return <div ref={host} className="min-h-0 flex-1 bg-panel p-2" />
}

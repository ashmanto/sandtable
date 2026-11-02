import { describe, expect, it, vi } from 'vitest'
import type { Orchestrator } from './orchestrator'
import type { Terminals } from './terminal'
import { isMainFrame, registerIpc, reloadAfterCrash, type AppHandlers } from './ipc'

type Listener = (
  event: { senderFrame: unknown; sender: { mainFrame: unknown } },
  ...args: unknown[]
) => unknown

const electron = vi.hoisted(() => ({
  handles: new Map<string, Listener>(),
  ons: new Map<string, Listener>(),
  exposed: [] as unknown[],
  invoked: new Set<string>(),
  sent: new Set<string>(),
  touched: ''
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: Listener) => electron.handles.set(channel, fn),
    on: (channel: string, fn: Listener) => electron.ons.set(channel, fn)
  },
  ipcRenderer: {
    invoke: async (channel: string) => void electron.invoked.add((electron.touched = channel)),
    send: (channel: string) => void electron.sent.add((electron.touched = channel)),
    on: (channel: string) => void (electron.touched = channel),
    off: () => undefined
  },
  contextBridge: { exposeInMainWorld: (_key: string, api: unknown) => electron.exposed.push(api) }
}))

const mainFrame = { main: true }
const event = (frame: unknown): { senderFrame: unknown; sender: { mainFrame: unknown } } => ({
  senderFrame: frame,
  sender: { mainFrame }
})
const stubs = <T extends object>(): T =>
  new Proxy({} as Record<string, unknown>, {
    get: (fns, key: string) => (fns[key] ??= vi.fn(async () => key))
  }) as T

const appHandlers = (): AppHandlers => ({
  'projects.pickFolder': vi.fn(),
  'accounts.folders': vi.fn(async () => ['/Users/a/.claude-work']),
  'accounts.signedIn': vi.fn(),
  'app.pendingOpen': vi.fn(),
  'app.tools': vi.fn(),
  'app.theme': vi.fn(() => 'dark' as const),
  'app.setTheme': vi.fn(),
  'app.keepAwake': vi.fn(),
  'app.setKeepAwake': vi.fn(),
  'app.awake': vi.fn(),
  'app.notifications': vi.fn(),
  'app.setNotifications': vi.fn(),
  'app.openNotificationSettings': vi.fn(),
  'app.remoteControl': vi.fn(),
  'app.setRemoteControl': vi.fn(),
  'app.lastView': vi.fn(),
  'app.saveView': vi.fn(),
  'app.frame': vi.fn(),
  'app.setSidebarHidden': vi.fn(),
  'app.setSidebarWidth': vi.fn(),
  'app.draft': vi.fn(),
  'app.saveDraft': vi.fn()
})

type Call = (channel: string, frame?: unknown, ...args: unknown[]) => unknown
type Registered = {
  orch: Orchestrator
  terminals: Terminals
  app: AppHandlers
  invoke: Call
  send: Call
}

const register = (ready: Promise<void>): Registered => {
  electron.handles.clear()
  electron.ons.clear()
  const orch = stubs<Orchestrator>()
  const terminals = stubs<Terminals>()
  const app = appHandlers()
  registerIpc({
    orch,
    terminals,
    ready,
    app
  })
  const invoke: Call = (channel, frame = mainFrame, ...args) =>
    electron.handles.get(channel)!(event(frame), ...args)
  const send: Call = (channel, frame = mainFrame, ...args) =>
    electron.ons.get(channel)!(event(frame), ...args)
  return { orch, terminals, app, invoke, send }
}

describe('registerIpc', () => {
  it('handles exactly the channels the preload invokes and sends', async () => {
    register(Promise.resolve())
    await import('../preload/index')
    const api = electron.exposed[0] as Record<string, Record<string, (cb: unknown) => unknown>>
    for (const [group, fns] of Object.entries(api))
      for (const [key, fn] of Object.entries(fns)) {
        fn(() => {})
        expect(electron.touched).toBe(`${group}.${key}`)
      }
    expect([...electron.handles.keys()].sort()).toEqual([...electron.invoked].sort())
    expect([...electron.ons.keys()].sort()).toEqual([...electron.sent].sort())
  })

  it('keeps store channels waiting on a failed load while app channels still answer', async () => {
    const t = register(Promise.reject(new Error('corrupt store')))
    await expect(t.invoke('projects.save', mainFrame, { id: 'p1' })).rejects.toThrow(
      'corrupt store'
    )
    expect(t.orch.saveProject).not.toHaveBeenCalled()
    await expect(t.invoke('app.theme')).resolves.toBe('dark')
    t.send('terminal.close', mainFrame, 's1')
    await Promise.resolve()
    expect(t.terminals.close).not.toHaveBeenCalled()
  })

  it('answers account folders on a failed load but keeps account changes waiting', async () => {
    const t = register(Promise.reject(new Error('corrupt store')))
    await expect(t.invoke('accounts.folders')).resolves.toEqual(['/Users/a/.claude-work'])
    await expect(t.invoke('accounts.add', mainFrame, { name: 'W', dir: '/w' })).rejects.toThrow(
      'corrupt store'
    )
    expect(t.orch.addAccount).not.toHaveBeenCalled()
  })

  it('passes arguments through once the store has loaded', async () => {
    const t = register(Promise.resolve())
    await t.invoke('tickets.move', mainFrame, 'p1', 'o/r#1', 'done')
    expect(t.orch.move).toHaveBeenCalledWith('p1', 'o/r#1', 'done')
    const lane = { from: 'U_a', to: null }
    await t.invoke('tickets.move', mainFrame, 'p1', 'o/r#1', 'todo', lane)
    expect(t.orch.move).toHaveBeenLastCalledWith('p1', 'o/r#1', 'todo', lane)
    await t.invoke('tickets.start', mainFrame, 'p1', 'o/r#1', [], undefined, 'A note')
    expect(t.orch.start).toHaveBeenCalledWith('p1', 'o/r#1', [], undefined, 'A note')
    t.send('app.setSidebarHidden', mainFrame, true)
    expect(t.app['app.setSidebarHidden']).toHaveBeenCalledWith(true)
  })

  it('writes to a terminal in the order the renderer sent', async () => {
    const t = register(Promise.resolve())
    for (const data of ['a', 'b', 'c']) t.send('terminal.write', mainFrame, 's1', data)
    await new Promise((resolve) => setTimeout(resolve))
    expect(vi.mocked(t.terminals.write).mock.calls).toEqual([
      ['s1', 'a'],
      ['s1', 'b'],
      ['s1', 'c']
    ])
  })

  it('logs a send handler that throws instead of leaving it unhandled', async () => {
    const t = register(Promise.resolve())
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.mocked(t.terminals.write).mockImplementation(() => {
      throw new Error('pty gone')
    })
    try {
      t.send('terminal.write', mainFrame, 's1', 'a')
      await new Promise((resolve) => setTimeout(resolve))
      expect(error).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ message: 'pty gone' })
      )
    } finally {
      error.mockRestore()
    }
  })

  it('rejects messages on every channel from any frame but the main window’s', async () => {
    const t = register(Promise.resolve())
    const foreign = [event({ other: true }), { senderFrame: null, sender: { mainFrame: null } }]
    for (const e of foreign) {
      for (const [channel, fn] of electron.handles)
        await expect(fn(e)).rejects.toThrow(`Sandtable refused ${channel}`)
      for (const fn of electron.ons.values()) fn(e, 's1', 'rm -rf ~\r')
    }
    await new Promise((resolve) => setTimeout(resolve))
    for (const fn of [t.orch, t.terminals, t.app].flatMap(Object.values))
      expect(fn).not.toHaveBeenCalled()
  })
})

describe('isMainFrame', () => {
  it('accepts the window’s top frame and refuses a subframe or a gone frame', () => {
    const e = (frame: unknown): Parameters<typeof isMainFrame>[0] =>
      event(frame) as unknown as Parameters<typeof isMainFrame>[0]
    expect(isMainFrame(e(mainFrame))).toBe(true)
    expect(isMainFrame(e({ sub: true }))).toBe(false)
    expect(isMainFrame(e(null))).toBe(false)
  })
})

describe('reloadAfterCrash', () => {
  it('reloads a crashed renderer once, not again within 10 s, and never after a clean exit', () => {
    expect(reloadAfterCrash('crashed', -Infinity, 0)).toBe(true)
    expect(reloadAfterCrash('oom', 1_000, 10_999)).toBe(false)
    expect(reloadAfterCrash('crashed', 1_000, 11_000)).toBe(true)
    expect(reloadAfterCrash('clean-exit', -Infinity, 0)).toBe(false)
  })
})

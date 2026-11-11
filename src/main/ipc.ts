import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import type { Handlers, SendChannel } from '../shared/api'
import { ORCHESTRATOR_CHANNELS, type OrchestratorChannel, type WaitingChannel } from './channels'
import type { Orchestrator } from './orchestrator'
import type { Terminals } from './terminal'

const waitingHandlers = (
  orch: Orchestrator,
  terminals: Terminals
): Pick<Handlers, WaitingChannel> => ({
  ...(Object.fromEntries(
    Object.entries(ORCHESTRATOR_CHANNELS).map(([channel, method]) => [channel, orch[method]])
  ) as Pick<Handlers, OrchestratorChannel>),
  'terminal.open': terminals.open,
  'terminal.write': terminals.write,
  'terminal.resize': terminals.resize,
  'terminal.close': terminals.close
})

/** The app's own handlers; unlike the orchestrator and terminal ones, they answer without waiting for the store to load. */
export type AppHandlers = Omit<Handlers, WaitingChannel>

const sends: Record<SendChannel, true> = {
  'board.watch': true,
  'terminal.write': true,
  'terminal.resize': true,
  'terminal.close': true,
  'app.saveView': true,
  'app.setSidebarHidden': true,
  'app.setSidebarWidth': true,
  'app.saveDraft': true
}

/** Whether an IPC message came from its window's top frame rather than an embedded one. */
export const isMainFrame = (e: IpcMainInvokeEvent | IpcMainEvent): boolean =>
  e.senderFrame !== null && e.senderFrame === e.sender.mainFrame

/** Whether to reload a renderer that went away for `reason`, given when a crash last reloaded it. */
export const reloadAfterCrash = (reason: string, lastReload: number, now: number): boolean =>
  reason !== 'clean-exit' && now - lastReload >= 10_000

/** Registers the IPC handlers behind `window.sandtable`. */
export function registerIpc(deps: {
  orch: Orchestrator
  terminals: Terminals
  ready: Promise<void>
  app: AppHandlers
}): void {
  const waiting = waitingHandlers(deps.orch, deps.terminals)
  const handlers: Handlers = { ...waiting, ...deps.app }
  for (const [channel, fn] of Object.entries(handlers) as [
    keyof Handlers,
    (...args: unknown[]) => unknown
  ][]) {
    const wait = channel in waiting
    if (channel in sends)
      ipcMain.on(channel, (e, ...args) => {
        if (!isMainFrame(e)) return
        if (!wait) return void fn(...args)
        void deps.ready
          .then(
            () => fn(...args),
            () => undefined
          )
          .catch((err) => console.error(`Sandtable could not handle ${channel}`, err))
      })
    else
      ipcMain.handle(channel, async (e, ...args) => {
        if (!isMainFrame(e))
          throw new Error(`Sandtable refused ${channel} from a frame other than its window`)
        if (wait) await deps.ready
        return fn(...args)
      })
  }
}

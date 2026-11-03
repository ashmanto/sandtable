import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import type { Handlers, SendChannel } from '../shared/api'
import type { Orchestrator } from './orchestrator'
import type { Terminals } from './terminal'

type WaitingChannel = Exclude<
  keyof Handlers,
  | `app.${string}`
  | 'projects.pickFolder'
  | 'projects.pickEditor'
  | 'accounts.folders'
  | 'accounts.signedIn'
>

const waitingHandlers = (
  orch: Orchestrator,
  terminals: Terminals
): Pick<Handlers, WaitingChannel> => ({
  'projects.list': orch.listProjects,
  'projects.save': orch.saveProject,
  'projects.setEditor': orch.setEditor,
  'projects.remove': orch.removeProject,
  'projects.groups': orch.listGroups,
  'projects.arrange': orch.arrangeProjects,
  'projects.statusOptions': orch.statusOptions,
  'projects.boardRepos': orch.boardRepos,
  'projects.me': orch.me,
  'projects.linearTeams': orch.linearTeams,
  'projects.linearWorkspaces': orch.linearWorkspaces,
  'projects.jiraAccounts': orch.jiraAccounts,
  'projects.jiraSignIn': orch.jiraSignIn,
  'projects.jiraProjects': orch.jiraProjects,
  'projects.jiraBoards': orch.jiraBoards,
  'projects.usage': orch.usageByWeek,
  'accounts.list': orch.listAccounts,
  'accounts.add': orch.addAccount,
  'accounts.remove': orch.removeAccount,
  'board.get': orch.getBoard,
  'board.sync': orch.sync,
  'board.watch': orch.watch,
  'tickets.start': orch.start,
  'tickets.checkStart': orch.checkStart,
  'tickets.checkOverlap': orch.checkOverlap,
  'tickets.checkReady': orch.checkReady,
  'tickets.triage': orch.triage,
  'tickets.applyTriage': orch.applyTriage,
  'tickets.chat': orch.chat,
  'tickets.sendChat': orch.sendChat,
  'tickets.draftComment': orch.draftComment,
  'tickets.saveDraft': orch.saveDraft,
  'tickets.postComment': orch.postComment,
  'tickets.discardDraft': orch.discardDraft,
  'tickets.clearChat': orch.clearChat,
  'tickets.stopChat': orch.stopChat,
  'tickets.create': orch.createTicket,
  'tickets.move': orch.move,
  'tickets.details': orch.details,
  'tickets.usage': orch.usage,
  'sessions.resume': orch.resume,
  'sessions.removeWorktree': orch.removeWorktree,
  'sessions.endAndRemove': orch.endAndRemove,
  'sessions.create': orch.create,
  'sessions.firstMessage': orch.firstMessage,
  'sessions.rename': orch.rename,
  'sessions.activity': orch.activity,
  'sessions.status': orch.status,
  'sessions.watchConversation': orch.watchConversation,
  'sessions.unwatchConversation': orch.unwatchConversation,
  'sessions.liveUsage': orch.liveUsage,
  'sessions.raiseCap': orch.raiseCap,
  'sessions.changes': orch.changes,
  'sessions.openFolder': orch.openFolder,
  'sessions.findings': orch.findings,
  'sessions.addFinding': orch.addFinding,
  'sessions.updateFinding': orch.updateFinding,
  'sessions.removeFinding': orch.removeFinding,
  'sessions.sendFindings': orch.sendFindings,
  'sessions.review': orch.review,
  'sessions.pullRequests': orch.pullRequests,
  'sessions.addCheck': orch.addCheck,
  'sessions.addThread': orch.addThread,
  'sessions.setAutoReview': orch.setAutoReview,
  'sessions.summarize': orch.summarize,
  'sessions.send': orch.send,
  'sessions.image': orch.image,
  'sessions.interrupt': orch.interrupt,
  'sessions.compact': orch.compact,
  'sessions.prompt': orch.prompt,
  'sessions.commands': orch.commands,
  'sessions.suggestion': orch.suggestion,
  'sessions.answer': orch.answer,
  'sessions.end': orch.end,
  'sessions.setRemoteControl': orch.setRemoteControl,
  'sessions.clearNeedsYou': orch.clearNeedsYou,
  'sessions.leftovers': orch.leftovers,
  'sessions.endUnknown': orch.endUnknown,
  'routines.list': orch.listRoutines,
  'routines.save': orch.saveRoutine,
  'routines.remove': orch.removeRoutine,
  'routines.start': orch.startRoutine,
  'routines.history': orch.routineHistory,
  'routines.chat': orch.chatRoutine,
  'routines.stopChat': orch.stopRoutineChat,
  'setup.progress': orch.setupProgress,
  'setup.cancel': orch.cancelSetup,
  'setup.suggest': orch.suggestSetup,
  'setup.hint': orch.setupHint,
  'setup.hideHint': orch.hideSetupHint,
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

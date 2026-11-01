import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  ApiMethod,
  InvokeChannel,
  PushChannel,
  SandtableApi,
  SendChannel
} from '../shared/api'

const invoke = <C extends InvokeChannel>(channel: C): ApiMethod<C> =>
  ((...args: unknown[]) => ipcRenderer.invoke(channel, ...args)) as ApiMethod<C>
const send = <C extends SendChannel>(channel: C): ApiMethod<C> =>
  ((...args: unknown[]): void => ipcRenderer.send(channel, ...args)) as ApiMethod<C>
const listen = <C extends PushChannel>(channel: C): ApiMethod<C> =>
  ((cb: (...args: never[]) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, ...args: unknown[]): void => cb(...(args as never[]))
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.off(channel, handler)
  }) as ApiMethod<C>

const api: SandtableApi = {
  projects: {
    list: invoke('projects.list'),
    save: invoke('projects.save'),
    remove: invoke('projects.remove'),
    groups: invoke('projects.groups'),
    arrange: invoke('projects.arrange'),
    statusOptions: invoke('projects.statusOptions'),
    linearTeams: invoke('projects.linearTeams'),
    linearWorkspaces: invoke('projects.linearWorkspaces'),
    jiraAccounts: invoke('projects.jiraAccounts'),
    jiraSignIn: invoke('projects.jiraSignIn'),
    jiraProjects: invoke('projects.jiraProjects'),
    jiraBoards: invoke('projects.jiraBoards'),
    boardRepos: invoke('projects.boardRepos'),
    me: invoke('projects.me'),
    pickFolder: invoke('projects.pickFolder'),
    usage: invoke('projects.usage')
  },
  accounts: {
    list: invoke('accounts.list'),
    add: invoke('accounts.add'),
    remove: invoke('accounts.remove'),
    folders: invoke('accounts.folders'),
    signedIn: invoke('accounts.signedIn')
  },
  board: {
    get: invoke('board.get'),
    sync: invoke('board.sync'),
    watch: send('board.watch'),
    onChange: listen('board.onChange')
  },
  tickets: {
    start: invoke('tickets.start'),
    checkStart: invoke('tickets.checkStart'),
    checkOverlap: invoke('tickets.checkOverlap'),
    checkReady: invoke('tickets.checkReady'),
    triage: invoke('tickets.triage'),
    applyTriage: invoke('tickets.applyTriage'),
    chat: invoke('tickets.chat'),
    sendChat: invoke('tickets.sendChat'),
    draftComment: invoke('tickets.draftComment'),
    saveDraft: invoke('tickets.saveDraft'),
    postComment: invoke('tickets.postComment'),
    discardDraft: invoke('tickets.discardDraft'),
    clearChat: invoke('tickets.clearChat'),
    stopChat: invoke('tickets.stopChat'),
    onChatSteps: listen('tickets.onChatSteps'),
    create: invoke('tickets.create'),
    move: invoke('tickets.move'),
    details: invoke('tickets.details'),
    usage: invoke('tickets.usage')
  },
  sessions: {
    resume: invoke('sessions.resume'),
    removeWorktree: invoke('sessions.removeWorktree'),
    endAndRemove: invoke('sessions.endAndRemove'),
    create: invoke('sessions.create'),
    firstMessage: invoke('sessions.firstMessage'),
    rename: invoke('sessions.rename'),
    activity: invoke('sessions.activity'),
    onActivity: listen('sessions.onActivity'),
    status: invoke('sessions.status'),
    onStatus: listen('sessions.onStatus'),
    watchConversation: invoke('sessions.watchConversation'),
    unwatchConversation: invoke('sessions.unwatchConversation'),
    onConversation: listen('sessions.onConversation'),
    liveUsage: invoke('sessions.liveUsage'),
    onLiveUsage: listen('sessions.onLiveUsage'),
    raiseCap: invoke('sessions.raiseCap'),
    changes: invoke('sessions.changes'),
    findings: invoke('sessions.findings'),
    addFinding: invoke('sessions.addFinding'),
    updateFinding: invoke('sessions.updateFinding'),
    removeFinding: invoke('sessions.removeFinding'),
    sendFindings: invoke('sessions.sendFindings'),
    review: invoke('sessions.review'),
    pullRequests: invoke('sessions.pullRequests'),
    addCheck: invoke('sessions.addCheck'),
    addThread: invoke('sessions.addThread'),
    setAutoReview: invoke('sessions.setAutoReview'),
    summarize: invoke('sessions.summarize'),
    end: invoke('sessions.end'),
    setRemoteControl: invoke('sessions.setRemoteControl'),
    send: invoke('sessions.send'),
    image: invoke('sessions.image'),
    interrupt: invoke('sessions.interrupt'),
    compact: invoke('sessions.compact'),
    prompt: invoke('sessions.prompt'),
    commands: invoke('sessions.commands'),
    suggestion: invoke('sessions.suggestion'),
    answer: invoke('sessions.answer'),
    clearNeedsYou: invoke('sessions.clearNeedsYou'),
    leftovers: invoke('sessions.leftovers'),
    endUnknown: invoke('sessions.endUnknown')
  },
  routines: {
    list: invoke('routines.list'),
    save: invoke('routines.save'),
    remove: invoke('routines.remove'),
    start: invoke('routines.start'),
    history: invoke('routines.history'),
    chat: invoke('routines.chat'),
    stopChat: invoke('routines.stopChat'),
    onChatSteps: listen('routines.onChatSteps')
  },
  setup: {
    progress: invoke('setup.progress'),
    cancel: invoke('setup.cancel'),
    suggest: invoke('setup.suggest'),
    hint: invoke('setup.hint'),
    hideHint: invoke('setup.hideHint'),
    onProgress: listen('setup.onProgress')
  },
  terminal: {
    open: invoke('terminal.open'),
    write: send('terminal.write'),
    resize: send('terminal.resize'),
    close: send('terminal.close'),
    onData: listen('terminal.onData')
  },
  app: {
    onOpen: listen('app.onOpen'),
    pendingOpen: invoke('app.pendingOpen'),
    tools: invoke('app.tools'),
    theme: invoke('app.theme'),
    setTheme: invoke('app.setTheme'),
    keepAwake: invoke('app.keepAwake'),
    setKeepAwake: invoke('app.setKeepAwake'),
    notifications: invoke('app.notifications'),
    setNotifications: invoke('app.setNotifications'),
    openNotificationSettings: invoke('app.openNotificationSettings'),
    remoteControl: invoke('app.remoteControl'),
    setRemoteControl: invoke('app.setRemoteControl'),
    awake: invoke('app.awake'),
    onAwake: listen('app.onAwake'),
    onSettings: listen('app.onSettings'),
    lastView: invoke('app.lastView'),
    saveView: send('app.saveView'),
    frame: invoke('app.frame'),
    onFrame: listen('app.onFrame'),
    onSwipe: listen('app.onSwipe'),
    setSidebarHidden: send('app.setSidebarHidden'),
    setSidebarWidth: send('app.setSidebarWidth'),
    setStartFailures: send('app.setStartFailures'),
    draft: invoke('app.draft'),
    saveDraft: send('app.saveDraft')
  }
}

contextBridge.exposeInMainWorld('sandtable', api)

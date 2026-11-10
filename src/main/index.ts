import {
  app,
  dialog,
  shell,
  BrowserWindow,
  Menu,
  Notification,
  nativeTheme,
  powerSaveBlocker,
  safeStorage,
  screen,
  session
} from 'electron'
import { sidebarWidth, type PushArgs, type PushChannel, type WindowFrame } from '../shared/api'
import type { LastView, Theme } from '../shared/types'
import { homedir } from 'os'
import { join } from 'path'
import { spawn } from 'node-pty'
import {
  accountEnv,
  checkTools,
  claudeFolders,
  claudeSignedIn,
  openInEditor,
  findTools,
  loginShellPath,
  run,
  runStoppable
} from './env/tools'
import { githubReposOf } from './git/remote'
import { worktreeChanges } from './git/diff'
import { checkRemovable, ensureWorktree, removeWorktree } from './git/worktree'
import { copyPaths, ignoredProblem, runSetup, suggestSetup } from './env/worktreeSetup'
import { createAreasClient } from './github/areas'
import { createBoardClient } from './github/board'
import { githubGraphql, lazyGraphql } from './github/graphql'
import {
  createLinearClient,
  linearGraphql,
  linearWorkspaces,
  type LinearClient
} from './linear/client'
import { createRepoIssuesClient } from './github/repoIssues'
import { mergedPullRequests } from './github/merged'
import { changeStamp } from './github/stamp'
import { createJiraClient, type JiraClient } from './jira/client'
import { createJiraCredentials, savedJiraRest } from './jira/credentials'
import { jiraRest } from './jira/rest'
import { fetchTicketDetails } from './github/ticketDetails'
import { failedLog, fetchPullRequests } from './github/pullRequest'
import { postComment } from './github/comments'
import { registerIpc, reloadAfterCrash } from './ipc'
import { createDockBadge } from './dockBadge'
import { createDrafts } from './drafts'
import { createKeepAwake } from './keepAwake'
import { warnNotificationsOffOnce } from './notifyOff'
import { createOrchestrator } from './orchestrator'
import { cliDir, createCliServer } from './sessions/cli'
import {
  countNeedsYou,
  readAsking,
  readBackground,
  readLastState,
  watchEvents
} from './sessions/hookEvents'
import {
  hasTmux,
  globalPath,
  killTmux,
  enterTmux,
  escapeTmux,
  keysTmux,
  captureTmux,
  listTmux,
  pasteTmux,
  startTmux
} from './sessions/tmux'
import { quitAfter } from './quit'
import { createStore, serial } from './store'
import { createSyncCache } from './syncCache'
import { createTerminals } from './terminal'
import {
  loadSettings,
  limitAlerts,
  notificationOptions,
  pickerStart,
  saveSettings
} from './settings'
import { createWindowState, MIN_WIDTH, placeWindow, type WindowStateStore } from './windowState'
import { logToFile } from './log'

let win: BrowserWindow | null = null
let pendingOpen: LastView | 'settings' | null = null
let rendererStarted = false
let lastCrashReload = -Infinity
const send = <C extends PushChannel>(channel: C, ...args: PushArgs<C>): void =>
  win?.webContents.send(channel, ...args)
const notifications = new Set<Notification>()
const dockBadge = createDockBadge((text) => app.dock?.setBadge(text))
app.on('did-become-active', () => dockBadge.setActive(true))
app.on('did-resign-active', () => dockBadge.setActive(false))

const github = lazyGraphql(githubGraphql)
const linearClients = new Map<string | undefined, LinearClient>()
const linearFor = (workspace?: string): LinearClient => {
  let client = linearClients.get(workspace)
  if (!client) {
    client = createLinearClient(lazyGraphql(() => linearGraphql(workspace)).gql)
    linearClients.set(workspace, client)
  }
  return client
}

const frameOf = (state: WindowStateStore): WindowFrame => ({
  sidebarHidden: state.get().sidebarHidden === true,
  sidebarWidth: sidebarWidth(state.get().sidebarWidth),
  fullScreen: win?.isFullScreen() ?? false
})

function createWindow(state: WindowStateStore, onRendererGone: () => void): BrowserWindow {
  rendererStarted = false
  const saved = state.get()
  win = new BrowserWindow({
    ...placeWindow(
      saved.bounds,
      screen.getAllDisplays().map((d) => d.workArea),
      screen.getPrimaryDisplay().workArea
    ),
    ...(saved.fullScreen && { fullscreen: true }),
    ...(testRun && { opacity: 0 }),
    show: false,
    minWidth: MIN_WIDTH,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 24 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true
    }
  })
  const w = win
  const saveBounds = (): void =>
    void state.update({
      bounds: w.getNormalBounds(),
      maximized: w.isMaximized(),
      fullScreen: w.isFullScreen()
    })
  const fullScreenChanged = (): void => {
    saveBounds()
    send('app.onFrame', frameOf(state))
  }
  w.on('resize', saveBounds)
    .on('moved', saveBounds)
    .on('maximize', saveBounds)
    .on('unmaximize', saveBounds)
    .on('enter-full-screen', fullScreenChanged)
    .on('leave-full-screen', fullScreenChanged)
    .on('swipe', (_e, direction) => send('app.onSwipe', direction))
  if (testRun) w.setIgnoreMouseEvents(true)
  win.on('ready-to-show', () => {
    if (testRun) w.showInactive()
    if (saved.maximized) w.maximize()
    else if (!testRun) w.show()
  })
  win.on('closed', () => {
    win = null
    onRendererGone()
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.on('did-navigate', onRendererGone)
  win.webContents.on('render-process-gone', (_, { reason }) => {
    onRendererGone()
    if (w.isDestroyed() || !reloadAfterCrash(reason, lastCrashReload, Date.now())) return
    lastCrashReload = Date.now()
    w.webContents.reload()
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL'])
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

const testRun = process.env.SANDTABLE_E2E === '1'
const toFront = (w: BrowserWindow): void => {
  if (testRun) return w.showInactive()
  w.show()
  w.focus()
}
const primary = app.requestSingleInstanceLock()
if (!primary) app.quit()
else {
  if (app.commandLine.hasSwitch('user-data-dir'))
    app.setAppLogsPath(join(app.getPath('userData'), 'logs'))
  logToFile(app.getPath('logs'))
}

async function start(): Promise<void> {
  if (!primary) return
  if (testRun) app.dock?.hide()
  session.defaultSession.setPermissionRequestHandler((_w, p, cb) =>
    cb(p === 'clipboard-sanitized-write')
  )
  process.env.PATH = (await loginShellPath()) || process.env.PATH
  process.env.LANG ??= 'en_US.UTF-8'
  const toolsPath = process.env.SANDTABLE_TOOLS_PATH ?? process.env.PATH ?? ''
  const tools = await findTools(toolsPath)

  const terminals = createTerminals({
    tmuxBin: tools.paths.tmux ?? 'tmux',
    session: (id) => orch.session(id),
    send: (id, data) => send('terminal.onData', id, data),
    spawn
  })
  const dataDir = app.getPath('userData')
  const windowState = createWindowState(join(dataDir, 'window-state.json'))
  await windowState.load()
  const drafts = createDrafts(join(dataDir, 'drafts'))
  const openWindow = (): BrowserWindow =>
    createWindow(windowState, () => {
      rendererStarted = false
      terminals.closeAll()
      orch.unwatchAll()
      orch.watch(null, false)
      sessionsChanged()
    })

  const settingsFile = join(dataDir, 'settings.json')
  const settings = await loadSettings(settingsFile)
  nativeTheme.themeSource = settings.theme
  let notifyPrefs = settings.notifications
  let remoteControl = settings.remoteControl
  let lastFolder = settings.lastFolder
  const openNotificationSettings = (): Promise<void> =>
    shell.openExternal(
      'x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=com.ashmanto.sandtable'
    )
  const keepAwake = createKeepAwake({
    blocker: powerSaveBlocker,
    running: () => orch.anyRunning(),
    enabled: settings.keepAwake,
    onActive: (active) => send('app.onAwake', active)
  })
  const writeSettings = serial()
  const saveSetting = (name: string): void => {
    const current = {
      theme: nativeTheme.themeSource,
      keepAwake: keepAwake.enabled(),
      notifications: notifyPrefs,
      remoteControl,
      lastFolder
    }
    writeSettings(() => saveSettings(settingsFile, current)).catch((err) =>
      dialog.showErrorBox(`Sandtable could not save ${name}`, (err as Error).message)
    )
  }
  const setTheme = (theme: Theme): void => {
    nativeTheme.themeSource = theme
    saveSetting('the appearance')
  }
  const openSettings = (): void => {
    const w = win ?? openWindow()
    if (!rendererStarted) return void (pendingOpen = 'settings')
    toFront(w)
    send('app.onSettings')
  }
  const setSidebarHidden = (hidden: boolean): void => {
    void windowState.update({ sidebarHidden: hidden })
    setMenu()
    send('app.onFrame', frameOf(windowState))
  }
  let waitingCount = 0
  const setMenu = (): void => {
    const hidden = frameOf(windowState).sidebarHidden
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { id: 'settings', label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: openSettings },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' }
          ]
        },
        { role: 'fileMenu' },
        { role: 'editMenu' },
        {
          label: 'View',
          submenu: [
            {
              id: 'sidebar',
              label: hidden ? 'Show Sidebar' : 'Hide Sidebar',
              accelerator: 'Ctrl+Cmd+S',
              click: () => setSidebarHidden(!hidden)
            },
            { type: 'separator' },
            {
              id: 'nextNeedsYou',
              label: 'Next Needs You',
              accelerator: 'CmdOrCtrl+Shift+J',
              enabled: waitingCount > 0,
              click: () => {
                const w = win ?? openWindow()
                if (rendererStarted) toFront(w)
                orch.openNextNeedsYou(windowState.get().view ?? null)
              }
            },
            ...(app.isPackaged
              ? []
              : [
                  { type: 'separator' as const },
                  { role: 'reload' as const },
                  { role: 'forceReload' as const },
                  { role: 'toggleDevTools' as const }
                ]),
            { type: 'separator' },
            { role: 'resetZoom' },
            { role: 'zoomIn' },
            { role: 'zoomOut' },
            { type: 'separator' },
            { role: 'togglefullscreen' }
          ]
        },
        { role: 'windowMenu' }
      ])
    )
  }
  setMenu()
  const claudeBin = tools.paths.claude ?? 'claude'
  const claudeDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
  const jiraCredentials = createJiraCredentials(join(dataDir, 'jira-credentials.json'), {
    encrypt: (text) => safeStorage.encryptString(text),
    decrypt: (data) => safeStorage.decryptString(data)
  })
  const jiraClients = new Map<string, JiraClient>()
  const jiraFor = (site: string): JiraClient => {
    let client = jiraClients.get(site)
    if (!client) {
      client = createJiraClient(savedJiraRest(jiraCredentials, site))
      jiraClients.set(site, client)
    }
    return client
  }
  const orch = createOrchestrator({
    cli: (handle) => createCliServer(cliDir(dataDir), handle),
    store: createStore(join(dataDir, 'sandtable.json')),
    cache: createSyncCache(join(dataDir, 'sync-cache.json')),
    board: createBoardClient(github.gql),
    repoIssues: createRepoIssuesClient(github.gql),
    areas: createAreasClient(github.gql),
    ticketDetails: (repo, number) => fetchTicketDetails(github.gql, repo, number),
    postComment: (repo, number, body) => postComment(github.gql, repo, number, body),
    githubViewer: async () => (await github.gql('query { viewer { login } }', {})).viewer.login,
    linear: linearFor,
    linearWorkspaces,
    jira: jiraFor,
    jiraCredentials,
    jiraClientWith: (site, email, token) => createJiraClient(jiraRest(site, email, token)),
    mergedPullRequests: (repo, since, truncated) =>
      mergedPullRequests(github.gql, repo, since, truncated),
    githubStamp: (board, repos) => changeStamp(github.gql, board, repos),
    githubReposOf,
    pullRequests: (repo, branch) => fetchPullRequests(github.gql, repo, branch),
    fingerprint: async (script, trees) => {
      const { stdout, code } = await run('/bin/sh', [script, 'fingerprint', ...trees.flat()])
      return code === 0 ? stdout : ''
    },
    failedLog: (repo, jobId) => failedLog(run, tools.paths.gh ?? 'gh', repo, jobId),
    openFolder: (folder, app) => (app ? openInEditor(app, folder) : shell.openPath(folder)),
    git: { ensureWorktree, removeWorktree, checkRemovable, changes: worktreeChanges },
    setup: { problem: ignoredProblem, copy: copyPaths, run: runSetup, suggest: suggestSetup },
    tmux: {
      startTmux,
      globalPath,
      hasTmux,
      listTmux,
      killTmux,
      pasteTmux,
      enterTmux,
      escapeTmux,
      keysTmux,
      captureTmux
    },
    claude: {
      bin: claudeBin,
      print: (cwd, args, env, timeoutMs, live) =>
        runStoppable(claudeBin, args, env && { ...process.env, ...env }, timeoutMs, cwd, live)
    },
    events: { watchEvents, readLastState, readAsking, readBackground, countNeedsYou },
    remoteControl: () => remoteControl,
    notify: (title, body, onClick) => {
      const options = notificationOptions(notifyPrefs, BrowserWindow.getFocusedWindow() !== null)
      if (options) showNotification(title, body, options, onClick)
    },
    draft: drafts.get,
    dataDir,
    claudeDir,
    claudeDirSet: process.env.CLAUDE_CONFIG_DIR !== undefined
  })
  const sessionsChanged = (): void => {
    keepAwake.update()
    const count = orch.needsYouCount()
    dockBadge.setCount(count)
    const flipped = count > 0 !== waitingCount > 0
    waitingCount = count
    if (flipped) setMenu()
  }
  orch.onChange((projectId) => {
    send('board.onChange', projectId)
    sessionsChanged()
  })
  orch.onActivity((sessionId, activity) => send('sessions.onActivity', sessionId, activity))
  const limitsSent = new Map<string, number>()
  orch.onStatus((sessionId, status, account) => {
    send('sessions.onStatus', sessionId, status)
    for (const a of limitAlerts(status, notifyPrefs, limitsSent, new Date(), account))
      showNotification(a.title, a.body, { silent: a.silent }, () => {})
  })
  function showNotification(
    title: string,
    body: string,
    options: { silent: boolean },
    onClick: () => void
  ): void {
    const n = new Notification({ title, body, ...options })
    notifications.add(n)
    n.on('click', () => {
      notifications.delete(n)
      if (!win) return void openWindow().webContents.once('did-finish-load', onClick)
      toFront(win)
      onClick()
    })
    n.on('close', () => notifications.delete(n))
    n.on('failed', () => {
      notifications.delete(n)
      if (!app.isPackaged) return
      void warnNotificationsOffOnce(join(dataDir, 'notifications-off-shown'), async () => {
        const options = {
          type: 'warning' as const,
          message: 'Notifications are off for Sandtable',
          detail:
            "Sandtable can't tell you when a session needs you or a plan limit runs low. Turn notifications on in System Settings > Notifications > Sandtable.",
          buttons: ['Open Notification Settings', 'OK'],
          defaultId: 0,
          cancelId: 1
        }
        const { response } = await (win
          ? dialog.showMessageBox(win, options)
          : dialog.showMessageBox(options))
        if (response === 0) await openNotificationSettings()
      }).catch((err) => console.error('Sandtable could not warn that notifications are off', err))
    })
    n.show()
  }
  orch.onConversation((sessionId, chunk) => send('sessions.onConversation', sessionId, chunk))
  orch.onLiveUsage((usage) => send('sessions.onLiveUsage', usage))
  orch.onSetupProgress((target, progress) => send('setup.onProgress', target, progress))
  orch.onChatSteps((projectId, ticketKey, steps) =>
    send('tickets.onChatSteps', projectId, ticketKey, steps)
  )
  orch.onRoutineChatSteps((runId, steps) => send('routines.onChatSteps', runId, steps))
  orch.onOpen((view) => {
    if (!rendererStarted) pendingOpen = view
    send('app.onOpen', view)
  })
  app.on(
    'before-quit',
    quitAfter(
      () => {
        orch.stop()
        return Promise.all([
          orch.flush(),
          windowState.flush(),
          writeSettings.flush(),
          drafts.flush()
        ])
      },
      () => app.quit()
    )
  )
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow()
  })
  app.on('second-instance', () => {
    if (!win) return void openWindow()
    toFront(win)
  })

  const ready = orch.reconnect(!tools.missing.includes('tmux'))
  ready.then(sessionsChanged, (err) =>
    dialog.showErrorBox('Sandtable could not start', (err as Error).message)
  )
  const pickFolder = async (): Promise<{ path: string; repos: string[] } | null> => {
    const options = {
      properties: ['openDirectory' as const],
      defaultPath: await pickerStart(lastFolder, homedir())
    }
    const res = await (win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options))
    const path = res.filePaths[0]
    if (res.canceled || !path) return null
    lastFolder = path
    saveSetting('the last folder')
    return { path, repos: await githubReposOf(path) }
  }
  const pickEditor = async (): Promise<string | null> => {
    const options = {
      properties: ['openFile' as const],
      filters: [{ name: 'Applications', extensions: ['app'] }],
      defaultPath: '/Applications'
    }
    const res = await (win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options))
    return res.canceled ? null : (res.filePaths[0] ?? null)
  }
  registerIpc({
    orch,
    terminals,
    ready,
    app: {
      'projects.pickFolder': pickFolder,
      'projects.pickEditor': pickEditor,
      'accounts.folders': async () => {
        await ready.catch(() => undefined)
        return claudeFolders(
          homedir(),
          (await orch.listAccounts()).map((a) => a.dir)
        )
      },
      'accounts.signedIn': (dir) =>
        claudeSignedIn(claudeBin, {
          ...process.env,
          PATH: toolsPath,
          ...accountEnv(dir, claudeDir)
        }),
      'app.tools': async () => {
        github.reset()
        linearClients.clear()
        orch.resetViewers()
        await ready.catch(() => undefined)
        const check = await checkTools(
          toolsPath,
          run,
          orch.usedAccounts(),
          orch.usedLinearWorkspaces(),
          orch.usedJiraSites()
        )
        if (!check.missing.includes('tmux')) void orch.watchTmux().then(keepAwake.update)
        return check
      },
      'app.pendingOpen': () => {
        rendererStarted = true
        const open = pendingOpen
        pendingOpen = null
        return open
      },
      'app.theme': () => nativeTheme.themeSource,
      'app.setTheme': setTheme,
      'app.keepAwake': keepAwake.enabled,
      'app.setKeepAwake': (on) => {
        keepAwake.setEnabled(on)
        saveSetting('Keep your Mac awake')
      },
      'app.awake': keepAwake.active,
      'app.notifications': () => notifyPrefs,
      'app.setNotifications': (prefs) => {
        notifyPrefs = prefs
        saveSetting('Notifications')
      },
      'app.openNotificationSettings': openNotificationSettings,
      'app.remoteControl': () => remoteControl,
      'app.setRemoteControl': (on) => {
        remoteControl = on
        saveSetting('Remote Control')
      },
      'app.lastView': () => windowState.get().view ?? null,
      'app.saveView': (view) => void windowState.update({ view }),
      'app.frame': () => frameOf(windowState),
      'app.setSidebarHidden': setSidebarHidden,
      'app.setSidebarWidth': (width) =>
        void windowState.update({ sidebarWidth: sidebarWidth(width) }),
      'app.draft': drafts.get,
      'app.saveDraft': drafts.save
    }
  })
  openWindow()
}

app
  .whenReady()
  .then(start)
  .catch((err) => {
    dialog.showErrorBox('Sandtable could not start', (err as Error).message)
    app.quit()
  })

// Without a listener Electron quits when the last window closes; a Mac app stays running.
app.on('window-all-closed', () => undefined)

import type { ApiMethod, Handlers } from '../shared/api'

/** The channels whose handlers wait for the store to load. */
export type WaitingChannel = Exclude<
  keyof Handlers,
  | `app.${string}`
  | 'projects.pickFolder'
  | 'projects.pickEditor'
  | 'accounts.folders'
  | 'accounts.signedIn'
>

/** The channels the orchestrator handles. */
export type OrchestratorChannel = Exclude<WaitingChannel, `terminal.${string}`>

/** The orchestrator method behind each orchestrator channel. */
export const ORCHESTRATOR_CHANNELS = {
  'projects.list': 'listProjects',
  'projects.save': 'saveProject',
  'projects.setEditor': 'setEditor',
  'projects.remove': 'removeProject',
  'projects.groups': 'listGroups',
  'projects.arrange': 'arrangeProjects',
  'projects.statusOptions': 'statusOptions',
  'projects.boardRepos': 'boardRepos',
  'projects.me': 'me',
  'projects.linearTeams': 'linearTeams',
  'projects.linearWorkspaces': 'linearWorkspaces',
  'projects.jiraAccounts': 'jiraAccounts',
  'projects.jiraSignIn': 'jiraSignIn',
  'projects.jiraProjects': 'jiraProjects',
  'projects.jiraBoards': 'jiraBoards',
  'projects.usage': 'usageByWeek',
  'accounts.list': 'listAccounts',
  'accounts.add': 'addAccount',
  'accounts.remove': 'removeAccount',
  'board.get': 'getBoard',
  'board.sync': 'sync',
  'board.watch': 'watch',
  'tickets.start': 'start',
  'tickets.checkStart': 'checkStart',
  'tickets.checkOverlap': 'checkOverlap',
  'tickets.checkReady': 'checkReady',
  'tickets.triage': 'triage',
  'tickets.applyTriage': 'applyTriage',
  'tickets.chat': 'chat',
  'tickets.sendChat': 'sendChat',
  'tickets.draftComment': 'draftComment',
  'tickets.saveDraft': 'saveDraft',
  'tickets.postComment': 'postComment',
  'tickets.discardDraft': 'discardDraft',
  'tickets.clearChat': 'clearChat',
  'tickets.stopChat': 'stopChat',
  'tickets.create': 'createTicket',
  'tickets.move': 'move',
  'tickets.details': 'details',
  'tickets.usage': 'usage',
  'sessions.resume': 'resume',
  'sessions.removeWorktree': 'removeWorktree',
  'sessions.endAndRemove': 'endAndRemove',
  'sessions.create': 'create',
  'sessions.firstMessage': 'firstMessage',
  'sessions.rename': 'rename',
  'sessions.activity': 'activity',
  'sessions.status': 'status',
  'sessions.watchConversation': 'watchConversation',
  'sessions.unwatchConversation': 'unwatchConversation',
  'sessions.liveUsage': 'liveUsage',
  'sessions.raiseCap': 'raiseCap',
  'sessions.changes': 'changes',
  'sessions.openFolder': 'openFolder',
  'sessions.findings': 'findings',
  'sessions.addFinding': 'addFinding',
  'sessions.updateFinding': 'updateFinding',
  'sessions.removeFinding': 'removeFinding',
  'sessions.sendFindings': 'sendFindings',
  'sessions.review': 'review',
  'sessions.pullRequests': 'pullRequests',
  'sessions.addCheck': 'addCheck',
  'sessions.addThread': 'addThread',
  'sessions.setAutoReview': 'setAutoReview',
  'sessions.summarize': 'summarize',
  'sessions.send': 'send',
  'sessions.image': 'image',
  'sessions.interrupt': 'interrupt',
  'sessions.compact': 'compact',
  'sessions.prompt': 'prompt',
  'sessions.commands': 'commands',
  'sessions.suggestion': 'suggestion',
  'sessions.answer': 'answer',
  'sessions.end': 'end',
  'sessions.setRemoteControl': 'setRemoteControl',
  'sessions.clearNeedsYou': 'clearNeedsYou',
  'sessions.leftovers': 'leftovers',
  'sessions.endUnknown': 'endUnknown',
  'routines.list': 'listRoutines',
  'routines.save': 'saveRoutine',
  'routines.remove': 'removeRoutine',
  'routines.start': 'startRoutine',
  'routines.history': 'routineHistory',
  'routines.chat': 'chatRoutine',
  'routines.stopChat': 'stopRoutineChat',
  'setup.progress': 'setupProgress',
  'setup.cancel': 'cancelSetup',
  'setup.suggest': 'suggestSetup',
  'setup.hint': 'setupHint',
  'setup.hideHint': 'hideSetupHint'
} as const satisfies Record<OrchestratorChannel, string>

/** Each orchestrator channel's method, typed from its `SandtableApi` method. */
export type ChannelMethods = {
  [C in OrchestratorChannel as (typeof ORCHESTRATOR_CHANNELS)[C]]: (
    ...args: Parameters<ApiMethod<C>>
  ) => ReturnType<ApiMethod<C>>
}

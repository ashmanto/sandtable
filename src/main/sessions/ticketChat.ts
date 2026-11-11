import { randomUUID } from 'node:crypto'
import type {
  Chat,
  ConversationEntry,
  Project,
  ProjectRepo,
  SessionRecord,
  Step,
  Ticket,
  TicketDetails
} from '../../shared/types'
import { isTrackerKey, parseTicketKey, serviceOf } from '../../shared/repo'
import type { Tracker } from '../tracker'
import type { Orchestrator, OrchestratorDeps } from '../orchestrator'
import {
  CHAT_RULES,
  chatArgs,
  chatRun,
  chatPrompt,
  DRAFT_PROMPT,
  MAX_CHAT_MESSAGE_BYTES,
  parseChat,
  printChat,
  type PrintClaude,
  type PrintRun,
  rewritePrompt
} from './chat'
import { withoutUnsafe } from './claudeLaunch'
import { summaryArgs, summaryPrompt } from './summary'
import { messageOf } from '../../shared/errors'

type TicketChat = Pick<
  Orchestrator,
  | 'chat'
  | 'sendChat'
  | 'draftComment'
  | 'saveDraft'
  | 'postComment'
  | 'discardDraft'
  | 'clearChat'
  | 'stopChat'
  | 'onChatSteps'
> & { summarize(sessionId: string, auto?: boolean): Promise<void> }

/** Builds the ticket chat over the orchestrator's stored chats and synced tickets. */
export function createTicketChat(ctx: {
  deps: Pick<OrchestratorDeps, 'claudeDir'>
  synced: ReadonlyMap<string, { tickets: Ticket[] }>
  chats: () => Chat[]
  setChats: (next: Chat[]) => void
  persist: () => Promise<void>
  changed: (projectId: string) => void
  projectById: (id: string) => Project
  sessionById: (id: string) => SessionRecord
  ticketRepo: (project: Project, github: string) => ProjectRepo
  checkFolders: (repos: ProjectRepo[]) => Promise<void>
  syncedTicket: (projectId: string, ticketKey: string) => Ticket
  detailsOf: (project: Project, ticketKey: string) => Promise<TicketDetails>
  trackerFor: (project: Project) => Tracker
  labelOf: (ticketKey: string) => string
  transcriptOf: (s: SessionRecord) => Promise<ConversationEntry[] | null>
  printClaude: PrintClaude
  subscribe: <T>(set: Set<T>, cb: T) => () => void
  recordRun: (projectId: string, ticketKey: string, id?: string) => Promise<string>
  printRun: PrintRun
  runsInFlight: Set<string>
}): TicketChat {
  const { deps, synced, persist, changed, projectById, sessionById, ticketRepo } = ctx
  const { checkFolders, syncedTicket, detailsOf, trackerFor, labelOf, transcriptOf } = ctx
  const { printClaude, recordRun, printRun, runsInFlight } = ctx

  const chatRepo = async (project: Project, ticketKey: string): Promise<ProjectRepo> => {
    const ticket = synced.get(project.id)?.tickets.find((t) => t.key === ticketKey)
    const repo = ticketRepo(
      project,
      isTrackerKey(ticketKey) ? (ticket?.repo ?? '') : parseTicketKey(ticketKey).repo
    )
    await checkFolders([repo])
    return repo
  }

  const chatting = new Set<string>()
  const stoppers = new Map<string, AbortController>()
  const stepListeners = new Set<(projectId: string, ticketKey: string, steps: Step[]) => void>()
  const chatKey = (projectId: string, ticketKey: string): string => `${projectId}\n${ticketKey}`
  const assertNotChatting = (projectId: string, ticketKey: string): string => {
    const key = chatKey(projectId, ticketKey)
    if (chatting.has(key)) throw new Error('Claude is still answering')
    return key
  }
  const chatOf = (projectId: string, ticketKey: string): Chat | undefined =>
    ctx.chats().find((c) => c.projectId === projectId && c.ticketKey === ticketKey)
  const saveChat = async (next: Chat): Promise<Chat> => {
    projectById(next.projectId)
    const old = chatOf(next.projectId, next.ticketKey)
    ctx.setChats([...ctx.chats().filter((c) => c !== old), next])
    try {
      await persist()
    } catch (err) {
      ctx.setChats([...ctx.chats().filter((c) => c !== next), ...(old ? [old] : [])])
      throw err
    }
    return next
  }
  const newChat = (project: Project, ticketKey: string, cwd: string): Chat => ({
    projectId: project.id,
    ticketKey,
    conversationId: randomUUID(),
    claudeDir: project.claudeDir ?? deps.claudeDir,
    cwd,
    messages: []
  })
  const clearDraft = async (chat: Chat): Promise<void> => {
    if (chat.messages.length) {
      await saveChat({ ...chat, draft: undefined, summary: undefined })
      return
    }
    ctx.setChats(ctx.chats().filter((c) => c !== chat))
    await persist()
  }
  type ChatPlace = Pick<Chat, 'conversationId' | 'claudeDir' | 'cwd'>
  const chatTurn = async <T>(
    projectId: string,
    ticketKey: string,
    turn: (ask: (prompt: string) => Promise<string>, place: ChatPlace, prev?: Chat) => Promise<T>
  ): Promise<T> => {
    const busy = assertNotChatting(projectId, ticketKey)
    const project = projectById(projectId)
    const label = labelOf(ticketKey)
    const saved = chatOf(projectId, ticketKey)
    const prev = saved?.messages.length ? saved : undefined
    try {
      return await chatRun(
        { answering: chatting, busyKey: busy, stoppers, stopKey: busy, runsInFlight },
        async (signal, recorded) => {
          let place: ChatPlace
          if (prev) {
            place = {
              conversationId: prev.conversationId,
              claudeDir: prev.claudeDir,
              cwd: prev.cwd
            }
          } else {
            const repo = await chatRepo(project, ticketKey)
            place = {
              conversationId: randomUUID(),
              claudeDir: projectById(projectId).claudeDir ?? deps.claudeDir,
              cwd: repo.path
            }
            recorded(await recordRun(projectId, ticketKey, place.conversationId))
          }
          const ask = async (prompt: string): Promise<string> => {
            const args = chatArgs({
              prompt,
              conversationId: place.conversationId,
              resume: !!prev,
              name: `Sandtable chat ${label}`,
              rules: CHAT_RULES
            })
            return parseChat(
              await printChat(printClaude, 'Chat', place, args, !!prev, {
                signal,
                onSteps: (steps) => stepListeners.forEach((cb) => cb(projectId, ticketKey, steps))
              })
            )
          }
          return turn(ask, place, prev)
        }
      )
    } finally {
      changed(projectId)
    }
  }

  const summarizing = new Set<string>()
  const summaryErrors = new Map<string, string>()

  return {
    async summarize(sessionId, auto = false) {
      const s = sessionById(sessionId)
      const { projectId, ticketKey } = s
      if (!ticketKey) throw new Error('Only a ticket session has a summary')
      const key = chatKey(projectId, ticketKey)
      if (chatting.has(key)) {
        if (auto) return
        summaryErrors.set(key, 'Claude is still answering')
        changed(projectId)
      }
      const busy = assertNotChatting(projectId, ticketKey)
      if (auto && chatOf(projectId, ticketKey)?.draft !== undefined) return
      const project = projectById(projectId)
      chatting.add(busy)
      summarizing.add(busy)
      summaryErrors.delete(busy)
      changed(projectId)
      try {
        const entries = await transcriptOf(s)
        if (!entries?.length) {
          if (auto) return
          throw new Error("Claude Code hasn't written this session's conversation")
        }
        const ticket = synced.get(projectId)?.tickets.find((t) => t.key === ticketKey)
        const cwd = (await chatRepo(project, ticketKey)).path
        const stdout = await printRun(projectId, ticketKey, 'Summary', cwd, (id) =>
          summaryArgs(
            summaryPrompt(ticket ? `${ticket.title}\n${ticket.url}` : ticketKey, entries),
            id,
            labelOf(ticketKey)
          )
        )
        const draft = withoutUnsafe(parseChat(stdout)).trim()
        if (!draft) throw new Error('Claude wrote an empty summary')
        await saveChat({
          ...(chatOf(projectId, ticketKey) ?? newChat(project, ticketKey, cwd)),
          draft,
          summary: true
        })
      } catch (err) {
        summaryErrors.set(busy, messageOf(err))
        throw err
      } finally {
        chatting.delete(busy)
        summarizing.delete(busy)
        changed(projectId)
      }
    },

    chat: async (projectId, ticketKey) => {
      const key = chatKey(projectId, ticketKey)
      const failed = summaryErrors.get(key)
      return {
        chat: chatOf(projectId, ticketKey) ?? null,
        answering: chatting.has(key),
        ...(summarizing.has(key) && { summarizing: true as const }),
        ...(failed !== undefined && { failed })
      }
    },

    async sendChat(projectId, ticketKey, text) {
      const message = text.trim()
      if (!message) throw new Error('Type a message first')
      if (Buffer.byteLength(message) > MAX_CHAT_MESSAGE_BYTES)
        throw new Error('The message is too long')
      const ticket = syncedTicket(projectId, ticketKey)
      return chatTurn(projectId, ticketKey, async (ask, place, prev) => {
        let prompt = withoutUnsafe(message)
        if (!prev) {
          const project = projectById(projectId)
          const { body, comments } = await detailsOf(project, ticketKey)
          prompt = chatPrompt({ ...ticket, body }, comments, message, serviceOf(project))
        }
        const answer = await ask(prompt)
        const now = chatOf(projectId, ticketKey)
        return saveChat({
          ...now,
          projectId,
          ticketKey,
          ...place,
          messages: [
            ...(now?.messages ?? []),
            { role: 'user', text: message },
            { role: 'assistant', text: answer }
          ]
        })
      })
    },

    async draftComment(projectId, ticketKey, mine) {
      if (!mine?.trim() && !chatOf(projectId, ticketKey)?.messages.length)
        throw new Error('Ask Claude something first')
      if (mine && Buffer.byteLength(mine) > MAX_CHAT_MESSAGE_BYTES)
        throw new Error('The comment is too long')
      return chatTurn(projectId, ticketKey, async (ask, place, prev) => {
        let prompt = mine?.trim() ? rewritePrompt(mine) : DRAFT_PROMPT
        if (!prev) {
          const project = projectById(projectId)
          const { body, comments } = await detailsOf(project, ticketKey)
          prompt = chatPrompt(
            { ...syncedTicket(projectId, ticketKey), body },
            comments,
            prompt,
            serviceOf(project)
          )
        }
        const draft = withoutUnsafe(await ask(prompt)).trim()
        const now = chatOf(projectId, ticketKey) ?? { projectId, ticketKey, ...place, messages: [] }
        await saveChat({ ...now, draft, summary: undefined })
        return draft
      })
    },

    async saveDraft(projectId, ticketKey, draft) {
      const project = projectById(projectId)
      const chat =
        chatOf(projectId, ticketKey) ??
        newChat(project, ticketKey, (await chatRepo(project, ticketKey)).path)
      await saveChat({ ...chat, draft })
    },

    async postComment(projectId, ticketKey, body) {
      const project = projectById(projectId)
      const text = withoutUnsafe(body).trim()
      if (!text) throw new Error('The comment is empty')
      await trackerFor(project).postComment(ticketKey, text)
      const chat = chatOf(projectId, ticketKey)
      if (chat?.draft !== undefined) await clearDraft(chat)
    },

    async discardDraft(projectId, ticketKey) {
      const chat = chatOf(projectId, ticketKey)
      if (chat?.draft !== undefined) await clearDraft(chat)
    },

    stopChat: async (projectId, ticketKey) => stoppers.get(chatKey(projectId, ticketKey))?.abort(),

    onChatSteps: (cb) => ctx.subscribe(stepListeners, cb),

    async clearChat(projectId, ticketKey) {
      summaryErrors.delete(assertNotChatting(projectId, ticketKey))
      ctx.setChats(ctx.chats().filter((c) => c !== chatOf(projectId, ticketKey)))
      await persist()
    }
  }
}

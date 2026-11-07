import { columnFor } from '../../shared/columns'
import { isTrackerKey, ticketLabel } from '../../shared/repo'
import { currentSession, isLive, STATE_LABELS } from '../../shared/sessions'
import type {
  ChatState,
  ConversationEntry,
  Project,
  SessionRecord,
  StatusMap,
  Ticket
} from '../../shared/types'
import type { CliHandler } from './cli'

const refuse = (text: string): { code: 1; text: string } => ({ code: 1, text })

/** The ticket `arg` names (`#12`, `owner/name#12`, or `APP-12`, any case), or the refusal text. */
export function resolveTicket(tickets: Ticket[], arg: string): Ticket | string {
  const want = arg.toLowerCase()
  const found = tickets.filter((t) =>
    want.startsWith('#')
      ? !isTrackerKey(t.key) && `#${t.number}` === want
      : t.key.toLowerCase() === want
  )
  if (found.length > 1)
    return `${arg} matches ${found.map((t) => t.key).join(' and ')}; use the full key`
  return found[0] ?? `No ticket ${arg} in this project`
}

/** The word `status` prints for a ticket and its newest session. */
export function stateWord(
  s: SessionRecord | undefined,
  ticket: Ticket,
  map: StatusMap,
  asking: boolean
): string {
  if (!s) return 'No session'
  const done = columnFor(ticket.status, map) === 'done'
  if (isLive(s)) {
    if (asking || s.asking) return 'Needs you (asking)'
    return done ? STATE_LABELS.doneOpen : STATE_LABELS[s.state]
  }
  return done ? 'Done' : STATE_LABELS[s.state]
}

/** The `sandtable` commands for a ticket session, answered from the orchestrator's state. */
export function createCliCommands(ctx: {
  sessions: () => SessionRecord[]
  synced: Map<string, { tickets: Ticket[] }>
  projectById: (id: string) => Project
  statusMapOf: (p: Project) => StatusMap
  transcriptOf: (s: SessionRecord) => Promise<ConversationEntry[] | null>
  chat: (projectId: string, ticketKey: string) => Promise<ChatState>
}): { run: CliHandler } {
  const run: CliHandler = async (callerId, command, arg) => {
    const caller = ctx.sessions().find((s) => s.id === callerId)
    if (!caller?.ticketKey) return refuse('Not a Sandtable ticket session')
    const found = resolveTicket(ctx.synced.get(caller.projectId)?.tickets ?? [], arg)
    if (typeof found === 'string') return refuse(found)
    if (found.key === caller.ticketKey)
      return refuse("A session can't use sandtable on its own ticket")
    if (command === 'wait' || command === 'start') return refuse('Not ready')
    const label = ticketLabel(found)
    const own = ctx.sessions().filter((s) => s.projectId === caller.projectId && !s.removedAt)
    const s = currentSession(own, found.key)
    if (command === 'status') {
      const map = ctx.statusMapOf(ctx.projectById(caller.projectId))
      return { code: 0, text: stateWord(s, found, map, false) }
    }
    if (!s) return refuse(`${label} has no session`)
    if (command === 'info') {
      return { code: 0, text: [s.branch ?? '', ...s.worktrees].join('\n') }
    }
    const { chat } = await ctx.chat(caller.projectId, found.key)
    const saved = chat?.summary && !isLive(s) ? chat.draft : undefined
    const last = (await ctx.transcriptOf(s))?.findLast((e) => e.kind === 'assistant')
    const text = saved ?? (last && 'text' in last ? last.text : undefined)
    return text ? { code: 0, text } : refuse(`${label} has no message yet`)
  }
  return { run }
}

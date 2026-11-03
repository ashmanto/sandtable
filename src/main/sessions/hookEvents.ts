import { mkdirSync, readdirSync, readFileSync, watch } from 'node:fs'
import { open, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { parseJson } from '../../shared/json'
import { readAppended } from './appended'
import type { BackgroundTask } from '../../shared/sessionStatus'
import type { SessionState } from '../../shared/types'

interface HookInput {
  hook_event_name?: unknown
  notification_type?: unknown
  background_tasks?: unknown
  source?: unknown
  session_id?: unknown
  agent_id?: unknown
  agent_type?: unknown
  tool_name?: unknown
  tool_input?: unknown
}

/** A subagent's request for permission to run a tool. */
export interface AgentRequest {
  agent: string
  tool: string
  input: unknown
}

const ASKING_NOTIFICATIONS = [
  'permission_prompt',
  'elicitation_dialog',
  'elicitation_url_dialog',
  'agent_needs_input',
  'worker_permission_prompt',
  undefined
]

const inFlight = (input: HookInput): ({ type?: unknown } | null)[] =>
  Array.isArray(input.background_tasks) ? input.background_tasks : []

/** Maps a Claude Code hook input to the session state it implies, or null to keep the current one. */
export function stateFromEvent(input: HookInput, agentInFlight = false): SessionState | null {
  switch (input.hook_event_name) {
    case 'PostToolUse':
      return input.agent_id ? null : 'running'
    case 'UserPromptSubmit':
      return 'running'
    case 'Stop':
      return inFlight(input).length > 0 ? null : 'needsYou'
    case 'StopFailure':
      return 'apiError'
    case 'Notification':
      if (input.notification_type === 'idle_prompt') return agentInFlight ? null : 'needsYou'
      return ASKING_NOTIFICATIONS.includes(input.notification_type as string) ? 'needsYou' : null
    case 'SessionStart':
      return input.source === 'resume' ? 'needsYou' : null
    case 'SandtableIdle':
      return 'idle'
    case 'SandtableStopped':
      return 'needsYou'
    case 'SandtableAnswered':
      return 'running'
    default:
      return null
  }
}

const askingFromEvent = (input: HookInput): boolean | null => {
  switch (input.hook_event_name) {
    case 'Notification':
      return ASKING_NOTIFICATIONS.includes(input.notification_type as string) ? true : null
    case 'PostToolUse':
      return input.agent_id ? null : false
    case 'Stop':
    case 'StopFailure':
    case 'UserPromptSubmit':
    case 'SandtableStopped':
    case 'SandtableAnswered':
      return false
    case 'SessionStart':
      return input.source === 'resume' ? false : null
    default:
      return null
  }
}

/** The events-file line Sandtable appends when you clear Needs you. */
export const IDLE_EVENT = JSON.stringify({ hook_event_name: 'SandtableIdle' })

/** The events-file line Sandtable appends after it interrupts a session, since Claude Code fires no hook then. */
export const STOPPED_EVENT = JSON.stringify({ hook_event_name: 'SandtableStopped' })

/** The events-file line Sandtable appends after you answer a subagent's last permission prompt, since Claude Code fires no hook then. */
export const ANSWERED_EVENT = JSON.stringify({ hook_event_name: 'SandtableAnswered' })

const RESCAN_MS = 2000

interface Memory {
  agentInFlight: boolean
  last: SessionState | null
  asking: boolean
  background?: boolean
}

function stateFromLine(line: string, memory: Memory): SessionState | null {
  const input = parseJson(line)
  if (typeof input !== 'object' || !input) return null
  const name = (input as HookInput).hook_event_name
  const repeat = name === 'Notification' && (input as HookInput).notification_type === 'idle_prompt'
  const failed = memory.last === 'apiError'
  const ignored =
    (name === 'SandtableIdle' && memory.last !== 'needsYou' && !failed) ||
    (repeat && (memory.last === 'idle' || failed))
  const state = ignored ? null : stateFromEvent(input, memory.agentInFlight)
  memory.asking = askingFromEvent(input) ?? memory.asking
  memory.background = Array.isArray((input as HookInput).background_tasks)
  if (state) memory.last = state
  else if (name === 'Stop' && memory.last === 'idle') memory.last = null
  if (name === 'UserPromptSubmit') memory.agentInFlight = false
  if (name === 'Stop')
    memory.agentInFlight = inFlight(input).some(
      (t) => t?.type === 'subagent' || t?.type === 'workflow'
    )
  return state
}

async function replay(
  eventsFile: string
): Promise<{ state: SessionState | null; asking: boolean; needsYou: number }> {
  const text = await readFile(eventsFile, 'utf8').catch(() => '')
  const memory: Memory = { agentInFlight: false, last: null, asking: false }
  let state: SessionState | null = null
  let needsYou = 0
  for (const line of text.split('\n')) {
    const next = stateFromLine(line, memory)
    if (next === 'needsYou' && state !== 'needsYou') needsYou++
    state = next ?? state
  }
  return { state, asking: memory.asking, needsYou }
}

/** Returns the state implied by the last known event in an events file, or null. */
export const readLastState = async (eventsFile: string): Promise<SessionState | null> =>
  (await replay(eventsFile)).state

/** Whether Claude's last turn in an events file stopped to ask you something, such as a permission. */
export const readAsking = async (eventsFile: string): Promise<boolean> =>
  (await replay(eventsFile)).asking

/** How many times an events file's session went to Needs you. */
export const countNeedsYou = async (eventsFile: string): Promise<number> =>
  (await replay(eventsFile)).needsYou

/** Whether Claude Code fired SessionStart into an events file after byte `from`, which it doesn't before you trust the folder. */
export const hasStarted = async (eventsFile: string, from = 0): Promise<boolean> =>
  (await readFile(eventsFile).catch(() => Buffer.alloc(0)))
    .subarray(from)
    .toString('utf8')
    .split('\n')
    .some((l) => (parseJson(l) as HookInput | null)?.hook_event_name === 'SessionStart')

/** The running background tasks the latest Stop, or Notification that lists them, reported in an events file. */
export async function readBackground(eventsFile: string): Promise<BackgroundTask[]> {
  const text = await readFile(eventsFile, 'utf8').catch(() => '')
  let tasks: unknown[] = []
  for (const line of text.split('\n')) {
    const e = parseJson(line) as HookInput | null | undefined
    const listed = Array.isArray(e?.background_tasks)
    if (e?.hook_event_name === 'Stop' || (e?.hook_event_name === 'Notification' && listed))
      tasks = listed ? (e.background_tasks as unknown[]) : []
  }
  return tasks.flatMap((t) => {
    const { type, status, description } = (t ?? {}) as Record<string, unknown>
    return status === 'running' && typeof type === 'string'
      ? [{ type, description: typeof description === 'string' ? description : '' }]
      : []
  })
}

/** Each subagent's latest permission request in an events file, oldest first, left out once that subagent used a tool after it. */
export async function readAgentRequests(eventsFile: string): Promise<AgentRequest[]> {
  const text = await readFile(eventsFile, 'utf8').catch(() => '')
  const requests = new Map<unknown, AgentRequest>()
  for (const line of text.split('\n')) {
    const e = parseJson(line) as HookInput | null | undefined
    if (!e?.agent_id) continue
    requests.delete(e.agent_id)
    if (e.hook_event_name === 'PermissionRequest')
      requests.set(e.agent_id, {
        agent: String(e.agent_type),
        tool: String(e.tool_name),
        input: e.tool_input
      })
  }
  return [...requests.values()]
}

/** The session's first conversation ID, then each one a `/clear` started, from its events file. */
export async function conversationIds(eventsFile: string, firstId: string): Promise<string[]> {
  const text = await readFile(eventsFile, 'utf8').catch(() => '')
  const ids = [firstId]
  for (const line of text.split('\n')) {
    const e = parseJson(line) as HookInput | null | undefined
    const id = e?.session_id
    if (
      e?.hook_event_name === 'SessionStart' &&
      e.source === 'clear' &&
      typeof id === 'string' &&
      /^[\w-]+$/.test(id)
    )
      ids.push(id)
  }
  return ids
}

interface Tail extends Memory {
  offset: number
  queue: Promise<void>
}

/** Watches `<dir>/<sessionId>.jsonl` files and calls onChange for each new state event or change in asking; returns a stop function. */
export function watchEvents(
  dir: string,
  onChange: (sessionId: string, state: SessionState | null, asking: boolean) => void
): () => void {
  const tails = new Map<string, Tail>()
  let stopped = false

  const drain = async (sessionId: string, tail: Tail): Promise<void> => {
    let handle
    try {
      handle = await open(join(dir, `${sessionId}.jsonl`), 'r')
    } catch {
      return
    }
    try {
      const { size } = await handle.stat()
      if (size < tail.offset)
        Object.assign(tail, {
          offset: 0,
          agentInFlight: false,
          last: null,
          asking: false
        })
      if (size === tail.offset) return
      await readAppended(handle, tail.offset, size, (text, end) => {
        tail.offset = end
        for (const line of text.slice(0, -1).split('\n')) {
          const asking = tail.asking
          const state = stateFromLine(line, tail)
          if ((state || tail.asking !== asking || tail.background) && !stopped)
            try {
              onChange(sessionId, state, tail.asking)
            } catch (err) {
              console.error(`Sandtable could not handle an event of session ${sessionId}`, err)
            }
        }
      })
    } finally {
      await handle.close()
    }
  }

  const tailFor = (sessionId: string): Tail => {
    let tail = tails.get(sessionId)
    if (!tail) {
      tail = {
        offset: 0,
        queue: Promise.resolve(),
        agentInFlight: false,
        last: null,
        asking: false
      }
      tails.set(sessionId, tail)
    }
    return tail
  }

  const schedule = (sessionId: string): void => {
    const tail = tailFor(sessionId)
    tail.queue = tail.queue.then(() => drain(sessionId, tail)).catch(() => undefined)
  }

  mkdirSync(dir, { recursive: true })
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.jsonl')) continue
    const tail = tailFor(basename(name, '.jsonl'))
    const text = readFileSync(join(dir, name))
    tail.offset = text.lastIndexOf(0x0a) + 1
    for (const line of text.subarray(0, tail.offset).toString('utf8').split('\n'))
      stateFromLine(line, tail)
  }

  const watcher = watch(dir, (_event, filename) => {
    if (!stopped && filename?.endsWith('.jsonl')) schedule(basename(filename, '.jsonl'))
  })
  watcher.on('error', () => undefined)

  const timer = setInterval(() => {
    try {
      for (const name of readdirSync(dir))
        if (name.endsWith('.jsonl')) schedule(basename(name, '.jsonl'))
    } catch {
      return
    }
  }, RESCAN_MS)

  return () => {
    stopped = true
    clearInterval(timer)
    watcher.close()
  }
}

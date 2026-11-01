import { mkdirSync, watch, type FSWatcher } from 'node:fs'
import { open, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseJson } from '../../shared/json'
import { isLive } from '../../shared/sessions'
import { parseStatus, type BackgroundTask, type SessionStatus } from '../../shared/sessionStatus'
import type { ConversationChunk, ConversationEntry, SessionRecord } from '../../shared/types'
import { readAppended } from './appended'
import { conversationParser, parseConversation } from './conversation'

/** How many of a conversation's latest entries the renderer gets on its first load. */
const MAX_CONVERSATION_ENTRIES = 500

const DEBOUNCE_MS = 50
const STATUS_FILE = /^([\w-]+)\.json$/

type Watch = {
  s: SessionRecord
  count: number
  files: string
  file?: string
  ino: number
  offset: number
  parser: ReturnType<typeof conversationParser>
  base: ConversationEntry[]
  dropped: number
  facts: string
  watcher?: FSWatcher
  watching?: string
  timer?: NodeJS.Timeout
  queue: Promise<void>
}

type ConversationListener = (sessionId: string, chunk: ConversationChunk) => void
type StatusListener = (sessionId: string, status: SessionStatus) => void

/** Watches live sessions' transcripts and status-line files and pushes their changes. */
export function createLiveView(ctx: {
  statusDir: string
  sessions: () => SessionRecord[]
  sessionById: (id: string) => SessionRecord
  conversationFiles: (s: SessionRecord) => Promise<{ id: string; file: string }[]>
  readBackground: (eventsFile: string) => Promise<BackgroundTask[]>
  subscribe: <T>(set: Set<T>, cb: T) => () => void
}): {
  status(sessionId: string): Promise<SessionStatus | null>
  onStatus(cb: StatusListener): () => void
  watchConversation(sessionId: string): Promise<ConversationChunk>
  unwatchConversation(sessionId: string): Promise<void>
  unwatchAll(): void
  onConversation(cb: ConversationListener): () => void
  eventSeen(sessionId: string): Promise<void>
  entryCount(sessionId: string): Promise<number>
  tick(): Promise<void>
  stop(): void
} {
  const watches = new Map<string, Watch>()
  const conversationListeners = new Set<ConversationListener>()
  const statusListeners = new Set<StatusListener>()
  const background = new Map<string, BackgroundTask[]>()
  const statusTimers = new Map<string, NodeJS.Timeout>()
  let statusWatcher: FSWatcher | undefined

  const fresh = (s: SessionRecord): Watch => ({
    s,
    count: 0,
    files: '',
    ino: 0,
    offset: 0,
    parser: conversationParser(),
    base: [],
    dropped: 0,
    facts: '',
    queue: Promise.resolve()
  })
  const total = (w: Watch): number => w.base.length + w.parser.entries.length
  const tail = (w: Watch, i: number): ConversationEntry[] =>
    i < w.base.length
      ? [...w.base.slice(i), ...w.parser.entries]
      : w.parser.entries.slice(i - w.base.length)
  const start = (w: Watch): { start?: number } => (w.dropped ? { start: w.dropped } : {})
  const whole = (w: Watch): ConversationChunk => ({
    from: 0,
    entries: tail(w, w.dropped),
    facts: w.parser.facts,
    ...start(w)
  })
  const current = (w: Watch): boolean => watches.get(w.s.id) === w
  const emit = (w: Watch, chunk: ConversationChunk): void => {
    if (current(w)) conversationListeners.forEach((cb) => cb(w.s.id, chunk))
  }
  const enqueue = (w: Watch, job: () => Promise<void>): Promise<void> =>
    (w.queue = w.queue
      .then(job)
      .catch((err) =>
        console.error(`Sandtable could not read session ${w.s.id}'s transcript`, err)
      ))

  const read = async (w: Watch): Promise<number | 'reload' | null> => {
    if (!w.file) return null
    let handle
    try {
      handle = await open(w.file, 'r')
    } catch {
      return null
    }
    try {
      const { ino, size } = await handle.stat()
      if ((w.ino && ino !== w.ino) || size < w.offset) return 'reload'
      w.ino = ino
      if (size === w.offset) return null
      let changed = w.parser.entries.length
      await readAppended(handle, w.offset, size, (text, end) => {
        w.offset = end
        changed = Math.min(changed, w.parser.add(text))
      })
      return changed
    } finally {
      await handle.close()
    }
  }

  const follow = (w: Watch): void => {
    if (w.watching === w.file || !current(w)) return
    w.watcher?.close()
    w.watcher = undefined
    w.watching = w.file
    if (!w.file) return
    w.watcher = watch(w.file, () => {
      clearTimeout(w.timer)
      w.timer = setTimeout(() => void enqueue(w, () => update(w, false)), DEBOUNCE_MS)
    })
    w.watcher.on('error', () => undefined)
  }

  const load = async (w: Watch, files?: { id: string; file: string }[]): Promise<void> => {
    files ??= await ctx.conversationFiles(w.s)
    const base: ConversationEntry[] = []
    for (const { file } of files.slice(0, -1))
      base.push(...parseConversation(await readFile(file, 'utf8')), {
        kind: 'user',
        text: '/clear'
      })
    Object.assign(w, {
      files: files.map((f) => f.file).join('\n'),
      file: files.at(-1)?.file,
      ino: 0,
      offset: 0,
      parser: conversationParser(),
      base
    })
    await read(w)
    w.dropped = Math.max(0, total(w) - MAX_CONVERSATION_ENTRIES)
    w.facts = JSON.stringify(w.parser.facts)
    follow(w)
  }

  const update = async (w: Watch, checkFiles: boolean): Promise<void> => {
    if (!current(w)) return
    const files = checkFiles ? await ctx.conversationFiles(w.s) : undefined
    const changed =
      files && files.map((f) => f.file).join('\n') !== w.files ? 'reload' : await read(w)
    if (changed === null) return
    if (changed !== 'reload') {
      const facts = JSON.stringify(w.parser.facts)
      if (changed === w.parser.entries.length && facts === w.facts) return
      w.facts = facts
      const from = w.base.length + changed - w.dropped
      if (from >= 0)
        return emit(w, {
          from,
          entries: tail(w, from + w.dropped),
          facts: w.parser.facts,
          ...start(w)
        })
    }
    if (changed === 'reload') await load(w, files)
    else w.dropped = Math.max(0, total(w) - MAX_CONVERSATION_ENTRIES)
    emit(w, whole(w))
  }

  const close = (w: Watch): void => {
    clearTimeout(w.timer)
    w.watcher?.close()
    watches.delete(w.s.id)
  }

  const readStatus = async (id: string): Promise<SessionStatus | null> => {
    const parsed = parseStatus(
      parseJson(await readFile(join(ctx.statusDir, `${id}.json`), 'utf8').catch(() => ''))
    )
    if (!parsed) return null
    const s = ctx.sessions().find((x) => x.id === id)
    let tasks = background.get(id)
    if (!tasks && s) background.set(id, (tasks = await ctx.readBackground(s.eventsFile)))
    return { ...parsed, background: tasks ?? [] }
  }
  const pushStatus = async (id: string): Promise<void> => {
    const status = await readStatus(id)
    if (status) statusListeners.forEach((cb) => cb(id, status))
  }

  const watchStatus = (): void => {
    const live = ctx.sessions().some(isLive)
    if (live && !statusWatcher) {
      mkdirSync(ctx.statusDir, { recursive: true })
      statusWatcher = watch(ctx.statusDir, (_event, name) => {
        const id = name && STATUS_FILE.exec(name)?.[1]
        if (!id) return
        clearTimeout(statusTimers.get(id))
        statusTimers.set(
          id,
          setTimeout(() => void pushStatus(id).catch(() => undefined), DEBOUNCE_MS)
        )
      })
      statusWatcher.on('error', () => undefined)
    } else if (!live && statusWatcher) {
      statusWatcher.close()
      statusWatcher = undefined
    }
  }

  return {
    status: readStatus,
    onStatus: (cb) => ctx.subscribe(statusListeners, cb),
    onConversation: (cb) => ctx.subscribe(conversationListeners, cb),

    async watchConversation(sessionId) {
      const s = ctx.sessionById(sessionId)
      let w = watches.get(sessionId)
      if (!w) {
        w = fresh(s)
        watches.set(sessionId, w)
        void enqueue(w, () => load(w!))
      }
      w.count++
      await w.queue
      return w.files || isLive(s) ? whole(w) : { ...whole(w), missing: true }
    },

    async unwatchConversation(sessionId) {
      const w = watches.get(sessionId)
      if (w && --w.count <= 0) close(w)
    },

    async eventSeen(sessionId) {
      const s = ctx.sessions().find((x) => x.id === sessionId)
      if (!s) return
      try {
        background.set(sessionId, await ctx.readBackground(s.eventsFile))
        await pushStatus(sessionId)
      } catch (err) {
        console.error(`Sandtable could not read session ${sessionId}'s status`, err)
      }
    },

    async entryCount(sessionId) {
      const w = watches.get(sessionId)
      if (w) {
        await enqueue(w, () => update(w, true))
        return total(w)
      }
      const unwatched = fresh(ctx.sessionById(sessionId))
      await load(unwatched)
      return total(unwatched)
    },

    async tick() {
      watchStatus()
      await Promise.all([...watches.values()].map((w) => enqueue(w, () => update(w, true))))
    },

    unwatchAll: () => [...watches.values()].forEach(close),

    stop() {
      ;[...watches.values()].forEach(close)
      statusTimers.forEach(clearTimeout)
      statusWatcher?.close()
      statusWatcher = undefined
    }
  }
}

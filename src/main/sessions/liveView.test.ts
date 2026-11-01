import { appendFile, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationChunk, SessionRecord } from '../../shared/types'
import type { SessionStatus } from '../../shared/sessionStatus'
import { findConversation } from './conversation'
import { conversationIds, readBackground } from './hookEvents'
import { createLiveView } from './liveView'

const SLOW = { timeout: 3000, interval: 20 }
const row = (o: object): string => JSON.stringify(o) + '\n'
const user = (text: string): string => row({ type: 'user', message: { content: text } })
const said = (text: string): string =>
  row({ type: 'assistant', message: { content: [{ type: 'text', text }] } })
const call = row({
  type: 'assistant',
  message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] }
})
const result = row({
  type: 'user',
  message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'out' }] }
})

let dir: string
let view: ReturnType<typeof createLiveView>
let chunks: [string, ConversationChunk][]
let statuses: [string, SessionStatus][]
let session: SessionRecord

const transcript = (id: string): string => join(dir, 'claude', 'projects', 'p', `${id}.jsonl`)

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'live-view-'))
  await mkdir(join(dir, 'claude', 'projects', 'p'), { recursive: true })
  await mkdir(join(dir, 'events'))
  session = { id: 's1', state: 'running', eventsFile: join(dir, 'events', 's1.jsonl') } as never
  const sessions = (): SessionRecord[] => [session]
  view = createLiveView({
    statusDir: join(dir, 'status'),
    sessions,
    sessionById: (id) => sessions().find((s) => s.id === id)!,
    conversationFiles: async (s) => {
      const files = []
      for (const id of await conversationIds(s.eventsFile, s.id)) {
        const file = await findConversation(join(dir, 'claude'), id)
        if (file) files.push({ id, file })
      }
      return files
    },
    readBackground,
    subscribe: (set, cb) => {
      set.add(cb)
      return () => set.delete(cb)
    }
  })
  chunks = []
  statuses = []
  view.onConversation((id, chunk) => chunks.push([id, chunk]))
  view.onStatus((id, status) => statuses.push([id, status]))
})

afterEach(async () => {
  view.stop()
  await rm(dir, { recursive: true, force: true })
})

const facts = { todos: [], permissionMode: null, compactions: [] }

describe('watchConversation', () => {
  it('marks a session that is not live and has no file as missing', async () => {
    session = { ...session, state: 'finished' }
    expect(await view.watchConversation('s1')).toEqual({
      from: 0,
      entries: [],
      facts,
      missing: true
    })
  })

  it("doesn't mark a live session with no file yet as missing", async () => {
    expect(await view.watchConversation('s1')).toEqual({ from: 0, entries: [], facts })
  })

  it('pushes appended entries', async () => {
    await writeFile(transcript('s1'), user('Hi'))
    expect(await view.watchConversation('s1')).toEqual({
      from: 0,
      entries: [{ kind: 'user', text: 'Hi' }],
      facts
    })
    await appendFile(transcript('s1'), said('Hello'))
    await view.tick()
    expect(chunks).toEqual([
      ['s1', { from: 1, entries: [{ kind: 'assistant', text: 'Hello' }], facts }]
    ])
  })

  it('pushes a tool result into its call', async () => {
    await writeFile(transcript('s1'), user('Hi') + call)
    await view.watchConversation('s1')
    await appendFile(transcript('s1'), result)
    await view.tick()
    expect(chunks).toHaveLength(1)
    const [, chunk] = chunks[0]
    expect(chunk.from).toBe(1)
    expect(chunk.entries).toMatchObject([{ kind: 'tool', name: 'Bash', output: 'out' }])
  })

  it('reloads after /clear', async () => {
    await writeFile(transcript('s1'), user('Before'))
    await view.watchConversation('s1')
    await appendFile(
      session.eventsFile,
      row({ hook_event_name: 'SessionStart', source: 'clear', session_id: 'c2' })
    )
    await writeFile(transcript('c2'), user('After'))
    await view.tick()
    expect(chunks.at(-1)).toEqual([
      's1',
      {
        from: 0,
        entries: [
          { kind: 'user', text: 'Before' },
          { kind: 'user', text: '/clear' },
          { kind: 'user', text: 'After' }
        ],
        facts
      }
    ])
  })

  it("waits for a transcript that doesn't exist yet", async () => {
    expect((await view.watchConversation('s1')).entries).toEqual([])
    await writeFile(transcript('s1'), user('Hi'))
    await view.tick()
    expect(chunks).toEqual([['s1', { from: 0, entries: [{ kind: 'user', text: 'Hi' }], facts }]])
  })

  it('closes on the last unwatch', async () => {
    await writeFile(transcript('s1'), user('Hi'))
    await view.watchConversation('s1')
    await view.watchConversation('s1')
    await view.unwatchConversation('s1')
    await appendFile(transcript('s1'), said('One'))
    await view.tick()
    expect(chunks).toEqual([
      ['s1', { from: 1, entries: [{ kind: 'assistant', text: 'One' }], facts }]
    ])
    await view.unwatchConversation('s1')
    await appendFile(transcript('s1'), said('Two'))
    await view.tick()
    expect(chunks).toHaveLength(1)
  })

  it('closes every watch at unwatchAll, and a later watch counts afresh', async () => {
    await writeFile(transcript('s1'), user('Hi'))
    await view.watchConversation('s1')
    await view.watchConversation('s1')
    view.unwatchAll()
    await appendFile(transcript('s1'), said('Gone'))
    await view.tick()
    expect(chunks).toEqual([])
    await view.watchConversation('s1')
    await view.unwatchConversation('s1')
    await appendFile(transcript('s1'), said('Still gone'))
    await view.tick()
    expect(chunks).toEqual([])
  })

  it('keeps following a finished session that turns live again', async () => {
    session.state = 'finished'
    await writeFile(transcript('s1'), user('Hi'))
    expect((await view.watchConversation('s1')).entries).toEqual([{ kind: 'user', text: 'Hi' }])
    session.state = 'running'
    await appendFile(transcript('s1'), said('Back'))
    await view.tick()
    expect(chunks).toEqual([
      ['s1', { from: 1, entries: [{ kind: 'assistant', text: 'Back' }], facts }]
    ])
  })

  it('keeps indexes into the last 500 entries it sent', async () => {
    await writeFile(transcript('s1'), user('x').repeat(502) + call)
    const first = await view.watchConversation('s1')
    expect(first.entries).toHaveLength(500)
    await appendFile(transcript('s1'), result)
    await view.tick()
    expect(first.start).toBe(3)
    expect(chunks.at(-1)?.[1]).toMatchObject({ from: 499, start: 3 })
  })
})

describe('entryCount', () => {
  it('counts every file and its /clear entry when the conversation is not watched', async () => {
    await writeFile(transcript('s1'), user('Before') + said('Reply'))
    await appendFile(
      session.eventsFile,
      row({ hook_event_name: 'SessionStart', source: 'clear', session_id: 'c2' })
    )
    await writeFile(transcript('c2'), user('After'))
    expect(await view.entryCount('s1')).toBe(4)
    expect(chunks).toEqual([])
  })

  it('reads what is new in a watched conversation', async () => {
    await writeFile(transcript('s1'), user('Hi'))
    await view.watchConversation('s1')
    await appendFile(transcript('s1'), said('One') + said('Two'))
    expect(await view.entryCount('s1')).toBe(3)
  })
})

describe('status', () => {
  const json = {
    model: { display_name: 'Opus' },
    cost: { total_lines_added: 3, total_lines_removed: 1 }
  }
  const put = async (id: string, text: string): Promise<void> => {
    await mkdir(join(dir, 'status'), { recursive: true })
    const temp = join(dir, 'status', `${id}.json.123`)
    await writeFile(temp, text)
    await rename(temp, join(dir, 'status', `${id}.json`))
  }

  it('pushes status', async () => {
    await view.tick()
    await vi.waitFor(async () => {
      await put('s2', '{oops')
      await put('s1', JSON.stringify(json))
      expect(statuses.length).toBeGreaterThan(0)
    }, SLOW)
    expect(statuses.every(([id]) => id === 's1')).toBe(true)
    expect(statuses[0][1]).toMatchObject({ model: 'Opus', linesAdded: 3, background: [] })
    expect(await view.status('s1')).toMatchObject({ model: 'Opus' })
    expect(await view.status('s2')).toBeNull()
  })

  it('merges running background tasks at a hook event', async () => {
    await put('s1', JSON.stringify(json))
    await writeFile(
      session.eventsFile,
      row({
        hook_event_name: 'Stop',
        background_tasks: [{ type: 'shell', status: 'running', description: 'npm run dev' }]
      })
    )
    await view.eventSeen('s1')
    expect(statuses.at(-1)).toEqual([
      's1',
      expect.objectContaining({ background: [{ type: 'shell', description: 'npm run dev' }] })
    ])
  })
})

import { appendFileSync } from 'node:fs'
import { appendFile, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionState } from '../../shared/types'
import {
  ANSWERED_EVENT,
  conversationIds,
  countNeedsYou,
  hasEvent,
  hasStarted,
  IDLE_EVENT,
  readAgentRequests,
  readAsking,
  readBackground,
  readLastState,
  stateFromEvent,
  STOPPED_EVENT,
  watchEvents
} from './hookEvents'

const line = (name: string): string =>
  JSON.stringify({ session_id: 's', hook_event_name: name }) + '\n'

let dir: string
let stop: (() => void) | undefined

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hook-events-'))
})

afterEach(async () => {
  stop?.()
  stop = undefined
  await rm(dir, { recursive: true, force: true })
})

const ev = (name: string, rest: object = {}): object => ({ hook_event_name: name, ...rest })
const task = (type: string, status = 'running'): object => ({ id: 'b1', type, status })
const json = (o: object): string => JSON.stringify(o) + '\n'
const notification = (type: string): string => json(ev('Notification', { notification_type: type }))
const stopWith = (...tasks: object[]): string => json(ev('Stop', { background_tasks: tasks }))

describe('stateFromEvent', () => {
  it('maps hook events to states', () => {
    expect(stateFromEvent(ev('UserPromptSubmit'))).toBe('running')
    expect(stateFromEvent(ev('PostToolUse'))).toBe('running')
    expect(stateFromEvent(ev('PreToolUse'))).toBeNull()
    expect(stateFromEvent(ev('PostToolUse', { agent_id: 'a1' }))).toBeNull()
    expect(stateFromEvent(ev('SandtableIdle'))).toBe('idle')
    expect(stateFromEvent(JSON.parse(STOPPED_EVENT))).toBe('needsYou')
    expect(stateFromEvent(ev('StopFailure', { error: 'rate_limit' }))).toBe('apiError')
  })

  it('needs you when a resumed conversation starts, and ignores other starts', () => {
    expect(stateFromEvent(ev('SessionStart', { source: 'resume' }))).toBe('needsYou')
    for (const source of ['startup', 'clear', 'compact'])
      expect(stateFromEvent(ev('SessionStart', { source })), source).toBeNull()
  })

  it('keeps the current state at a Stop with background work in flight', () => {
    expect(stateFromEvent(ev('Stop', { background_tasks: [task('shell')] }))).toBeNull()
    expect(
      stateFromEvent(ev('Stop', { background_tasks: [task('subagent', 'pending')] }))
    ).toBeNull()
  })

  it('needs you at a Stop with nothing in flight', () => {
    expect(stateFromEvent(ev('Stop', { background_tasks: [] }))).toBe('needsYou')
    expect(stateFromEvent(ev('Stop'))).toBe('needsYou')
  })

  it('needs you at a Notification that asks you, and ignores the rest', () => {
    for (const type of [
      'permission_prompt',
      'elicitation_dialog',
      'elicitation_url_dialog',
      'agent_needs_input',
      'worker_permission_prompt'
    ])
      expect(stateFromEvent(ev('Notification', { notification_type: type })), type).toBe('needsYou')
    expect(stateFromEvent(ev('Notification'))).toBe('needsYou')
    for (const type of ['elicitation_response', 'auth_success', 'agent_completed'])
      expect(stateFromEvent(ev('Notification', { notification_type: type })), type).toBeNull()
  })
})

describe('hasStarted', () => {
  it('is whether the events file has a SessionStart line', async () => {
    const file = join(dir, 'a.jsonl')
    expect(await hasStarted(file)).toBe(false)
    await writeFile(file, IDLE_EVENT + '\n{oops\n')
    expect(await hasStarted(file)).toBe(false)
    await appendFile(file, line('SessionStart'))
    expect(await hasStarted(file)).toBe(true)
  })

  it('reads only from a byte offset, so an earlier launch does not count', async () => {
    const file = join(dir, 'b.jsonl')
    await writeFile(file, line('SessionStart'))
    const { size } = await stat(file)
    expect(await hasStarted(file, size)).toBe(false)
    await appendFile(file, line('SessionStart'))
    expect(await hasStarted(file, size)).toBe(true)
  })
})

describe('hasEvent', () => {
  it('finds a named event only past a byte offset', async () => {
    const file = join(dir, 'g.jsonl')
    await writeFile(file, line('SandtableGate'))
    const { size } = await stat(file)
    expect(await hasEvent(file, 'SandtableGate')).toBe(true)
    expect(await hasEvent(file, 'SandtableGate', size)).toBe(false)
    await appendFile(file, line('Stop'))
    expect(await hasEvent(file, 'SandtableGate', size)).toBe(false)
    await appendFile(file, line('SandtableGate'))
    expect(await hasEvent(file, 'SandtableGate', size)).toBe(true)
  })
})

describe('readBackground', () => {
  it("is the latest Stop's running tasks, without the finished ones", async () => {
    const file = join(dir, 'b.jsonl')
    const shell = { id: 'b2', type: 'shell', status: 'running', description: 'npm run dev' }
    await writeFile(
      file,
      stopWith(task('subagent')) + stopWith(shell, { ...task('subagent'), status: 'completed' })
    )
    expect(await readBackground(file)).toEqual([{ type: 'shell', description: 'npm run dev' }])
  })

  it('is empty after a Stop with none, and without an events file', async () => {
    const file = join(dir, 'b.jsonl')
    await writeFile(file, stopWith(task('shell')) + line('Stop'))
    expect(await readBackground(file)).toEqual([])
    expect(await readBackground(join(dir, 'missing.jsonl'))).toEqual([])
  })
})

describe('ANSWERED_EVENT', () => {
  it('ends asking and turns the session running', async () => {
    const file = join(dir, 'a.jsonl')
    await writeFile(file, notification('permission_prompt') + ANSWERED_EVENT + '\n')
    expect(await readAsking(file)).toBe(false)
    expect(await readLastState(file)).toBe('running')
  })
})

describe('readAgentRequests', () => {
  const request = (agent: string, command: string): string =>
    json(
      ev('PermissionRequest', {
        agent_id: agent,
        agent_type: 'general-purpose',
        tool_name: 'Bash',
        tool_input: { command }
      })
    )
  const used = (agent: string): string => json(ev('PostToolUse', { agent_id: agent }))

  it("is each subagent's latest permission request, oldest first, until it uses a tool", async () => {
    const file = join(dir, 'r.jsonl')
    await writeFile(
      file,
      request('a1', 'touch a') +
        request('a2', 'touch b') +
        request('a1', 'touch c') +
        json(ev('PermissionRequest', { tool_name: 'Agent', tool_input: {} })) +
        request('a3', 'touch d') +
        used('a2') +
        json(ev('PostToolUse')) +
        line('Stop')
    )
    expect(await readAgentRequests(file)).toEqual([
      { agent: 'general-purpose', tool: 'Bash', input: { command: 'touch c' } },
      { agent: 'general-purpose', tool: 'Bash', input: { command: 'touch d' } }
    ])
    expect(await readAgentRequests(join(dir, 'missing.jsonl'))).toEqual([])
  })
})

describe('conversationIds', () => {
  const start = (source: string, id: string): string =>
    JSON.stringify({ hook_event_name: 'SessionStart', source, session_id: id }) + '\n'

  it('is the first ID, then each ID a /clear started', async () => {
    const file = join(dir, 'a.jsonl')
    await writeFile(
      file,
      start('startup', 'a') +
        line('Stop') +
        start('clear', 'b') +
        start('compact', 'b') +
        '{oops\nnull\n' +
        start('resume', 'x') +
        start('clear', 'c')
    )
    expect(await conversationIds(file, 'a')).toEqual(['a', 'b', 'c'])
  })

  it("leaves out an ID that isn't a plain name, since it becomes part of a path", async () => {
    const file = join(dir, 'a.jsonl')
    await writeFile(file, start('clear', '../x') + start('clear', 'b/c') + start('clear', 'd-1_e'))
    expect(await conversationIds(file, 'a')).toEqual(['a', 'd-1_e'])
  })

  it('is only the first ID without an events file', async () => {
    expect(await conversationIds(join(dir, 'none.jsonl'), 'a')).toEqual(['a'])
  })
})

describe('readLastState', () => {
  const last = async (text: string): Promise<SessionState | null> => {
    const file = join(dir, 'a.jsonl')
    await writeFile(file, text)
    return readLastState(file)
  }

  it("keeps a failed turn through Claude Code's idle reminder", async () => {
    expect(
      await last(line('UserPromptSubmit') + line('StopFailure') + notification('idle_prompt'))
    ).toBe('apiError')
  })

  it('clears a failed turn to Idle', async () => {
    expect(await last(line('StopFailure') + IDLE_EVENT + '\n')).toBe('idle')
  })

  it('returns the state of the last known event, skipping blank and malformed lines', async () => {
    expect(
      await last(line('UserPromptSubmit') + line('Stop') + line('PreToolUse') + '\n{oops\n')
    ).toBe('needsYou')
  })

  it('stays running at a Stop with background work in flight', async () => {
    expect(await last(line('UserPromptSubmit') + stopWith(task('shell')))).toBe('running')
  })

  it("keeps a permission prompt's needsYou through a Stop with work in flight", async () => {
    expect(await last(notification('permission_prompt') + stopWith(task('subagent')))).toBe(
      'needsYou'
    )
  })

  it("keeps a permission prompt's needsYou through a subagent's tool use, not the main session's", async () => {
    const prompt = notification('permission_prompt')
    const subagent = json(ev('PostToolUse', { agent_id: 'a2c4d5a13dfb9b228' }))
    expect(await last(prompt + subagent)).toBe('needsYou')
    expect(await last(prompt + subagent + line('PostToolUse'))).toBe('running')
  })

  it('stays running at idle_prompt while a subagent or workflow is in flight', async () => {
    const start = line('UserPromptSubmit')
    expect(
      await last(start + stopWith(task('shell'), task('subagent')) + notification('idle_prompt'))
    ).toBe('running')
    expect(await last(start + stopWith(task('workflow')) + notification('idle_prompt'))).toBe(
      'running'
    )
  })

  it('needs you at idle_prompt when only background commands are in flight', async () => {
    const start = line('UserPromptSubmit')
    expect(await last(start + stopWith(task('shell')) + notification('idle_prompt'))).toBe(
      'needsYou'
    )
    expect(
      await last(
        start +
          stopWith(task('subagent')) +
          start +
          stopWith(task('shell')) +
          notification('idle_prompt')
      )
    ).toBe('needsYou')
  })

  it('needs you at idle_prompt after an interrupted turn, which has no Stop', async () => {
    const start = line('UserPromptSubmit')
    expect(
      await last(start + stopWith(task('subagent')) + start + notification('idle_prompt'))
    ).toBe('needsYou')
  })

  it('keeps a clear through idle_prompt until a real Needs you event', async () => {
    const idle = IDLE_EVENT + '\n'
    const prompt = notification('idle_prompt')
    expect(await last(line('Stop') + idle + prompt)).toBe('idle')
    expect(await last(line('Stop') + idle + prompt + line('Stop'))).toBe('needsYou')
    expect(await last(idle + line('UserPromptSubmit') + line('Stop') + prompt)).toBe('needsYou')
  })

  it('ignores a clear that lands after the session moved on', async () => {
    expect(await last(line('Stop') + line('UserPromptSubmit') + IDLE_EVENT + '\n')).toBe('running')
  })

  it('needs you at idle_prompt after a fresh turn that ends with background commands', async () => {
    const idle = IDLE_EVENT + '\n'
    expect(
      await last(line('Stop') + idle + stopWith(task('shell')) + notification('idle_prompt'))
    ).toBe('needsYou')
  })

  it('returns null for a missing file', async () => {
    expect(await readLastState(join(dir, 'missing.jsonl'))).toBeNull()
  })
})

describe('readAsking', () => {
  const asking = async (text: string): Promise<boolean> => {
    const file = join(dir, 'a.jsonl')
    await writeFile(file, text)
    return readAsking(file)
  }

  it('ends asking at a StopFailure', async () => {
    expect(await asking(notification('permission_prompt') + line('StopFailure'))).toBe(false)
  })

  it('is true from a Notification that asks you until the turn moves on', async () => {
    for (const type of [
      'permission_prompt',
      'elicitation_dialog',
      'elicitation_url_dialog',
      'agent_needs_input',
      'worker_permission_prompt'
    ])
      expect(await asking(line('Stop') + notification(type)), type).toBe(true)
    expect(await asking(line('Notification'))).toBe(true)
    const prompt = notification('permission_prompt')
    for (const after of [
      line('Stop'),
      stopWith(task('subagent')),
      line('UserPromptSubmit'),
      line('PostToolUse'),
      json(ev('SessionStart', { source: 'resume' })),
      STOPPED_EVENT + '\n'
    ])
      expect(await asking(prompt + after), after).toBe(false)
  })

  it('stays true through a clear of Needs you and other events', async () => {
    const prompt = notification('permission_prompt')
    expect(await asking(prompt + IDLE_EVENT + '\n')).toBe(true)
    expect(await asking(prompt + notification('idle_prompt'))).toBe(true)
    expect(await asking(prompt + line('PreToolUse') + notification('auth_success'))).toBe(true)
    expect(await asking(prompt + json(ev('SessionStart', { source: 'compact' })))).toBe(true)
    expect(await asking(prompt + json(ev('PostToolUse', { agent_id: 'a1' })))).toBe(true)
  })

  it('is false for a missing file or a turn that never asked', async () => {
    expect(await readAsking(join(dir, 'missing.jsonl'))).toBe(false)
    expect(await asking(line('UserPromptSubmit') + line('Stop'))).toBe(false)
  })
})

describe('countNeedsYou', () => {
  const count = async (text: string): Promise<number> => {
    const file = join(dir, 'n.jsonl')
    await writeFile(file, text)
    return countNeedsYou(file)
  }

  it('counts each entry into Needs you, not repeats while it stays there', async () => {
    const turn = line('UserPromptSubmit') + line('PostToolUse')
    expect(
      await count(
        turn +
          line('Stop') +
          notification('idle_prompt') +
          turn +
          notification('permission_prompt') +
          line('PostToolUse') +
          line('Stop') +
          IDLE_EVENT +
          '\n' +
          notification('idle_prompt')
      )
    ).toBe(3)
  })

  it('is 0 for a missing file or a session that never stopped', async () => {
    expect(await countNeedsYou(join(dir, 'missing.jsonl'))).toBe(0)
    expect(await count(line('UserPromptSubmit') + stopWith(task('subagent')))).toBe(0)
  })
})

describe('watchEvents', () => {
  const SLOW = { timeout: 6000, interval: 25 }
  const collect = (): {
    calls: [string, SessionState][]
    cb: (id: string, s: SessionState | null) => void
  } => {
    const calls: [string, SessionState][] = []
    return { calls, cb: (id, s) => void (s && calls.push([id, s])) }
  }
  const settled = async (calls: unknown[]): Promise<void> => {
    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0), SLOW)
  }
  const live = async (calls: unknown[]): Promise<void> => {
    await appendFile(join(dir, 'probe.jsonl'), line('Stop'))
    await settled(calls)
  }

  it('reports every state event, including repeats', async () => {
    const { calls, cb } = collect()
    stop = watchEvents(dir, cb)
    await live(calls)
    calls.length = 0
    const file = join(dir, 's1.jsonl')
    await appendFile(file, line('Stop') + line('PreToolUse') + line('Notification'))
    await vi.waitFor(
      () =>
        expect(calls).toEqual([
          ['s1', 'needsYou'],
          ['s1', 'needsYou']
        ]),
      SLOW
    )
    await appendFile(file, line('UserPromptSubmit'))
    await vi.waitFor(
      () =>
        expect(calls).toEqual([
          ['s1', 'needsYou'],
          ['s1', 'needsYou'],
          ['s1', 'running']
        ]),
      SLOW
    )
  })

  it('delivers the rest of a read after a listener throws', async () => {
    const { calls, cb } = collect()
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let thrown = false
    stop = watchEvents(dir, (id, s) => {
      if (id === 's1' && !thrown) {
        thrown = true
        throw new Error('listener broke')
      }
      cb(id, s)
    })
    try {
      await live(calls)
      calls.length = 0
      await appendFile(join(dir, 's1.jsonl'), line('Stop') + line('UserPromptSubmit'))
      await vi.waitFor(() => expect(calls).toEqual([['s1', 'running']]), SLOW)
      expect(error).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ message: 'listener broke' })
      )
    } finally {
      error.mockRestore()
    }
  })

  it('keeps a clear through idle_prompt until a real Needs you event', async () => {
    const { calls, cb } = collect()
    stop = watchEvents(dir, cb)
    await live(calls)
    calls.length = 0
    const file = join(dir, 'c.jsonl')
    await appendFile(file, line('Stop') + IDLE_EVENT + '\n' + notification('idle_prompt'))
    await appendFile(file, line('UserPromptSubmit'))
    await vi.waitFor(
      () =>
        expect(calls).toEqual([
          ['c', 'needsYou'],
          ['c', 'idle'],
          ['c', 'running']
        ]),
      SLOW
    )
    await appendFile(file, line('Stop') + notification('idle_prompt'))
    await vi.waitFor(
      () =>
        expect(calls.slice(3)).toEqual([
          ['c', 'needsYou'],
          ['c', 'needsYou']
        ]),
      SLOW
    )
  })

  it('needs you again at a Stop after a cleared idle_prompt', async () => {
    const { calls, cb } = collect()
    stop = watchEvents(dir, cb)
    await live(calls)
    calls.length = 0
    await appendFile(
      join(dir, 'd.jsonl'),
      line('Stop') + IDLE_EVENT + '\n' + notification('idle_prompt') + line('Stop')
    )
    await vi.waitFor(
      () =>
        expect(calls).toEqual([
          ['d', 'needsYou'],
          ['d', 'idle'],
          ['d', 'needsYou']
        ]),
      SLOW
    )
  })

  it('keeps a clear made before the watch through a later idle_prompt', async () => {
    const file = join(dir, 'e.jsonl')
    await writeFile(file, line('Stop') + IDLE_EVENT + '\n')
    const { calls, cb } = collect()
    stop = watchEvents(dir, cb)
    await appendFile(file, notification('idle_prompt'))
    await appendFile(file, line('Stop'))
    await vi.waitFor(() => expect(calls).toEqual([['e', 'needsYou']]), SLOW)
  })

  it('reports a Stop with background work when neither the state nor asking changes', async () => {
    const calls: [string, SessionState | null, boolean][] = []
    stop = watchEvents(dir, (id, s, asking) => calls.push([id, s, asking]))
    await live(calls)
    calls.length = 0
    await appendFile(join(dir, 'g.jsonl'), stopWith(task('shell')) + line('PreToolUse'))
    await vi.waitFor(() => expect(calls).toEqual([['g', null, false]]), SLOW)
  })

  it('reports whether Claude is asking, even when the state stays', async () => {
    const calls: [string, SessionState | null, boolean][] = []
    stop = watchEvents(dir, (id, s, asking) => calls.push([id, s, asking]))
    await live(calls)
    calls.length = 0
    const file = join(dir, 'q.jsonl')
    await appendFile(file, notification('permission_prompt') + line('PreToolUse'))
    await vi.waitFor(() => expect(calls).toEqual([['q', 'needsYou', true]]), SLOW)
    await appendFile(file, stopWith(task('subagent')) + line('Stop'))
    await vi.waitFor(
      () =>
        expect(calls).toEqual([
          ['q', 'needsYou', true],
          ['q', null, false],
          ['q', 'needsYou', false]
        ]),
      SLOW
    )
  })

  it('notices a new file written once after the watcher is live', async () => {
    const { calls, cb } = collect()
    stop = watchEvents(dir, cb)
    await live(calls)
    calls.length = 0
    await appendFile(join(dir, 'new.jsonl'), line('UserPromptSubmit'))
    await vi.waitFor(() => expect(calls).toEqual([['new', 'running']]), SLOW)
  })

  it('does not replay history of a file that existed before the watch', async () => {
    const file = join(dir, 'old.jsonl')
    await writeFile(file, (line('UserPromptSubmit') + line('Stop')).repeat(5))
    const { calls, cb } = collect()
    stop = watchEvents(dir, cb)
    await appendFile(file, line('UserPromptSubmit'))
    await vi.waitFor(() => expect(calls).toEqual([['old', 'running']]), SLOW)
  })

  it('notices an append made immediately after the watch starts', async () => {
    const { calls, cb } = collect()
    stop = watchEvents(dir, cb)
    appendFileSync(join(dir, 'a.jsonl'), line('Stop'))
    await vi.waitFor(() => expect(calls).toEqual([['a', 'needsYou']]), SLOW)
  })

  it('creates a missing directory', async () => {
    const { calls, cb } = collect()
    stop = watchEvents(join(dir, 'nested'), cb)
    await appendFile(join(dir, 'nested', 'a.jsonl'), line('Stop'))
    await vi.waitFor(() => expect(calls).toEqual([['a', 'needsYou']]), SLOW)
  })

  it('buffers a partial last line until its newline arrives', async () => {
    const { calls, cb } = collect()
    stop = watchEvents(dir, cb)
    await live(calls)
    calls.length = 0
    const full = line('Stop')
    await appendFile(join(dir, 'a.jsonl'), full.slice(0, 20))
    await appendFile(join(dir, 'b.jsonl'), line('UserPromptSubmit'))
    await vi.waitFor(() => expect(calls).toEqual([['b', 'running']]), SLOW)
    await appendFile(join(dir, 'a.jsonl'), full.slice(20))
    await vi.waitFor(
      () =>
        expect(calls).toEqual([
          ['b', 'running'],
          ['a', 'needsYou']
        ]),
      SLOW
    )
  })

  it('tracks sessions separately and ignores other files', async () => {
    const { calls, cb } = collect()
    stop = watchEvents(dir, cb)
    await live(calls)
    calls.length = 0
    await appendFile(join(dir, 'a.jsonl'), line('Stop'))
    await appendFile(join(dir, 'b.jsonl'), line('UserPromptSubmit'))
    await appendFile(join(dir, 'c.txt'), line('Stop'))
    await vi.waitFor(() => expect(calls).toHaveLength(2), SLOW)
    expect(calls).toContainEqual(['a', 'needsYou'])
    expect(calls).toContainEqual(['b', 'running'])
  })

  it('remembers a subagent Stop from before the watch at idle_prompt', async () => {
    const file = join(dir, 'old.jsonl')
    await writeFile(file, line('UserPromptSubmit') + stopWith(task('subagent')))
    const { calls, cb } = collect()
    stop = watchEvents(dir, cb)
    await appendFile(file, notification('idle_prompt') + line('PostToolUse'))
    await vi.waitFor(() => expect(calls).toEqual([['old', 'running']]), SLOW)
  })

  it('stops reporting after stop', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      const { calls, cb } = collect()
      const s = watchEvents(dir, cb)
      await live(calls)
      s()
      expect(vi.getTimerCount()).toBe(0)
      calls.length = 0
      const control = collect()
      stop = watchEvents(dir, control.cb)
      await appendFile(join(dir, 'a.jsonl'), line('Stop'))
      await vi.advanceTimersByTimeAsync(2500)
      await settled(control.calls)
      expect(calls).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })
})

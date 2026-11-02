import { appendFileSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tempDirs } from '../test/tempDirs'
import { activityOf, readActivity, stepsOf, stopOf } from './activity'

const cwd = '/repo-wt.noindex/7-fix'
const user = (content: unknown, timestamp: string, over: object = {}): string =>
  JSON.stringify({ type: 'user', cwd, timestamp, message: { role: 'user', content }, ...over })
const tool = (name: string, input: object, timestamp: string, over: object = {}): string =>
  JSON.stringify({
    type: 'assistant',
    cwd,
    timestamp,
    message: { role: 'assistant', content: [{ type: 'tool_use', id: name, name, input }] },
    ...over
  })
const result = (timestamp: string): string =>
  user([{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }], timestamp)

describe('activityOf', () => {
  it('lists tool steps newest first, at most five', () => {
    const lines = ['a', 'b', 'c', 'd', 'e', 'f'].map((p, i) =>
      tool('Read', { file_path: `/elsewhere/${p}.ts` }, `2026-10-28T10:0${i}:00Z`)
    )
    expect(activityOf(lines.join('\n')).steps).toEqual(
      ['f', 'e', 'd', 'c', 'b'].map((p, i) => ({
        tool: 'Read',
        target: `/elsewhere/${p}.ts`,
        at: `2026-10-28T10:0${5 - i}:00Z`
      }))
    )
  })

  it('strips the cwd prefix and collapses whitespace', () => {
    const text = [
      tool('Edit', { file_path: `${cwd}/src/a.ts` }, 't1'),
      tool('Bash', { command: 'npm\n  test', description: 'Run tests' }, 't2')
    ].join('\n')
    expect(activityOf(text).steps.map((s) => s.target)).toEqual(['npm test', 'src/a.ts'])
  })

  it('drops a leading cd into the session folder from a command', () => {
    const text = [
      tool('Bash', { command: `cd ${cwd}; npm test` }, 't1'),
      tool('Bash', { command: `cd "${cwd}" && git status` }, 't2'),
      tool('Bash', { command: `cd ${cwd}/src && ls` }, 't3')
    ].join('\n')
    expect(activityOf(text).steps.map((s) => s.target)).toEqual([
      'cd src && ls',
      'git status',
      'npm test'
    ])
  })

  it('takes the prompt time, not a tool result or a meta row', () => {
    const text = [
      user('Fix it', '2026-10-28T09:00:00Z'),
      user([{ type: 'text', text: 'And this' }], '2026-10-28T09:30:00Z'),
      result('2026-10-28T09:40:00Z'),
      user('Caveat', '2026-10-28T09:50:00Z', { isMeta: true }),
      user('Summary', '2026-10-28T09:55:00Z', { isCompactSummary: true })
    ].join('\n')
    expect(activityOf(text).since).toBe('2026-10-28T09:30:00Z')
  })

  it('redacts tokens in a target', () => {
    const text = tool('Bash', { command: 'GH_TOKEN=ghp_abc123 gh pr list' }, 't1')
    expect(activityOf(text).steps[0].target).toBe('GH_TOKEN=[redacted] gh pr list')
  })

  it('cuts a target at 300 characters', () => {
    const text = tool('Bash', { command: 'x'.repeat(400) }, 't1')
    expect(activityOf(text).steps[0].target).toHaveLength(300)
  })

  it('ignores a cut first line and sidechain rows', () => {
    const text = [
      tool('Read', { file_path: '/x' }, 't0').slice(20),
      tool('Grep', { pattern: 'sub' }, 't1', { isSidechain: true }),
      tool('Grep', { pattern: 'main' }, 't2')
    ].join('\n')
    expect(activityOf(text)).toEqual({
      steps: [{ tool: 'Grep', target: 'main', at: 't2' }],
      since: null
    })
  })
})

describe('stepsOf', () => {
  const streamed = (...content: object[]): unknown => ({
    type: 'assistant',
    message: { role: 'assistant', content },
    parent_tool_use_id: null
  })

  it("reads a stream row's tool steps in order, relative to the given folder", () => {
    const row = streamed(
      { type: 'text', text: 'Looking' },
      { type: 'tool_use', name: 'Read', input: { file_path: `${cwd}/src/a.ts` } },
      { type: 'tool_use', name: 'Grep', input: { pattern: 'chatArgs' } }
    )
    expect(stepsOf(row, cwd)).toEqual([
      { tool: 'Read', target: 'src/a.ts', at: null },
      { tool: 'Grep', target: 'chatArgs', at: null }
    ])
  })

  it('leaves out the structured answer, user rows, and sidechain rows', () => {
    expect(stepsOf(streamed({ type: 'tool_use', name: 'StructuredOutput', input: {} }))).toEqual([])
    expect(stepsOf(JSON.parse(result('t1')))).toEqual([])
    expect(
      stepsOf(JSON.parse(tool('Read', { file_path: 'a' }, 't1', { isSidechain: true })))
    ).toEqual([])
    expect(stepsOf(undefined)).toEqual([])
  })
})

describe('readActivity', () => {
  const temp = tempDirs()

  it('returns the cached value while size and mtime match and rereads after an append', async () => {
    const file = join(temp('activity-'), 's.jsonl')
    writeFileSync(file, tool('Grep', { pattern: 'aaa' }, 't1'))
    utimesSync(file, 1000, 1000)
    expect((await readActivity(file)).steps[0].target).toBe('aaa')
    writeFileSync(file, tool('Grep', { pattern: 'bbb' }, 't1'))
    utimesSync(file, 1000, 1000)
    expect((await readActivity(file)).steps[0].target).toBe('aaa')
    appendFileSync(file, '\n' + tool('Grep', { pattern: 'ccc' }, 't2'))
    expect((await readActivity(file)).steps.map((s) => s.target)).toEqual(['ccc', 'bbb'])
  })

  it('keeps the cached steps and prompt time when one row outgrows the tail', async () => {
    const file = join(temp('activity-'), 's.jsonl')
    writeFileSync(file, [user('Fix it', 't0'), tool('Grep', { pattern: 'aaa' }, 't1')].join('\n'))
    const before = await readActivity(file)
    expect(before.since).toBe('t0')
    appendFileSync(file, '\n' + result('t2').replace('ok', 'x'.repeat(300 * 1024)))
    expect(await readActivity(file)).toEqual(before)
  })
})

describe('stopOf', () => {
  const limitText = "You've hit your session limit · resets 2:30am (Europe/Oslo)"
  const failed = (text: string, over: object = {}): string =>
    JSON.stringify({
      type: 'assistant',
      isSidechain: false,
      cwd,
      timestamp: 't2',
      isApiErrorMessage: true,
      error: 'rate_limit',
      message: { role: 'assistant', content: [{ type: 'text', text }] },
      ...over
    })
  const limit = (over: object = {}): string =>
    failed(limitText, {
      apiError: 'usage_limit_reached',
      apiErrorParams: { rate_limit_info: { resetsAt: 1792888200, rateLimitType: 'five_hour' } },
      ...over
    })
  const said = JSON.stringify({
    type: 'assistant',
    cwd,
    timestamp: 't3',
    message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] }
  })
  const prompt = (at = 't1'): string => user('Fix the bug', at)
  const of = (...lines: string[]): ReturnType<typeof stopOf> => stopOf(lines.join('\n'))

  it('reads a usage-limit row with its reset time', () => {
    expect(of(prompt(), limit())).toEqual({
      limit: true,
      resetsAt: 1792888200000,
      message: limitText
    })
  })

  it('reads another API error without a reset time', () => {
    const text = "API Error: Can't reach the API server"
    expect(of(prompt(), failed(text, { error: 'server_error' }))).toEqual({
      limit: false,
      message: text
    })
  })

  it('reads a limit row without params as a limit with no time', () => {
    expect(of(prompt(), limit({ apiErrorParams: undefined }))).toEqual({
      limit: true,
      message: limitText
    })
  })

  it('clears the stop after a typed prompt', () => {
    expect(of(prompt(), limit(), prompt('t4'))).toBeNull()
  })

  it('has no stop after a normal turn', () => {
    expect(of(prompt(), tool('Bash', { command: 'npm test' }, 't2'), result('t2'), said)).toBeNull()
  })

  it("ignores a subagent's error row", () => {
    expect(of(prompt(), limit({ isSidechain: true }))).toBeNull()
  })
})

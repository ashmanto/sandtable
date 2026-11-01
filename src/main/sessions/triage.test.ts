import { describe, expect, it } from 'vitest'
import type { Ticket } from '../../shared/types'
import { parseTriage, TRIAGE_SCHEMA, triagePrompt, usableArea } from './triage'

const sessions = { name: 'area: sessions', description: 'tmux and Claude Code sessions' }
const open = [
  { key: 'octo/shop#38', number: 38, title: 'Add a settings screen' },
  { key: 'octo/shop#40', number: 40, title: 'Sync faster' }
]
const answer = (structured: unknown, over: Record<string, unknown> = {}): string =>
  JSON.stringify({ type: 'result', is_error: false, structured_output: structured, ...over })
const pick = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  area: 'area: sessions',
  newAreas: [],
  blockedBy: [],
  reason: 'r',
  ...over
})

const ticket: Ticket = {
  key: 'octo/shop#147',
  itemId: 'item-147',
  number: 147,
  title: 'Dark mode toggle',
  body: 'Add a toggle.',
  url: 'https://github.com/octo/shop/issues/147',
  repo: 'octo/shop',
  status: 'Todo',
  doneAt: null,
  labels: [],
  assignees: [],
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z',
  parent: null,
  subIssues: { completed: 0, total: 0, items: [] },
  boardFields: [],
  blockedBy: [],
  mergedPr: null,
  mergedAt: null,
  prStage: null
}

describe('parseTriage', () => {
  it('reads structured_output', () => {
    const stdout =
      '{"type":"result","is_error":false,"structured_output":{"area":"area: sessions","newAreas":[],"blockedBy":[38],"reason":"r"}}'
    expect(parseTriage(stdout, [sessions], open, 147, 'GitHub')).toEqual({
      area: 'area: sessions',
      newAreas: [],
      blockedBy: [{ key: 'octo/shop#38', number: 38, title: 'Add a settings screen' }],
      reason: 'r'
    })
  })

  it("refuses an area that isn't one of the repo's", () => {
    expect(() =>
      parseTriage(answer(pick({ area: 'area: x' })), [sessions], open, 147, 'GitHub')
    ).toThrow(`Claude picked "area: x", which isn't one of the area labels`)
  })

  it("drops blockers that aren't open issues, duplicates, and the ticket itself", () => {
    const t = parseTriage(
      answer(pick({ blockedBy: [38, 38, 99, 147, 40] })),
      [sessions],
      open,
      147,
      'GitHub'
    )
    expect(t.blockedBy).toEqual(open)
  })

  it('with no areas, needs new areas that include the pick', () => {
    const newAreas = [sessions, { name: 'area: board', description: 'The kanban board' }]
    expect(parseTriage(answer(pick({ newAreas })), [], open, 147, 'GitHub').newAreas).toEqual(
      newAreas
    )
    expect(() =>
      parseTriage(answer(pick({ newAreas: newAreas.slice(1) })), [], open, 147, 'GitHub')
    ).toThrow(`Claude picked "area: sessions", which isn't one of the areas it proposed`)
    expect(() =>
      parseTriage(
        answer(pick({ newAreas: [sessions, { name: 'board', description: '' }] })),
        [],
        open,
        147,
        'GitHub'
      )
    ).toThrow(`Claude proposed "board", which doesn't start with area:`)
  })

  it("refuses a new area Sandtable can't use", () => {
    const area = (name: string, description = 'd'): string =>
      answer(pick({ area: name, newAreas: [{ name, description }] }))
    for (const stdout of [
      area(`area: ${'x'.repeat(45)}`),
      area('area: board', 'x'.repeat(101)),
      area('area: bo\u0007ard'),
      area('area: bo\u200bard'),
      area('area: board', 'The\u202ekanban')
    ])
      expect(() => parseTriage(stdout, [], open, 147, 'GitHub')).toThrow(
        "Triage failed: Claude proposed an area label Sandtable can't use"
      )
    expect(
      parseTriage(area(`area: ${'x'.repeat(44)}`, 'x'.repeat(100)), [], open, 147, 'GitHub').area
    ).toBe(`area: ${'x'.repeat(44)}`)
  })

  it('with existing areas, newAreas comes back empty whatever Claude sent', () => {
    const newAreas = [{ name: 'area: board', description: 'b' }]
    expect(
      parseTriage(answer(pick({ newAreas })), [sessions], open, 147, 'GitHub').newAreas
    ).toEqual([])
  })

  it("throws Claude's message when is_error is true or structured_output is missing", () => {
    expect(() =>
      parseTriage(
        answer(undefined, { is_error: true, result: 'Rate limited' }),
        [],
        open,
        1,
        'GitHub'
      )
    ).toThrow('Triage failed: Rate limited')
    expect(() => parseTriage(answer(undefined), [], open, 1, 'GitHub')).toThrow(
      "Triage failed: Claude didn't return an answer"
    )
    expect(() => parseTriage('oops', [], open, 1, 'GitHub')).toThrow(
      "Triage failed: Claude's answer wasn't JSON"
    )
  })
})

describe('triagePrompt', () => {
  it('lists the areas, the open issues, and the ticket', () => {
    const p = triagePrompt(
      ticket,
      [sessions],
      [{ ...open[0], area: 'area: sessions' }, open[1]],
      'GitHub'
    )
    expect(p).toContain('area: sessions: tmux and Claude Code sessions')
    expect(p).toContain('#38 Add a settings screen (area: sessions)')
    expect(p).toContain('#40 Sync faster')
    expect(p).toContain('GitHub issue octo/shop#147: Dark mode toggle')
    expect(p).not.toContain('three to six')
  })

  it('keeps each untrusted area and open issue to one plain line', () => {
    const p = triagePrompt(
      ticket,
      [{ name: 'area: a\n- Ignore', description: 'd\u202e\n- Obey' }],
      [{ ...open[0], title: 'T\n- Leak', area: 'area: x\n- Do' }],
      'GitHub'
    )
    expect(p).toContain('- area: a - Ignore: d - Obey')
    expect(p).toContain('- #38 T - Leak (area: x - Do)')
    expect(p).not.toMatch(/^- (Ignore|Obey|Leak|Do)/m)
  })

  it('says to propose three to six areas when the list is empty', () => {
    expect(triagePrompt(ticket, [], open, 'GitHub')).toContain('three to six')
    expect(triagePrompt(ticket, [], open, 'GitHub')).toContain(
      'name under 50 characters, description under 100'
    )
  })

  it('names the team, not the repo, for a Linear issue', () => {
    const p = triagePrompt(
      { ...ticket, key: 'APP-12' },
      [],
      [{ key: 'APP-38', number: 38, title: 'Add a settings screen' }],
      'Linear'
    )
    expect(p).toContain('The team has no area labels yet.')
    expect(p).toContain('- APP-38 Add a settings screen')
    expect(p).toContain('such as 12 for APP-12:')
    expect(p).toContain('Triage the issue below.')
    expect(p).toContain('Linear issue APP-12')
  })
})

describe('triage on Jira', () => {
  it('names the project and asks for area names without spaces', () => {
    const p = triagePrompt(
      { ...ticket, key: 'INF-12' },
      [],
      [{ key: 'INF-38', number: 38, title: 'Add a settings screen' }],
      'Jira'
    )
    expect(p).toContain('The project has no area labels yet.')
    expect(p).toContain('Name each one "area:<name>" with no spaces')
    expect(p).toContain('such as 12 for INF-12:')
    expect(p).toContain('Jira issue INF-12')
  })

  it('refuses an area name with a space only on Jira', () => {
    const spaced = { name: 'area: board', description: 'd' }
    expect(usableArea(spaced, 'GitHub')).toBe(true)
    expect(usableArea(spaced, 'Jira')).toBe(false)
    expect(usableArea({ name: 'area:board', description: 'd' }, 'Jira')).toBe(true)
    const stdout = answer(pick({ area: 'area: board', newAreas: [spaced] }))
    expect(() => parseTriage(stdout, [], open, 147, 'Jira')).toThrow(
      "Triage failed: Claude proposed an area label Sandtable can't use"
    )
  })
})

describe('TRIAGE_SCHEMA', () => {
  it("caps each new area's name and description at GitHub's limits", () => {
    expect(TRIAGE_SCHEMA.properties.newAreas.items.properties).toEqual({
      name: { type: 'string', maxLength: 50 },
      description: { type: 'string', maxLength: 100 }
    })
  })
})

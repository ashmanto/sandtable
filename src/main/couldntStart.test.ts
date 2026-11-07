import { describe, expect, it } from 'vitest'
import type { Routine, SessionRecord, SkippedRun, StartFailure } from '../shared/types'
import { couldntStartByProject } from './couldntStart'

const routine = (id: string, projectId = 'p1'): Routine =>
  ({ id, projectId, name: `Routine ${id}` }) as Routine
const ran = (routineId: string, startedAt: string): SessionRecord =>
  ({ id: `s-${startedAt}`, routineId, startedAt }) as SessionRecord
const failure = (over: Partial<StartFailure> = {}): StartFailure => ({
  projectId: 'p1',
  ticketKey: 'octo/shop#1',
  at: '2026-10-24T10:00:00.000Z',
  reason: 'tmux broke',
  repo: null,
  ...over
})
const titles: Record<string, string> = { 'octo/shop#1': 'Dark mode toggle' }
const titleOf = (_: string, key: string): string | undefined => titles[key]

describe('couldntStartByProject', () => {
  it('lists a ticket failure under its project, named by its title, or its key without one', () => {
    const list = couldntStartByProject(
      [failure(), failure({ projectId: 'p2', ticketKey: 'octo/shop#2' })],
      [],
      [],
      [],
      titleOf
    )
    expect(list).toEqual({
      p1: [
        {
          kind: 'ticket',
          name: 'Dark mode toggle',
          ticketKey: 'octo/shop#1',
          at: '2026-10-24T10:00:00.000Z',
          reason: 'tmux broke',
          repo: null
        }
      ],
      p2: [expect.objectContaining({ kind: 'ticket', name: 'octo/shop#2' })]
    })
  })

  it("lists a skipped run only when it is later than the routine's newest session start", () => {
    const skipped: SkippedRun[] = [
      { routineId: 'r1', at: '2026-10-24T08:00:00.000Z', reason: 'closed' },
      { routineId: 'r1', at: '2026-10-24T11:00:00.000Z', reason: 'failed', error: 'Setup failed' }
    ]
    const list = couldntStartByProject(
      [],
      skipped,
      [routine('r1')],
      [ran('r1', '2026-10-24T09:00:00.000Z')],
      titleOf
    )
    expect(list).toEqual({
      p1: [
        {
          kind: 'routine',
          routineId: 'r1',
          name: 'Routine r1',
          at: '2026-10-24T11:00:00.000Z',
          reason: 'failed',
          error: 'Setup failed'
        }
      ]
    })
  })

  it('leaves out skipped runs of unknown routines', () => {
    const skipped: SkippedRun[] = [
      { routineId: 'gone', at: '2026-10-24T08:00:00.000Z', reason: 'closed' }
    ]
    expect(couldntStartByProject([], skipped, [routine('r1')], [], titleOf)).toEqual({})
  })

  it("sorts each project's entries newest first", () => {
    const list = couldntStartByProject(
      [failure({ at: '2026-10-24T09:00:00.000Z' })],
      [
        { routineId: 'r1', at: '2026-10-24T08:00:00.000Z', reason: 'capped' },
        { routineId: 'r1', at: '2026-10-24T10:00:00.000Z', reason: 'running' }
      ],
      [routine('r1')],
      [],
      titleOf
    )
    expect(list.p1.map((e) => e.at)).toEqual([
      '2026-10-24T10:00:00.000Z',
      '2026-10-24T09:00:00.000Z',
      '2026-10-24T08:00:00.000Z'
    ])
  })
})

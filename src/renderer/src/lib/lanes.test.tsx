import { describe, expect, it } from 'vitest'
import type { IssueRef, Ticket } from '../../../shared/types'
import { NO_ASSIGNEE } from './assigneeFilter'
import {
  droppedWords,
  inLane,
  laneCells,
  laneId,
  lanesOf,
  nextCellId,
  nextLaneGroupId,
  NO_PARENT,
  parentLanesOf,
  placeDrop,
  splitLane,
  type Lane
} from './lanes'

type Person = Ticket['assignees'][number]
type T = { n: number; assignees: Person[] }

const person = (id: string, name: string | null, login = id.toLowerCase()): Person => ({
  id,
  login,
  name
})
const t = (n: number, ...assignees: Person[]): T => ({ n, assignees })
const shape = (lanes: Lane<T>[]): unknown[] =>
  lanes.map((l) => [l.id, l.name, l.tickets.map((x) => x.n)])

describe('lanesOf', () => {
  it('gives one lane per person, sorted by name, then No assignee, keeping the tickets order', () => {
    const zoe = person('U_z', 'Zoe')
    const ann = person('U_a', null, 'ann')
    expect(shape(lanesOf([t(1, zoe), t(2), t(3, ann), t(4, zoe)]))).toEqual([
      ['U_a', 'ann', [3]],
      ['U_z', 'Zoe', [1, 4]],
      [NO_ASSIGNEE, 'No assignee', [2]]
    ])
  })

  it('puts a ticket with several assignees in each of their lanes', () => {
    const lanes = lanesOf([t(1, person('U_b', 'Bo'), person('U_a', 'Al'))])
    expect(shape(lanes)).toEqual([
      ['U_a', 'Al', [1]],
      ['U_b', 'Bo', [1]],
      [NO_ASSIGNEE, 'No assignee', []]
    ])
  })

  it('always ends with an empty No assignee lane, even with no tickets', () => {
    expect(shape(lanesOf([]))).toEqual([[NO_ASSIGNEE, 'No assignee', []]])
  })
})

describe('laneCells', () => {
  it("splits each lane's tickets by column and counts the lane", () => {
    const al = person('U_a', 'Al')
    const cells = laneCells(lanesOf([t(1, al), t(2, al)]), (x) => (x.n === 1 ? 'todo' : 'done'))
    expect(cells[0]).toMatchObject({ id: 'U_a', name: 'Al', count: 2 })
    expect(cells[0].cells.map((c) => [c.id, c.title, c.tickets.map((x) => x.n)])).toEqual([
      ['todo', 'To do', [1]],
      ['inProgress', 'In progress', []],
      ['done', 'Done', [2]]
    ])
  })
})

describe('lane IDs', () => {
  it('joins a lane and a key or column, and splits them back', () => {
    expect(laneId('U_a', 'octo/shop#1')).toBe('U_a|octo/shop#1')
    expect(splitLane('U_a|octo/shop#1')).toEqual(['U_a', 'octo/shop#1'])
    expect(splitLane('U_a|')).toEqual(['U_a', ''])
    expect(splitLane('todo')).toEqual([null, 'todo'])
  })
})

describe('keyboard steps', () => {
  it('moves across columns and up and down lanes on the board', () => {
    const next = nextCellId(['A', 'B'])
    expect(next('A|todo', 'ArrowRight')).toBe('A|inProgress')
    expect(next('A|todo', 'ArrowLeft')).toBeUndefined()
    expect(next('A|done', 'ArrowDown')).toBe('B|done')
    expect(next('B|done', 'ArrowDown')).toBeUndefined()
    expect(next('A|todo', 'Space')).toBeUndefined()
  })

  it("steps through each lane's groups in the list, a collapsed lane as one", () => {
    const next = nextLaneGroupId(['A', 'B', 'C'], ['B'])
    expect(next('A|done', 'ArrowDown')).toBe('B|')
    expect(next('B|', 'ArrowDown')).toBe('C|todo')
    expect(next('C|todo', 'ArrowUp')).toBe('B|')
    expect(next('A|todo', 'ArrowRight')).toBeUndefined()
  })
})

describe('placeDrop', () => {
  const columnOf = (): 'todo' => 'todo'

  it('keeps the column on a lane header and gives the lane change', () => {
    expect(placeDrop('A|k#1', 'B|', columnOf)).toEqual({
      key: 'k#1',
      from: 'A',
      to: 'B',
      column: 'todo',
      fromColumn: 'todo',
      lane: { from: 'A', to: 'B' },
      moves: true
    })
  })

  it('turns No assignee into null', () => {
    expect(placeDrop(`A|k#1`, `${NO_ASSIGNEE}|done`, columnOf).lane).toEqual({
      from: 'A',
      to: null
    })
    expect(placeDrop(`${NO_ASSIGNEE}|k#1`, 'A|todo', columnOf).lane).toEqual({
      from: null,
      to: 'A'
    })
  })

  it('moves only the column within a lane or without lanes, and stays without a target', () => {
    expect(placeDrop('A|k#1', 'A|done', columnOf)).toMatchObject({ lane: undefined, moves: true })
    expect(placeDrop('k#1', 'done', columnOf)).toMatchObject({ lane: undefined, column: 'done' })
    expect(placeDrop('k#1', 'todo', columnOf).moves).toBe(false)
    expect(placeDrop('A|k#1', undefined, columnOf)).toMatchObject({ to: 'A', moves: false })
  })
})

describe('droppedWords', () => {
  const columnOf = (): 'todo' => 'todo'
  const nameOf = (lane: string): string => ({ A: 'Al', B: 'Bo' })[lane] ?? 'No assignee'

  it('names the lane and the column', () => {
    expect(droppedWords(placeDrop('A|k#1', 'B|done', columnOf), '#1', nameOf, false)).toBe(
      'Moved #1 to Bo, Done.'
    )
    expect(droppedWords(placeDrop('k#1', 'done', columnOf), '#1', nameOf, false)).toBe(
      'Moved #1 to Done.'
    )
    expect(droppedWords(placeDrop('A|k#1', undefined, columnOf), '#1', nameOf, false)).toBe(
      '#1 stays in Al, To do.'
    )
  })

  it('says who was removed when the ticket keeps other assignees', () => {
    const none = `${NO_ASSIGNEE}|`
    expect(droppedWords(placeDrop('A|k#1', `${none}todo`, columnOf), '#1', nameOf, true)).toBe(
      'Removed Al from #1.'
    )
    expect(droppedWords(placeDrop('A|k#1', `${none}done`, columnOf), '#1', nameOf, true)).toBe(
      'Removed Al from #1 and moved it to Done.'
    )
    expect(droppedWords(placeDrop('A|k#1', `${none}todo`, columnOf), '#1', nameOf, false)).toBe(
      'Moved #1 to No assignee, To do.'
    )
  })
})

type P = Pick<Ticket, 'key' | 'number' | 'repo' | 'title' | 'parent' | 'subIssues'>

const ref = (n: number, extra: Partial<Ticket['parent'] & object> = {}): IssueRef => ({
  key: `o/r#${n}`,
  number: n,
  title: `Parent ${n}`,
  repo: 'o/r',
  url: `https://github.com/o/r/issues/${n}`,
  column: 'todo',
  ...extra
})
const p = (n: number, parent: IssueRef | null = null, subs = 0): P => ({
  key: `o/r#${n}`,
  number: n,
  repo: 'o/r',
  title: `t${n}`,
  parent,
  subIssues: { completed: 0, total: subs, items: [] }
})
const keys = (lanes: Lane<P>[]): unknown[] =>
  lanes.map((l) => [l.id, l.tickets.map((x) => x.number)])

describe('parentLanesOf', () => {
  it('gives one lane per parent, the parent in its own lane, then No parent', () => {
    const one = p(1, null, 2)
    const lanes = parentLanesOf(
      [p(5), p(2, ref(1)), p(3, ref(9)), one, p(4, ref(9))],
      [],
      () => 'todo'
    )
    expect(keys(lanes)).toEqual([
      ['o/r#1', [2, 1]],
      ['o/r#9', [3, 4]],
      [NO_PARENT, [5]]
    ])
    expect(lanes[2].name).toBe('No parent')
  })

  it('sorts the parent lanes by key, numbers in numeric order, so a sync never reorders them', () => {
    const lanes = parentLanesOf([p(3, ref(12)), p(4, ref(2))], [], () => 'todo')
    expect(keys(lanes)).toEqual([
      ['o/r#2', [4]],
      ['o/r#12', [3]],
      [NO_PARENT, []]
    ])
  })

  it('puts a ticket that is both a parent and a sub-issue in its own lane', () => {
    const lanes = parentLanesOf([p(2, ref(1)), p(3, ref(2))], [], () => 'todo')
    expect(keys(lanes)).toEqual([
      ['o/r#2', [2, 3]],
      [NO_PARENT, []]
    ])
  })

  it("heads a lane from the parent's ticket on the board, or else from the sub-issue's reference", () => {
    const parent = { ...p(1, null, 3), subIssues: { completed: 1, total: 3, items: [] } }
    const lanes = parentLanesOf(
      [p(2, ref(1)), p(3, ref(7, { column: 'hidden', subIssues: { completed: 2, total: 5 } }))],
      [parent],
      (x) => (x.number === 1 ? 'inProgress' : 'todo')
    )
    expect(lanes.map((l) => [l.name, l.parent])).toEqual([
      [
        '#1 t1',
        {
          key: 'o/r#1',
          number: 1,
          repo: 'o/r',
          title: 't1',
          column: 'inProgress',
          subIssues: { completed: 1, total: 3 }
        }
      ],
      [
        '#7 Parent 7',
        {
          key: 'o/r#7',
          number: 7,
          repo: 'o/r',
          title: 'Parent 7',
          column: 'done',
          subIssues: { completed: 2, total: 5 }
        }
      ],
      ['No parent', undefined]
    ])
  })
})

describe('inLane', () => {
  it('keeps a step that stays in the lane and drops one that leaves it', () => {
    const next = inLane(nextLaneGroupId(['A', 'B'], []))
    expect(next(laneId('A', 'todo'), 'ArrowDown')).toBe(laneId('A', 'inProgress'))
    expect(next(laneId('A', 'done'), 'ArrowDown')).toBeUndefined()
    expect(inLane(nextCellId(['A', 'B']))(laneId('A', 'todo'), 'ArrowDown')).toBeUndefined()
  })
})

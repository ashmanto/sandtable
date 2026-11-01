import { beforeEach, describe, expect, it } from 'vitest'
import { loadBoardLayout, saveBoardLayout } from './boardLayout'

describe('loadBoardLayout', () => {
  beforeEach(() => localStorage.clear())

  it("remembers each project's layout", () => {
    saveBoardLayout('p1', { view: 'list', collapsed: ['done'], lanes: ['U_a'] })
    expect(loadBoardLayout('p1')).toEqual({ view: 'list', collapsed: ['done'], lanes: ['U_a'] })
    expect(loadBoardLayout('p2')).toEqual({ view: 'board', collapsed: [], lanes: [] })
  })

  it('falls back to the board for bad JSON or an unknown view', () => {
    localStorage.setItem('boardLayout:p1', '{')
    expect(loadBoardLayout('p1')).toEqual({ view: 'board', collapsed: [], lanes: [] })
    localStorage.setItem('boardLayout:p1', JSON.stringify({ view: 'grid', collapsed: [] }))
    expect(loadBoardLayout('p1')).toEqual({ view: 'board', collapsed: [], lanes: [] })
  })

  it('keeps only string lane IDs', () => {
    localStorage.setItem(
      'boardLayout:p1',
      JSON.stringify({ view: 'board', collapsed: [], lanes: ['U_a', 3, null, '@none'] })
    )
    expect(loadBoardLayout('p1')).toEqual({ view: 'board', collapsed: [], lanes: ['U_a', '@none'] })
  })

  it('drops unknown columns', () => {
    localStorage.setItem(
      'boardLayout:p1',
      JSON.stringify({ view: 'list', collapsed: ['todo', 'hidden', 3] })
    )
    expect(loadBoardLayout('p1')).toEqual({ view: 'list', collapsed: ['todo'], lanes: [] })
  })
})

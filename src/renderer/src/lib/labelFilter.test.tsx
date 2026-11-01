import { beforeEach, describe, expect, it } from 'vitest'
import { IN_PROGRESS_LABEL } from '../../../shared/columns'
import {
  boardLabels,
  loadLabelFilter,
  passes,
  saveLabelFilter,
  type LabelFilter
} from './labelFilter'

const t = (...names: string[]): { labels: { name: string; color: string }[] } => ({
  labels: names.map((name) => ({ name, color: 'ffffff' }))
})

describe('passes', () => {
  it('shows every ticket when no label is selected', () => {
    expect(passes({ mode: 'only', labels: [] }, t())).toBe(true)
    expect(passes({ mode: 'hide', labels: [] }, t('bug'))).toBe(true)
  })

  it('shows only tickets with at least one selected label in only mode', () => {
    const f: LabelFilter = { mode: 'only', labels: ['bug', 'docs'] }
    expect(passes(f, t('docs', 'ui'))).toBe(true)
    expect(passes(f, t('ui'))).toBe(false)
    expect(passes(f, t())).toBe(false)
  })

  it('matches label names in any case, as GitHub does', () => {
    expect(passes({ mode: 'only', labels: ['bug'] }, t('Bug'))).toBe(true)
  })

  it('hides tickets with any selected label in hide mode', () => {
    const f: LabelFilter = { mode: 'hide', labels: ['wontfix'] }
    expect(passes(f, t('bug', 'wontfix'))).toBe(false)
    expect(passes(f, t('bug'))).toBe(true)
    expect(passes(f, t())).toBe(true)
  })
})

describe('boardLabels', () => {
  it('lists each label once by name, sorted, without the in-progress label', () => {
    const tickets = [
      { labels: [{ name: 'ui', color: '111111' }, IN_PROGRESS_LABEL] },
      {
        labels: [
          { name: 'bug', color: '222222' },
          { name: 'ui', color: '333333' }
        ]
      }
    ]
    expect(boardLabels(tickets, [])).toEqual([
      { name: 'bug', color: '222222' },
      { name: 'ui', color: '111111' }
    ])
  })

  it('lists labels that differ only in case once', () => {
    expect(boardLabels([t('Bug'), t('bug')], ['BUG'])).toEqual([{ name: 'Bug', color: 'ffffff' }])
  })

  it('keeps a selected label no ticket has, so it can be cleared', () => {
    expect(boardLabels([t('bug')], ['gone'])).toEqual([
      { name: 'bug', color: 'ffffff' },
      { name: 'gone', color: null }
    ])
  })
})

describe('loadLabelFilter', () => {
  beforeEach(() => localStorage.clear())

  it('returns the filter saved for that project only', () => {
    saveLabelFilter('p1', { mode: 'hide', labels: ['wontfix'] })
    expect(loadLabelFilter('p1')).toEqual({ mode: 'hide', labels: ['wontfix'] })
    expect(loadLabelFilter('p2')).toEqual({ mode: 'only', labels: [] })
  })

  it('falls back to no filter for unreadable data', () => {
    localStorage.setItem('labelFilter:p1', '{nope')
    expect(loadLabelFilter('p1')).toEqual({ mode: 'only', labels: [] })
    localStorage.setItem('labelFilter:p1', JSON.stringify({ mode: 'x', labels: [1] }))
    expect(loadLabelFilter('p1')).toEqual({ mode: 'only', labels: [] })
  })
})

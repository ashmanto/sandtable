import { describe, expect, it } from 'vitest'
import type { Project, ProjectGroup } from '../../../shared/types'
import { moveGroup, moveProject, sections } from './projectGroups'

const p = (id: string, group?: string): Project => ({
  id,
  name: id,
  repos: [],
  ...(group && { group })
})
const g1: ProjectGroup = { id: 'g1', name: 'Work' }
const g2: ProjectGroup = { id: 'g2', name: 'Home' }
const groups = [g1, g2]
const projects = [p('a', 'g2'), p('b'), p('c', 'g1'), p('d', 'gone'), p('e', 'g1')]
const ids = (ps: Project[]): string[] => ps.map((x) => x.id)

describe('sections', () => {
  it('puts ungrouped first, then each group in order, keeping project order', () => {
    expect(sections(projects, groups).map((s) => [s.group?.id ?? null, ids(s.projects)])).toEqual([
      [null, ['b', 'd']],
      ['g1', ['c', 'e']],
      ['g2', ['a']]
    ])
  })

  it('always has the ungrouped section and empty groups', () => {
    expect(sections([], groups)).toEqual([
      { group: null, projects: [] },
      { group: g1, projects: [] },
      { group: g2, projects: [] }
    ])
  })
})

describe('moveProject', () => {
  it('appends to a group and flattens sections in order', () => {
    const next = moveProject(projects, groups, 'b', 'g2')
    expect(ids(next)).toEqual(['d', 'c', 'e', 'a', 'b'])
    expect(next[4].group).toBe('g2')
  })

  it('inserts beside a sibling, before or after', () => {
    expect(ids(moveProject(projects, groups, 'a', 'g1', { id: 'e', after: false }))).toEqual([
      'b',
      'd',
      'c',
      'a',
      'e'
    ])
    expect(ids(moveProject(projects, groups, 'a', 'g1', { id: 'c', after: true }))).toEqual([
      'b',
      'd',
      'c',
      'a',
      'e'
    ])
  })

  it('removes the group key when moving to ungrouped', () => {
    const next = moveProject(projects, groups, 'c', null, { id: 'b', after: false })
    expect(ids(next)).toEqual(['c', 'b', 'd', 'e', 'a'])
    expect(next[0]).not.toHaveProperty('group')
  })

  it('treats an unknown group as ungrouped instead of dropping the project', () => {
    const next = moveProject(projects, groups, 'a', 'nope')
    expect(ids(next)).toEqual(['b', 'd', 'a', 'c', 'e'])
    expect(next[2]).not.toHaveProperty('group')
  })

  it('reorders within a section', () => {
    expect(ids(moveProject(projects, groups, 'e', 'g1', { id: 'c', after: false }))).toEqual([
      'b',
      'd',
      'e',
      'c',
      'a'
    ])
  })
})

describe('moveGroup', () => {
  const g3: ProjectGroup = { id: 'g3', name: 'Side' }
  it('moves a group before or after another', () => {
    expect(moveGroup([g1, g2, g3], 'g1', 'g3', true)).toEqual([g2, g3, g1])
    expect(moveGroup([g1, g2, g3], 'g3', 'g1', false)).toEqual([g3, g1, g2])
    expect(moveGroup([g1, g2, g3], 'g1', 'g2', true)).toEqual([g2, g1, g3])
  })
})

import { describe, expect, it } from 'vitest'
import { dropOf } from './sidebarDrop'

const over = (id: string): { id: string; rect: { top: number; height: number } } => ({
  id,
  rect: { top: 100, height: 28 }
})

describe('dropOf', () => {
  it('drops a group before or after another by the pointer, not the dragged copy', () => {
    expect(dropOf({ id: 'g:a' }, over('g:b'), 110)).toEqual({ id: 'g:b', place: 'before' })
    expect(dropOf({ id: 'g:a' }, over('g:b'), 120)).toEqual({ id: 'g:b', place: 'after' })
  })

  it('drops a project before or after another project', () => {
    expect(dropOf({ id: 'p:a' }, over('p:b'), 101)).toEqual({ id: 'p:b', place: 'before' })
    expect(dropOf({ id: 'p:a' }, over('p:b'), 127)).toEqual({ id: 'p:b', place: 'after' })
  })

  it('drops a project into Projects, a group heading, or an empty group line', () => {
    for (const id of ['u:', 'g:b', 'e:b'])
      expect(dropOf({ id: 'p:a' }, over(id), 101)).toEqual({ id, place: 'into' })
  })

  it('refuses a group over a project, Projects, or an empty group line', () => {
    for (const id of ['p:b', 'u:', 'e:b']) expect(dropOf({ id: 'g:a' }, over(id), 101)).toBeNull()
  })

  it('refuses a drop on itself or on nothing', () => {
    expect(dropOf({ id: 'p:a' }, over('p:a'), 101)).toBeNull()
    expect(dropOf({ id: 'g:a' }, over('g:a'), 101)).toBeNull()
    expect(dropOf({ id: 'p:a' }, null, 101)).toBeNull()
  })
})

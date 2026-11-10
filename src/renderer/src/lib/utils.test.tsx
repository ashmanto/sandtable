import { beforeEach, describe, expect, it } from 'vitest'
import { savedFilter } from './utils'

describe('savedFilter', () => {
  beforeEach(() => localStorage.clear())
  const labels = savedFilter('labelFilter', 'labels')

  it('saves a filter under the prefix and project, and loads it back', () => {
    labels.save('p1', { mode: 'hide', labels: ['bug'] })
    expect(JSON.parse(localStorage.getItem('labelFilter:p1') ?? '')).toEqual({
      mode: 'hide',
      labels: ['bug']
    })
    expect(labels.load('p1')).toEqual({ mode: 'hide', labels: ['bug'] })
  })

  it('loads no filter for a project without one', () => {
    expect(labels.load('p2')).toEqual({ mode: 'only', labels: [] })
  })
})

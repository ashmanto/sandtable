import { describe, expect, it } from 'vitest'
import { reassign } from './types'

describe('reassign', () => {
  const al = { id: 'U_a' }
  const bo = { id: 'U_b' }

  it('drops from and adds to once', () => {
    expect(reassign([al], 'U_a', bo)).toEqual([bo])
    expect(reassign([], null, al)).toEqual([al])
    expect(reassign([al, bo], 'U_a', null)).toEqual([bo])
    expect(reassign([al, bo], 'U_a', bo)).toEqual([bo])
  })
})

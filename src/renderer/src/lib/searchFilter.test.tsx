import { describe, expect, it } from 'vitest'
import { ticket } from '../test/fixtures'
import { passesSearch } from './searchFilter'

describe('passesSearch', () => {
  it('shows every ticket for an empty or blank query', () => {
    expect(passesSearch('', ticket(1))).toBe(true)
    expect(passesSearch('  ', ticket(1))).toBe(true)
  })

  it('matches a word in the title, ignoring case', () => {
    const t = ticket(1, { title: 'Dark mode toggle' })
    expect(passesSearch('dark', t)).toBe(true)
    expect(passesSearch('light', t)).toBe(false)
  })

  it('matches a #number by prefix, not the title', () => {
    expect(passesSearch('#42', ticket(42))).toBe(true)
    expect(passesSearch('#42', ticket(420))).toBe(true)
    expect(passesSearch('#42', ticket(142))).toBe(false)
    expect(passesSearch('#42', ticket(1, { title: 'Fix #42 crash' }))).toBe(false)
  })

  it('matches bare digits against the number or the title', () => {
    expect(passesSearch('42', ticket(42, { title: 'Other' }))).toBe(true)
    expect(passesSearch('42', ticket(420, { title: 'Other' }))).toBe(true)
    expect(passesSearch('42', ticket(1, { title: 'Retry 42 times' }))).toBe(true)
    expect(passesSearch('42', ticket(142, { title: 'Other' }))).toBe(false)
  })

  it('matches a tracker key by prefix, ignoring case', () => {
    const t = ticket(42, { key: 'ENG-42', title: 'Other' })
    expect(passesSearch('eng-4', t)).toBe(true)
    expect(passesSearch('eng-5', t)).toBe(false)
  })
})

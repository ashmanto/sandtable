import { describe, expect, it } from 'vitest'
import { compactText, isPrepared, prepareText } from './compact'
import type { ConversationEntry } from './types'

const user = (text: string): ConversationEntry => ({ kind: 'user', text })
const reply: ConversationEntry = { kind: 'assistant', text: 'Ready' }

describe('compact prompts', () => {
  it('name the notes file', () => {
    expect(prepareText('/d/notes/s1.md')).toContain('/d/notes/s1.md')
    expect(compactText('/d/notes/s1.md')).toMatch(/^\/compact .*\/d\/notes\/s1\.md/)
  })

  it('is prepared after the prepare message until the next compaction or message', () => {
    const prepared = [user('hi'), user(prepareText('/f')), reply]
    expect(isPrepared([])).toBe(false)
    expect(isPrepared([user('hi'), reply])).toBe(false)
    expect(isPrepared(prepared)).toBe(true)
    expect(isPrepared([...prepared, { kind: 'compact', at: '', trigger: 'manual' }])).toBe(false)
    expect(isPrepared([...prepared, user('go on')])).toBe(false)
  })
})

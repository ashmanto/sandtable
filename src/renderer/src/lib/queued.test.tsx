import { describe, expect, it } from 'vitest'
import type { ConversationEntry } from '../../../shared/types'
import { type Queued, waiting } from './queued'

const q = (id: string, typed: string | null, from = 1, error: string | null = null): Queued => ({
  id,
  text: typed ?? id,
  images: [],
  from,
  typed,
  error
})
const you = (text: string): ConversationEntry => ({ kind: 'user', text })
const claude = (text: string): ConversationEntry => ({ kind: 'assistant', text })

describe('waiting', () => {
  it('keeps a message until its text shows after where it was sent', () => {
    const sent = [q('a', 'Go on')]
    expect(waiting(sent, [you('Go on')])).toEqual(sent)
    expect(waiting(sent, [you('Go on'), claude('Sure')])).toEqual(sent)
    expect(waiting(sent, [you('Go on'), claude('Sure'), you(' Go on\n')])).toEqual([])
  })

  it('keeps a message that is still being typed or failed', () => {
    const sent = [q('a', null), q('b', 'Go on', 1, 'Already sending')]
    expect(waiting(sent, [claude('Hi'), you('a'), you('Go on')])).toEqual(sent)
  })

  it('lands two of the same text once each', () => {
    const sent = [q('a', 'Again'), q('b', 'Again')]
    const left = waiting(sent, [claude('Hi'), you('Again')])
    expect(left).toEqual([{ ...sent[1], from: 2 }])
    expect(waiting(left, [claude('Hi'), you('Again')])).toEqual(left)
    expect(waiting(sent, [claude('Hi'), you('Again'), you('Again')])).toEqual([])
  })

  it('counts from where the entries start', () => {
    const sent = [q('a', 'Go on', 503)]
    expect(waiting(sent, [you('Go on'), you('Go on')], 501)).toEqual(sent)
    expect(waiting(sent, [you('Go on'), you('Go on')], 502)).toEqual([])
  })

  it('lets a typed command leave at once, alone', () => {
    const sent = [q('a', 'Go on'), q('b', '/model opus'), q('c', ' !ls'), q('d', null)]
    expect(waiting(sent, [claude('Hi')])).toEqual([sent[0], sent[3]])
  })

  it('lands an earlier message when a later one shows', () => {
    const sent = [q('a', 'First, reworded'), q('b', 'Second')]
    expect(waiting(sent, [claude('Hi'), you('First'), you('Second')])).toEqual([])
  })
})

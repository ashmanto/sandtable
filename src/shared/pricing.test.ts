import { describe, expect, it } from 'vitest'
import { messagePrice, modelName, type MessageUsage } from './pricing'

const usage = (u: Partial<MessageUsage>): MessageUsage => ({
  input: 0,
  output: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  cacheRead: 0,
  fast: false,
  ...u
})
const M = 1_000_000

describe('messagePrice', () => {
  it('prices each token type at the model rate, with 5-minute writes at 1.25x and 1-hour at 2x input', () => {
    expect(messagePrice('claude-opus-5-5', usage({ input: M }))).toBeCloseTo(4)
    expect(messagePrice('claude-opus-5-5', usage({ output: M }))).toBeCloseTo(20)
    expect(messagePrice('claude-opus-5-5', usage({ cacheWrite5m: M }))).toBeCloseTo(5)
    expect(messagePrice('claude-opus-5-5', usage({ cacheWrite1h: M }))).toBeCloseTo(8)
    expect(messagePrice('claude-opus-5-5', usage({ cacheRead: M }))).toBeCloseTo(0.2)
    expect(messagePrice('claude-sonnet-4-6', usage({ input: M, output: M }))).toBeCloseTo(18)
    expect(messagePrice('claude-fable-5', usage({ cacheRead: M }))).toBeCloseTo(1)
    expect(messagePrice('claude-mythos-5-1', usage({ cacheRead: M }))).toBeCloseTo(0.25)
  })

  it('uses the higher Haiku 5.5 rates when the prompt is over 100,000 tokens', () => {
    expect(messagePrice('claude-haiku-5-5', usage({ input: 100_000, output: M }))).toBeCloseTo(0.51)
    expect(
      messagePrice('claude-haiku-5-5', usage({ input: 50_000, cacheRead: 50_001, output: M }))
    ).toBeCloseTo(0.025 + 0.0025 + 2.5)
    expect(
      messagePrice(
        'claude-haiku-5-5',
        usage({ input: 50_000, cacheWrite5m: 25_000, cacheWrite1h: 25_001, output: M })
      )
    ).toBeCloseTo(0.025 + 0.015625 + 0.025001 + 2.5)
  })

  it('doubles every rate in fast mode on Opus 5.5, Opus 5, and Opus 4.8, and has no price elsewhere', () => {
    expect(messagePrice('claude-opus-5-5', usage({ input: M, output: M, fast: true }))).toBeCloseTo(
      48
    )
    expect(messagePrice('claude-opus-5', usage({ cacheWrite1h: M, fast: true }))).toBeCloseTo(20)
    expect(messagePrice('claude-opus-4-8', usage({ output: M, fast: true }))).toBeCloseTo(50)
    expect(messagePrice('claude-sonnet-5', usage({ output: M, fast: true }))).toBeNull()
  })

  it('drops a date suffix and [1m] before lookup', () => {
    expect(messagePrice('claude-haiku-4-5-20251001', usage({ input: M }))).toBeCloseTo(1)
    expect(messagePrice('claude-opus-5-5[1m]', usage({ input: M }))).toBeCloseTo(4)
    expect(modelName('claude-3-5-haiku-20241022')).toBe('Haiku 3.5')
  })

  it('has no price or name for an unknown model', () => {
    expect(messagePrice('gpt-9', usage({ input: M }))).toBeNull()
    expect(modelName('gpt-9')).toBeNull()
  })
})

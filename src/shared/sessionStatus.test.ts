import { describe, expect, it } from 'vitest'
import { parseStatus, resetsText } from './sessionStatus'

const full = {
  model: { display_name: 'Opus 4.7' },
  effort: { level: 'high' },
  context_window: {
    context_window_size: 1000000,
    used_percentage: 6,
    current_usage: {
      input_tokens: 8,
      output_tokens: 100,
      cache_creation_input_tokens: 700,
      cache_read_input_tokens: 58028
    }
  },
  rate_limits: {
    five_hour: { used_percentage: 30, resets_at: 1793383200 },
    seven_day: { used_percentage: 42, resets_at: 1793900000 }
  },
  cost: {
    total_cost_usd: 0.2614286,
    total_duration_ms: 90000,
    total_api_duration_ms: 40000,
    total_lines_added: 0,
    total_lines_removed: 0
  }
}

describe('parseStatus', () => {
  it('parses a full status', () => {
    expect(parseStatus(full)).toMatchObject({
      model: 'Opus 4.7',
      effort: 'high',
      contextPct: 6,
      contextSize: 1000000,
      contextUsed: 58736,
      fiveHour: { pct: 30, resetsAt: 1793383200000 },
      sevenDay: { pct: 42, resetsAt: 1793900000000 },
      costUsd: 0.2614286,
      durationMs: 90000,
      apiDurationMs: 40000,
      linesAdded: 0,
      linesRemoved: 0,
      background: []
    })
  })

  it('keeps nulls before the first reply', () => {
    const s = parseStatus({
      model: { display_name: 'Opus 4.7' },
      context_window: { context_window_size: 1000000, used_percentage: null, current_usage: null }
    })
    expect(s).toMatchObject({
      contextPct: null,
      contextUsed: null,
      fiveHour: null,
      sevenDay: null
    })
  })

  it('drops malformed input', () => {
    expect(parseStatus(null)).toBeNull()
    expect(parseStatus([])).toBeNull()
    expect(parseStatus('x')).toBeNull()
    const bad = parseStatus({ context_window: { used_percentage: '6' } })
    expect(bad?.contextPct).toBeNull()
    expect(bad?.contextUsed).toBeNull()
  })

  it('drops a window without resets_at', () => {
    expect(
      parseStatus({ rate_limits: { five_hour: { used_percentage: 30 } } })?.fiveHour
    ).toBeNull()
  })
})

describe('resetsText', () => {
  const now = new Date(2026, 9, 30, 12)
  const at = (d: Date): number => d.getTime()

  it('says the time for the same day', () => {
    expect(resetsText(at(new Date(2026, 9, 30, 16)), now)).toBe('Resets 16:00')
  })

  it('adds the weekday for a later day', () => {
    expect(resetsText(at(new Date(2026, 10, 2, 9)), now)).toBe('Resets Mon 09:00')
  })

  it('says Reset at once past', () => {
    expect(resetsText(at(new Date(2026, 9, 30, 11)), now)).toBe('Reset at 11:00')
  })
})

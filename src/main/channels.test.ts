import { describe, expect, it } from 'vitest'
import { ORCHESTRATOR_CHANNELS } from './channels'
import { setup } from './test/orchestrator'

describe('ORCHESTRATOR_CHANNELS', () => {
  it('every mapped method exists on the orchestrator', () => {
    const t = setup()
    for (const method of Object.values(ORCHESTRATOR_CHANNELS))
      expect(typeof t.orch[method]).toBe('function')
  })
})

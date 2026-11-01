import { expect, it } from 'vitest'
import { GAUGES_WIDTH, panelWidth } from './headerFrame'

it('rounds a width between the narrow and gauges breakpoints to just under the gauges one', () => {
  expect(panelWidth(800)).toBe(GAUGES_WIDTH - 1)
  expect(panelWidth(GAUGES_WIDTH)).toBe(1151)
})

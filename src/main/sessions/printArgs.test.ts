import { expect, it } from 'vitest'
import { printArgs } from './claudeLaunch'

it('printArgs puts the rules and prompt last', () => {
  expect(printArgs(['-p'], ['-n', 'x'], 'R', 'P')).toEqual([
    '-p',
    '-n',
    'x',
    '--append-system-prompt',
    'R',
    '--',
    'P'
  ])
})

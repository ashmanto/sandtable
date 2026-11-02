import { describe, expect, it } from 'vitest'
import { EDITORS, editorFor, type Editor } from './editors'

const ed = (command: string): Editor => ({ command, name: command, path: `/bin/${command}` })
const [code, cursor, idea] = [ed('code'), ed('cursor'), ed('idea')]

describe('editorFor', () => {
  it('takes the first editor found when the project chose none', () => {
    expect(editorFor(undefined, [cursor, code])).toBe(cursor)
  })
  it("takes the project's editor when it is found", () => {
    expect(editorFor('idea', [code, idea])).toBe(idea)
  })
  it("falls back to the first editor found when the project's isn't", () => {
    expect(editorFor('idea', [code])).toBe(code)
  })
  it('finds none when no editor is found', () => {
    expect(editorFor(undefined, [])).toBeUndefined()
  })
})

it('lists the editors in probe order', () => {
  expect(EDITORS.map((e) => e.command)).toEqual([
    'code',
    'cursor',
    'idea',
    'webstorm',
    'pycharm',
    'goland',
    'phpstorm',
    'rubymine',
    'clion',
    'rider',
    'rustrover'
  ])
})

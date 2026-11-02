/** The editors Sandtable looks for, by command-line launcher, in the order it prefers them. */
export const EDITORS = [
  { command: 'code', name: 'VS Code' },
  { command: 'cursor', name: 'Cursor' },
  { command: 'idea', name: 'IntelliJ IDEA' },
  { command: 'webstorm', name: 'WebStorm' },
  { command: 'pycharm', name: 'PyCharm' },
  { command: 'goland', name: 'GoLand' },
  { command: 'phpstorm', name: 'PhpStorm' },
  { command: 'rubymine', name: 'RubyMine' },
  { command: 'clion', name: 'CLion' },
  { command: 'rider', name: 'Rider' },
  { command: 'rustrover', name: 'RustRover' }
] as const

/** An editor whose launcher was found, and where. */
export type Editor = { command: string; name: string; path: string }

/** The project's chosen editor if it was found, else the first editor found. */
export const editorFor = (chosen: string | undefined, found: Editor[]): Editor | undefined =>
  found.find((e) => e.command === chosen) ?? found[0]

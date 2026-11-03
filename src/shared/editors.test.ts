import { describe, expect, it } from 'vitest'
import { appName, isApp } from './editors'

describe('isApp', () => {
  it('accepts only an absolute path to an app', () => {
    expect(isApp('/Applications/WebStorm.app')).toBe(true)
    for (const v of ['code', 'WebStorm.app', '/usr/bin/code', '', 3, undefined])
      expect(isApp(v)).toBe(false)
  })
})

describe('appName', () => {
  it('names an app after its file', () => {
    expect(appName('/Applications/Sublime Text.app')).toBe('Sublime Text')
  })
})

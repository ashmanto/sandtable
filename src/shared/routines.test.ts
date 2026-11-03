import { describe, expect, it } from 'vitest'
import { dueTimes, routineProblem, rulesProblem, scheduleLabel } from './routines'

const local = (s: string): Date => new Date(s)

describe('routines', () => {
  it('lists the scheduled times after one moment up to another', () => {
    const weekdays = { days: [1, 2, 3, 4, 5], time: '02:00' }
    expect(dueTimes(weekdays, local('2026-10-27T02:00'), local('2026-10-29T02:00'))).toEqual([
      local('2026-10-28T02:00'),
      local('2026-10-29T02:00')
    ])
    expect(dueTimes(weekdays, local('2026-10-30T03:00'), local('2026-11-02T01:59'))).toEqual([])
  })

  it('names the days and time', () => {
    expect(scheduleLabel({ days: [1, 2, 3, 4, 5], time: '02:00' })).toBe('Weekdays at 02:00')
    expect(scheduleLabel({ days: [0, 1, 2, 3, 4, 5, 6], time: '09:30' })).toBe('Every day at 09:30')
    expect(scheduleLabel({ days: [0, 6], time: '06:00' })).toBe('Weekends at 06:00')
    expect(scheduleLabel({ days: [3, 1], time: '18:00' })).toBe('Mon, Wed at 18:00')
    expect(scheduleLabel({ days: [0], time: '18:00' })).toBe('Sun at 18:00')
  })

  it('says what is wrong with a routine before it saves', () => {
    const base = {
      projectId: 'p1',
      name: 'Dependency check',
      repo: 'a/b',
      worktree: false,
      message: 'Go'
    }
    const other = { ...base, id: 'r2', name: 'Triage' }
    expect(routineProblem(base, [other], 'Shop')).toBeNull()
    expect(routineProblem({ ...base, name: '  ' }, [], 'Shop')).toBe('Enter a name')
    expect(routineProblem({ ...base, name: ' triage ' }, [other], 'Shop')).toBe(
      'Shop already has a routine named triage'
    )
    expect(routineProblem({ ...base, id: 'r2', name: 'Triage' }, [other], 'Shop')).toBeNull()
    expect(routineProblem({ ...base, message: ' ' }, [], 'Shop')).toBe('Write the first message')
    expect(routineProblem({ ...base, schedule: { days: [], time: '02:00' } }, [], 'Shop')).toBe(
      'Pick at least one day'
    )
    expect(routineProblem({ ...base, schedule: { days: [1], time: '25:00' } }, [], 'Shop')).toBe(
      'Enter a time such as 02:00'
    )
    for (const days of [[7], [-1], [1.5], ['1' as unknown as number]])
      expect(routineProblem({ ...base, schedule: { days, time: '02:00' } }, [], 'Shop')).toBe(
        'Pick days from the list'
      )
    expect(
      routineProblem(
        { ...base, schedule: { days: [1, 1, 1, 1, 1, 1, 1, 1], time: '02:00' } },
        [],
        'Shop'
      )
    ).toBe('Pick days from the list')
    expect(routineProblem({ ...base, worktree: 'false' as unknown as boolean }, [], 'Shop')).toBe(
      'Pick where it runs'
    )
  })

  it('refuses an allowed rule that is not permission syntax or allows any command', () => {
    const base = { projectId: 'p1', name: 'N', repo: 'a/b', worktree: false, message: 'Go' }
    const allow = (...rules: string[]): string | null =>
      routineProblem({ ...base, allow: rules }, [], 'Shop')
    expect(
      allow('Read', ' Bash(npm outdated) ', 'Bash(npm audit:*)', 'mcp__github__get_issue', '')
    ).toBeNull()
    expect(allow('WebFetch(domain:example.com)', 'Read(./src/**)')).toBeNull()
    for (const bad of ['Bash(npm', 'Bash()', 'npm outdated', '(x)', 'Bash(x) y'])
      expect(allow('Read', bad)).toBe(
        `${bad} isn't a permission rule. Write a tool such as Read, or a tool and what it may do, such as Bash(npm outdated)`
      )
    for (const broad of ['Bash', 'Bash(*)', 'Bash(:*)', 'Bash(**)', 'Bash(*:*)', 'Bash( *)'])
      expect(allow(broad)).toBe(
        `${broad} lets the session run any command. Name the commands, such as Bash(npm outdated)`
      )
    for (const runner of [
      'Bash(sh:*)',
      'Bash(bash -c:*)',
      'Bash(node *)',
      'Bash(npx:*)',
      'Bash(npm exec:*)',
      'Bash(env:*)',
      'Bash(xargs *)',
      'Bash(sudo:*)',
      'Bash(python3 -c:*)',
      'Bash(/bin/sh:*)',
      'Bash(/usr/bin/env:*)',
      'Bash(SH:*)',
      'Bash(npm:*)',
      'Bash(pnpm:*)',
      'Bash(nice -n 5 sh:*)',
      'Bash(sudo sh:*)',
      'Bash(env FOO=1 bash:*)',
      'Bash(timeout 5s npx:*)',
      'Bash(s*)',
      'Bash(n*)',
      'Bash(py*)',
      'Bash(su*)',
      'Bash(/bin/s*)',
      'Bash(npm e*)',
      'Bash(nice -*)',
      'Bash(sudo s*)'
    ])
      expect(allow(runner)).toBe(
        `${runner} lets the session run any command. Name the commands, such as Bash(npm outdated)`
      )
    expect(
      allow(
        'Bash(node scripts/check.js)',
        'Bash(npx eslint:*)',
        'Bash(env FOO=1 npm test:*)',
        'Bash(/usr/local/bin/npm audit:*)',
        'Bash(nice -n 5 npm test:*)',
        'Bash(yarn lint:*)',
        'Bash(ls*)',
        'Bash(git s*)',
        'Bash(npm test*)'
      )
    ).toBeNull()
    expect(rulesProblem(['Read', ''])).toBeNull()
    expect(rulesProblem(['Read', 'Bash'])).toBe(allow('Bash'))
    expect(allow(3 as unknown as string)).toBe(
      "3 isn't a permission rule. Write a tool such as Read, or a tool and what it may do, such as Bash(npm outdated)"
    )
    expect(routineProblem({ ...base, allow: 'Read' as unknown as string[] }, [], 'Shop')).toBe(
      'Write one allowed rule per line'
    )
  })

  it('caps the name at 200 characters and the first message at 10,000 bytes', () => {
    const base = { projectId: 'p1', name: 'N', repo: 'a/b', worktree: false, message: 'Go' }
    expect(routineProblem({ ...base, name: 'n'.repeat(200) }, [], 'Shop')).toBeNull()
    expect(routineProblem({ ...base, name: 'n'.repeat(201) }, [], 'Shop')).toBe('Shorten the name')
    expect(routineProblem({ ...base, message: 'm'.repeat(10_000) }, [], 'Shop')).toBeNull()
    expect(routineProblem({ ...base, message: 'é'.repeat(5_001) }, [], 'Shop')).toBe(
      'Shorten the first message'
    )
  })

  it('checks the trigger label and the daily cap', () => {
    const base = { projectId: 'p1', name: 'N', repo: 'a/b', worktree: false, message: 'Go' }
    const on = { label: 'triage' }
    expect(routineProblem({ ...base, on, dailyCap: 50 }, [], 'Shop')).toBeNull()
    expect(routineProblem({ ...base, on: { label: ' ' } }, [], 'Shop')).toBe('Enter a label')
    expect(routineProblem({ ...base, on: { label: 3 as unknown as string } }, [], 'Shop')).toBe(
      'Enter a label'
    )
    expect(routineProblem({ ...base, on: { label: 'l'.repeat(101) } }, [], 'Shop')).toBe(
      'Shorten the label'
    )
    for (const dailyCap of [0, 51, 2.5, '5' as unknown as number])
      expect(routineProblem({ ...base, on, dailyCap }, [], 'Shop')).toBe(
        'Enter a daily cap from 1 to 50'
      )
  })
})

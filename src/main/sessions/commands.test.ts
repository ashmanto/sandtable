import { describe, expect, it } from 'vitest'
import { commandsOf } from './commands'

const response = (commands: object[]): string =>
  [
    JSON.stringify({ type: 'system', subtype: 'hook_started', hook_id: 'h1' }),
    JSON.stringify({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'commands',
        response: { commands, agents: [] }
      }
    })
  ].join('\n') + '\n'

describe('commandsOf', () => {
  it('reads each command with its source, and takes a trailing source off the description', () => {
    const stdout = response([
      {
        name: 'context',
        description: 'Show current context usage',
        argumentHint: '',
        builtin: true
      },
      {
        name: 'export',
        description: 'Export the conversation, which stays on disk (resumable with /resume)',
        argumentHint: '[filename]',
        builtin: true
      },
      { name: 'simplify', description: 'Review the changed code (user)', argumentHint: '' },
      { name: 'ship', description: 'Ship it (project)', argumentHint: '<branch>' },
      {
        name: 'anthropic-skills:pdf',
        description: 'Use this skill (claude.ai sync)',
        argumentHint: ''
      },
      { name: 'plain', description: 'No source here', argumentHint: '' }
    ])
    expect(commandsOf(stdout)).toEqual([
      {
        name: 'context',
        description: 'Show current context usage',
        argumentHint: '',
        source: 'Built into Claude Code',
        aliases: []
      },
      {
        name: 'export',
        description: 'Export the conversation, which stays on disk (resumable with /resume)',
        argumentHint: '[filename]',
        source: 'Built into Claude Code',
        aliases: []
      },
      {
        name: 'simplify',
        description: 'Review the changed code',
        argumentHint: '',
        source: 'Your command or skill',
        aliases: []
      },
      {
        name: 'ship',
        description: 'Ship it',
        argumentHint: '<branch>',
        source: "This repo's command or skill",
        aliases: []
      },
      {
        name: 'anthropic-skills:pdf',
        description: 'Use this skill',
        argumentHint: '',
        source: 'Synced from claude.ai',
        aliases: []
      },
      { name: 'plain', description: 'No source here', argumentHint: '', source: '', aliases: [] }
    ])
  })

  it('leaves out commands that open a panel in the terminal', () => {
    const names = [
      'usage',
      'model',
      'effort',
      'config',
      'mcp',
      'fast',
      'advisor',
      'autocompact',
      'skill-doctor',
      'auto-mode-setup',
      'usage-credits',
      'extra-usage',
      'ultrareview',
      '__internal',
      'workflow-launch-exec',
      'goal',
      'send-to-project',
      'context'
    ]
    const stdout = response(
      names.map((name) => ({ name, description: name, argumentHint: '', builtin: true }))
    )
    expect(commandsOf(stdout).map((c) => c.name)).toEqual(['context'])
  })

  it('throws when Claude Code sent no command list', () => {
    expect(() => commandsOf('{"type":"system","subtype":"hook_started"}\n')).toThrow(
      "Claude Code didn't list its commands"
    )
  })

  it("passes on Claude Code's error, and reads a source before trailing space", () => {
    const failed = JSON.stringify({
      type: 'control_response',
      response: { subtype: 'error', request_id: 'commands', error: 'Not signed in' }
    })
    expect(() => commandsOf(failed)).toThrow("Claude Code didn't list its commands: Not signed in")
    const [c] = commandsOf(
      response([{ name: 'x', description: 'Do X (user)\n', argumentHint: '' }])
    )
    expect(c).toMatchObject({ description: 'Do X', source: 'Your command or skill' })
  })

  it('keeps aliases, and leaves out a command whose alias opens a panel', () => {
    const stdout = response([
      {
        name: 'clear',
        description: 'Clear',
        argumentHint: '',
        builtin: true,
        aliases: ['reset', 'new']
      },
      {
        name: 'cost-ish',
        description: 'Panel',
        argumentHint: '',
        builtin: true,
        aliases: ['usage']
      },
      { name: 'x', description: 'X', argumentHint: '', aliases: 'bad' }
    ])
    expect(commandsOf(stdout).map((c) => [c.name, c.aliases])).toEqual([
      ['clear', ['reset', 'new']],
      ['x', []]
    ])
  })
})

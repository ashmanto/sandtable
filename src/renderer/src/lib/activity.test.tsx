import {
  Bot,
  FileText,
  Globe,
  Pencil,
  Search,
  Sparkles,
  SquareTerminal,
  Wrench
} from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { stepLook } from './activity'

const step = (tool: string): { tool: string; target: string; at: null } => ({
  tool,
  target: 'x',
  at: null
})

describe('stepLook', () => {
  it.each([
    ['Edit', 'Editing', Pencil],
    ['Write', 'Editing', Pencil],
    ['MultiEdit', 'Editing', Pencil],
    ['NotebookEdit', 'Editing', Pencil],
    ['Bash', 'Running', SquareTerminal],
    ['Read', 'Reading', FileText],
    ['Grep', 'Searching', Search],
    ['Glob', 'Searching', Search],
    ['WebSearch', 'Searching', Search],
    ['WebFetch', 'Fetching', Globe],
    ['Task', 'Asking an agent', Bot],
    ['Agent', 'Asking an agent', Bot],
    ['Skill', 'Using', Sparkles]
  ])('gives %s the verb %s and its icon', (tool, verb, icon) => {
    expect(stepLook(step(tool))).toEqual({ verb, icon })
  })

  it('names any other tool by its name, with the wrench', () => {
    expect(stepLook(step('mcp__linear__get_issue'))).toEqual({
      verb: 'mcp__linear__get_issue',
      icon: Wrench
    })
  })
})

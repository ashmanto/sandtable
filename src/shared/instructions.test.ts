import { describe, expect, it } from 'vitest'
import { instructionsBytes, instructionsFor, keptInstructions } from './instructions'
import type { Project } from './types'

const project = (instructions?: Project['instructions']): Project => ({
  id: 'p1',
  name: 'Shop',
  repos: [],
  ...(instructions && { instructions })
})

describe('instructionsFor', () => {
  it('is empty for a project without instructions', () => {
    expect(instructionsFor(project(), [{ name: 'bug' }])).toEqual([])
  })

  it('gives the every-ticket text first, then matching labels in saved order', () => {
    const p = project({
      all: '  Run the tests.\n',
      labels: [
        { label: 'docs', text: 'Keep it short.' },
        { label: 'bug', text: 'Write a failing test first.' },
        { label: 'ui', text: 'Take a screenshot.' }
      ]
    })
    expect(instructionsFor(p, [{ name: 'bug' }, { name: 'docs' }])).toEqual([
      { text: 'Run the tests.' },
      { label: 'docs', text: 'Keep it short.' },
      { label: 'bug', text: 'Write a failing test first.' }
    ])
  })

  it('matches labels case-insensitively and skips labels the ticket lacks', () => {
    const p = project({ labels: [{ label: 'Bug', text: 'Reproduce it.' }] })
    expect(instructionsFor(p, [{ name: 'bUG' }])).toEqual([{ label: 'Bug', text: 'Reproduce it.' }])
    expect(instructionsFor(p, [{ name: 'enhancement' }])).toEqual([])
  })

  it('skips blank texts', () => {
    const p = project({ all: ' \n', labels: [{ label: 'bug', text: '  ' }] })
    expect(instructionsFor(p, [{ name: 'bug' }])).toEqual([])
  })
})

describe('keptInstructions', () => {
  it('trims label names and drops blank text, blank and repeated labels, and an empty result', () => {
    expect(
      keptInstructions({
        all: 'Run the tests.',
        labels: [
          { label: ' bug ', text: 'Repro it.' },
          { label: 'Bug', text: 'Again.' },
          { label: 'docs', text: '  ' },
          { label: ' ', text: 'No label.' }
        ]
      })
    ).toEqual({ all: 'Run the tests.', labels: [{ label: 'bug', text: 'Repro it.' }] })
    expect(keptInstructions({ all: ' ', labels: [{ label: 'bug', text: '' }] })).toBeUndefined()
    expect(keptInstructions(undefined)).toBeUndefined()
  })
})

describe('instructionsBytes', () => {
  it('counts the UTF-8 bytes of the section the rules end with, as if every label matched', () => {
    expect(instructionsBytes({ all: 'é', labels: [{ label: 'bug', text: 'ab' }] })).toBe(
      new TextEncoder().encode(
        '\n\nYour instructions for this ticket:\né\n\nFor the label "bug":\nab'
      ).length
    )
    expect(instructionsBytes(undefined)).toBe(0)
  })
})

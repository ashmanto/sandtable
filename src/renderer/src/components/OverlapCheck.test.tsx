import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { OverlapRun } from '@/hooks/startFlow'
import { OverlapCheck } from './OverlapCheck'

const show = (check: OverlapRun['check'], cancel = vi.fn()): ReturnType<typeof vi.fn> => {
  const startAnyway = vi.fn()
  render(
    <OverlapCheck
      check={check}
      begin={vi.fn()}
      cancel={cancel}
      startAnyway={startAnyway}
      refine={vi.fn()}
      area={undefined}
    />
  )
  return startAnyway
}

describe('OverlapCheck Start with planning', () => {
  it('starts with planning from the Not ready block', async () => {
    const startAnyway = show({
      kind: 'gaps',
      gaps: ['No done-when'],
      extraRepos: [],
      candidates: []
    })
    await userEvent.click(screen.getByRole('button', { name: 'Start with planning' }))
    expect(startAnyway).toHaveBeenCalledWith(true)
  })

  it('is not offered when the readiness check failed', () => {
    show({ kind: 'gaps', gaps: [], error: 'Boom', extraRepos: [], candidates: [] })
    expect(screen.queryByRole('button', { name: 'Start with planning' })).toBeNull()
  })
})

describe('OverlapCheck buttons', () => {
  it('wraps the four Not ready buttons so Cancel stays reachable', async () => {
    const cancel = vi.fn()
    show({ kind: 'gaps', gaps: ['No done-when'], extraRepos: [], candidates: [] }, cancel)
    const cancelButton = screen.getByRole('button', { name: 'Cancel' })
    expect(cancelButton.parentElement).toHaveClass('flex-wrap')
    expect(cancelButton.parentElement?.children).toHaveLength(4)
    await userEvent.click(cancelButton)
    expect(cancel).toHaveBeenCalled()
  })
})

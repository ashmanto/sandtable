import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { session } from '../test/fixtures'
import { ClearNeedsYou } from './ClearNeedsYou'

describe('ClearNeedsYou', () => {
  it('offers Clear Needs you on an API error', () => {
    render(<ClearNeedsYou session={session('octo/shop#1', { state: 'apiError' })} run={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Clear Needs you' })).toBeInTheDocument()
  })

  it('offers nothing at Limit reached', () => {
    render(
      <ClearNeedsYou session={session('octo/shop#1', { state: 'limitReached' })} run={vi.fn()} />
    )
    expect(screen.queryByRole('button')).toBeNull()
  })
})

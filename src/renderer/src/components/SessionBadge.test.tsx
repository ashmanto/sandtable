import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionBadge } from './SessionBadge'

const NOW = new Date(2026, 9, 24, 12, 0)
const login = 'Login expired · Please run /login'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(NOW)
})
afterEach(() => vi.useRealTimers())

describe('SessionBadge stop', () => {
  it('shows Limit reached with its reset time', () => {
    render(
      <SessionBadge
        state="limitReached"
        stop={{ message: 'm', resetsAt: new Date(2026, 9, 24, 16, 0).getTime() }}
      />
    )
    expect(screen.getByText(/Limit reached/)).toHaveTextContent(/^Limit reached · Resets 16:00$/)
  })

  it('turns to Reset at once the reset time passes, without another render', async () => {
    const resetsAt = NOW.getTime() + 60_000
    render(<SessionBadge state="limitReached" stop={{ message: 'm', resetsAt }} />)
    expect(screen.getByText(/Limit reached/)).toHaveTextContent(/Resets 12:01$/)
    await act(() => vi.advanceTimersByTimeAsync(61_000))
    expect(screen.getByText(/Limit reached/)).toHaveTextContent(/Reset at 12:01$/)
  })

  it('shows Limit reached alone without a reset time', () => {
    render(<SessionBadge state="limitReached" stop={{ message: 'm' }} />)
    expect(screen.getByText(/Limit reached/)).toHaveTextContent(/^Limit reached$/)
  })

  it("shows API error with Claude Code's message as its tooltip", () => {
    render(<SessionBadge state="apiError" stop={{ message: login }} />)
    expect(screen.getByText('API error').closest('[title]')).toHaveAttribute('title', login)
  })

  it('gives screen readers the API error message', () => {
    render(<SessionBadge state="apiError" stop={{ message: login }} />)
    expect(screen.getByText('API error').closest('span')).toHaveTextContent(`API error: ${login}`)
  })

  it('has no tooltip outside the two stop states', () => {
    render(<SessionBadge state="running" stop={{ message: login }} />)
    expect(screen.getByText('Running').closest('[title]')).toBeNull()
  })

  it('shows neither word for a running session', () => {
    render(<SessionBadge state="running" />)
    expect(screen.queryByText(/Limit reached|API error/)).toBeNull()
  })
})

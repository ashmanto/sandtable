import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SandtableApi } from '../../../shared/api'
import type { ReviewRound, SessionRecord } from '../../../shared/types'
import { fakeSandtable, project, session } from '../test/fixtures'
import { AutoReviewToggle } from './AutoReviewToggle'

let api: SandtableApi

beforeEach(() => {
  api = fakeSandtable()
})

const toggle = (): HTMLElement => screen.getByRole('switch', { name: 'Automatic review' })
const s = (over: Partial<SessionRecord> = {}): SessionRecord => session('octo/shop#1', over)

describe('AutoReviewToggle', () => {
  it("follows the project's setting and turns it on for the session", async () => {
    render(<AutoReviewToggle session={s()} project={project} />)
    expect(toggle()).not.toBeChecked()
    expect(toggle()).toHaveAccessibleDescription(
      'Review the changes when Claude ends its turn with an open pull request'
    )
    await userEvent.click(toggle())
    expect(api.sessions.setAutoReview).toHaveBeenCalledWith(s().id, true)
  })

  it('is on when the project turns it on, and turns it off for the session', async () => {
    render(<AutoReviewToggle session={s()} project={{ ...project, autoReview: true }} />)
    expect(toggle()).toBeChecked()
    await userEvent.click(toggle())
    expect(api.sessions.setAutoReview).toHaveBeenCalledWith(s().id, false)
  })

  it("follows the session's own setting over the project's", () => {
    render(
      <AutoReviewToggle
        session={s({ autoReview: { on: false, rounds: 0 } })}
        project={{ ...project, autoReview: true }}
      />
    )
    expect(toggle()).not.toBeChecked()
  })

  const round: ReviewRound = { at: 3, round: 2, startedAt: '2026-10-31T14:02:00', files: 4 }

  it('says a round is running, with Open Changes when the panel can open them', async () => {
    const onOpenChanges = vi.fn()
    render(
      <AutoReviewToggle
        session={s({ state: 'reviewing', reviewRounds: [round] })}
        project={project}
        onOpenChanges={onOpenChanges}
      />
    )
    expect(screen.getByText('Reviewing')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Round 2 of 3 · 4 changed files · started 14:02. High findings go to Claude when it ends.'
      )
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Open Changes' }))
    expect(onOpenChanges).toHaveBeenCalledOnce()
  })

  it('says 1 changed file, with no Open Changes when the panel has none', () => {
    render(
      <AutoReviewToggle
        session={s({ state: 'reviewing', reviewRounds: [{ ...round, files: 1 }] })}
        project={project}
      />
    )
    expect(screen.getByText(/· 1 changed file ·/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open Changes' })).toBeNull()
  })

  it('says nothing once the session leaves Reviewing', () => {
    render(
      <AutoReviewToggle
        session={s({ state: 'needsYou', reviewRounds: [round] })}
        project={project}
      />
    )
    expect(screen.queryByText('Reviewing')).toBeNull()
  })
})

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { fakeSandtable, project, session, ticket } from '../test/fixtures'
import { TicketRow } from './TicketList'

describe('TicketRow', () => {
  it("says an open pull request's stage on a row outside Done, not in Done", () => {
    const t = ticket(1, { prStage: 'changesRequested' })
    const { rerender } = render(
      <TicketRow ticket={t} session={undefined} state={undefined} done={false} onOpen={vi.fn()} />
    )
    expect(screen.getByText('Changes requested')).toBeInTheDocument()
    rerender(<TicketRow ticket={t} session={undefined} state={undefined} done onOpen={vi.fn()} />)
    expect(screen.queryByText('Changes requested')).toBeNull()
  })

  it("shows a running session's latest step as a pill that doesn't open the row", async () => {
    const api = fakeSandtable()
    vi.mocked(api.sessions.activity).mockResolvedValue({
      steps: [{ tool: 'Grep', target: 'parseConversation', at: null }],
      since: new Date(Date.now() - 65 * 60_000).toISOString()
    })
    const t = ticket(1)
    const onOpen = vi.fn()
    render(
      <TicketRow ticket={t} session={session(t.key)} state="running" done={false} onOpen={onOpen} />
    )
    const pill = await screen.findByRole('img', {
      name: 'Searching parseConversation, for 1 hour'
    })
    await userEvent.click(pill)
    expect(onOpen).not.toHaveBeenCalled()
    expect(screen.getByText('Running')).toBeInTheDocument()
  })

  it("shows another project's session state and name, Done, session open in Done", () => {
    const t = ticket(1)
    const elsewhere = {
      session: session(t.key, { projectId: 'p2', state: 'needsYou' }),
      project: { ...project, id: 'p2', name: 'Contacts team' },
      onOpen: vi.fn()
    }
    const { rerender } = render(
      <TicketRow
        ticket={t}
        session={undefined}
        state={undefined}
        done={false}
        onOpen={vi.fn()}
        elsewhere={elsewhere}
      />
    )
    expect(screen.getByText('Needs you')).toBeInTheDocument()
    expect(screen.getByText('in Contacts team')).toBeInTheDocument()
    rerender(
      <TicketRow
        ticket={t}
        session={undefined}
        state={undefined}
        done
        onOpen={vi.fn()}
        elsewhere={elsewhere}
      />
    )
    expect(screen.getByText('Done, session open')).toBeInTheDocument()
  })
})

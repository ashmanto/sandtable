import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fakeSandtable,
  linearProject,
  linearTicket,
  project,
  session,
  ticket
} from '../test/fixtures'
import { StartFlow } from './StartFlow'

beforeEach(() => {
  fakeSandtable()
})

const [shop, frontend] = project.repos

describe('StartFlow', () => {
  it('asks for the repo of a ticket with none, then starts in it with the extras', async () => {
    const onStart = vi.fn()
    const t = linearTicket(12)
    render(<StartFlow project={linearProject} ticket={t} onStart={onStart} onClose={vi.fn()} />)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('APP-12')).toBeInTheDocument()
    expect(within(dialog).getByText('Choose the repo the worktree goes in.')).toBeInTheDocument()
    const group = within(dialog).getByRole('radiogroup', { name: 'Repo for the worktree' })
    expect(
      within(group)
        .getAllByRole('radio')
        .some((r) => (r as HTMLInputElement).checked)
    ).toBe(false)
    expect(within(dialog).getByRole('button', { name: 'Start' })).toBeDisabled()
    expect(within(dialog).queryAllByRole('checkbox')).toHaveLength(0)
    await userEvent.click(within(group).getByRole('radio', { name: frontend.github }))
    expect(
      within(dialog).getByText(`Runs Claude Code in a new worktree of ${frontend.github}.`)
    ).toBeInTheDocument()
    expect(
      within(dialog).queryByRole('checkbox', { name: frontend.github })
    ).not.toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('checkbox', { name: shop.github }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start' }))
    expect(onStart).toHaveBeenCalledWith([shop.github], frontend.github, {
      overlap: [],
      ready: false
    })
  })

  it('drops the repo question once sync fills the ticket repo', async () => {
    const t = linearTicket(12)
    const props = { project: linearProject, onStart: vi.fn(), onClose: vi.fn() }
    const { rerender } = render(<StartFlow {...props} ticket={t} />)
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('radio', { name: frontend.github }))
    rerender(<StartFlow {...props} ticket={{ ...t, repo: shop.github }} mainRepo={shop} />)
    expect(within(dialog).queryByRole('radio')).not.toBeInTheDocument()
    expect(
      within(dialog).getByText(`Runs Claude Code in a new worktree of ${shop.github}.`)
    ).toBeInTheDocument()
  })

  it("pre-checks a session's extra repo even when its main repo left the project", async () => {
    const t = linearTicket(12)
    const s = session(t.key, {
      worktrees: ['/gone-wt.noindex/12-x', `${frontend.path}-wt.noindex/12-x`]
    })
    render(
      <StartFlow
        project={linearProject}
        ticket={t}
        session={s}
        onStart={vi.fn()}
        onClose={vi.fn()}
      />
    )
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('radio', { name: shop.github }))
    expect(within(dialog).getByRole('checkbox', { name: frontend.github })).toBeChecked()
  })

  it("pre-checks the newest session's extra repos", async () => {
    const t = ticket(3)
    const s = session(t.key, {
      worktrees: [`${shop.path}-wt.noindex/3-x`, `${frontend.path}-wt.noindex/3-x`]
    })
    const onStart = vi.fn()
    render(
      <StartFlow
        project={project}
        ticket={t}
        mainRepo={shop}
        session={s}
        onStart={onStart}
        onClose={vi.fn()}
      />
    )
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('#3')).toBeInTheDocument()
    expect(within(dialog).queryByRole('radio')).not.toBeInTheDocument()
    expect(within(dialog).getByRole('checkbox', { name: frontend.github })).toBeChecked()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start' }))
    expect(onStart).toHaveBeenCalledWith([frontend.github], undefined, {
      overlap: [],
      ready: false
    })
  })
})

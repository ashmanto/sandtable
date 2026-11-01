import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SandtableApi } from '../../../shared/api'
import { fakeSandtable, project, ticket } from '../test/fixtures'
import { StartCheckDialog } from './StartCheckDialog'

const t = ticket(40)
let api: SandtableApi

function renderDialog(): { onPass: ReturnType<typeof vi.fn>; onClose: ReturnType<typeof vi.fn> } {
  const onPass = vi.fn()
  const onClose = vi.fn()
  render(<StartCheckDialog project={project} ticket={t} onPass={onPass} onClose={onClose} />)
  return { onPass, onClose }
}

beforeEach(() => {
  api = fakeSandtable()
})

describe('StartCheckDialog', () => {
  it('passes straight through with no problems', async () => {
    const { onPass } = renderDialog()
    await vi.waitFor(() => expect(onPass).toHaveBeenCalledTimes(1))
    expect(api.tickets.checkStart).toHaveBeenCalledWith(project.id, t.key)
    expect(api.tickets.triage).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('hands on the overlap candidates and the readiness flag when it passes', async () => {
    const overlap = [{ key: 'octo/shop#67', number: 67, title: 'Sort cards' }]
    vi.mocked(api.tickets.checkStart).mockResolvedValue({
      triage: false,
      problems: [],
      overlap,
      ready: true
    })
    const { onPass } = renderDialog()
    await vi.waitFor(() => expect(onPass).toHaveBeenCalledWith({ overlap, ready: true }))
  })

  it('shows problems and starts anyway with the overlap candidates', async () => {
    const overlap = [{ key: 'octo/shop#67', number: 67, title: 'Sort cards' }]
    vi.mocked(api.tickets.checkStart).mockResolvedValue({
      triage: false,
      problems: ['Blocked by #38: Add a settings screen'],
      overlap,
      ready: false
    })
    const { onPass } = renderDialog()
    const dialog = await screen.findByRole('dialog')
    expect(
      await within(dialog).findByText('Blocked by #38: Add a settings screen')
    ).toBeInTheDocument()
    expect(onPass).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start anyway' }))
    expect(onPass).toHaveBeenCalledWith({ overlap, ready: false })
  })

  it('triages, applies, and re-checks', async () => {
    const calls: string[] = []
    const triage = {
      area: 'area: board',
      newAreas: [{ name: 'area: board', description: 'The kanban board' }],
      blockedBy: [{ key: 'octo/shop#38', number: 38, title: 'Add a settings screen' }],
      reason: 'It changes the card layout.'
    }
    vi.mocked(api.tickets.checkStart)
      .mockImplementationOnce(async () => {
        calls.push('checkStart')
        return { triage: true, problems: [], overlap: [], ready: false }
      })
      .mockImplementationOnce(async () => {
        calls.push('checkStart')
        return {
          triage: false,
          problems: ['Blocked by #38: Add a settings screen'],
          overlap: [],
          ready: false
        }
      })
    vi.mocked(api.tickets.triage).mockImplementation(async () => {
      calls.push('triage')
      return triage
    })
    vi.mocked(api.tickets.applyTriage).mockImplementation(async () => {
      calls.push('applyTriage')
    })
    const { onPass } = renderDialog()
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('It changes the card layout.')).toBeInTheDocument()
    expect(within(dialog).getByText('area: board — The kanban board')).toBeInTheDocument()
    expect(within(dialog).getByText('#38 Add a settings screen')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }))
    expect(await screen.findByText('Blocked by #38: Add a settings screen')).toBeInTheDocument()
    expect(calls).toEqual(['checkStart', 'triage', 'applyTriage', 'checkStart'])
    expect(api.tickets.applyTriage).toHaveBeenCalledWith(project.id, t.key, triage)
    expect(onPass).not.toHaveBeenCalled()
  })

  it('names Linear and shows blockers by their Linear key in a Linear project', async () => {
    vi.mocked(api.tickets.checkStart).mockResolvedValue({
      triage: true,
      problems: [],
      overlap: [],
      ready: false
    })
    vi.mocked(api.tickets.triage).mockResolvedValue({
      area: 'area: board',
      newAreas: [],
      blockedBy: [{ key: 'APP-3', number: 3, title: 'Settings' }],
      reason: 'r'
    })
    const linearProject = { ...project, board: undefined, linear: { team: 'APP', projects: [] } }
    render(
      <StartCheckDialog
        project={linearProject}
        ticket={{ ...t, key: 'APP-40' }}
        onPass={vi.fn()}
        onClose={vi.fn()}
      />
    )
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('APP-3 Settings')).toBeInTheDocument()
    expect(
      within(dialog).getByText(
        'Apply writes these to Linear. Until then, nothing on Linear changes.'
      )
    ).toBeInTheDocument()
  })

  it('shows a triage failure with Start anyway and never applies', async () => {
    vi.mocked(api.tickets.checkStart).mockResolvedValue({
      triage: true,
      problems: [],
      overlap: [],
      ready: false
    })
    vi.mocked(api.tickets.triage).mockRejectedValue(
      new Error("Triage didn't finish within 3 minutes")
    )
    const { onPass } = renderDialog()
    expect(await screen.findByText("Triage didn't finish within 3 minutes")).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Start anyway' }))
    expect(onPass).toHaveBeenCalledTimes(1)
    expect(api.tickets.applyTriage).not.toHaveBeenCalled()
  })

  it('keeps the blockers under a triage failure', async () => {
    vi.mocked(api.tickets.checkStart).mockResolvedValue({
      triage: true,
      problems: ['Blocked by #38: Add a settings screen'],
      overlap: [],
      ready: false
    })
    vi.mocked(api.tickets.triage).mockRejectedValue(new Error('Triage failed: no output'))
    renderDialog()
    expect(await screen.findByText('Triage failed: no output')).toBeInTheDocument()
    expect(screen.getByText('Blocked by #38: Add a settings screen')).toBeInTheDocument()
  })

  it('shows a failed Apply with Start anyway and never re-checks', async () => {
    vi.mocked(api.tickets.checkStart).mockResolvedValue({
      triage: true,
      problems: [],
      overlap: [],
      ready: false
    })
    vi.mocked(api.tickets.applyTriage).mockRejectedValue(new Error('GitHub is down'))
    const { onPass } = renderDialog()
    await userEvent.click(await screen.findByRole('button', { name: 'Apply' }))
    expect(await screen.findByText('GitHub is down')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Start anyway' }))
    expect(onPass).toHaveBeenCalledTimes(1)
    expect(api.tickets.checkStart).toHaveBeenCalledTimes(1)
  })

  it('starts anyway from the triage result without applying, and shows the first problems', async () => {
    vi.mocked(api.tickets.checkStart).mockResolvedValue({
      triage: true,
      problems: ['Blocked by #38: Add a settings screen'],
      overlap: [],
      ready: false
    })
    const { onPass } = renderDialog()
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByRole('button', { name: 'Apply' })
    expect(within(dialog).getByText('Blocked by #38: Add a settings screen')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start anyway' }))
    expect(onPass).toHaveBeenCalledTimes(1)
    expect(api.tickets.applyTriage).not.toHaveBeenCalled()
  })

  it('keeps the first problems under a failed Apply and a failed re-check', async () => {
    const problems = ['Blocked by #38: Add a settings screen']
    vi.mocked(api.tickets.checkStart).mockResolvedValue({
      triage: true,
      problems,
      overlap: [],
      ready: false
    })
    vi.mocked(api.tickets.applyTriage).mockRejectedValueOnce(new Error('GitHub is down'))
    renderDialog()
    await userEvent.click(await screen.findByRole('button', { name: 'Apply' }))
    expect(await screen.findByText('GitHub is down')).toBeInTheDocument()
    expect(screen.getByText(problems[0])).toBeInTheDocument()
    cleanup()

    vi.mocked(api.tickets.checkStart)
      .mockResolvedValueOnce({ triage: true, problems, overlap: [], ready: false })
      .mockRejectedValueOnce(new Error('Unknown ticket'))
    renderDialog()
    await userEvent.click(await screen.findByRole('button', { name: 'Apply' }))
    expect(await screen.findByText('Unknown ticket')).toBeInTheDocument()
    expect(screen.getByText(problems[0])).toBeInTheDocument()
  })

  it('titles a failed refresh after Apply as a failed check', async () => {
    vi.mocked(api.tickets.checkStart).mockResolvedValue({
      triage: true,
      problems: [],
      overlap: [],
      ready: false
    })
    vi.mocked(api.tickets.applyTriage).mockRejectedValue(
      new Error("Applied, but couldn't refresh the board: rate limited")
    )
    renderDialog()
    await userEvent.click(await screen.findByRole('button', { name: 'Apply' }))
    expect(await screen.findByText(`Couldn't check #${t.number}`)).toBeInTheDocument()
    expect(screen.queryByText("Couldn't apply the triage")).toBeNull()
  })

  it('announces each step to screen readers', async () => {
    vi.mocked(api.tickets.checkStart).mockResolvedValue({
      triage: true,
      problems: [],
      overlap: [],
      ready: false
    })
    vi.mocked(api.tickets.triage).mockReturnValue(new Promise(() => {}))
    renderDialog()
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Asking Claude for the area and blockers…'
    )
  })

  it('Cancel calls onClose and never onPass', async () => {
    let finish: (v: Awaited<ReturnType<SandtableApi['tickets']['triage']>>) => void = () => {}
    vi.mocked(api.tickets.checkStart).mockResolvedValue({
      triage: true,
      problems: [],
      overlap: [],
      ready: false
    })
    vi.mocked(api.tickets.triage).mockReturnValue(new Promise((r) => (finish = r)))
    const { onPass, onClose } = renderDialog()
    expect(await screen.findByText('Asking Claude for the area and blockers…')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    finish({ area: 'area: board', newAreas: [], blockedBy: [], reason: '' })
    await new Promise((r) => setTimeout(r))
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()
    expect(onPass).not.toHaveBeenCalled()
    expect(api.tickets.applyTriage).not.toHaveBeenCalled()
  })
})

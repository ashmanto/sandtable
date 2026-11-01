import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SandtableApi } from '../../../shared/api'
import { fakeSandtable, jiraProject, linearProject, project } from '../test/fixtures'
import { hasDraft } from '@/lib/ticketDrafts'
import { NewTicketComposer } from './NewTicketComposer'

let api: SandtableApi

beforeEach(() => {
  api = fakeSandtable()
})

const compose = (
  p = project
): { onDrafted: ReturnType<typeof vi.fn>; onClose: ReturnType<typeof vi.fn> } => {
  const onDrafted = vi.fn()
  const onClose = vi.fn()
  render(<NewTicketComposer project={p} onDrafted={onDrafted} onClose={onClose} />)
  return { onDrafted, onClose }
}

describe('NewTicketComposer', () => {
  it('focuses Title and creates the issue in the first repo, then clears for another', async () => {
    compose()
    expect(screen.getByRole('form', { name: 'New ticket' })).toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toHaveFocus()
    expect(screen.getByLabelText('Title')).toHaveAttribute('placeholder', 'Issue title')
    await userEvent.type(screen.getByLabelText('Description'), 'Follow the system.')
    await userEvent.type(screen.getByLabelText('Title'), 'Dark mode')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(api.tickets.create).toHaveBeenCalledWith(
      'p1',
      'octo/shop',
      'Dark mode',
      'Follow the system.',
      undefined
    )
    expect(screen.getByLabelText('Title')).toHaveValue('')
    expect(screen.getByLabelText('Description')).toHaveValue('')
    expect(screen.getByLabelText('Title')).toHaveFocus()
    expect(screen.getByRole('status')).toHaveTextContent('Created octo/shop#9')
  })

  it('creates on Enter in Title', async () => {
    compose()
    await userEvent.keyboard('Dark mode{Enter}')
    expect(api.tickets.create).toHaveBeenCalledWith('p1', 'octo/shop', 'Dark mode', '', undefined)
  })

  it('keeps the draft after unmounting until you cancel', async () => {
    const { unmount } = render(
      <NewTicketComposer project={project} onDrafted={vi.fn()} onClose={vi.fn()} />
    )
    await userEvent.type(screen.getByLabelText('Title'), 'Dark mode')
    await userEvent.type(screen.getByLabelText('Description'), 'Follow the system.')
    await userEvent.click(screen.getByRole('radio', { name: 'shop-web' }))
    unmount()
    expect(hasDraft(project.id)).toBe(true)
    compose()
    expect(screen.getByLabelText('Title')).toHaveValue('Dark mode')
    expect(screen.getByLabelText('Description')).toHaveValue('Follow the system.')
    expect(screen.getByRole('radio', { name: 'shop-web' })).toBeChecked()
    await userEvent.keyboard('{Escape}')
    expect(hasDraft(project.id)).toBe(false)
  })

  it('keeps a sub-issue draft per parent, apart from New ticket', async () => {
    render(
      <NewTicketComposer project={project} parent={{ key: 'k1', number: 1 }} onClose={vi.fn()} />
    )
    await userEvent.type(screen.getByLabelText('Title'), 'Child')
    expect(hasDraft(project.id, 'k1')).toBe(true)
    expect(hasDraft(project.id)).toBe(false)
  })

  it('drops the draft after creating or drafting', async () => {
    compose()
    await userEvent.keyboard('Dark mode{Enter}')
    expect(hasDraft(project.id)).toBe(false)
    await userEvent.keyboard('Light mode')
    await userEvent.click(screen.getByRole('button', { name: 'Draft with Claude' }))
    expect(hasDraft(project.id)).toBe(false)
  })

  it('cancels on Escape', async () => {
    const { onClose } = compose()
    await userEvent.keyboard('Dark{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('ignores Escape during an IME composition', () => {
    const { onClose } = compose()
    fireEvent.keyDown(screen.getByLabelText('Title'), { key: 'Escape', isComposing: true })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows the hint in fg-3', () => {
    compose()
    expect(screen.getByText('Esc to cancel')).toHaveClass('text-fg-3')
  })

  it('picks a repo with the arrow keys', async () => {
    compose()
    screen.getByRole('radio', { name: 'shop' }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: 'shop-web' })).toHaveFocus()
  })

  it('names repos in full when two share a short name', () => {
    compose({
      ...project,
      repos: [
        { github: 'octo/app', path: '/a' },
        { github: 'other/app', path: '/b' },
        { github: 'octo/web', path: '/c' }
      ]
    })
    expect(screen.getByRole('radio', { name: 'octo/app' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'other/app' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'web' })).toBeInTheDocument()
  })

  it('reads Starting while a draft starts', async () => {
    vi.mocked(api.sessions.create).mockReturnValue(new Promise(() => {}))
    compose()
    await userEvent.click(screen.getByRole('button', { name: 'Draft with Claude' }))
    expect(screen.getByRole('button', { name: 'Starting' })).toBeDisabled()
  })

  it("doesn't open the draft if the composer closed while it started", async () => {
    let started: (id: string) => void = () => {}
    vi.mocked(api.sessions.create).mockReturnValue(new Promise((resolve) => (started = resolve)))
    const onDrafted = vi.fn()
    const { unmount } = render(
      <NewTicketComposer project={project} onDrafted={onDrafted} onClose={vi.fn()} />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Draft with Claude' }))
    unmount()
    started('a1')
    await Promise.resolve()
    expect(onDrafted).not.toHaveBeenCalled()
  })

  it('drafts with Claude in the picked repo, seeded with what you typed', async () => {
    const { onDrafted } = compose()
    const repo = screen.getByRole('radiogroup', { name: 'Repo' })
    expect(screen.getByRole('radio', { name: 'shop', checked: true })).toBe(repo.firstChild)
    await userEvent.click(screen.getByRole('radio', { name: 'shop-web' }))
    expect(screen.getByRole('radio', { name: 'shop-web', checked: true })).toBeVisible()
    await userEvent.type(screen.getByLabelText('Title'), 'Dark mode')
    await userEvent.type(screen.getByLabelText('Description'), 'Follow the system.')
    await userEvent.click(screen.getByRole('button', { name: 'Draft with Claude' }))
    expect(api.sessions.create).toHaveBeenCalledWith('p1', 'octo/shop-web', false, {
      title: 'Dark mode',
      body: 'Follow the system.'
    })
    expect(onDrafted).toHaveBeenCalledWith('a1')
  })

  describe('on a Linear project', () => {
    const two = {
      ...linearProject,
      linear: {
        team: 'APP',
        projects: [
          { id: 'lp1', name: 'Launch' },
          { id: 'lp2', name: 'Web' }
        ]
      }
    }

    it('creates in the picked Linear project, with no Repo toggle', async () => {
      compose(two)
      expect(screen.queryByRole('radiogroup', { name: 'Repo' })).not.toBeInTheDocument()
      expect(screen.getByRole('radio', { name: 'Launch', checked: true })).toBeVisible()
      await userEvent.click(screen.getByRole('radio', { name: 'Web' }))
      await userEvent.type(screen.getByLabelText('Title'), 'Dark mode{Enter}')
      expect(api.tickets.create).toHaveBeenCalledWith('p1', 'lp2', 'Dark mode', '', undefined)
    })

    it('drafts in the first repo for the picked Linear project', async () => {
      compose(two)
      await userEvent.click(screen.getByRole('radio', { name: 'Web' }))
      await userEvent.click(screen.getByRole('button', { name: 'Draft with Claude' }))
      expect(api.sessions.create).toHaveBeenCalledWith('p1', linearProject.repos[0].github, false, {
        title: '',
        body: '',
        linearProject: 'lp2'
      })
    })

    it('files in the one Linear project without asking', async () => {
      compose(linearProject)
      expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
      await userEvent.type(screen.getByLabelText('Title'), 'Dark mode{Enter}')
      expect(api.tickets.create).toHaveBeenCalledWith('p1', 'lp1', 'Dark mode', '', undefined)
    })
  })

  describe('on a Jira project', () => {
    it('files in the Jira project without a Repo toggle', async () => {
      compose(jiraProject)
      expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
      await userEvent.type(screen.getByLabelText('Title'), 'Dark mode{Enter}')
      expect(api.tickets.create).toHaveBeenCalledWith('p1', '', 'Dark mode', '', undefined)
    })

    it('drafts in the first repo', async () => {
      compose(jiraProject)
      await userEvent.click(screen.getByRole('button', { name: 'Draft with Claude' }))
      expect(api.sessions.create).toHaveBeenCalledWith('p1', jiraProject.repos[0].github, false, {
        title: '',
        body: ''
      })
    })
  })

  it('has no Repo toggle with one repo', () => {
    compose({ ...project, repos: [project.repos[0]] })
    expect(screen.queryByRole('radiogroup', { name: 'Repo' })).not.toBeInTheDocument()
  })

  it('disables both buttons and ignores Escape while creating, and keeps a failure', async () => {
    let fail: (err: Error) => void = () => {}
    vi.mocked(api.tickets.create).mockReturnValue(new Promise((_, reject) => (fail = reject)))
    const { onClose } = compose()
    await userEvent.keyboard('Dark mode{Enter}')
    expect(screen.getByRole('button', { name: 'Creating' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Draft with Claude' })).toBeDisabled()
    await userEvent.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
    fail(new Error('Enter a title'))
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't create: Enter a title")
    expect(screen.getByLabelText('Title')).toHaveValue('Dark mode')
  })

  it('keeps a failed start, and clears it when the repo changes', async () => {
    vi.mocked(api.sessions.create).mockRejectedValue(new Error('tmux is missing'))
    const { onDrafted } = compose()
    await userEvent.click(screen.getByRole('button', { name: 'Draft with Claude' }))
    expect(await screen.findByText("Couldn't start: tmux is missing")).toBeInTheDocument()
    expect(onDrafted).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('radio', { name: 'shop-web' }))
    expect(screen.queryByText("Couldn't start: tmux is missing")).not.toBeInTheDocument()
  })

  it('offers only Close once the issue exists, so it cannot be filed twice', async () => {
    vi.mocked(api.tickets.create).mockRejectedValue(
      new Error("Created octo/shop#9, but couldn't refresh the board: rate limited")
    )
    const { onClose } = compose()
    await userEvent.keyboard('Dark mode{Enter}')
    expect(
      await screen.findByText("Created octo/shop#9, but couldn't refresh the board: rate limited")
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Draft with Claude' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toHaveAttribute('readonly')
    expect(screen.getByLabelText('Description')).toHaveAttribute('readonly')
    await userEvent.type(screen.getByLabelText('Title'), '{Enter}')
    await userEvent.click(screen.getByRole('radio', { name: 'shop-web' }))
    expect(screen.getByText(/couldn't refresh the board/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
    expect(api.tickets.create).toHaveBeenCalledTimes(1)
  })
})

describe('NewTicketComposer growth', () => {
  it('keeps the whole card in view as it grows', () => {
    let grew = (): void => {}
    const observed: Element[] = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          grew = cb
        }
        observe = (el: Element): void => void observed.push(el)
        disconnect = vi.fn()
      }
    )
    const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView')
    compose()
    const form = screen.getByRole('form', { name: 'New ticket' })
    expect(observed).toEqual([form])
    scrolled.mockClear()
    grew()
    expect(scrolled.mock.contexts).toEqual([form])
    expect(scrolled).toHaveBeenCalledWith({ block: 'nearest' })
    vi.unstubAllGlobals()
  })
})

import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SandtableApi } from '../../../shared/api'
import type { Routine, RoutineProposal, Step } from '../../../shared/types'
import { fakeSandtable, project } from '../test/fixtures'
import { RoutineEditor } from './RoutineEditor'

let api: SandtableApi

beforeEach(() => {
  api = fakeSandtable()
})

const triage: Routine = {
  id: 'r1',
  projectId: 'p1',
  name: 'triage',
  repo: 'octo/shop-web',
  worktree: true,
  message: 'Triage the inbox',
  schedule: { days: [1, 3], time: '18:00' }
}

const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

describe('RoutineEditor', () => {
  it('shows its fields in order with the schedule off', () => {
    render(<RoutineEditor project={project} onClose={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'New routine in Shop' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'Starts a session without a ticket with this first message, in one click, on a schedule, or when a ticket gets a label or its checks fail.'
      )
    ).toBeInTheDocument()
    const order = [
      screen.getByRole('textbox', { name: 'Name' }),
      screen.getByRole('radiogroup', { name: 'Repo' }),
      screen.getByRole('radiogroup', { name: 'Where it runs' }),
      screen.getByRole('textbox', { name: 'First message' }),
      screen.getByRole('textbox', { name: 'Allowed without asking' }),
      screen.getByRole('switch', { name: 'Run on a schedule' })
    ]
    order.slice(1).forEach((el, i) => {
      expect(order[i].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })
    expect(screen.getByRole('radio', { name: /Main checkout/ })).toBeChecked()
    expect(screen.getByText(/Runs in \/Users\/me\/projects\/shop, the folder/)).toBeInTheDocument()
    expect(
      screen.getByText('Gets its own branch and worktree, for changing code.')
    ).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Run on a schedule' })).not.toBeChecked()
    expect(screen.queryByRole('button', { name: 'Monday' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete routine' })).not.toBeInTheDocument()
  })

  it("falls back to the project's first repo when the routine's repo is gone", () => {
    render(
      <RoutineEditor
        project={project}
        routine={{ ...triage, repo: 'octo/gone' }}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByRole('radio', { name: project.repos[0].github })).toBeChecked()
    expect(screen.getByText(/Runs in \/Users\/me\/projects\/shop,/)).toBeInTheDocument()
  })

  it('has no Repo group with one repo', () => {
    render(<RoutineEditor project={{ ...project, repos: [project.repos[0]] }} onClose={vi.fn()} />)
    expect(screen.queryByRole('radiogroup', { name: 'Repo' })).not.toBeInTheDocument()
  })

  it('shows weekday toggles from Monday and a 02:00 time when scheduled', async () => {
    render(<RoutineEditor project={project} onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('switch', { name: 'Run on a schedule' }))
    expect(
      screen.getByText(
        'Starts while Sandtable is open and the Mac is awake. A time it misses is skipped.'
      )
    ).toBeInTheDocument()
    const toggles = screen.getAllByRole('button', { name: new RegExp(`^(${days.join('|')})$`) })
    expect(toggles.map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual(days)
    expect(toggles.map((b) => b.getAttribute('aria-pressed'))).toEqual([
      ...Array(5).fill('true'),
      'false',
      'false'
    ])
    expect(screen.getByLabelText('Time')).toHaveValue('02:00')
  })

  it('saves the typed values and closes', async () => {
    const onClose = vi.fn()
    render(<RoutineEditor project={project} onClose={onClose} />)
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'nightly')
    await userEvent.click(screen.getByRole('radio', { name: 'octo/shop-web' }))
    await userEvent.click(screen.getByRole('radio', { name: /New worktree/ }))
    await userEvent.type(screen.getByRole('textbox', { name: 'First message' }), 'Run the tests')
    await userEvent.click(screen.getByRole('switch', { name: 'Run on a schedule' }))
    await userEvent.click(screen.getByRole('button', { name: 'Friday' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sunday' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(api.routines.save).toHaveBeenCalledWith({
      projectId: 'p1',
      name: 'nightly',
      repo: 'octo/shop-web',
      worktree: true,
      message: 'Run the tests',
      schedule: { days: [1, 2, 3, 4, 0], time: '02:00' }
    })
    expect(api.routines.start).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('saves a trigger label, failing checks, and a daily cap', async () => {
    render(<RoutineEditor project={project} onClose={vi.fn()} />)
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'triage')
    await userEvent.type(screen.getByRole('textbox', { name: 'First message' }), 'Triage it')
    expect(
      screen.queryByRole('spinbutton', { name: 'Automatic starts a day' })
    ).not.toBeInTheDocument()
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Start when a ticket gets the label' }),
      'triage'
    )
    await userEvent.click(
      screen.getByRole('switch', { name: "Start when a pull request's checks fail" })
    )
    const cap = screen.getByRole('spinbutton', { name: 'Automatic starts a day' })
    expect(cap).toHaveValue(5)
    await userEvent.clear(cap)
    await userEvent.type(cap, '3')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(api.routines.save).toHaveBeenCalledWith(
      expect.objectContaining({ on: { label: 'triage', checksFail: true }, dailyCap: 3 })
    )
  })

  it('shows a saved trigger and saves no trigger when cleared', async () => {
    render(
      <RoutineEditor
        project={project}
        routine={{ ...triage, on: { label: 'bug' }, dailyCap: 2 }}
        onClose={vi.fn()}
      />
    )
    const label = screen.getByRole('textbox', { name: 'Start when a ticket gets the label' })
    expect(label).toHaveValue('bug')
    expect(screen.getByRole('spinbutton', { name: 'Automatic starts a day' })).toHaveValue(2)
    await userEvent.clear(label)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    const saved = vi.mocked(api.routines.save).mock.calls[0][0]
    expect(saved).not.toHaveProperty('on')
    expect(saved).not.toHaveProperty('dailyCap')
  })

  it('starts the saved routine with Save and start', async () => {
    const onClose = vi.fn()
    render(
      <RoutineEditor
        project={project}
        draft={{ repo: 'octo/shop', worktree: false, message: 'Look around' }}
        onClose={onClose}
      />
    )
    expect(screen.getByRole('textbox', { name: 'First message' })).toHaveValue('Look around')
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'explore')
    await userEvent.click(screen.getByRole('button', { name: 'Save and start' }))
    expect(api.routines.save).toHaveBeenCalledWith({
      projectId: 'p1',
      name: 'explore',
      repo: 'octo/shop',
      worktree: false,
      message: 'Look around'
    })
    expect(api.routines.start).toHaveBeenCalledWith('r1')
    expect(onClose).toHaveBeenCalled()
  })

  describe('a copy', () => {
    const copy = {
      name: 'triage',
      repo: 'octo/shop-web',
      worktree: true,
      message: 'Triage the inbox',
      allow: ['Bash(npm outdated)'],
      schedule: { days: [1, 3], time: '18:00' },
      copiedFrom: { project: 'Docs', repo: 'octo/shop-web' }
    }

    it('fills every field from the routine and saves a separate routine', async () => {
      const onClose = vi.fn()
      render(<RoutineEditor project={project} draft={copy} onClose={onClose} />)
      expect(screen.getByRole('heading', { name: 'New routine in Shop' })).toBeInTheDocument()
      expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('triage')
      expect(screen.getByRole('radio', { name: 'octo/shop-web' })).toBeChecked()
      expect(screen.getByRole('radio', { name: /New worktree/ })).toBeChecked()
      expect(screen.getByRole('textbox', { name: 'Allowed without asking' })).toHaveValue(
        'Bash(npm outdated)'
      )
      expect(screen.getByRole('switch', { name: 'Run on a schedule' })).toBeChecked()
      expect(screen.getByRole('button', { name: 'Wednesday' })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(api.routines.save).toHaveBeenCalledWith({
        projectId: 'p1',
        name: 'triage',
        repo: 'octo/shop-web',
        worktree: true,
        message: 'Triage the inbox',
        allow: ['Bash(npm outdated)'],
        schedule: { days: [1, 3], time: '18:00' }
      })
      expect(onClose).toHaveBeenCalled()
    })

    it('leaves the repo empty when the project lacks it', () => {
      render(
        <RoutineEditor project={project} draft={{ ...copy, repo: 'octo/docs' }} onClose={vi.fn()} />
      )
      for (const radio of within(screen.getByRole('radiogroup', { name: 'Repo' })).getAllByRole(
        'radio'
      ))
        expect(radio).not.toBeChecked()
    })

    it("uses a one-repo project's repo, and matches a repo in any case", async () => {
      const { unmount } = render(
        <RoutineEditor
          project={{ ...project, repos: [project.repos[0]] }}
          draft={{ ...copy, repo: 'octo/docs' }}
          onClose={vi.fn()}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(vi.mocked(api.routines.save).mock.lastCall?.[0].repo).toBe('octo/shop')
      unmount()
      render(
        <RoutineEditor
          project={project}
          draft={{ ...copy, repo: 'Octo/Shop-Web' }}
          onClose={vi.fn()}
        />
      )
      expect(screen.getByRole('radio', { name: 'octo/shop-web' })).toBeChecked()
    })

    it("tells Claude's chat where the routine came from", async () => {
      vi.mocked(api.routines.chat).mockResolvedValueOnce({ conversationId: 'rc1', reply: 'Hi' })
      render(<RoutineEditor project={project} draft={copy} onClose={vi.fn()} />)
      await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'Fit it{Enter}')
      expect(vi.mocked(api.routines.chat).mock.lastCall?.[0].copiedFrom).toEqual(copy.copiedFrom)
    })

    const docs = {
      ...copy,
      repo: 'octo/docs',
      copiedFrom: { project: 'Docs', repo: 'octo/docs' }
    }
    const fit = (repo: string): string =>
      `Fit this routine to ${repo}: check its first message and allowed rules against this repo's code.`

    it('warns that the routine was written for another repo and fills in the message', () => {
      render(
        <RoutineEditor
          project={{ ...project, repos: [project.repos[0]] }}
          draft={docs}
          onClose={vi.fn()}
        />
      )
      const note = screen.getByRole('note')
      expect(within(note).getByText('Written for Docs')).toBeInTheDocument()
      expect(note).toHaveTextContent(
        'Its commands and allowed rules come from octo/docs and might not work in octo/shop. Send the message to have Claude fit them.'
      )
      expect(screen.queryByText('Describe the routine')).not.toBeInTheDocument()
      expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue(fit('octo/shop'))
      expect(api.routines.chat).not.toHaveBeenCalled()
    })

    it('asks for a repo first, then fills in the message until you edit it', async () => {
      render(<RoutineEditor project={project} draft={docs} onClose={vi.fn()} />)
      expect(screen.getByRole('note')).toHaveTextContent(
        'might not work in this project. Pick a repo, then send the message to have Claude fit them.'
      )
      const box = screen.getByRole('textbox', { name: 'Message' })
      expect(box).toHaveValue('')
      await userEvent.click(screen.getByRole('radio', { name: 'octo/shop-web' }))
      expect(box).toHaveValue(fit('octo/shop-web'))
      await userEvent.type(box, ' Keep the schedule.')
      await userEvent.click(screen.getByRole('radio', { name: 'octo/shop' }))
      expect(box).toHaveValue(`${fit('octo/shop-web')} Keep the schedule.`)
      expect(api.routines.chat).not.toHaveBeenCalled()
    })

    it('shows the usual empty chat when the copy keeps its repo, in any case', () => {
      render(
        <RoutineEditor
          project={project}
          draft={{
            ...copy,
            copiedFrom: { project: 'Docs', repo: 'Octo/Shop-Web' }
          }}
          onClose={vi.fn()}
        />
      )
      expect(screen.queryByRole('note')).not.toBeInTheDocument()
      expect(screen.getByText('Describe the routine')).toBeInTheDocument()
      expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('')
    })

    it('drops the warning after the first message and brings it back on Start over', async () => {
      vi.mocked(api.routines.chat).mockResolvedValueOnce({ conversationId: 'rc1', reply: 'Done' })
      render(
        <RoutineEditor
          project={{ ...project, repos: [project.repos[0]] }}
          draft={docs}
          onClose={vi.fn()}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: 'Send' }))
      expect(await screen.findByText('Done')).toBeInTheDocument()
      expect(screen.queryByRole('note')).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Start over' }))
      expect(screen.getByRole('note')).toBeInTheDocument()
      expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue(fit('octo/shop'))
    })
  })

  it('keeps a failed save in the dialog', async () => {
    vi.mocked(api.routines.save).mockRejectedValue(
      new Error('Shop already has a routine named triage')
    )
    const onClose = vi.fn()
    render(<RoutineEditor project={project} onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(
      await screen.findByText("Couldn't save: Shop already has a routine named triage")
    ).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('edits a routine with its values and saves it under its id', async () => {
    render(<RoutineEditor project={project} routine={triage} onClose={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Edit triage' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'octo/shop-web' })).toBeChecked()
    expect(screen.getByRole('radio', { name: /New worktree/ })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Run on a schedule' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Wednesday' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByRole('button', { name: 'Tuesday' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByLabelText('Time')).toHaveValue('18:00')
    await userEvent.click(screen.getByRole('switch', { name: 'Run on a schedule' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(api.routines.save).toHaveBeenCalledWith({
      id: 'r1',
      projectId: 'p1',
      name: 'triage',
      repo: 'octo/shop-web',
      worktree: true,
      message: 'Triage the inbox'
    })
  })

  it('saves one allowed rule per line and shows the saved ones when editing', async () => {
    render(
      <RoutineEditor
        project={project}
        routine={{ ...triage, schedule: undefined, allow: ['Read', 'Bash(npm outdated)'] }}
        onClose={vi.fn()}
      />
    )
    const field = screen.getByRole('textbox', { name: 'Allowed without asking' })
    expect(field).toHaveValue('Read\nBash(npm outdated)')
    expect(field).toHaveAccessibleDescription(
      "One permission rule per line, such as Bash(npm audit:*). Only this routine's sessions use them without asking."
    )
    await userEvent.type(field, '{Enter}{Enter}  Bash(npm audit:*) ')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(api.routines.save).toHaveBeenCalledWith(
      expect.objectContaining({ allow: ['Read', 'Bash(npm outdated)', 'Bash(npm audit:*)'] })
    )
  })

  it('deletes a routine after asking', async () => {
    const onClose = vi.fn()
    render(<RoutineEditor project={project} routine={triage} onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: 'Delete routine' }))
    expect(screen.getByRole('heading', { name: 'Delete triage?' })).toBeInTheDocument()
    expect(
      screen.getByText('The sessions it started stay. Its skipped times are deleted.')
    ).toBeInTheDocument()
    expect(api.routines.remove).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(api.routines.remove).toHaveBeenCalledWith('r1')
    expect(onClose).toHaveBeenCalled()
  })

  describe('chat', () => {
    const proposal: RoutineProposal = {
      name: 'deps',
      repo: 'octo/shop-web',
      worktree: true,
      message: 'Run npm outdated',
      allow: ['Bash(npm outdated)'],
      schedule: { days: [1], time: '09:00' }
    }
    const reply = (routine: Partial<RoutineProposal> | null = {}, text = 'Here it is'): void => {
      vi.mocked(api.routines.chat).mockResolvedValueOnce({
        conversationId: 'rc1',
        reply: text,
        ...(routine && { routine: { ...proposal, ...routine } })
      })
    }
    const send = async (text: string): Promise<void> => {
      await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), `${text}{Enter}`)
    }

    it('starts empty and sends a message with the form', async () => {
      const scrolled = vi.spyOn(Element.prototype, 'scrollTo')
      let answer: (r: { conversationId: string; reply: string }) => void = () => {}
      vi.mocked(api.routines.chat).mockReturnValueOnce(new Promise((r) => (answer = r)))
      render(<RoutineEditor project={project} onClose={vi.fn()} />)
      expect(screen.getByRole('heading', { name: 'Build with Claude' })).toBeInTheDocument()
      expect(screen.getByText('Describe the routine')).toBeInTheDocument()
      expect(
        screen.getByText(
          "Claude reads the repo's code, asks what it needs, and fills in the fields. Nothing is saved until you click Save."
        )
      ).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Start over' })).not.toBeInTheDocument()
      await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'nightly')
      await send('Check the deps')
      expect(scrolled).toHaveBeenCalledWith({ top: 0, behavior: 'instant' })
      expect(api.routines.chat).toHaveBeenCalledWith({
        projectId: 'p1',
        repo: 'octo/shop',
        message: 'Check the deps',
        runId: expect.any(String),
        form: {
          name: 'nightly',
          repo: 'octo/shop',
          worktree: false,
          message: '',
          allow: [],
          schedule: null
        }
      })
      expect(screen.getByRole('status')).toHaveTextContent('Claude is answering')
      expect(screen.getByRole('textbox', { name: 'Message' })).toBeDisabled()
      expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Save and start' })).toBeDisabled()
      answer({ conversationId: 'rc1', reply: 'Which script?' })
      expect(await screen.findByText('Which script?')).toBeInTheDocument()
      await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
      expect(screen.getByRole('button', { name: 'Save and start' })).toBeEnabled()
      expect(screen.getByText('Check the deps')).toBeInTheDocument()
      expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('')
      expect(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus()
      expect(screen.queryByText('Changed by Claude')).not.toBeInTheDocument()
    })

    it("fills untouched fields from the reply's routine and marks them, but waits on its rules", async () => {
      reply()
      render(<RoutineEditor project={project} onClose={vi.fn()} />)
      await send('Check the deps every Monday')
      expect(await screen.findByText('Here it is')).toBeInTheDocument()
      expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('deps')
      expect(screen.getByRole('radio', { name: 'octo/shop-web' })).toBeChecked()
      expect(screen.getByRole('radio', { name: /New worktree/ })).toBeChecked()
      expect(screen.getByRole('textbox', { name: 'First message' })).toHaveValue('Run npm outdated')
      const rules = screen.getByRole('textbox', { name: 'Allowed without asking' })
      expect(rules).toHaveValue('')
      expect(screen.getByRole('switch', { name: 'Run on a schedule' })).toBeChecked()
      expect(screen.getByRole('button', { name: 'Monday' })).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByRole('button', { name: 'Tuesday' })).toHaveAttribute(
        'aria-pressed',
        'false'
      )
      expect(screen.getByLabelText('Time')).toHaveValue('09:00')
      expect(screen.getAllByText('Changed by Claude')).toHaveLength(5)
      expect(
        screen.getByText('Changed: Name, Repo, Where it runs, First message, Run on a schedule')
      ).toBeInTheDocument()
      expect(screen.getByText('Suggested: Allowed without asking')).toBeInTheDocument()
      const offer = screen.getByRole('group', {
        name: "Claude's suggestion for Allowed without asking"
      })
      expect(offer).toHaveTextContent(/^Claude suggests:Bash\(npm outdated\)/)
      await userEvent.click(within(offer).getByRole('button', { name: "Use Claude's" }))
      expect(rules).toHaveValue('Bash(npm outdated)')
      expect(screen.getAllByText('Changed by Claude')).toHaveLength(6)
      expect(api.routines.save).not.toHaveBeenCalled()
    })

    it("offers Claude's value for a field you edited, with Use Claude's and Keep mine", async () => {
      reply({ repo: 'octo/gone', worktree: false, allow: [], schedule: null })
      render(<RoutineEditor project={project} onClose={vi.fn()} />)
      await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'mine')
      await userEvent.type(screen.getByRole('textbox', { name: 'First message' }), 'My words')
      await send('Make it')
      await screen.findByText('Here it is')
      expect(screen.getByText('Suggested: Name, First message')).toBeInTheDocument()
      expect(screen.getByText('Not in this project: octo/gone')).toBeInTheDocument()
      expect(screen.queryByText(/^Changed:/)).not.toBeInTheDocument()
      expect(screen.getByRole('radio', { name: 'octo/shop' })).toBeChecked()
      expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('mine')
      const name = screen.getByRole('group', { name: "Claude's suggestion for Name" })
      expect(name).toHaveTextContent('You edited this field. Claude suggests:')
      expect(name).toHaveTextContent('deps')
      await userEvent.click(within(name).getByRole('button', { name: "Use Claude's" }))
      expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('deps')
      expect(screen.getAllByText('Changed by Claude')).toHaveLength(1)
      const message = screen.getByRole('group', { name: "Claude's suggestion for First message" })
      expect(message).toHaveTextContent('Run npm outdated')
      await userEvent.click(within(message).getByRole('button', { name: 'Keep mine' }))
      expect(screen.queryByRole('group', { name: /Claude's suggestion/ })).not.toBeInTheDocument()
      expect(screen.getByRole('textbox', { name: 'First message' })).toHaveValue('My words')
    })

    it('sends the returned conversation and your edits on the next turn', async () => {
      reply({ schedule: null })
      render(<RoutineEditor project={project} onClose={vi.fn()} />)
      await send('Check the deps')
      await screen.findByText('Here it is')
      const message = screen.getByRole('textbox', { name: 'First message' })
      await userEvent.type(message, ' and audit')
      expect(screen.getAllByText('Changed by Claude')).toHaveLength(3)
      reply(null, 'Got it')
      await send('Looks good')
      await screen.findByText('Got it')
      expect(api.routines.chat).toHaveBeenLastCalledWith({
        projectId: 'p1',
        conversationId: 'rc1',
        repo: 'octo/shop-web',
        message: 'Looks good',
        runId: expect.any(String),
        form: { ...proposal, message: 'Run npm outdated and audit', allow: [], schedule: null }
      })
      expect(screen.getAllByText('Changed by Claude')).toHaveLength(3)
    })

    it('starts over with the fields kept and the marks and offers cleared', async () => {
      reply({ schedule: null })
      render(<RoutineEditor project={project} onClose={vi.fn()} />)
      await send('Check the deps')
      await screen.findByText('Here it is')
      expect(screen.getAllByText('Changed by Claude')).toHaveLength(4)
      await userEvent.click(screen.getByRole('button', { name: 'Start over' }))
      expect(screen.queryByText('Changed by Claude')).not.toBeInTheDocument()
      expect(screen.queryByRole('group', { name: /Claude's suggestion/ })).not.toBeInTheDocument()
      expect(screen.queryByText('Here it is')).not.toBeInTheDocument()
      expect(screen.getByText('Describe the routine')).toBeInTheDocument()
      expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('deps')
      expect(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus()
      await send('Again')
      expect(vi.mocked(api.routines.chat).mock.lastCall?.[0].conversationId).toBeUndefined()
    })

    it("shows Claude's latest step beside the status and Stop puts the message back", async () => {
      let fail: (err: Error) => void = () => {}
      vi.mocked(api.routines.chat).mockReturnValueOnce(new Promise((_, reject) => (fail = reject)))
      let push: (runId: string, steps: Step[]) => void = () => {}
      vi.mocked(api.routines.onChatSteps).mockImplementation((cb) => {
        push = cb
        return () => {}
      })
      render(<RoutineEditor project={project} onClose={vi.fn()} />)
      await send('Check the deps')
      const { runId } = vi.mocked(api.routines.chat).mock.lastCall![0]
      act(() => push('other', [{ tool: 'Grep', target: 'nope', at: null }]))
      act(() => push(runId, [{ tool: 'Read', target: 'package.json', at: null }]))
      expect(screen.getByTitle('Reading package.json')).toBeInTheDocument()
      expect(screen.queryByTitle('Searching nope')).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Stop' }))
      expect(api.routines.stopChat).toHaveBeenCalledWith(runId)
      await act(async () => fail(new Error('Routine chat stopped')))
      const box = screen.getByRole('textbox', { name: 'Message' })
      await waitFor(() => expect(box).toBeEnabled())
      expect(box).toHaveValue('Check the deps')
      expect(box).toHaveFocus()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.queryByTitle('Reading package.json')).not.toBeInTheDocument()
    })

    it('shows a failed turn', async () => {
      vi.mocked(api.routines.chat).mockRejectedValueOnce(
        new Error('This chat is gone. Use Start over.')
      )
      render(<RoutineEditor project={project} onClose={vi.fn()} />)
      await send('Hi')
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'This chat is gone. Use Start over.'
      )
      expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Hi')
      expect(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus()
    })

    const unchanged = { repo: 'octo/shop', worktree: false, allow: [], schedule: null }

    it('keeps an edit you made while Claude was answering', async () => {
      let answer: (r: {
        conversationId: string
        reply: string
        routine: RoutineProposal
      }) => void = () => {}
      vi.mocked(api.routines.chat).mockReturnValueOnce(new Promise((r) => (answer = r)))
      render(<RoutineEditor project={project} onClose={vi.fn()} />)
      await send('Make it')
      await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'mine')
      answer({
        conversationId: 'rc1',
        reply: 'Here it is',
        routine: { ...proposal, ...unchanged, name: '' }
      })
      await screen.findByText('Here it is')
      expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('mine')
      expect(screen.queryByRole('group', { name: /Claude's suggestion/ })).not.toBeInTheDocument()
      expect(screen.getByText('Changed: First message')).toBeInTheDocument()
    })

    it("uses Claude's main checkout and no schedule over yours", async () => {
      reply({
        name: '',
        message: '',
        allow: [],
        worktree: false,
        schedule: null,
        repo: 'octo/shop'
      })
      render(<RoutineEditor project={project} onClose={vi.fn()} />)
      await userEvent.click(screen.getByRole('radio', { name: /New worktree/ }))
      await userEvent.click(screen.getByRole('switch', { name: 'Run on a schedule' }))
      await send('Make it')
      await screen.findByText('Here it is')
      const where = screen.getByRole('group', { name: "Claude's suggestion for Where it runs" })
      expect(where).toHaveTextContent('Main checkout')
      const schedule = screen.getByRole('group', {
        name: "Claude's suggestion for Run on a schedule"
      })
      expect(schedule).toHaveTextContent('Not scheduled')
      await userEvent.click(within(where).getByRole('button', { name: "Use Claude's" }))
      await userEvent.click(within(schedule).getByRole('button', { name: "Use Claude's" }))
      expect(screen.getByRole('radio', { name: /Main checkout/ })).toBeChecked()
      expect(screen.getByRole('switch', { name: 'Run on a schedule' })).not.toBeChecked()
      expect(screen.getAllByText('Changed by Claude')).toHaveLength(2)
    })

    it('replaces the marks on the next reply and drops an offer Claude no longer makes', async () => {
      reply(unchanged)
      render(<RoutineEditor project={project} onClose={vi.fn()} />)
      await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'mine')
      await send('Make it')
      await screen.findByText('Here it is')
      expect(
        screen.getByRole('group', { name: "Claude's suggestion for Name" })
      ).toBeInTheDocument()
      reply({ ...unchanged, name: 'mine', worktree: true }, 'Better')
      await send('Keep my name')
      await screen.findByText('Better')
      expect(screen.queryByRole('group', { name: /Claude's suggestion/ })).not.toBeInTheDocument()
      expect(screen.getAllByText('Changed by Claude')).toHaveLength(1)
      expect(screen.getByText('Changed: Where it runs')).toBeInTheDocument()
    })

    it('drops a repo offer when Claude names a repo the project lacks', async () => {
      reply(unchanged)
      render(<RoutineEditor project={project} onClose={vi.fn()} />)
      await userEvent.click(screen.getByRole('radio', { name: 'octo/shop-web' }))
      await send('Make it')
      await screen.findByText('Here it is')
      expect(
        screen.getByRole('group', { name: "Claude's suggestion for Repo" })
      ).toBeInTheDocument()
      reply({ ...unchanged, repo: 'octo/gone' }, 'Moved')
      await send('Use the other one')
      await screen.findByText('Moved')
      expect(screen.queryByRole('group', { name: "Claude's suggestion for Repo" })).toBeNull()
      expect(screen.getByText('Not in this project: octo/gone')).toBeInTheDocument()
      expect(screen.getByRole('radio', { name: 'octo/shop-web' })).toBeChecked()
    })

    it('shows why offered rules would be refused', async () => {
      reply({ ...unchanged, allow: ['Bash'] })
      render(<RoutineEditor project={project} onClose={vi.fn()} />)
      await userEvent.type(screen.getByRole('textbox', { name: 'Allowed without asking' }), 'Read')
      await send('Make it')
      await screen.findByText('Here it is')
      expect(
        screen.getByRole('group', { name: "Claude's suggestion for Allowed without asking" })
      ).toHaveTextContent(
        'Bash lets the session run any command. Name the commands, such as Bash(npm outdated)'
      )
    })

    it('names the chat by its heading', () => {
      render(<RoutineEditor project={project} onClose={vi.fn()} />)
      expect(screen.getByRole('region', { name: 'Build with Claude' })).toBeInTheDocument()
    })
  })

  it('shows a refused allowed rule as you type', async () => {
    render(<RoutineEditor project={project} onClose={vi.fn()} />)
    const field = screen.getByRole('textbox', { name: 'Allowed without asking' })
    await userEvent.type(field, 'Bash')
    expect(field).toHaveAccessibleDescription(
      'Bash lets the session run any command. Name the commands, such as Bash(npm outdated)'
    )
    await userEvent.type(field, '(npm outdated)')
    expect(field).toHaveAccessibleDescription(/^One permission rule per line/)
  })
})

import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SandtableApi } from '../../../shared/api'
import type { SetupProgress } from '../../../shared/types'
import { SETUP_CANCELLED, SETUP_FAILED } from '../../../shared/worktreeSetup'
import { fakeSandtable, project } from '../test/fixtures'
import { NewSessionDialog } from './NewSessionDialog'

let api: SandtableApi
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

beforeEach(() => {
  api = fakeSandtable()
})

describe('NewSessionDialog', () => {
  it('starts in the main checkout of the only repo without asking for a repo', async () => {
    const one = { ...project, repos: [project.repos[0]] }
    const onCreated = vi.fn()
    render(
      <NewSessionDialog project={one} onCreated={onCreated} onClose={vi.fn()} onRoutine={vi.fn()} />
    )
    expect(screen.getByRole('heading', { name: 'New session in Shop' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'Runs Claude Code with no ticket. Leave the first message empty to type it in the terminal.'
      )
    ).toBeInTheDocument()
    expect(screen.queryByRole('radiogroup', { name: 'Repo' })).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Main checkout/ })).toBeChecked()
    expect(screen.getByText(/Runs in \/Users\/me\/projects\/shop, the folder/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(api.sessions.create).toHaveBeenCalledWith(
      'p1',
      'octo/shop',
      false,
      undefined,
      '',
      null,
      expect.stringMatching(UUID),
      undefined
    )
    expect(onCreated).toHaveBeenCalledWith('a1')
  })

  it('starts in a new worktree of the picked repo', async () => {
    render(
      <NewSessionDialog
        project={project}
        onCreated={vi.fn()}
        onClose={vi.fn()}
        onRoutine={vi.fn()}
      />
    )
    await userEvent.click(screen.getByRole('radio', { name: 'octo/shop-web' }))
    expect(screen.getByText(/Runs in \/Users\/me\/projects\/shop-web,/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: /New worktree/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(api.sessions.create).toHaveBeenCalledWith(
      'p1',
      'octo/shop-web',
      true,
      undefined,
      '',
      null,
      expect.stringMatching(UUID),
      undefined
    )
  })

  it.each([
    [null, 'sonnet'],
    ['Opus', 'opus'],
    ['Account default', null]
  ] as const)('on a Sonnet project, picking %s starts with model %s', async (name, model) => {
    render(
      <NewSessionDialog
        project={{ ...project, model: 'sonnet' }}
        onCreated={vi.fn()}
        onClose={vi.fn()}
        onRoutine={vi.fn()}
      />
    )
    const group = screen.getByRole('radiogroup', { name: 'Model' })
    expect(within(group).getByRole('radio', { name: 'Sonnet' })).toBeChecked()
    if (name) await userEvent.click(within(group).getByRole('radio', { name }))
    await userEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(api.sessions.create).toHaveBeenCalledWith(
      'p1',
      'octo/shop',
      false,
      undefined,
      '',
      model,
      expect.stringMatching(UUID),
      undefined
    )
  })

  it('passes a typed first message to the session', async () => {
    render(
      <NewSessionDialog
        project={project}
        onCreated={vi.fn()}
        onClose={vi.fn()}
        onRoutine={vi.fn()}
      />
    )
    await userEvent.type(screen.getByRole('textbox', { name: 'First message' }), 'Find the leak')
    await userEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(api.sessions.create).toHaveBeenCalledWith(
      'p1',
      'octo/shop',
      false,
      undefined,
      'Find the leak',
      null,
      expect.stringMatching(UUID),
      undefined
    )
  })

  it('hands its values to the routine editor with Save as routine', async () => {
    const onRoutine = vi.fn()
    const onClose = vi.fn()
    render(
      <NewSessionDialog
        project={project}
        onCreated={vi.fn()}
        onClose={onClose}
        onRoutine={onRoutine}
      />
    )
    await userEvent.click(screen.getByRole('radio', { name: 'octo/shop-web' }))
    await userEvent.click(screen.getByRole('radio', { name: /New worktree/ }))
    await userEvent.type(screen.getByRole('textbox', { name: 'First message' }), 'Nightly check')
    await userEvent.click(screen.getByRole('radio', { name: 'Haiku' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save as routine' }))
    expect(onRoutine).toHaveBeenCalledWith(project, undefined, {
      repo: 'octo/shop-web',
      worktree: true,
      message: 'Nightly check',
      model: 'haiku'
    })
    expect(onClose).toHaveBeenCalled()
    expect(api.sessions.create).not.toHaveBeenCalled()
  })

  it('hands Account default to Save as routine as no model', async () => {
    const onRoutine = vi.fn()
    render(
      <NewSessionDialog
        project={{ ...project, model: 'opus' }}
        onCreated={vi.fn()}
        onClose={vi.fn()}
        onRoutine={onRoutine}
      />
    )
    await userEvent.click(screen.getByRole('radio', { name: 'Account default' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save as routine' }))
    expect(onRoutine).toHaveBeenCalledWith(
      expect.anything(),
      undefined,
      expect.objectContaining({ model: null })
    )
  })

  it('moves between the Where choices with the arrow keys', async () => {
    render(
      <NewSessionDialog
        project={project}
        onCreated={vi.fn()}
        onClose={vi.fn()}
        onRoutine={vi.fn()}
      />
    )
    await userEvent.click(screen.getByRole('radio', { name: /Main checkout/ }))
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('radio', { name: /New worktree/ })).toBeChecked()
  })

  it('keeps a failure in the dialog', async () => {
    let fail: (err: Error) => void = () => {}
    vi.mocked(api.sessions.create).mockReturnValue(new Promise((_, reject) => (fail = reject)))
    const onCreated = vi.fn()
    render(
      <NewSessionDialog
        project={project}
        onCreated={onCreated}
        onClose={vi.fn()}
        onRoutine={vi.fn()}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(screen.getByRole('button', { name: 'Starting' })).toBeDisabled()
    fail(new Error('Repo not in this project'))
    expect(await screen.findByText("Couldn't start: Repo not in this project")).toBeInTheDocument()
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('cannot be closed while starting', async () => {
    let finish: (id: string) => void = () => {}
    vi.mocked(api.sessions.create).mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const onClose = vi.fn()
    render(
      <NewSessionDialog
        project={project}
        onCreated={vi.fn()}
        onClose={onClose}
        onRoutine={vi.fn()}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
    finish('a1')
  })

  describe('worktree setup', () => {
    let push: (target: string, p: SetupProgress | null) => void = () => {}
    const failed: SetupProgress = {
      repo: 'octo/shop',
      state: 'failed',
      notes: [],
      lines: [],
      error: 'npm install exited with code 1',
      startedAt: new Date().toISOString()
    }
    const startFailing = async (
      onClose = vi.fn()
    ): Promise<{ setupId: string; onCreated: ReturnType<typeof vi.fn> }> => {
      vi.mocked(api.setup.onProgress).mockImplementation((cb) => {
        push = cb
        return () => {}
      })
      let fail: (err: Error) => void = () => {}
      vi.mocked(api.sessions.create).mockReturnValueOnce(
        new Promise((_, reject) => (fail = reject))
      )
      const onCreated = vi.fn()
      render(
        <NewSessionDialog
          project={project}
          onCreated={onCreated}
          onClose={onClose}
          onRoutine={vi.fn()}
        />
      )
      await userEvent.click(screen.getByRole('radio', { name: /New worktree/ }))
      await userEvent.click(screen.getByRole('button', { name: 'Start' }))
      const setupId = vi.mocked(api.sessions.create).mock.calls[0][6] as string
      act(() => push(setupId, { ...failed, state: 'running' }))
      expect(screen.getByRole('status')).toHaveTextContent('Copying files into the worktree')
      act(() => push(setupId, failed))
      await act(async () => fail(new Error(`${SETUP_FAILED}: npm install exited with code 1`)))
      return { setupId, onCreated }
    }

    it('shows the failed setup, and Start anyway starts again without setup', async () => {
      const { setupId, onCreated } = await startFailing()
      expect(setupId).toMatch(UUID)
      expect(screen.getByText('Setup failed: npm install exited with code 1')).toBeInTheDocument()
      expect(screen.queryByText(/Couldn't start/)).toBeNull()
      await userEvent.click(screen.getByRole('radio', { name: 'octo/shop-web' }))
      let finish: (id: string) => void = () => undefined
      vi.mocked(api.sessions.create).mockReturnValueOnce(new Promise((r) => (finish = r)))
      await userEvent.click(screen.getByRole('button', { name: 'Start anyway' }))
      expect(screen.queryByRole('button', { name: 'Start anyway' })).toBeNull()
      expect(screen.queryByText(/Setup failed/)).toBeNull()
      expect(api.sessions.create).toHaveBeenCalledTimes(2)
      finish('a1')
      expect(api.sessions.create).toHaveBeenLastCalledWith(
        'p1',
        'octo/shop',
        true,
        undefined,
        '',
        null,
        setupId,
        false
      )
      await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith('a1'))
    })

    it('Cancel cancels the setup and goes back to the form', async () => {
      const { setupId } = await startFailing()
      await userEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0])
      expect(api.setup.cancel).toHaveBeenCalledWith(setupId)
      act(() => push(setupId, null))
      expect(screen.queryByText(/Setup failed/)).toBeNull()
      expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled()
    })

    it("shows why Cancel couldn't cancel the setup", async () => {
      await startFailing()
      vi.mocked(api.setup.cancel).mockRejectedValueOnce(new Error('main is gone'))
      await userEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0])
      expect(await screen.findByText("Couldn't cancel the setup: main is gone")).toBeInTheDocument()
    })

    it('closing the dialog after a failure cancels the setup', async () => {
      const onClose = vi.fn()
      const { setupId } = await startFailing(onClose)
      await userEvent.keyboard('{Escape}')
      expect(api.setup.cancel).toHaveBeenCalledWith(setupId)
      expect(onClose).toHaveBeenCalled()
    })

    it('closing the dialog after Start anyway fails cancels the setup', async () => {
      const onClose = vi.fn()
      const { setupId } = await startFailing(onClose)
      vi.mocked(api.sessions.create).mockRejectedValueOnce(new Error('tmux died'))
      await userEvent.click(screen.getByRole('button', { name: 'Start anyway' }))
      expect(await screen.findByText("Couldn't start: tmux died")).toBeInTheDocument()
      await userEvent.keyboard('{Escape}')
      expect(api.setup.cancel).toHaveBeenCalledWith(setupId)
      expect(onClose).toHaveBeenCalled()
    })

    it('keeps Start off until Cancel finishes', async () => {
      await startFailing()
      let done = (): void => undefined
      vi.mocked(api.setup.cancel).mockReturnValueOnce(new Promise<void>((r) => (done = r)))
      await userEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0])
      expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
      await act(async () => done())
      expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled()
    })

    it('shows nothing when the setup is cancelled', async () => {
      vi.mocked(api.sessions.create).mockRejectedValueOnce(new Error(SETUP_CANCELLED))
      render(
        <NewSessionDialog
          project={project}
          onCreated={vi.fn()}
          onClose={vi.fn()}
          onRoutine={vi.fn()}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: 'Start' }))
      expect(await screen.findByRole('button', { name: 'Start' })).toBeEnabled()
      expect(screen.queryByText(/Couldn't start/)).toBeNull()
    })
  })
})

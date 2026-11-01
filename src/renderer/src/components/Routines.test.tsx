import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import type { SandtableApi } from '../../../shared/api'
import type { Routine, RoutineRun, SessionRecord } from '../../../shared/types'
import { adhoc, fakeSandtable, project } from '../test/fixtures'
import { Routines } from './Routines'

let api: SandtableApi

beforeEach(() => {
  api = fakeSandtable()
})

const nightly: Routine = {
  id: 'r1',
  projectId: 'p1',
  name: 'Nightly',
  repo: 'octo/shop',
  worktree: true,
  message: 'Check dependencies',
  schedule: { days: [1, 2, 3, 4, 5], time: '02:00' }
}
const triage: Routine = { ...nightly, id: 'r2', name: 'Triage', schedule: undefined }
const other = { ...project, id: 'p2', name: 'Docs' }

function renderRoutines(
  routines: Routine[] = [nightly, triage],
  sessions: SessionRecord[] = []
): { onRoutine: ReturnType<typeof vi.fn>; onOpenSession: ReturnType<typeof vi.fn> } {
  const onRoutine = vi.fn()
  const onOpenSession = vi.fn()
  render(
    <Routines
      project={project}
      projects={[project, other]}
      routines={routines}
      sessions={sessions}
      onRoutine={onRoutine}
      onOpenSession={onOpenSession}
    />
  )
  return { onRoutine, onOpenSession }
}

const section = (): HTMLElement => screen.getByRole('region', { name: 'Routines' })

describe('Routines', () => {
  it('shows the heading and count, a pill per routine with a clock for a schedule, and New routine', async () => {
    const { onRoutine } = renderRoutines()
    expect(within(section()).getByRole('heading')).toHaveTextContent('Routines2')
    const start = screen.getByRole('button', { name: 'Start Nightly. Runs weekdays at 02:00.' })
    expect(start).toHaveTextContent(/^Nightly$/)
    expect(within(start).getByRole('img', { name: 'Runs weekdays at 02:00' })).toBeInTheDocument()
    const triage = screen.getByRole('button', { name: 'Start Triage' })
    expect(triage).toHaveTextContent(/^Triage$/)
    expect(within(triage).queryByRole('img')).not.toBeInTheDocument()
    await userEvent.hover(start)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Start Nightly. Runs weekdays at 02:00.'
    )
    await userEvent.click(screen.getByRole('button', { name: /New routine/ }))
    expect(onRoutine).toHaveBeenCalledWith(project)
  })

  it('names the clock with any schedule, and shows the tooltip on focus', async () => {
    renderRoutines([
      { ...nightly, schedule: { days: [1, 2, 3, 4, 5, 6, 0], time: '02:00' } },
      { ...triage, schedule: { days: [1, 3], time: '18:00' } }
    ])
    expect(screen.getByRole('img', { name: 'Runs every day at 02:00' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Runs Mon, Wed at 18:00' })).toBeInTheDocument()
    await userEvent.tab()
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Start Nightly. Runs every day at 02:00.'
    )
  })

  it('shows a count of 0 with no routines', () => {
    renderRoutines([])
    expect(within(section()).getByRole('heading')).toHaveTextContent('Routines0')
    expect(screen.getByRole('button', { name: /New routine/ })).toBeInTheDocument()
  })

  it('starts a routine on a click', async () => {
    renderRoutines()
    await userEvent.click(
      screen.getByRole('button', { name: 'Start Nightly. Runs weekdays at 02:00.' })
    )
    expect(api.routines.start).toHaveBeenCalledWith('r1')
  })

  it("shows its last session's state and starts nothing while that session is open", async () => {
    for (const [state, word] of [
      ['needsYou', 'Needs you'],
      ['idle', 'Idle'],
      ['running', 'Running']
    ] as const) {
      const { unmount } = render(
        <Routines
          project={project}
          projects={[project]}
          routines={[nightly]}
          sessions={[adhoc({ routineId: 'r1', state })]}
          onRoutine={vi.fn()}
          onOpenSession={vi.fn()}
        />
      )
      const pill = screen.getByRole('button', {
        name: "Nightly's last session is still open. Runs weekdays at 02:00."
      })
      expect(pill).toHaveAttribute('aria-disabled', 'true')
      expect(pill).toHaveTextContent(word)
      expect(pill).not.toHaveTextContent('Weekdays')
      expect(within(pill).getByRole('img', { name: 'Runs weekdays at 02:00' })).toBeInTheDocument()
      await userEvent.click(pill)
      expect(api.routines.start).not.toHaveBeenCalled()
      unmount()
    }
  })

  it('shows Done while its last session is open and still starts a run', async () => {
    render(
      <Routines
        project={project}
        projects={[project]}
        routines={[nightly]}
        sessions={[adhoc({ routineId: 'r1', state: 'done' })]}
        onRoutine={vi.fn()}
        onOpenSession={vi.fn()}
      />
    )
    const pill = screen.getByRole('button', {
      name: 'Start Nightly. Its last run is done. Runs weekdays at 02:00.'
    })
    expect(pill).not.toHaveAttribute('aria-disabled')
    expect(pill).toHaveTextContent('Done')
    await userEvent.click(pill)
    expect(api.routines.start).toHaveBeenCalledWith('r1')
  })

  it('shows the open session that holds the next run over a newer Done one', () => {
    render(
      <Routines
        project={project}
        projects={[project]}
        routines={[nightly]}
        sessions={[
          adhoc({ id: 's1', routineId: 'r1', state: 'needsYou' }),
          adhoc({ id: 's2', routineId: 'r1', state: 'done' })
        ]}
        onRoutine={vi.fn()}
        onOpenSession={vi.fn()}
      />
    )
    expect(
      screen.getByRole('button', {
        name: "Nightly's last session is still open. Runs weekdays at 02:00."
      })
    ).toHaveTextContent('Needs you')
  })

  it('reads Starting and ignores a second click while it starts', async () => {
    let done = (): void => undefined
    vi.mocked(api.routines.start).mockImplementation(
      () => new Promise((r) => (done = () => r('s9')))
    )
    renderRoutines()
    await userEvent.click(
      screen.getByRole('button', { name: 'Start Nightly. Runs weekdays at 02:00.' })
    )
    const pill = screen.getByRole('button', { name: 'Starting Nightly. Runs weekdays at 02:00.' })
    expect(pill).toHaveAttribute('aria-disabled', 'true')
    expect(pill).toHaveTextContent('Starting')
    expect(pill).not.toHaveTextContent('Weekdays')
    await userEvent.click(pill)
    expect(api.routines.start).toHaveBeenCalledTimes(1)
    await act(async () => done())
    expect(
      screen.getByRole('button', { name: 'Start Nightly. Runs weekdays at 02:00.' })
    ).toBeInTheDocument()
    expect(screen.queryByText(/Couldn't start/)).not.toBeInTheDocument()
  })

  it('says Loading while the run history loads', async () => {
    vi.mocked(api.routines.history).mockReturnValue(new Promise(() => undefined))
    renderRoutines()
    await userEvent.click(screen.getByRole('button', { name: 'More for Nightly' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Run history' }))
    const sheet = await screen.findByRole('dialog', { name: 'Nightly: run history' })
    expect(within(sheet).getByText('Loading')).toHaveClass('text-xs', 'text-fg-3')
  })

  it('starts again once its last session finished', () => {
    renderRoutines([nightly], [adhoc({ routineId: 'r1', state: 'finished' })])
    expect(
      screen.getByRole('button', { name: 'Start Nightly. Runs weekdays at 02:00.' })
    ).not.toHaveAttribute('aria-disabled', 'true')
  })

  it('shows a failed start under the row', async () => {
    vi.mocked(api.routines.start).mockRejectedValue(new Error('no such folder'))
    renderRoutines()
    await userEvent.click(
      screen.getByRole('button', { name: 'Start Nightly. Runs weekdays at 02:00.' })
    )
    expect(await screen.findByText("Couldn't start Nightly: no such folder")).toBeInTheDocument()
  })

  it('opens Edit routine from the pill menu', async () => {
    const { onRoutine } = renderRoutines()
    await userEvent.click(screen.getByRole('button', { name: 'More for Nightly' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit routine' }))
    expect(onRoutine).toHaveBeenCalledWith(project, nightly)
  })

  it('copies a routine to any project, its own included, as a draft from its project and repo', async () => {
    const { onRoutine } = renderRoutines([{ ...nightly, allow: ['Bash(npm outdated)'] }])
    await userEvent.click(screen.getByRole('button', { name: 'More for Nightly' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Copy to project…' }))
    expect(screen.getByRole('menuitem', { name: 'Shop' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Docs' }))
    expect(onRoutine).toHaveBeenCalledWith(other, undefined, {
      name: 'Nightly',
      repo: 'octo/shop',
      worktree: true,
      message: 'Check dependencies',
      allow: ['Bash(npm outdated)'],
      schedule: { days: [1, 2, 3, 4, 5], time: '02:00' },
      copiedFrom: { project: 'Shop', repo: 'octo/shop' }
    })
  })

  it('keeps the run history mounted while it slides out', async () => {
    const real = window.getComputedStyle
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
      const style = real(el, pseudo)
      return (el as HTMLElement).dataset?.slot === 'sheet-content'
        ? Object.defineProperty(style, 'animationName', {
            get: () => (el as HTMLElement).dataset.state
          })
        : style
    })
    onTestFinished(() => {
      vi.restoreAllMocks()
    })
    renderRoutines()
    await userEvent.click(screen.getByRole('button', { name: 'More for Nightly' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Run history' }))
    await screen.findByRole('dialog', { name: 'Nightly: run history' })
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    const leaving = document.querySelector('[data-slot="sheet-content"]')
    expect(leaving).toHaveAttribute('data-state', 'closed')
    expect(leaving).toHaveTextContent('Nightly: run history')
  })

  it('reloads the run history each time it opens', async () => {
    renderRoutines()
    const open = async (): Promise<void> => {
      await userEvent.click(screen.getByRole('button', { name: 'More for Nightly' }))
      await userEvent.click(screen.getByRole('menuitem', { name: 'Run history' }))
      await screen.findByRole('dialog', { name: 'Nightly: run history' })
    }
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    await open()
    expect(api.routines.history).toHaveBeenCalledTimes(2)
  })

  it('opens the run history with its counts, price, and runs', async () => {
    const at = (h: number): string => new Date(2026, 9, 27, h, 0).toISOString()
    const runs: RoutineRun[] = [
      {
        kind: 'session',
        at: at(14),
        scheduled: false,
        sessionId: 'a2',
        state: 'needsYou',
        removed: false,
        place: 'main checkout',
        usage: [],
        lastMessage: null,
        waitingFor: 'Bash(npm outdated)'
      },
      { kind: 'skipped', at: at(12), scheduled: true, reason: 'running' },
      {
        kind: 'session',
        at: at(2),
        scheduled: true,
        sessionId: 'a1',
        state: 'finished',
        removed: false,
        place: 'routine/nightly',
        usage: [
          {
            model: 'claude-opus-4',
            name: null,
            input: 1000,
            output: 500,
            cacheRead: 0,
            cacheWrite: 0,
            price: 1.25
          }
        ],
        lastMessage: 'All dependencies are current.',
        warning: 'Claude exited right after it started.'
      },
      {
        kind: 'session',
        at: at(1),
        scheduled: true,
        sessionId: 'a0',
        state: 'finished',
        removed: true,
        place: 'routine/old',
        usage: [],
        lastMessage: 'Done.'
      },
      { kind: 'skipped', at: at(0), scheduled: true, reason: 'closed' },
      {
        kind: 'skipped',
        at: new Date(2026, 9, 26, 23, 0).toISOString(),
        scheduled: true,
        reason: 'failed',
        error: 'Setup failed: npm install exited with code 1\nnpm ERR! boom'
      }
    ]
    vi.mocked(api.routines.history).mockResolvedValue(runs)
    const { onOpenSession } = renderRoutines()
    await userEvent.click(screen.getByRole('button', { name: 'More for Nightly' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Run history' }))
    const sheet = await screen.findByRole('dialog', { name: 'Nightly: run history' })
    expect(api.routines.history).toHaveBeenCalledWith('r1')
    expect(await within(sheet).findByText('3 runs')).toBeInTheDocument()
    expect(within(sheet).getByText('3 skipped')).toBeInTheDocument()
    expect(within(sheet).getByText('$1.25 API estimate')).toBeInTheDocument()
    const rows = within(sheet).getAllByRole('listitem')
    expect(rows).toHaveLength(6)
    expect(rows[0]).toHaveTextContent('Oct 27, 14:00')
    expect(rows[0]).toHaveTextContent('Started by you')
    expect(rows[0]).toHaveTextContent('Needs you')
    expect(rows[0]).toHaveTextContent('Waiting on Bash(npm outdated)')
    expect(rows[2]).not.toHaveTextContent('Waiting on')
    expect(rows[2]).toHaveTextContent('Claude exited right after it started.')
    expect(rows[0]).not.toHaveTextContent('Claude exited')
    expect(rows[0]).toHaveTextContent('main checkout')
    expect(rows[1]).toHaveTextContent('On schedule')
    expect(rows[1]).toHaveTextContent('Skipped')
    expect(rows[1]).toHaveTextContent('Its last session was still open')
    expect(rows[2]).toHaveTextContent('Finished')
    expect(rows[2]).toHaveTextContent('routine/nightly')
    expect(rows[2]).toHaveTextContent('1.5K tokens · $1.25 API estimate')
    expect(rows[2]).toHaveTextContent('All dependencies are current.')
    expect(within(rows[3]).queryByRole('button', { name: 'Open' })).not.toBeInTheDocument()
    expect(within(rows[1]).queryByRole('button', { name: 'Open' })).not.toBeInTheDocument()
    expect(rows[4]).toHaveTextContent('Sandtable was closed or the Mac was asleep')
    expect(within(rows[5]).getByText(/^Couldn't start: Setup failed/)).toHaveClass(
      'whitespace-pre-line'
    )
    await userEvent.click(within(rows[2]).getByRole('button', { name: 'Open' }))
    expect(onOpenSession).toHaveBeenCalledWith('a1')
  })
})

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import type { CouldntStart } from '../../../shared/api'
import { folderError } from '../../../shared/repo'
import { shortTime } from '../../../shared/time'
import { CouldntStartList } from './CouldntStartList'

const entries: CouldntStart[] = [
  {
    kind: 'ticket',
    name: 'Dark mode toggle',
    ticketKey: 'octo/shop#52',
    at: '2026-10-24T11:00:00.000Z',
    reason: folderError('octo/shop'),
    repo: 'octo/shop'
  },
  {
    kind: 'routine',
    routineId: 'r1',
    name: 'Nightly triage',
    at: '2026-10-24T10:00:00.000Z',
    reason: 'failed',
    error: 'Setup failed: npm install exited with code 1\nnpm ERR! boom'
  },
  {
    kind: 'routine',
    routineId: 'r2',
    name: 'Morning summary',
    at: '2026-10-24T08:00:00.000Z',
    reason: 'closed'
  }
]

const open = async (
  onOpenTicket = vi.fn(),
  onOpenRunHistory = vi.fn()
): Promise<ReturnType<typeof within>> => {
  render(
    <CouldntStartList
      project="Shop"
      entries={entries}
      onOpenTicket={onOpenTicket}
      onOpenRunHistory={onOpenRunHistory}
    />
  )
  await userEvent.click(screen.getByRole('button', { name: "3 couldn't start" }))
  return within(await screen.findByRole('dialog', { name: "Couldn't start in Shop" }))
}

it('reads "3 couldn\'t start" and lists kind, name, reason, output, and time', async () => {
  const list = await open()
  expect(list.getAllByText(/^(Ticket|Routine)$/).map((e: HTMLElement) => e.textContent)).toEqual([
    'Ticket',
    'Routine',
    'Routine'
  ])
  expect(list.getByText('Dark mode toggle')).toBeInTheDocument()
  expect(
    list.getByText(`Couldn't start: ${folderError('octo/shop')}. Nothing was created.`)
  ).toBeInTheDocument()
  expect(
    list.getByText("Couldn't start: Setup failed: npm install exited with code 1")
  ).toBeInTheDocument()
  expect(list.getByText('npm ERR! boom')).toBeInTheDocument()
  expect(list.getByText('Sandtable was closed or the Mac was asleep')).toBeInTheDocument()
  expect(list.getByText(shortTime('2026-10-24T08:00:00.000Z'))).toBeInTheDocument()
})

it('opens the ticket for a ticket entry', async () => {
  const onOpenTicket = vi.fn()
  const list = await open(onOpenTicket)
  await userEvent.click(list.getByRole('button', { name: /Dark mode toggle/ }))
  expect(onOpenTicket).toHaveBeenCalledWith('octo/shop#52')
})

it('opens the Run history for a routine entry', async () => {
  const onOpenRunHistory = vi.fn()
  const list = await open(vi.fn(), onOpenRunHistory)
  await userEvent.click(list.getByRole('button', { name: /Nightly triage/ }))
  expect(onOpenRunHistory).toHaveBeenCalledWith('r1')
})

it("lists two skips of a routine from one sync as two rows, without React's duplicate key warning", async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const skip: CouldntStart = {
    kind: 'routine',
    routineId: 'r1',
    name: 'Label triage',
    at: '2026-10-24T10:00:00.000Z',
    reason: 'capped'
  }
  render(
    <CouldntStartList
      project="Shop"
      entries={[skip, skip]}
      onOpenTicket={vi.fn()}
      onOpenRunHistory={vi.fn()}
    />
  )
  await userEvent.click(screen.getByRole('button', { name: "2 couldn't start" }))
  const list = within(await screen.findByRole('dialog', { name: "Couldn't start in Shop" }))
  expect(list.getAllByRole('button', { name: /Label triage/ })).toHaveLength(2)
  expect(error.mock.calls.flat().join(' ')).not.toMatch(/same key/)
  error.mockRestore()
})

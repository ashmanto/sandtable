import { act, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { fakeSandtable } from '../test/fixtures'
import { checkSetupHint, useSetupHint } from './useSetupHint'

const suggestion = { copy: ['.env'], command: 'npm install' }

function Shown({
  projectId,
  ticketKey
}: {
  projectId: string
  ticketKey: string
}): React.JSX.Element {
  const { hint, notNow, dismiss } = useSetupHint(projectId, ticketKey)
  return (
    <p>
      {`${ticketKey}:${hint?.repo ?? 'none'}`}
      <button onClick={() => void notNow()}>Not now {ticketKey}</button>
      <button onClick={dismiss}>Dismiss {ticketKey}</button>
    </p>
  )
}

it('asks once per repo, shows the hint on the ticket that started, and Not now hides it for good', async () => {
  const api = fakeSandtable()
  vi.mocked(api.setup.hint).mockResolvedValue(suggestion)
  render(
    <>
      <Shown projectId="h1" ticketKey="a#1" />
      <Shown projectId="h1" ticketKey="a#2" />
    </>
  )
  await act(async () => checkSetupHint('h1', 'a#1', 'octo/shop'))
  expect(screen.getByText('a#1:octo/shop')).toBeInTheDocument()
  await act(async () => checkSetupHint('h1', 'a#2', 'octo/shop'))
  expect(screen.getByText('a#2:none')).toBeInTheDocument()
  expect(api.setup.hint).toHaveBeenCalledTimes(1)
  expect(api.setup.hint).toHaveBeenCalledWith('h1', 'octo/shop')
  await act(async () => screen.getByText('Not now a#1').click())
  expect(screen.getByText('a#1:none')).toBeInTheDocument()
  expect(api.setup.hideHint).toHaveBeenCalledWith('h1', 'octo/shop')
})

it('shows nothing when main has no hint, and Dismiss hides it without saving', async () => {
  const api = fakeSandtable()
  render(<Shown projectId="h2" ticketKey="b#1" />)
  await act(async () => checkSetupHint('h2', 'b#1', 'octo/shop'))
  expect(screen.getByText('b#1:none')).toBeInTheDocument()
  vi.mocked(api.setup.hint).mockResolvedValue(suggestion)
  await act(async () => checkSetupHint('h2', 'b#1', 'octo/other'))
  await act(async () => screen.getByText('Dismiss b#1').click())
  expect(screen.getByText('b#1:none')).toBeInTheDocument()
  expect(api.setup.hideHint).not.toHaveBeenCalled()
})

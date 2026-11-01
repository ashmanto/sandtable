import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { SetupHint } from './SetupHint'

const props = { onSetUp: vi.fn(), onNotNow: vi.fn() }

it('names what new worktrees lack, with Set up and Not now', async () => {
  const hint = { repo: 'octo/shop', suggestion: { copy: ['.env'], command: 'npm install' } }
  render(<SetupHint hint={hint} {...props} />)
  expect(screen.getByRole('status')).toHaveTextContent(
    "New worktrees here won't have .env or node_modules"
  )
  await userEvent.click(screen.getByRole('button', { name: 'Set up' }))
  expect(props.onSetUp).toHaveBeenCalledWith('octo/shop')
  await userEvent.click(screen.getByRole('button', { name: 'Not now' }))
  expect(props.onNotNow).toHaveBeenCalled()
})

it('names the command when it builds no folder and nothing is copied', () => {
  const hint = { repo: 'r/x', suggestion: { copy: [], command: 'bundle install' } }
  render(<SetupHint hint={hint} {...props} />)
  expect(screen.getByRole('status')).toHaveTextContent(
    "New worktrees here won't run bundle install"
  )
})

it('shows nothing without a hint', () => {
  const { container } = render(<SetupHint hint={null} {...props} />)
  expect(container).toBeEmptyDOMElement()
})

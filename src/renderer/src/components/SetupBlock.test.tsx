import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Project, SetupProgress } from '../../../shared/types'
import { project as base } from '../test/fixtures'
import { SetupBlock } from './SetupBlock'

const project: Project = {
  ...base,
  repos: [{ ...base.repos[0], setup: { copy: ['.env'], command: 'npm install' } }, base.repos[1]]
}
const one: Project = { ...project, repos: [project.repos[0]] }
const running = (p: Partial<SetupProgress> = {}): SetupProgress => ({
  repo: 'octo/shop',
  state: 'running',
  notes: [],
  lines: [],
  startedAt: new Date(Date.now() - 3 * 60_000).toISOString(),
  ...p
})

describe('SetupBlock', () => {
  it('shows nothing without progress', () => {
    const { container } = render(<SetupBlock progress={null} project={project} cancel={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows a running setup with its latest line, time, and Cancel', async () => {
    const cancel = vi.fn()
    const onClick = vi.fn()
    render(
      <div onClick={onClick}>
        <SetupBlock
          progress={running({
            notes: ['Skipped .env: not in the main checkout'],
            lines: ['added 1 package', 'added 2 packages']
          })}
          project={one}
          cancel={cancel}
        />
      </div>
    )
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(/^Setting up the worktree: npm install/)
    expect(within(status).getByText('npm install')).toHaveClass('font-mono')
    expect(status).toHaveTextContent('Skipped .env: not in the main checkout')
    const row = screen.getByRole('button', { name: /^added 2 packages, for 3 minutes\. Show/ })
    expect(row).toHaveTextContent('3m')
    expect(row).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(row)
    expect(row).toHaveAttribute('aria-expanded', 'true')
    expect(
      within(screen.getByRole('list', { name: 'Last lines' }))
        .getAllByRole('listitem')
        .map((li) => li.textContent)
    ).toEqual(['added 1 package', 'added 2 packages'])
    expect(screen.queryByRole('button', { name: 'Start anyway' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(cancel).toHaveBeenCalled()
    expect(onClick).not.toHaveBeenCalled()
  })

  it('names the repo when the project has several, and waits for output', () => {
    render(<SetupBlock progress={running()} project={project} cancel={vi.fn()} />)
    expect(screen.getByRole('status')).toHaveTextContent(
      'Setting up the worktree for shop: npm install'
    )
    expect(screen.getByText('Waiting for output')).toHaveClass('text-fg-3')
    expect(screen.getByText('3m')).toBeInTheDocument()
  })

  it('says it copies files when there is no command, with no strip until a line', () => {
    const { rerender } = render(
      <SetupBlock
        progress={running({ repo: 'octo/shop-web' })}
        project={project}
        cancel={vi.fn()}
      />
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      'Copying files into the worktree for shop-web'
    )
    expect(screen.queryByText('Waiting for output')).toBeNull()
    expect(screen.queryByText('3m')).toBeNull()
    rerender(
      <SetupBlock
        progress={running({ repo: 'octo/shop-web', lines: ['copied'] })}
        project={project}
        cancel={vi.fn()}
      />
    )
    expect(screen.getByText('copied')).toHaveClass('font-mono')
  })

  it('opens the strip when the setup fails without losing focus on its row', async () => {
    const lines = ['one', 'two']
    const { rerender } = render(
      <SetupBlock progress={running({ lines })} project={project} cancel={vi.fn()} />
    )
    const row = screen.getByRole('button', { name: /Show last lines/ })
    row.focus()
    rerender(
      <SetupBlock
        progress={running({ lines, state: 'failed', error: 'boom' })}
        project={project}
        cancel={vi.fn()}
      />
    )
    expect(row).toHaveFocus()
    expect(row).toHaveAttribute('aria-expanded', 'true')
  })

  it('shows a failure with the last lines open, Start anyway, and Cancel', async () => {
    const startAnyway = vi.fn()
    const cancel = vi.fn()
    render(
      <SetupBlock
        progress={running({
          state: 'failed',
          error: 'npm install exited with code 1',
          lines: ['npm ERR! missing script', 'npm ERR! A complete log']
        })}
        project={project}
        startAnyway={startAnyway}
        cancel={cancel}
      />
    )
    expect(screen.getByText('Setup failed: npm install exited with code 1')).toHaveClass(
      'text-danger'
    )
    expect(screen.getByRole('button', { name: /Show last lines/ })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
    expect(
      within(screen.getByRole('list', { name: 'Last lines' })).getByText('npm ERR! missing script')
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Start anyway' }))
    expect(startAnyway).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(cancel).toHaveBeenCalled()
  })
})

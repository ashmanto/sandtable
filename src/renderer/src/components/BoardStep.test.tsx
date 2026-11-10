import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SandtableApi } from '../../../shared/api'
import { useBoardSource } from '../hooks/useBoardSource'
import { fakeSandtable, project } from '../test/fixtures'
import { BoardStep } from './BoardStep'

const URL = 'https://github.com/users/octo/projects/2'
const on = { loaded: vi.fn(), cleared: vi.fn() }
let api: SandtableApi

beforeEach(() => {
  api = fakeSandtable()
  on.loaded.mockReset()
  on.cleared.mockReset()
  vi.mocked(api.projects.statusOptions).mockResolvedValue([
    'Backlog',
    'Todo',
    'In Progress',
    'Done'
  ])
  vi.mocked(api.projects.boardRepos).mockResolvedValue(['octo/shop', 'octo/shop-web'])
})

function Harness({ saved }: { saved?: typeof project }): React.JSX.Element {
  const source = useBoardSource(saved, on)
  return (
    <>
      <BoardStep source={source} />
      <output aria-label="issue">{source.issue}</output>
      <output aria-label="map">{JSON.stringify(source.statusMap)}</output>
      <output aria-label="loaded">{String(!!source.board)}</output>
    </>
  )
}

const url = (): HTMLElement => screen.getByLabelText('Board URL')
const load = (): Promise<void> =>
  userEvent.click(screen.getByRole('button', { name: 'Load board' }))

describe('BoardStep', () => {
  it('presets the usual statuses and reports the board repos', async () => {
    render(<Harness />)
    await userEvent.type(url(), URL)
    await load()
    expect(await screen.findByText('Board loaded: tickets from 2 repos')).toBeInTheDocument()
    expect(JSON.parse(screen.getByLabelText('map').textContent ?? '')).toEqual({
      todo: 'Todo',
      inProgress: 'In Progress',
      done: 'Done'
    })
    expect(on.loaded).toHaveBeenCalledWith(['octo/shop', 'octo/shop-web'])
    expect(screen.getByLabelText('issue')).toBeEmptyDOMElement()
  })

  it('refuses a malformed URL without loading', async () => {
    render(<Harness />)
    await userEvent.type(url(), 'https://github.com/octo')
    await load()
    expect(
      screen.getByText('Enter a board URL such as https://github.com/users/you/projects/1')
    ).toBeInTheDocument()
    expect(api.projects.statusOptions).not.toHaveBeenCalled()
  })

  it('clears the board when the URL changes', async () => {
    render(<Harness />)
    await userEvent.type(url(), URL)
    await load()
    await screen.findByText('Board loaded: tickets from 2 repos')
    await userEvent.type(url(), '0')
    expect(on.cleared).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('loaded')).toHaveTextContent('false')
    expect(screen.getByLabelText('issue')).toHaveTextContent('Load the board')
  })

  it('asks to load the board when a saved board URL is malformed', () => {
    const board = { ...project.board!, source: { ...project.board!.source, url: 'not a url' } }
    render(<Harness saved={{ ...project, board }} />)
    expect(screen.getByLabelText('issue')).toHaveTextContent('Load the board')
  })
})

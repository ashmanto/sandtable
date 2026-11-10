import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SandtableApi } from '../../../shared/api'
import { useJiraSource } from '../hooks/useJiraSource'
import { fakeSandtable } from '../test/fixtures'
import { JiraStep } from './JiraStep'

const SITE = 'acme.atlassian.net'
const OTHER = 'other.atlassian.net'
const PROJECTS = [
  { key: 'INF', name: 'Internal' },
  { key: 'OPS', name: 'Operations' }
]
let api: SandtableApi

beforeEach(() => {
  api = fakeSandtable()
  vi.mocked(api.projects.jiraAccounts).mockResolvedValue([
    { site: SITE, email: 'me@example.com' },
    { site: OTHER, email: 'me@example.com' }
  ])
  vi.mocked(api.projects.jiraProjects).mockResolvedValue(PROJECTS)
  vi.mocked(api.projects.jiraBoards).mockResolvedValue([{ id: 1, name: 'INF board' }])
})

function Harness(): React.JSX.Element {
  const source = useJiraSource()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- activates once, as choosing Jira does
  useEffect(() => source.activate(), [])
  return (
    <>
      <JiraStep source={source} />
      <output aria-label="saved">{JSON.stringify(source.saved)}</output>
    </>
  )
}

const saved = (): unknown => JSON.parse(screen.getByLabelText('saved').textContent ?? '')
const account = async (site: string): Promise<void> =>
  userEvent.click(await screen.findByRole('radio', { name: new RegExp(site) }))
const internal = async (): Promise<void> => {
  const list = await screen.findByRole('radiogroup', { name: 'Jira project' })
  await userEvent.click(within(list).getByRole('radio', { name: /Internal/ }))
}

describe('JiraStep', () => {
  it('picks an account, a project, and its only board', async () => {
    render(<Harness />)
    await account(SITE)
    await internal()
    expect(await screen.findByRole('radio', { name: /INF board/ })).toBeChecked()
    expect(api.projects.jiraBoards).toHaveBeenCalledWith(SITE, 'INF')
    expect(saved()).toEqual({
      site: SITE,
      project: 'INF',
      name: 'Internal',
      board: { id: 1, name: 'INF board' }
    })
  })

  it('opens the sign-in form when there are no accounts', async () => {
    vi.mocked(api.projects.jiraAccounts).mockResolvedValue([])
    render(<Harness />)
    expect(await screen.findByRole('group', { name: 'Add a Jira account' })).toBeInTheDocument()
    expect(saved()).toBeNull()
  })

  it('drops boards still loading when the account changes', async () => {
    let boards: (loaded: { id: number; name: string }[]) => void = () => {}
    vi.mocked(api.projects.jiraBoards).mockReturnValueOnce(new Promise((done) => (boards = done)))
    render(<Harness />)
    await account(SITE)
    await internal()
    await account(OTHER)
    await act(async () => boards([{ id: 1, name: 'INF board' }]))
    expect(screen.queryByRole('radio', { name: /INF board/ })).not.toBeInTheDocument()
    expect(saved()).toBeNull()
  })
})

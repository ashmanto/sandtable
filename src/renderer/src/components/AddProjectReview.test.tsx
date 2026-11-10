import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SandtableApi } from '../../../shared/api'
import type { Project } from '../../../shared/types'
import { fakeSandtable, jiraProject, linearProject } from '../test/fixtures'
import { AddProject } from './AddProject'

const props = { onSaved: vi.fn(), onDeleted: vi.fn(), onCancel: vi.fn() }
const SITE = 'acme.atlassian.net'
let api: SandtableApi

beforeEach(() => {
  api = fakeSandtable()
  vi.mocked(api.projects.jiraAccounts).mockResolvedValue([{ site: SITE, email: 'me@example.com' }])
  vi.mocked(api.projects.jiraProjects).mockResolvedValue([{ key: 'INF', name: 'Internal' }])
  vi.mocked(api.projects.linearWorkspaces).mockResolvedValue([
    { slug: 'acme', organization: 'Acme Inc', default: true }
  ])
})

describe('AddProject review while the tickets step needs a choice', () => {
  it('keeps the Jira site in the sandbox hint when the saved board is gone', async () => {
    vi.mocked(api.projects.jiraBoards).mockResolvedValue([
      { id: 1, name: 'One' },
      { id: 2, name: 'Two' }
    ])
    const project: Project = {
      ...jiraProject,
      sandbox: true,
      jira: { ...jiraProject.jira!, board: { id: 9, name: 'Gone' } }
    }
    render(<AddProject {...props} project={project} />)
    expect((await screen.findAllByText('Choose a Jira board')).length).toBeGreaterThan(0)
    expect(screen.getByText(/which sessions always reach/)).toHaveTextContent(SITE)
  })

  it('keeps the board sentence in Columns when the saved Jira project is gone', async () => {
    vi.mocked(api.projects.jiraProjects).mockResolvedValue([{ key: 'OPS', name: 'Operations' }])
    vi.mocked(api.projects.jiraBoards).mockResolvedValue([{ id: 9, name: 'Kept' }])
    const project: Project = {
      ...jiraProject,
      jira: { ...jiraProject.jira!, board: { id: 9, name: 'Kept' } }
    }
    render(<AddProject {...props} project={project} />)
    expect((await screen.findAllByText('Choose a Jira project')).length).toBeGreaterThan(0)
    expect(screen.getByText(/Only the board's issues show/)).toBeInTheDocument()
  })

  it('keeps Linear in the sandbox hint when the saved team is gone', async () => {
    vi.mocked(api.projects.linearTeams).mockResolvedValue([
      { key: 'OPS', name: 'Ops', projects: [] }
    ])
    render(<AddProject {...props} project={{ ...linearProject, sandbox: true }} />)
    expect((await screen.findAllByText('Choose a team')).length).toBeGreaterThan(0)
    expect(screen.getByText(/which sessions always reach/)).toHaveTextContent('api.linear.app')
  })
})

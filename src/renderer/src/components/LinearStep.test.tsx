import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SandtableApi } from '../../../shared/api'
import { fakeSandtable } from '../test/fixtures'
import { useLinearSource } from '../hooks/useLinearSource'
import { LinearStep } from './LinearStep'

const TEAMS = [
  { key: 'APP', name: 'Apps', projects: [{ id: 'lp1', name: 'Launch' }] },
  { key: 'OPS', name: 'Ops', projects: [] }
]
const WORKSPACES = [
  { slug: 'octo', organization: 'Octo Inc', default: false },
  { slug: 'acme', organization: 'Acme Inc', default: true }
]
let api: SandtableApi

beforeEach(() => {
  api = fakeSandtable()
  vi.mocked(api.projects.linearWorkspaces).mockResolvedValue(WORKSPACES)
  vi.mocked(api.projects.linearTeams).mockResolvedValue(TEAMS)
})

function Harness(): React.JSX.Element {
  const source = useLinearSource()
  const [shown, setShown] = useState(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- activates once, as choosing Linear does
  useEffect(() => source.activate(), [])
  return (
    <>
      <button onClick={() => setShown((s) => !s)}>Toggle</button>
      {shown && <LinearStep source={source} />}
      <output aria-label="issue">{source.issue}</output>
      <output aria-label="saved">{JSON.stringify(source.saved)}</output>
    </>
  )
}

const pick = async (box: string, option: string): Promise<void> => {
  await userEvent.click(await screen.findByRole('combobox', { name: box }))
  await userEvent.click(screen.getByRole('option', { name: option }))
}
const saved = (): unknown => JSON.parse(screen.getByLabelText('saved').textContent ?? '')

describe('LinearStep', () => {
  it('loads workspaces then teams and saves the picked team and projects', async () => {
    render(<Harness />)
    await pick('Team', 'Apps (APP)')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Launch' }))
    expect(api.projects.linearTeams).toHaveBeenCalledWith('acme')
    expect(screen.getByLabelText('issue')).toBeEmptyDOMElement()
    expect(saved()).toEqual({
      team: 'APP',
      projects: [{ id: 'lp1', name: 'Launch' }],
      workspace: 'acme'
    })
  })

  it('clears the team when the workspace changes', async () => {
    render(<Harness />)
    await pick('Team', 'Apps (APP)')
    await pick('Workspace', 'Octo Inc (octo)')
    expect(api.projects.linearTeams).toHaveBeenLastCalledWith('octo')
    expect(saved()).toBeNull()
    expect(await screen.findByLabelText('issue')).toHaveTextContent('Choose a team')
  })

  it('keeps loaded teams when the step unmounts and mounts again', async () => {
    render(<Harness />)
    await pick('Team', 'Apps (APP)')
    await userEvent.click(screen.getByRole('button', { name: 'Toggle' }))
    await userEvent.click(screen.getByRole('button', { name: 'Toggle' }))
    expect(screen.getByRole('combobox', { name: 'Team' })).toHaveTextContent('Apps (APP)')
    expect(api.projects.linearWorkspaces).toHaveBeenCalledTimes(1)
    expect(api.projects.linearTeams).toHaveBeenCalledTimes(1)
  })
})

import type { Project } from '../../../shared/types'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SandtableApi } from '../../../shared/api'
import {
  boardView,
  fakeSandtable,
  jiraProject,
  linearProject,
  project,
  ticket
} from '../test/fixtures'
import { AddProject } from './AddProject'

const URL = 'https://github.com/users/octo/projects/2'
const ID = '00000000-0000-4000-8000-000000000001'
let api: SandtableApi

beforeEach(() => {
  api = fakeSandtable()
  vi.spyOn(crypto, 'randomUUID').mockReturnValue(ID)
  vi.mocked(api.projects.statusOptions).mockResolvedValue([
    'Backlog',
    'Todo',
    'In Progress',
    'Done'
  ])
  vi.mocked(api.projects.boardRepos).mockResolvedValue(['octo/shop', 'octo/shop-web'])
})

const props = { onSaved: vi.fn(), onDeleted: vi.fn(), onCancel: vi.fn() }
const next = (): Promise<void> => userEvent.click(screen.getByRole('button', { name: 'Continue' }))
const ticketsFrom = (): Promise<void> =>
  userEvent.click(screen.getByRole('button', { name: /Tickets from/ }))
const repoBox = (repo: string): HTMLElement => screen.getByRole('group', { name: repo })
const folder = (path: string, ...repos: string[]): void => {
  vi.mocked(api.projects.pickFolder).mockResolvedValueOnce({ path, repos })
}

async function nameAndRepoIssues(): Promise<void> {
  await userEvent.type(screen.getByLabelText('Name'), 'Sandtable')
  await next()
  await userEvent.click(screen.getByRole('radio', { name: /Repo issues/ }))
  await next()
}

describe('AddProject', () => {
  it('runs name, tickets from, repos, and review in order, then saves a repo project', async () => {
    const onSaved = vi.fn()
    render(<AddProject {...props} onSaved={onSaved} />)
    expect(screen.getByRole('heading', { name: 'Add project' })).toBeInTheDocument()
    expect(screen.getByText('Step 1 of 4')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Name the project' })).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    expect(screen.getByText('Enter a name')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Name'), 'Sandtable{Enter}')
    expect(screen.getByRole('heading', { name: 'Where tickets come from' })).toBeInTheDocument()
    expect(screen.getByText('Step 2 of 4')).toBeInTheDocument()
    expect(screen.getByText('Choose where tickets come from')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: /Repo issues/ }))
    await next()

    expect(screen.getByRole('heading', { name: 'Repos and folders' })).toBeInTheDocument()
    expect(screen.getByText('No repos yet.')).toBeInTheDocument()
    expect(screen.getByText('Add at least one repo')).toBeInTheDocument()
    await userEvent.type(screen.getByPlaceholderText('owner/name'), 'octo/sandtable{Enter}')
    expect(screen.getByText('Choose a folder for octo/sandtable')).toBeInTheDocument()
    folder('/Users/me/projects/sandtable', 'octo/sandtable')
    await userEvent.click(
      within(repoBox('octo/sandtable')).getByRole('button', { name: 'Choose folder…' })
    )
    expect(await screen.findByText('Remote matches')).toBeInTheDocument()
    expect(screen.getByText('~/projects/sandtable')).toBeInTheDocument()
    await next()

    expect(screen.getByRole('heading', { name: 'Review' })).toBeInTheDocument()
    expect(screen.getByText(/Sandtable creates the/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    const saved = {
      id: ID,
      name: 'Sandtable',
      repos: [{ github: 'octo/sandtable', path: '/Users/me/projects/sandtable' }]
    }
    expect(api.projects.save).toHaveBeenCalledWith(saved)
    expect(onSaved).toHaveBeenCalledWith(saved)
  })

  it('loads a board, presets its statuses, lists its repos, and saves the board', async () => {
    const onSaved = vi.fn()
    render(<AddProject {...props} onSaved={onSaved} />)
    await userEvent.type(screen.getByLabelText('Name'), 'Shop')
    await next()
    await userEvent.click(screen.getByRole('radio', { name: /GitHub Projects board/ }))
    expect(screen.getByText('Load the board')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Board URL'), `${URL}{Enter}`)
    expect(await screen.findByText('Board loaded: tickets from 2 repos')).toBeInTheDocument()
    expect(api.projects.statusOptions).toHaveBeenCalledWith(URL)
    expect(api.projects.boardRepos).toHaveBeenCalledWith(URL)
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'To do' })).toHaveTextContent('Todo')
    expect(screen.getByRole('combobox', { name: 'In progress' })).toHaveTextContent('In Progress')
    expect(screen.getByRole('combobox', { name: 'Done' })).toHaveTextContent('Done')
    await next()

    expect(screen.getByText('Include at least one repo')).toBeInTheDocument()
    expect(within(repoBox('octo/shop-web')).getByText('Not included')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: 'octo/shop' }))
    expect(within(repoBox('octo/shop')).getByText('Included')).toBeInTheDocument()
    folder('/Users/me/projects/shop', 'octo/shop')
    await userEvent.click(
      within(repoBox('octo/shop')).getByRole('button', { name: 'Choose folder…' })
    )
    await screen.findByText('Remote matches')
    await next()
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(api.projects.save).toHaveBeenCalledWith({
      id: ID,
      name: 'Shop',
      repos: [project.repos[0]],
      board: project.board
    })
  })

  it('rejects a malformed board URL and clears the board when the URL changes', async () => {
    render(<AddProject {...props} />)
    await userEvent.type(screen.getByLabelText('Name'), 'Shop')
    await next()
    await userEvent.click(screen.getByRole('radio', { name: /GitHub Projects board/ }))
    await userEvent.type(screen.getByLabelText('Board URL'), 'nope{Enter}')
    expect(
      screen.getByText('Enter a board URL such as https://github.com/users/you/projects/1')
    ).toBeInTheDocument()
    expect(api.projects.statusOptions).not.toHaveBeenCalled()
    await userEvent.clear(screen.getByLabelText('Board URL'))
    await userEvent.type(screen.getByLabelText('Board URL'), `${URL}{Enter}`)
    await screen.findByText('Board loaded: tickets from 2 repos')
    await userEvent.type(screen.getByLabelText('Board URL'), '3')
    expect(screen.queryByRole('combobox', { name: 'To do' })).not.toBeInTheDocument()
    expect(screen.getByText('Load the board')).toBeInTheDocument()
  })

  it('ignores a board load still running when the URL changes', async () => {
    let answer: (repos: string[]) => void = () => {}
    vi.mocked(api.projects.boardRepos).mockImplementationOnce(
      () => new Promise((done) => (answer = done))
    )
    render(<AddProject {...props} />)
    await userEvent.type(screen.getByLabelText('Name'), 'Shop')
    await next()
    await userEvent.click(screen.getByRole('radio', { name: /GitHub Projects board/ }))
    await userEvent.type(screen.getByLabelText('Board URL'), `${URL}{Enter}`)
    await userEvent.type(screen.getByLabelText('Board URL'), '3')
    expect(screen.getByText('Load the board')).toBeInTheDocument()
    answer(['octo/stale'])
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.getByText('Load the board')).toBeInTheDocument()
    await userEvent.keyboard('{Enter}')
    await screen.findByText('Board loaded: tickets from 2 repos')
    await next()
    expect(screen.queryByRole('group', { name: 'octo/stale' })).not.toBeInTheDocument()
    expect(repoBox('octo/shop')).toBeInTheDocument()
  })

  it('says when the board cannot be loaded and offers Try again', async () => {
    vi.mocked(api.projects.statusOptions).mockRejectedValueOnce(
      new Error(
        "Error invoking remote method 'projects.statusOptions': Error: GitHub says octo/projects/2 doesn't exist, or your token can't read it."
      )
    )
    render(<AddProject {...props} />)
    await userEvent.type(screen.getByLabelText('Name'), 'Shop')
    await next()
    await userEvent.click(screen.getByRole('radio', { name: /GitHub Projects board/ }))
    await userEvent.type(screen.getByLabelText('Board URL'), `${URL}{Enter}`)
    expect(await screen.findByText("Couldn't load the board.")).toBeInTheDocument()
    expect(
      screen.getByText("GitHub says octo/projects/2 doesn't exist, or your token can't read it.")
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Board loaded: tickets from 2 repos')).toBeInTheDocument()
  })

  it('shows the real reason when the board fails for something other than a missing board', async () => {
    vi.mocked(api.projects.statusOptions).mockRejectedValueOnce(
      new Error(
        "Error invoking remote method 'projects.statusOptions': Error: GitHub CLI is not logged in; run `gh auth login`"
      )
    )
    render(<AddProject {...props} />)
    await userEvent.type(screen.getByLabelText('Name'), 'Shop')
    await next()
    await userEvent.click(screen.getByRole('radio', { name: /GitHub Projects board/ }))
    await userEvent.type(screen.getByLabelText('Board URL'), `${URL}{Enter}`)
    expect(await screen.findByText("Couldn't load the board.")).toBeInTheDocument()
    expect(screen.getByText('GitHub CLI is not logged in; run `gh auth login`')).toBeInTheDocument()
    expect(screen.queryByText(/doesn't exist/)).not.toBeInTheDocument()
  })

  it("keeps an edited project's repos and folders when the source is toggled, and needs a reload", async () => {
    render(<AddProject {...props} project={project} />)
    await ticketsFrom()
    await userEvent.click(screen.getByRole('radio', { name: /Repo issues/ }))
    await userEvent.click(screen.getByRole('radio', { name: /GitHub Projects board/ }))
    expect(screen.queryByText('Board loaded: tickets from 2 repos')).not.toBeInTheDocument()
    expect(screen.getAllByText('Load the board')).not.toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Load board' }))
    await screen.findByText('Board loaded: tickets from 2 repos')
    await next()
    expect(screen.getByRole('checkbox', { name: 'octo/shop' })).toBeChecked()
    expect(within(repoBox('octo/shop-web')).getByText('~/projects/shop-web')).toBeInTheDocument()
  })

  it("keeps an edited project's included repos and folders when the board URL changes", async () => {
    render(<AddProject {...props} project={project} />)
    await ticketsFrom()
    await userEvent.clear(screen.getByLabelText('Board URL'))
    await userEvent.type(screen.getByLabelText('Board URL'), `${URL.slice(0, -1)}3{Enter}`)
    await screen.findByText('Board loaded: tickets from 2 repos')
    await next()
    expect(screen.getByRole('checkbox', { name: 'octo/shop' })).toBeChecked()
    expect(within(repoBox('octo/shop-web')).getByText('~/projects/shop-web')).toBeInTheDocument()
  })

  it('keeps saved repos that are no longer on the board when reloading', async () => {
    vi.mocked(api.projects.boardRepos).mockResolvedValue(['octo/shop'])
    render(<AddProject {...props} project={project} />)
    await ticketsFrom()
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }))
    await screen.findByText('Board loaded: tickets from 1 repo')
    await next()
    expect(screen.getByRole('checkbox', { name: 'octo/shop-web' })).toBeChecked()
  })

  it("refuses a folder whose remote doesn't point at the repo and keeps the folder unset", async () => {
    render(<AddProject {...props} />)
    await nameAndRepoIssues()
    await userEvent.type(screen.getByPlaceholderText('owner/name'), 'octo/sandtable{Enter}')
    folder('/Users/me/projects/notes', 'octo/notes')
    await userEvent.click(screen.getByRole('button', { name: 'Choose folder…' }))
    expect(
      await screen.findByText("This folder's git remote doesn't point at octo/sandtable")
    ).toBeInTheDocument()
    expect(
      screen.getByText("/Users/me/projects/notes points at octo/notes. The folder wasn't added.")
    ).toBeInTheDocument()
    expect(screen.getByText('No folder chosen')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  })

  it('ignores a cancelled folder dialog', async () => {
    render(<AddProject {...props} />)
    await nameAndRepoIssues()
    await userEvent.click(screen.getByRole('button', { name: 'Add from a folder…' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('No repos yet.')).toBeInTheDocument()
  })

  it('adds a worktree setup to a repo and saves it', async () => {
    render(<AddProject {...props} />)
    await nameAndRepoIssues()
    await userEvent.type(screen.getByPlaceholderText('owner/name'), 'octo/sandtable{Enter}')
    const box = repoBox('octo/sandtable')
    expect(within(box).queryByText('Worktree setup')).toBeNull()
    folder('/Users/me/projects/sandtable', 'octo/sandtable')
    await userEvent.click(within(box).getByRole('button', { name: 'Choose folder…' }))
    expect(await within(box).findByText('Worktree setup')).toBeInTheDocument()
    expect(within(box).getByText('None')).toBeInTheDocument()
    const toggle = within(box).getByRole('button', {
      name: 'Add worktree setup for octo/sandtable'
    })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(toggle)
    expect(toggle).toHaveAccessibleName('Hide worktree setup for octo/sandtable')
    expect(
      within(box).getByText('Kept as you type, and saved when you save the project.')
    ).toBeInTheDocument()
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(
      within(box).getByText('Runs only in a worktree Sandtable makes, before Claude Code starts.')
    ).toBeInTheDocument()
    const copy = within(box).getByRole('textbox', { name: 'Copy from the main checkout' })
    expect(copy).toHaveAccessibleDescription(
      'One path per line. Only files and folders git ignores.'
    )
    expect(copy).toHaveAttribute('placeholder', '.env')
    await userEvent.type(copy, '.env{Enter}{Enter}.env.local')
    expect(copy).toHaveValue('.env\n\n.env.local')
    await userEvent.type(
      within(box).getByRole('textbox', { name: 'Setup command' }),
      '  npm install '
    )
    await userEvent.click(toggle)
    expect(within(box).queryByRole('textbox', { name: 'Setup command' })).toBeNull()
    expect(within(box).getByText('2 paths · npm install')).toBeInTheDocument()
    expect(toggle).toHaveAccessibleName('Edit worktree setup for octo/sandtable')
    await next()
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(api.projects.save).toHaveBeenCalledWith({
      id: ID,
      name: 'Sandtable',
      repos: [
        {
          github: 'octo/sandtable',
          path: '/Users/me/projects/sandtable',
          setup: { copy: ['.env', '.env.local'], command: 'npm install' }
        }
      ]
    })
  })

  it('keeps a worktree setup typed with the fields still open, and shows it on Review', async () => {
    render(<AddProject {...props} />)
    await nameAndRepoIssues()
    await userEvent.type(screen.getByPlaceholderText('owner/name'), 'octo/sandtable{Enter}')
    const box = repoBox('octo/sandtable')
    folder('/Users/me/projects/sandtable', 'octo/sandtable')
    await userEvent.click(within(box).getByRole('button', { name: 'Choose folder…' }))
    await userEvent.click(
      await within(box).findByRole('button', { name: 'Add worktree setup for octo/sandtable' })
    )
    await userEvent.type(
      within(box).getByRole('textbox', { name: 'Copy from the main checkout' }),
      '.env'
    )
    await userEvent.type(within(box).getByRole('textbox', { name: 'Setup command' }), 'make')
    await next()
    expect(screen.getByTitle('1 path · make')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(api.projects.save).toHaveBeenCalledWith({
      id: ID,
      name: 'Sandtable',
      repos: [
        {
          github: 'octo/sandtable',
          path: '/Users/me/projects/sandtable',
          setup: { copy: ['.env'], command: 'make' }
        }
      ]
    })
  })

  it('omits an empty worktree setup', async () => {
    render(<AddProject {...props} />)
    await nameAndRepoIssues()
    await userEvent.type(screen.getByPlaceholderText('owner/name'), 'octo/sandtable{Enter}')
    const box = repoBox('octo/sandtable')
    folder('/Users/me/projects/sandtable', 'octo/sandtable')
    await userEvent.click(within(box).getByRole('button', { name: 'Choose folder…' }))
    await userEvent.click(
      await within(box).findByRole('button', { name: 'Add worktree setup for octo/sandtable' })
    )
    await userEvent.type(
      within(box).getByRole('textbox', { name: 'Copy from the main checkout' }),
      '{Enter}  '
    )
    await next()
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(api.projects.save).toHaveBeenCalledWith({
      id: ID,
      name: 'Sandtable',
      repos: [{ github: 'octo/sandtable', path: '/Users/me/projects/sandtable' }]
    })
  })

  it("shows an edited project's worktree setups and keeps them", async () => {
    const withSetup = {
      ...project,
      repos: [
        { ...project.repos[0], setup: { copy: ['.env'] } },
        { ...project.repos[1], setup: { command: 'npm install' } }
      ]
    }
    render(<AddProject {...props} project={withSetup} />)
    expect(screen.getByTitle('1 path')).toBeInTheDocument()
    expect(screen.getByTitle('npm install')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(within(repoBox('octo/shop')).getByText('1 path')).toBeInTheDocument()
    const front = repoBox('octo/shop-web')
    expect(within(front).getByText('npm install')).toBeInTheDocument()
    const edit = within(front).getByRole('button', {
      name: 'Edit worktree setup for octo/shop-web'
    })
    await userEvent.click(edit)
    expect(within(front).getByRole('textbox', { name: 'Setup command' })).toHaveValue('npm install')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(api.projects.save).toHaveBeenCalledWith(withSetup)
  })

  it("keeps an edited project's setup typed with the fields still open", async () => {
    render(<AddProject {...props} project={project} />)
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    const box = repoBox('octo/shop')
    await userEvent.click(
      within(box).getByRole('button', { name: 'Add worktree setup for octo/shop' })
    )
    await userEvent.type(within(box).getByRole('textbox', { name: 'Setup command' }), 'make')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByTitle('make')).toHaveTextContent('Worktree setup: make')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(api.projects.save).toHaveBeenCalledWith({
      ...project,
      repos: [{ ...project.repos[0], setup: { command: 'make' } }, project.repos[1]]
    })
  })

  it("suggests a setup for a repo with none, and Use saves it to the project's saved repos", async () => {
    vi.mocked(api.setup.suggest).mockImplementation(async (path) =>
      path === project.repos[0].path ? { copy: ['.env'], command: 'npm install' } : null
    )
    const withSetup = {
      ...project,
      repos: [project.repos[0], { ...project.repos[1], setup: { command: 'make' } }]
    }
    const onChanged = vi.fn()
    render(<AddProject {...props} project={withSetup} repo="octo/shop" onChanged={onChanged} />)
    const box = repoBox('octo/shop')
    const use = await within(box).findByRole('button', {
      name: 'Use suggested worktree setup for octo/shop'
    })
    expect(use).toHaveFocus()
    expect(within(box).getByText(/Suggested:/)).toHaveTextContent(
      'Suggested: copy .env · npm install'
    )
    expect(within(repoBox('octo/shop-web')).queryByText(/Suggested:/)).toBeNull()
    expect(api.setup.suggest).toHaveBeenCalledTimes(1)
    await userEvent.click(use)
    expect(api.projects.save).toHaveBeenCalledWith({
      ...withSetup,
      repos: [
        { ...project.repos[0], setup: { copy: ['.env'], command: 'npm install' } },
        withSetup.repos[1]
      ]
    })
    expect(await within(box).findByRole('status')).toHaveTextContent('Saved')
    expect(within(box).getByText('1 path · npm install')).toBeInTheDocument()
    expect(within(box).queryByText(/Suggested:/)).toBeNull()
    expect(onChanged).toHaveBeenCalled()
    expect(props.onSaved).not.toHaveBeenCalled()
  })

  it('fills the editor without saving when Use is on a project not saved yet', async () => {
    vi.mocked(api.setup.suggest).mockResolvedValue({ copy: ['.env'], command: 'npm install' })
    render(<AddProject {...props} />)
    await nameAndRepoIssues()
    await userEvent.type(screen.getByPlaceholderText('owner/name'), 'octo/sandtable{Enter}')
    folder('/Users/me/projects/sandtable', 'octo/sandtable')
    const box = repoBox('octo/sandtable')
    await userEvent.click(within(box).getByRole('button', { name: 'Choose folder…' }))
    await userEvent.click(
      await within(box).findByRole('button', {
        name: 'Use suggested worktree setup for octo/sandtable'
      })
    )
    expect(within(box).getByRole('textbox', { name: 'Setup command' })).toHaveValue('npm install')
    expect(api.projects.save).not.toHaveBeenCalled()
  })

  it("shows why Use couldn't save the setup", async () => {
    vi.mocked(api.setup.suggest).mockResolvedValue({ copy: ['.env'], command: '' })
    vi.mocked(api.projects.save).mockRejectedValueOnce(new Error("Can't copy .env: git tracks it"))
    render(<AddProject {...props} project={project} repo="octo/shop" />)
    const box = repoBox('octo/shop')
    await userEvent.click(
      await within(box).findByRole('button', {
        name: 'Use suggested worktree setup for octo/shop'
      })
    )
    expect(
      await screen.findByText(/Couldn't save the worktree setup: .*git tracks it/)
    ).toBeInTheDocument()
    expect(within(box).getByText('None')).toBeInTheDocument()
  })

  it('shows no suggestion when there is nothing to suggest', async () => {
    render(<AddProject {...props} project={project} repo="octo/shop" />)
    await waitFor(() => expect(api.setup.suggest).toHaveBeenCalledTimes(2))
    expect(screen.queryByText(/Suggested:/)).toBeNull()
  })

  it('validates a typed repo and refuses a duplicate', async () => {
    render(<AddProject {...props} />)
    await nameAndRepoIssues()
    await userEvent.type(screen.getByPlaceholderText('owner/name'), 'sandtable{Enter}')
    expect(screen.getByText('Enter a repo as owner/name, such as acme/api.')).toBeInTheDocument()
    await userEvent.clear(screen.getByPlaceholderText('owner/name'))
    await userEvent.type(screen.getByPlaceholderText('owner/name'), 'octo/sandtable{Enter}')
    await userEvent.type(screen.getByPlaceholderText('owner/name'), 'Octo/Sandtable{Enter}')
    expect(screen.getByText('Octo/Sandtable is already in this project.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Remove octo/sandtable' }))
    expect(screen.getByText('No repos yet.')).toBeInTheDocument()
  })

  it('fills in the repo from a folder picked first', async () => {
    render(<AddProject {...props} />)
    await nameAndRepoIssues()
    folder('/Users/me/projects/sandtable', 'octo/sandtable')
    await userEvent.click(screen.getByRole('button', { name: 'Add from a folder…' }))
    expect(
      await screen.findByText("Filled in octo/sandtable from the folder's remote.")
    ).toBeInTheDocument()
    expect(within(repoBox('octo/sandtable')).getByText('~/projects/sandtable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
  })

  it('lets you choose the repo when a folder picked first has several', async () => {
    render(<AddProject {...props} />)
    await nameAndRepoIssues()
    folder('/Users/me/projects/fork', 'me/sandtable', 'octo/sandtable')
    await userEvent.click(screen.getByRole('button', { name: 'Add from a folder…' }))
    await userEvent.click(await screen.findByRole('button', { name: 'octo/sandtable' }))
    expect(
      screen.getByText("Filled in octo/sandtable from the folder's remote.")
    ).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'me/sandtable' })).not.toBeInTheDocument()
  })

  it('refuses a folder picked first without a GitHub remote, or from off the board', async () => {
    render(<AddProject {...props} />)
    await nameAndRepoIssues()
    folder('/Users/me/notes')
    await userEvent.click(screen.getByRole('button', { name: 'Add from a folder…' }))
    expect(
      await screen.findByText(
        "This folder has no GitHub remote, so Sandtable can't tell which repo it is."
      )
    ).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await userEvent.click(screen.getByRole('radio', { name: /GitHub Projects board/ }))
    await userEvent.type(screen.getByLabelText('Board URL'), `${URL}{Enter}`)
    await screen.findByText('Board loaded: tickets from 2 repos')
    await next()
    folder('/Users/me/projects/sandtable', 'octo/sandtable')
    await userEvent.click(screen.getByRole('button', { name: 'Add from a folder…' }))
    expect(
      await screen.findByText('No tickets on this board come from octo/sandtable.')
    ).toBeInTheDocument()
  })

  describe('Jira project', () => {
    const SITE = 'acme.atlassian.net'
    const PROJECTS = [
      { key: 'INF', name: 'Internal' },
      { key: 'OPS', name: 'Operations' }
    ]
    beforeEach(() => {
      vi.mocked(api.projects.jiraAccounts).mockResolvedValue([
        { site: SITE, email: 'me@example.com' }
      ])
      vi.mocked(api.projects.jiraProjects).mockResolvedValue(PROJECTS)
    })
    const chooseJira = async (): Promise<void> => {
      await userEvent.type(screen.getByLabelText('Name'), 'Shop')
      await next()
      await userEvent.click(screen.getByRole('radio', { name: /Jira project/ }))
    }

    it('picks a saved account, filters its projects, and saves the Jira project', async () => {
      const onSaved = vi.fn()
      render(<AddProject {...props} onSaved={onSaved} />)
      await chooseJira()
      expect(
        screen.getByText(
          "Tickets are a Jira project's issues. Columns follow each issue's status category."
        )
      ).toBeInTheDocument()
      const account = await screen.findByRole('radio', { name: new RegExp(SITE) })
      expect(account).toHaveAccessibleName(`${SITE} me@example.com · token encrypted on this Mac`)
      expect(screen.getAllByText('Choose a Jira account')).not.toHaveLength(0)
      await userEvent.click(account)
      expect(api.projects.jiraProjects).toHaveBeenCalledWith(SITE)
      const list = await screen.findByRole('radiogroup', { name: 'Jira project' })
      expect(within(list).getAllByRole('radio')).toHaveLength(2)
      expect(screen.getAllByText('Choose a Jira project')).not.toHaveLength(0)
      await userEvent.type(screen.getByLabelText('Filter projects'), 'ops')
      expect(within(list).getAllByRole('radio')).toHaveLength(1)
      await userEvent.click(within(list).getByRole('radio', { name: /Operations/ }))
      await next()

      expect(screen.getByText(/Jira doesn't know about repos/)).toBeInTheDocument()
      await userEvent.type(screen.getByPlaceholderText('owner/name'), 'octo/shop{Enter}')
      folder('/Users/me/projects/shop', 'octo/shop')
      await userEvent.click(
        within(repoBox('octo/shop')).getByRole('button', { name: 'Choose folder…' })
      )
      await screen.findByText('Remote matches')
      expect(screen.getByRole('button', { name: /Tickets from/ })).toHaveTextContent(
        'Jira project OPS'
      )
      await next()

      expect(screen.getByText(`Jira project Operations (OPS) on ${SITE}`)).toBeInTheDocument()
      expect(screen.getByText(/Issues in the To Do category are To do/)).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      const saved = {
        id: ID,
        name: 'Shop',
        repos: [project.repos[0]],
        jira: { site: SITE, project: 'OPS', name: 'Operations' }
      }
      expect(api.projects.save).toHaveBeenCalledWith(saved)
      expect(onSaved).toHaveBeenCalledWith(saved)
    })

    it('adds an account inline, shows why Jira refused it, then loads its projects', async () => {
      vi.mocked(api.projects.jiraAccounts).mockResolvedValue([])
      vi.mocked(api.projects.jiraSignIn)
        .mockRejectedValueOnce(new Error('Jira answered 401: Unauthorized'))
        .mockResolvedValueOnce({ site: 'new.atlassian.net', email: 'a@b.co' })
      render(<AddProject {...props} />)
      await chooseJira()
      const add = await screen.findByRole('button', { name: 'Add account' })
      expect(add).toBeDisabled()
      const form = screen.getByRole('group', { name: 'Add a Jira account' })
      expect(within(form).queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
      const token = screen.getByLabelText('API token')
      expect(token).toHaveAttribute('type', 'password')
      expect(token).toHaveAttribute('autocomplete', 'off')
      await userEvent.type(screen.getByLabelText('Jira site'), 'new.atlassian.net')
      await userEvent.type(screen.getByLabelText('Atlassian email'), 'a@b.co')
      await userEvent.type(token, 'tok')
      await userEvent.click(add)
      expect(await screen.findByRole('alert')).toHaveTextContent('Jira answered 401: Unauthorized')
      await userEvent.click(screen.getByRole('button', { name: 'Add account' }))
      expect(api.projects.jiraSignIn).toHaveBeenLastCalledWith('new.atlassian.net', 'a@b.co', 'tok')
      expect(await screen.findByRole('radio', { name: /new\.atlassian\.net/ })).toBeChecked()
      expect(screen.queryByLabelText('API token')).not.toBeInTheDocument()
      expect(api.projects.jiraProjects).toHaveBeenCalledWith('new.atlassian.net')
      expect(await screen.findByRole('radiogroup', { name: 'Jira project' })).toBeInTheDocument()
    })

    it("replaces a saved site's account, and Cancel closes the form", async () => {
      vi.mocked(api.projects.jiraSignIn).mockResolvedValue({ site: SITE, email: 'new@example.com' })
      render(<AddProject {...props} />)
      await chooseJira()
      await userEvent.click(await screen.findByRole('button', { name: 'Add a Jira account…' }))
      expect(screen.getByLabelText('Jira site')).toHaveFocus()
      await userEvent.click(
        within(screen.getByRole('group', { name: 'Add a Jira account' })).getByRole('button', {
          name: 'Cancel'
        })
      )
      expect(screen.queryByLabelText('Jira site')).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Add a Jira account…' }))
      await userEvent.type(screen.getByLabelText('Jira site'), SITE)
      await userEvent.type(screen.getByLabelText('Atlassian email'), 'new@example.com')
      await userEvent.type(screen.getByLabelText('API token'), 'tok2{Enter}')
      const accounts = await screen.findAllByRole('radio', { name: new RegExp(SITE) })
      expect(accounts).toHaveLength(1)
      expect(accounts[0]).toHaveAccessibleName(
        `${SITE} new@example.com · token encrypted on this Mac`
      )
    })

    it('says when the projects cannot be loaded and offers Try again', async () => {
      vi.mocked(api.projects.jiraProjects).mockRejectedValueOnce(
        new Error('Jira answered 403: Forbidden')
      )
      render(<AddProject {...props} />)
      await chooseJira()
      await userEvent.click(await screen.findByRole('radio', { name: new RegExp(SITE) }))
      expect(await screen.findByText("Couldn't load the Jira projects.")).toBeInTheDocument()
      expect(screen.getByText('Jira answered 403: Forbidden')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
      expect(await screen.findByRole('radiogroup', { name: 'Jira project' })).toBeInTheDocument()
    })

    it('says when no project matches the filter', async () => {
      render(<AddProject {...props} />)
      await chooseJira()
      await userEvent.click(await screen.findByRole('radio', { name: new RegExp(SITE) }))
      await userEvent.type(await screen.findByLabelText('Filter projects'), 'zzz')
      expect(screen.getByText('No project matches.')).toBeInTheDocument()
    })

    it('says when the site has no projects', async () => {
      vi.mocked(api.projects.jiraProjects).mockResolvedValue([])
      render(<AddProject {...props} />)
      await chooseJira()
      await userEvent.click(await screen.findByRole('radio', { name: new RegExp(SITE) }))
      expect(await screen.findByText('No projects on this site.')).toBeInTheDocument()
      expect(screen.queryByLabelText('Filter projects')).not.toBeInTheDocument()
    })

    it("ignores a late answer from an account you've moved away from", async () => {
      const OTHER = 'other.atlassian.net'
      vi.mocked(api.projects.jiraAccounts).mockResolvedValue([
        { site: SITE, email: 'me@example.com' },
        { site: OTHER, email: 'me@example.com' }
      ])
      const answers: Record<string, { done: (v: unknown) => void; fail: (e: Error) => void }> = {}
      vi.mocked(api.projects.jiraProjects).mockImplementation(
        (site) =>
          new Promise(
            (done, fail) => (answers[site] = { done: done as (v: unknown) => void, fail })
          )
      )
      render(<AddProject {...props} />)
      await chooseJira()
      await userEvent.click(await screen.findByRole('radio', { name: new RegExp(SITE) }))
      await userEvent.click(screen.getByRole('radio', { name: new RegExp(OTHER) }))
      answers[OTHER].done([{ key: 'OPS', name: 'Operations' }])
      const list = await screen.findByRole('radiogroup', { name: 'Jira project' })
      answers[SITE].done(PROJECTS)
      await waitFor(() => expect(within(list).getAllByRole('radio')).toHaveLength(1))
      answers[SITE].fail(new Error('late'))
      await new Promise((r) => setTimeout(r, 0))
      expect(screen.queryByText('late')).not.toBeInTheDocument()
      expect(within(list).getByRole('radio', { name: /Operations/ })).toBeInTheDocument()
    })

    it('focuses the project filter once a new account’s projects load', async () => {
      vi.mocked(api.projects.jiraAccounts).mockResolvedValue([])
      vi.mocked(api.projects.jiraSignIn).mockResolvedValue({ site: SITE, email: 'me@example.com' })
      render(<AddProject {...props} />)
      await chooseJira()
      await userEvent.type(await screen.findByLabelText('Jira site'), SITE)
      await userEvent.type(screen.getByLabelText('Atlassian email'), 'me@example.com')
      await userEvent.type(screen.getByLabelText('API token'), 'tok{Enter}')
      await waitFor(() => expect(screen.getByLabelText('Filter projects')).toHaveFocus())
    })

    it('disables the account radios while signing in', async () => {
      let finish = (): void => {}
      vi.mocked(api.projects.jiraSignIn).mockReturnValue(
        new Promise((done) => (finish = () => done({ site: SITE, email: 'me@example.com' })))
      )
      render(<AddProject {...props} />)
      await chooseJira()
      await userEvent.click(await screen.findByRole('button', { name: 'Add a Jira account…' }))
      await userEvent.type(screen.getByLabelText('Jira site'), 'new.atlassian.net')
      await userEvent.type(screen.getByLabelText('Atlassian email'), 'a@b.co')
      await userEvent.type(screen.getByLabelText('API token'), 'tok{Enter}')
      expect(screen.getByRole('radio', { name: new RegExp(SITE) })).toBeDisabled()
      finish()
      await waitFor(() =>
        expect(screen.getByRole('radio', { name: new RegExp(SITE) })).toBeEnabled()
      )
    })

    it('loads the accounts once, saying so while they load', async () => {
      let finish = (): void => {}
      vi.mocked(api.projects.jiraAccounts).mockReturnValue(
        new Promise((done) => (finish = () => done([{ site: SITE, email: 'me@example.com' }])))
      )
      render(<AddProject {...props} />)
      await chooseJira()
      expect(screen.getByRole('status')).toHaveTextContent('Loading Jira accounts…')
      await userEvent.click(screen.getByRole('radio', { name: /Repo issues/ }))
      await userEvent.click(screen.getByRole('radio', { name: /Jira project/ }))
      expect(api.projects.jiraAccounts).toHaveBeenCalledTimes(1)
      finish()
      expect(await screen.findByRole('radio', { name: new RegExp(SITE) })).toBeInTheDocument()
    })

    it('closes the account form when you leave the Jira source', async () => {
      render(<AddProject {...props} />)
      await chooseJira()
      await userEvent.click(await screen.findByRole('button', { name: 'Add a Jira account…' }))
      await userEvent.click(screen.getByRole('radio', { name: /Repo issues/ }))
      await userEvent.click(screen.getByRole('radio', { name: /Jira project/ }))
      expect(screen.queryByLabelText('Jira site')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Add a Jira account…' })).toBeInTheDocument()
    })

    it('keeps the account and project when editing, even when the projects fail to load', async () => {
      vi.mocked(api.projects.jiraProjects).mockRejectedValueOnce(new Error('offline'))
      render(<AddProject {...props} project={jiraProject} />)
      await ticketsFrom()
      expect(await screen.findByText('offline')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: /Review/ }))
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(api.projects.save).toHaveBeenCalledWith(jiraProject)
    })

    it('asks for a project when the saved one is no longer listed', async () => {
      vi.mocked(api.projects.jiraProjects).mockResolvedValue([{ key: 'OPS', name: 'Operations' }])
      render(<AddProject {...props} project={jiraProject} />)
      await ticketsFrom()
      await screen.findByRole('radiogroup', { name: 'Jira project' })
      expect(screen.getAllByText('Choose a Jira project')).not.toHaveLength(0)
      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    })

    it("takes a saved project's new name from the loaded list", async () => {
      vi.mocked(api.projects.jiraProjects).mockResolvedValue([
        { key: 'INF', name: 'Internal Tools' }
      ])
      render(<AddProject {...props} project={jiraProject} />)
      await ticketsFrom()
      expect(await screen.findByRole('radio', { name: /Internal Tools/ })).toBeChecked()
      await userEvent.click(screen.getByRole('button', { name: /Review/ }))
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(api.projects.save).toHaveBeenCalledWith({
        ...jiraProject,
        jira: { ...jiraProject.jira, name: 'Internal Tools' }
      })
    })

    const pickProject = async (name: RegExp): Promise<void> => {
      await userEvent.click(await screen.findByRole('radio', { name: new RegExp(SITE) }))
      const list = await screen.findByRole('radiogroup', { name: 'Jira project' })
      await userEvent.click(within(list).getByRole('radio', { name }))
    }
    const finish = async (): Promise<void> => {
      await next()
      await userEvent.type(screen.getByPlaceholderText('owner/name'), 'octo/shop{Enter}')
      folder('/Users/me/projects/shop', 'octo/shop')
      await userEvent.click(
        within(repoBox('octo/shop')).getByRole('button', { name: 'Choose folder…' })
      )
      await screen.findByText('Remote matches')
      await next()
    }

    it("picks the project's only board and saves it", async () => {
      vi.mocked(api.projects.jiraBoards).mockResolvedValue([{ id: 379, name: 'INF board' }])
      render(<AddProject {...props} />)
      await chooseJira()
      await pickProject(/Internal/)
      const boards = await screen.findByRole('radiogroup', { name: 'Jira board' })
      expect(api.projects.jiraBoards).toHaveBeenCalledWith(SITE, 'INF')
      expect(boards).toHaveAccessibleDescription(
        'Sandtable shows what the board shows: its active sprints, or, on a board without sprints, everything outside its backlog.'
      )
      expect(within(boards).getByRole('radio', { name: /INF board/ })).toBeChecked()
      expect(
        within(boards).getByRole('radio', { name: /No board \(show every issue\)/ })
      ).not.toBeChecked()
      await finish()
      expect(screen.getByText('On board INF board')).toBeInTheDocument()
      expect(
        screen.getByText(/Only the board's issues show: those in its active sprints/)
      ).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(vi.mocked(api.projects.save).mock.calls[0][0].jira).toEqual({
        site: SITE,
        project: 'INF',
        name: 'Internal',
        board: { id: 379, name: 'INF board' }
      })
    })

    it('asks which board when there are several, and can take no board', async () => {
      vi.mocked(api.projects.jiraBoards).mockResolvedValue([
        { id: 379, name: 'INF board' },
        { id: 380, name: 'Ops view' }
      ])
      render(<AddProject {...props} />)
      await chooseJira()
      await pickProject(/Internal/)
      const boards = await screen.findByRole('radiogroup', { name: 'Jira board' })
      expect(screen.getAllByText('Choose a Jira board')).not.toHaveLength(0)
      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
      await userEvent.click(within(boards).getByRole('radio', { name: /No board/ }))
      await finish()
      expect(screen.getByText('No board, so every issue shows')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(vi.mocked(api.projects.save).mock.calls[0][0].jira).toEqual({
        site: SITE,
        project: 'INF',
        name: 'Internal'
      })
    })

    it('says when the project has no board', async () => {
      render(<AddProject {...props} />)
      await chooseJira()
      await pickProject(/Internal/)
      expect(
        await screen.findByText('This project has no board, so Sandtable shows every issue.')
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
    })

    it('says when the boards cannot be loaded and offers Try again', async () => {
      vi.mocked(api.projects.jiraBoards).mockRejectedValueOnce(new Error('Jira answered 500: Boom'))
      render(<AddProject {...props} />)
      await chooseJira()
      await pickProject(/Internal/)
      expect(await screen.findByText("Couldn't load the Jira boards.")).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
      expect(
        await screen.findByText('This project has no board, so Sandtable shows every issue.')
      ).toBeInTheDocument()
    })

    it('asks for a board when the saved one is gone and the project has several', async () => {
      vi.mocked(api.projects.jiraBoards).mockResolvedValue([
        { id: 380, name: 'Ops view' },
        { id: 381, name: 'Other' }
      ])
      render(
        <AddProject
          {...props}
          project={{
            ...jiraProject,
            jira: { ...jiraProject.jira!, board: { id: 379, name: 'Gone' } }
          }}
        />
      )
      await ticketsFrom()
      await screen.findByRole('radiogroup', { name: 'Jira board' })
      expect(screen.getAllByText('Choose a Jira board')).not.toHaveLength(0)
      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    })

    it('keeps a saved No board while the project has boards', async () => {
      vi.mocked(api.projects.jiraBoards).mockResolvedValue([{ id: 379, name: 'INF board' }])
      render(<AddProject {...props} project={jiraProject} />)
      await ticketsFrom()
      const boards = await screen.findByRole('radiogroup', { name: 'Jira board' })
      expect(within(boards).getByRole('radio', { name: /No board/ })).toBeChecked()
      await userEvent.click(screen.getByRole('button', { name: /Review/ }))
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(api.projects.save).toHaveBeenCalledWith(jiraProject)
    })

    it('keeps the board when editing, even when the boards fail to load', async () => {
      const onBoard = {
        ...jiraProject,
        jira: { ...jiraProject.jira!, board: { id: 379, name: 'INF board' } }
      }
      vi.mocked(api.projects.jiraBoards).mockRejectedValueOnce(new Error('offline'))
      render(<AddProject {...props} project={onBoard} />)
      await ticketsFrom()
      expect(await screen.findByText("Couldn't load the Jira boards.")).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: /Review/ }))
      expect(screen.getByText('On board INF board')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(api.projects.save).toHaveBeenCalledWith(onBoard)
    })

    it('keeps the account and project when editing', async () => {
      render(<AddProject {...props} project={jiraProject} />)
      expect(screen.getByRole('button', { name: /Tickets from/ })).toHaveTextContent(
        'Jira project INF'
      )
      await ticketsFrom()
      expect(screen.getByRole('radio', { name: /Jira project/ })).toBeChecked()
      expect(await screen.findByRole('radio', { name: new RegExp(SITE) })).toBeChecked()
      expect(await screen.findByRole('radio', { name: /Internal/ })).toBeChecked()
      await userEvent.click(screen.getByRole('button', { name: /Review/ }))
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(api.projects.save).toHaveBeenCalledWith(jiraProject)
    })
  })

  describe('Linear team', () => {
    const TEAMS = [
      {
        key: 'APP',
        name: 'Apps',
        projects: [
          { id: 'lp1', name: 'Launch' },
          { id: 'lp2', name: 'Later' }
        ]
      },
      { key: 'OPS', name: 'Ops', projects: [] }
    ]
    const WORKSPACES = [
      { slug: 'octo', organization: 'Octo Inc', default: false },
      { slug: 'acme', organization: 'Acme Inc', default: true }
    ]
    beforeEach(() => {
      vi.mocked(api.projects.linearWorkspaces).mockResolvedValue(WORKSPACES)
      vi.mocked(api.projects.linearTeams).mockResolvedValue(TEAMS)
    })

    it('loads the teams once, picks a team and projects, and saves the Linear team', async () => {
      const onSaved = vi.fn()
      let loaded = (): void => {}
      vi.mocked(api.projects.linearTeams).mockReturnValueOnce(
        new Promise((done) => (loaded = () => done(TEAMS)))
      )
      render(<AddProject {...props} onSaved={onSaved} />)
      await userEvent.type(screen.getByLabelText('Name'), 'Shop')
      await next()
      await userEvent.click(screen.getByRole('radio', { name: /Linear team/ }))
      expect(
        screen.getByText(/canceled, backlog, triage, and duplicate issues stay hidden/)
      ).toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent('Loading teams…')
      expect(screen.getAllByText('Loading teams…')).toHaveLength(2)
      loaded()
      expect(await screen.findByText('Choose a team')).toBeInTheDocument()
      expect(screen.queryByText('Linear projects (optional)')).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('combobox', { name: 'Team' }))
      await userEvent.click(screen.getByRole('option', { name: 'Apps (APP)' }))
      expect(screen.getByText('Leave all unchecked to show the whole team.')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('checkbox', { name: 'Launch' }))
      await userEvent.click(screen.getByRole('radio', { name: /Repo issues/ }))
      await userEvent.click(screen.getByRole('radio', { name: /Linear team/ }))
      expect(api.projects.linearTeams).toHaveBeenCalledTimes(1)
      expect(screen.getByText('Choose a team')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('combobox', { name: 'Team' }))
      await userEvent.click(screen.getByRole('option', { name: 'Apps (APP)' }))
      await userEvent.click(screen.getByRole('checkbox', { name: 'Launch' }))
      await next()

      expect(screen.getByText(/Start asks which one/)).toBeInTheDocument()
      await userEvent.type(screen.getByPlaceholderText('owner/name'), 'octo/shop{Enter}')
      folder('/Users/me/projects/shop', 'octo/shop')
      await userEvent.click(
        within(repoBox('octo/shop')).getByRole('button', { name: 'Choose folder…' })
      )
      await screen.findByText('Remote matches')
      expect(screen.getByRole('button', { name: /Tickets from/ })).toHaveTextContent(
        'Linear team APP'
      )
      await next()

      expect(screen.getByText('Apps (APP)')).toBeInTheDocument()
      expect(screen.getByText('Acme Inc (acme)')).toBeInTheDocument()
      expect(screen.getByText('Launch')).toBeInTheDocument()
      expect(screen.getByText(/Unstarted issues are To do/)).toBeInTheDocument()
      expect(screen.queryByText(/Sandtable creates the/)).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      const saved = {
        id: ID,
        name: 'Shop',
        repos: [project.repos[0]],
        linear: { team: 'APP', projects: [{ id: 'lp1', name: 'Launch' }], workspace: 'acme' }
      }
      expect(api.projects.save).toHaveBeenCalledWith(saved)
      expect(onSaved).toHaveBeenCalledWith(saved)
    })

    it('says when the teams cannot be loaded and offers Try again', async () => {
      vi.mocked(api.projects.linearTeams).mockRejectedValueOnce(
        new Error('Linear CLI is not signed in; run `linear auth login`')
      )
      render(<AddProject {...props} />)
      await userEvent.type(screen.getByLabelText('Name'), 'Shop')
      await next()
      await userEvent.click(screen.getByRole('radio', { name: /Linear team/ }))
      expect(await screen.findByText("Couldn't load the Linear teams.")).toBeInTheDocument()
      expect(
        screen.getByText('Linear CLI is not signed in; run `linear auth login`')
      ).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
      expect(await screen.findByRole('combobox', { name: 'Team' })).toBeInTheDocument()
    })

    it('keeps the team and projects when editing, even when the teams fail to load', async () => {
      vi.mocked(api.projects.linearTeams).mockRejectedValueOnce(new Error('offline'))
      render(<AddProject {...props} project={linearProject} />)
      expect(screen.getByRole('button', { name: /Tickets from/ })).toHaveTextContent(
        'Linear team APP'
      )
      await ticketsFrom()
      expect(screen.getByRole('radio', { name: /Linear team/ })).toBeChecked()
      expect(await screen.findByText('offline')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: /Review/ }))
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(api.projects.save).toHaveBeenCalledWith({
        ...linearProject,
        linear: { ...linearProject.linear, workspace: 'acme' }
      })
    })

    const saveEdited = async (
      over: Partial<typeof linearProject>,
      change: () => Promise<void>
    ): Promise<void> => {
      render(<AddProject {...props} project={{ ...linearProject, ...over }} />)
      await ticketsFrom()
      await screen.findByRole('combobox', { name: 'Team' })
      await change()
      await userEvent.click(screen.getByRole('button', { name: /Review/ }))
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    }
    const toggle = (name: string): Promise<void> =>
      userEvent.click(screen.getByRole('checkbox', { name }))
    const savedProjects = (): unknown =>
      vi.mocked(api.projects.save).mock.calls[0][0].linear?.projects

    it('clears the projects when the team changes', async () => {
      await saveEdited({}, async () => {
        await userEvent.click(screen.getByRole('combobox', { name: 'Team' }))
        await userEvent.click(screen.getByRole('option', { name: 'Ops (OPS)' }))
      })
      expect(api.projects.save).toHaveBeenCalledWith({
        ...linearProject,
        linear: { team: 'OPS', projects: [], workspace: 'acme' }
      })
    })

    it('drops an unchecked project', async () => {
      await saveEdited({}, async () => {
        await toggle('Launch')
        await toggle('Later')
      })
      expect(savedProjects()).toEqual([{ id: 'lp2', name: 'Later' }])
    })

    it("saves the projects in the team's order", async () => {
      await saveEdited({ linear: { team: 'APP', projects: [] } }, async () => {
        await toggle('Later')
        await toggle('Launch')
      })
      expect(savedProjects()).toEqual(TEAMS[0].projects)
    })

    it('drops saved projects the team no longer has once the teams load', async () => {
      await saveEdited(
        {
          linear: {
            team: 'APP',
            projects: [{ id: 'gone', name: 'Gone' }, ...TEAMS[0].projects.slice(0, 1)]
          }
        },
        async () => {}
      )
      expect(savedProjects()).toEqual([{ id: 'lp1', name: 'Launch' }])
    })

    it("takes a saved project's new name from the loaded team", async () => {
      await saveEdited(
        { linear: { team: 'APP', projects: [{ id: 'lp1', name: 'Old' }] } },
        async () => {}
      )
      expect(savedProjects()).toEqual([{ id: 'lp1', name: 'Launch' }])
    })

    it('asks for a team when the saved one is no longer there', async () => {
      render(
        <AddProject
          {...props}
          project={{ ...linearProject, linear: { team: 'ZZZ', projects: [] } }}
        />
      )
      await ticketsFrom()
      expect(await screen.findByRole('combobox', { name: 'Team' })).toHaveTextContent('Choose')
      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
      expect(screen.getAllByText('Choose a team')).not.toHaveLength(0)
    })

    it('lists the workspaces, preselects the default one, and loads its teams', async () => {
      render(<AddProject {...props} />)
      await userEvent.type(screen.getByLabelText('Name'), 'Shop')
      await next()
      await userEvent.click(screen.getByRole('radio', { name: /Linear team/ }))
      expect(await screen.findByRole('combobox', { name: 'Workspace' })).toHaveTextContent(
        'Acme Inc (acme)'
      )
      await screen.findByRole('combobox', { name: 'Team' })
      expect(api.projects.linearTeams).toHaveBeenCalledWith('acme')
      await userEvent.click(screen.getByRole('combobox', { name: 'Workspace' }))
      expect(screen.getByRole('option', { name: 'Octo Inc (octo)' })).toBeInTheDocument()
    })

    it("preselects the project's saved workspace when editing", async () => {
      render(
        <AddProject
          {...props}
          project={{ ...linearProject, linear: { ...linearProject.linear!, workspace: 'octo' } }}
        />
      )
      await ticketsFrom()
      expect(await screen.findByRole('combobox', { name: 'Workspace' })).toHaveTextContent(
        'Octo Inc (octo)'
      )
      expect(await screen.findByRole('combobox', { name: 'Team' })).toHaveTextContent('Apps (APP)')
      expect(api.projects.linearTeams).toHaveBeenCalledWith('octo')
    })

    it('clears the team and loads the teams of a workspace you switch to', async () => {
      await saveEdited({}, async () => {
        vi.mocked(api.projects.linearTeams).mockResolvedValueOnce([
          { key: 'OPS', name: 'Ops', projects: [] }
        ])
        await userEvent.click(screen.getByRole('combobox', { name: 'Workspace' }))
        await userEvent.click(screen.getByRole('option', { name: 'Octo Inc (octo)' }))
        expect(api.projects.linearTeams).toHaveBeenLastCalledWith('octo')
        expect(await screen.findByRole('combobox', { name: 'Team' })).toHaveTextContent('Choose')
        expect(screen.queryByText('Linear projects (optional)')).not.toBeInTheDocument()
        await userEvent.click(screen.getByRole('combobox', { name: 'Team' }))
        await userEvent.click(screen.getByRole('option', { name: 'Ops (OPS)' }))
      })
      expect(api.projects.save).toHaveBeenCalledWith({
        ...linearProject,
        linear: { team: 'OPS', projects: [], workspace: 'octo' }
      })
    })

    it('blocks Continue when the teams of a workspace you switch to fail to load', async () => {
      render(<AddProject {...props} project={linearProject} />)
      await ticketsFrom()
      await screen.findByRole('combobox', { name: 'Team' })
      vi.mocked(api.projects.linearTeams).mockRejectedValueOnce(new Error('offline'))
      await userEvent.click(screen.getByRole('combobox', { name: 'Workspace' }))
      await userEvent.click(screen.getByRole('option', { name: 'Octo Inc (octo)' }))
      expect(await screen.findByText("Couldn't load the Linear teams.")).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
      expect(screen.getAllByText('Load the Linear teams')).not.toHaveLength(0)
      await userEvent.click(screen.getByRole('button', { name: /Review/ }))
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    })

    it("falls back to the default workspace and clears the team when the saved one isn't signed in", async () => {
      vi.mocked(api.projects.linearTeams).mockRejectedValueOnce(new Error('offline'))
      render(
        <AddProject
          {...props}
          project={{ ...linearProject, linear: { ...linearProject.linear!, workspace: 'gone' } }}
        />
      )
      await ticketsFrom()
      expect(await screen.findByText("Couldn't load the Linear teams.")).toBeInTheDocument()
      expect(screen.getByRole('combobox', { name: 'Workspace' })).toHaveTextContent(
        'Acme Inc (acme)'
      )
      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    })

    it('ignores the teams of a workspace you switched away from', async () => {
      let late = (): void => {}
      vi.mocked(api.projects.linearTeams)
        .mockReturnValueOnce(new Promise((done) => (late = () => done(TEAMS))))
        .mockResolvedValueOnce([{ key: 'OPS', name: 'Ops', projects: [] }])
      render(<AddProject {...props} />)
      await userEvent.type(screen.getByLabelText('Name'), 'Shop')
      await next()
      await userEvent.click(screen.getByRole('radio', { name: /Linear team/ }))
      await userEvent.click(await screen.findByRole('combobox', { name: 'Workspace' }))
      await userEvent.click(screen.getByRole('option', { name: 'Octo Inc (octo)' }))
      await userEvent.click(await screen.findByRole('combobox', { name: 'Team' }))
      late()
      expect(await screen.findByRole('option', { name: 'Ops (OPS)' })).toBeInTheDocument()
      await new Promise((r) => setTimeout(r, 0))
      expect(screen.queryByRole('option', { name: 'Apps (APP)' })).not.toBeInTheDocument()
    })

    it('ignores an earlier load of the same workspace after switching away and back', async () => {
      let late = (): void => {}
      vi.mocked(api.projects.linearTeams)
        .mockReturnValueOnce(new Promise((done) => (late = () => done(TEAMS))))
        .mockReturnValue(new Promise(() => {}))
      render(<AddProject {...props} />)
      await userEvent.type(screen.getByLabelText('Name'), 'Shop')
      await next()
      await userEvent.click(screen.getByRole('radio', { name: /Linear team/ }))
      await userEvent.click(await screen.findByRole('combobox', { name: 'Workspace' }))
      await userEvent.click(screen.getByRole('option', { name: 'Octo Inc (octo)' }))
      await userEvent.click(screen.getByRole('combobox', { name: 'Workspace' }))
      await userEvent.click(screen.getByRole('option', { name: 'Acme Inc (acme)' }))
      late()
      await new Promise((r) => setTimeout(r, 0))
      expect(screen.queryByRole('combobox', { name: 'Team' })).not.toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent('Loading teams…')
    })

    it("keeps loading the switched-to workspace's teams when the earlier load fails late", async () => {
      let fail = (): void => {}
      vi.mocked(api.projects.linearTeams)
        .mockReturnValueOnce(new Promise((_, reject) => (fail = () => reject(new Error('late')))))
        .mockReturnValueOnce(new Promise(() => {}))
      render(<AddProject {...props} />)
      await userEvent.type(screen.getByLabelText('Name'), 'Shop')
      await next()
      await userEvent.click(screen.getByRole('radio', { name: /Linear team/ }))
      await userEvent.click(await screen.findByRole('combobox', { name: 'Workspace' }))
      await userEvent.click(screen.getByRole('option', { name: 'Octo Inc (octo)' }))
      fail()
      await new Promise((r) => setTimeout(r, 0))
      expect(screen.queryByText('late')).not.toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent('Loading teams…')
    })

    it("shows the CLI's reason when no workspace is signed in", async () => {
      vi.mocked(api.projects.linearWorkspaces).mockRejectedValue(
        new Error('No workspaces configured. Run `linear auth login`.')
      )
      render(<AddProject {...props} />)
      await userEvent.type(screen.getByLabelText('Name'), 'Shop')
      await next()
      await userEvent.click(screen.getByRole('radio', { name: /Linear team/ }))
      expect(await screen.findByText("Couldn't load the Linear workspaces.")).toBeInTheDocument()
      expect(
        screen.getByText('No workspaces configured. Run `linear auth login`.')
      ).toBeInTheDocument()
      expect(screen.getAllByText('Load the Linear workspaces')).not.toHaveLength(0)
      expect(api.projects.linearTeams).not.toHaveBeenCalled()
    })

    it('shows the saved team and projects once the teams load when editing', async () => {
      render(<AddProject {...props} project={linearProject} />)
      await ticketsFrom()
      expect(await screen.findByRole('combobox', { name: 'Team' })).toHaveTextContent('Apps (APP)')
      expect(screen.getByRole('checkbox', { name: 'Launch' })).toBeChecked()
      expect(screen.getByRole('checkbox', { name: 'Later' })).not.toBeChecked()
    })
  })

  it('opens on Review when editing, prefills every step, and keeps the project id', async () => {
    const onSaved = vi.fn()
    render(<AddProject {...props} project={project} onSaved={onSaved} />)
    expect(screen.getByRole('heading', { name: 'Edit Shop' })).toBeInTheDocument()
    expect(screen.getByText('Step 4 of 4')).toBeInTheDocument()
    expect(screen.getByText('~/projects/shop-web')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Tickets from/ })).toHaveTextContent(
      'Board, statuses chosen'
    )
    expect(screen.getByRole('button', { name: /Repos/ })).toHaveTextContent('2 repos')
    const back = (): Promise<void> => userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await back()
    expect(screen.getByRole('checkbox', { name: 'octo/shop-web' })).toBeChecked()
    await back()
    expect(screen.getByLabelText('Board URL')).toHaveValue(URL)
    expect(screen.getByRole('combobox', { name: 'In progress' })).toHaveTextContent('In Progress')
    await back()
    expect(screen.getByLabelText('Name')).toHaveValue('Shop')
    await userEvent.click(screen.getByRole('button', { name: /Review/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(api.projects.save).toHaveBeenCalledWith(project)
    expect(api.projects.statusOptions).not.toHaveBeenCalled()
  })

  it.each([
    ['On', true],
    ['Off', false]
  ])('saves Remote Control %s from the review step', async (choice, on) => {
    render(<AddProject {...props} project={project} />)
    await userEvent.click(screen.getByRole('button', { name: /Review/ }))
    const group = screen.getByRole('radiogroup', { name: 'Remote Control' })
    expect(within(group).getByRole('radio', { name: /Use the Settings default/ })).toBeChecked()
    await userEvent.click(within(group).getByRole('radio', { name: new RegExp(`^${choice}`) }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(api.projects.save).toHaveBeenCalledWith({ ...project, remoteControl: on })
  })

  it('keeps the saved Remote Control choice when editing, and the Settings default drops it', async () => {
    render(<AddProject {...props} project={{ ...project, remoteControl: false }} />)
    await userEvent.click(screen.getByRole('button', { name: /Review/ }))
    expect(screen.getByRole('radio', { name: /^Off/ })).toBeChecked()
    await userEvent.click(screen.getByRole('radio', { name: /Use the Settings default/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(api.projects.save).toHaveBeenCalledWith(project)
  })

  it('keeps done tickets 7 days by default and saves another choice', async () => {
    render(<AddProject {...props} project={project} />)
    await userEvent.click(screen.getByRole('button', { name: /Review/ }))
    const keep = screen.getByRole('combobox', { name: 'Keep done tickets' })
    expect(keep).toHaveTextContent('7 days')
    await userEvent.click(keep)
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      '1 day',
      '3 days',
      '7 days',
      '14 days',
      '30 days'
    ])
    await userEvent.click(screen.getByRole('option', { name: '30 days' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(api.projects.save).toHaveBeenCalledWith({ ...project, keepDoneDays: 30 })
  })

  it('shows the saved Keep done tickets when editing, and 7 days drops it', async () => {
    render(<AddProject {...props} project={{ ...project, keepDoneDays: 3 }} />)
    await userEvent.click(screen.getByRole('button', { name: /Review/ }))
    const keep = screen.getByRole('combobox', { name: 'Keep done tickets' })
    expect(keep).toHaveTextContent('3 days')
    await userEvent.click(keep)
    await userEvent.click(screen.getByRole('option', { name: '7 days' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(api.projects.save).toHaveBeenCalledWith(project)
  })

  it('has no token cap by default, and saves one with help text', async () => {
    render(<AddProject {...props} project={project} />)
    await userEvent.click(screen.getByRole('button', { name: /Review/ }))
    const cap = screen.getByRole('combobox', { name: 'Token cap' })
    expect(cap).toHaveTextContent('Off')
    expect(cap).toHaveAccessibleDescription(
      'Stops a session from running tools once it has used this many tokens, until you raise its cap.'
    )
    await userEvent.click(cap)
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Off',
      '10M tokens',
      '25M tokens',
      '50M tokens',
      '100M tokens',
      '250M tokens'
    ])
    await userEvent.click(screen.getByRole('option', { name: '25M tokens' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(api.projects.save).toHaveBeenCalledWith({ ...project, tokenCap: 25e6 })
  })

  it('shows the saved Token cap when editing, and Off drops it', async () => {
    render(<AddProject {...props} project={{ ...project, tokenCap: 50e6 }} />)
    await userEvent.click(screen.getByRole('button', { name: /Review/ }))
    const cap = screen.getByRole('combobox', { name: 'Token cap' })
    expect(cap).toHaveTextContent('50M tokens')
    await userEvent.click(cap)
    await userEvent.click(screen.getByRole('option', { name: 'Off' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(api.projects.save).toHaveBeenCalledWith(project)
  })

  it('uses the account default model unless you pick one, and saves the pick', async () => {
    const { rerender } = render(<AddProject {...props} project={project} />)
    await userEvent.click(screen.getByRole('button', { name: /Review/ }))
    const model = screen.getByRole('combobox', { name: 'Model' })
    expect(model).toHaveTextContent('Account default')
    await userEvent.click(model)
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Account default',
      'Fable',
      'Opus',
      'Sonnet',
      'Haiku'
    ])
    await userEvent.click(screen.getByRole('option', { name: 'Haiku' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(api.projects.save).toHaveBeenCalledWith({ ...project, model: 'haiku' })
    rerender(<AddProject {...props} project={{ ...project, model: 'haiku' }} key="again" />)
    await userEvent.click(screen.getByRole('button', { name: /Review/ }))
    await userEvent.click(screen.getByRole('combobox', { name: 'Model' }))
    await userEvent.click(screen.getByRole('option', { name: 'Account default' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(api.projects.save).toHaveBeenLastCalledWith(project)
  })

  it('opens sessions in the first editor found unless you pick one, and saves the pick', async () => {
    vi.mocked(api.app.editors).mockResolvedValue([
      { command: 'code', name: 'VS Code', path: '/x/code' },
      { command: 'cursor', name: 'Cursor', path: '/x/cursor' }
    ])
    const { rerender } = render(<AddProject {...props} project={project} />)
    await userEvent.click(screen.getByRole('button', { name: /Review/ }))
    const editor = await screen.findByRole('combobox', { name: 'Editor' })
    expect(editor).toHaveTextContent('First found')
    await userEvent.click(editor)
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'First found',
      'VS Code',
      'Cursor'
    ])
    await userEvent.click(screen.getByRole('option', { name: 'Cursor' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(api.projects.save).toHaveBeenCalledWith({ ...project, editor: 'cursor' })
    rerender(<AddProject {...props} project={{ ...project, editor: 'idea' }} key="again" />)
    await userEvent.click(screen.getByRole('button', { name: /Review/ }))
    expect(await screen.findByRole('combobox', { name: 'Editor' })).toHaveTextContent(
      'IntelliJ IDEA'
    )
    await userEvent.click(screen.getByRole('combobox', { name: 'Editor' }))
    await userEvent.click(screen.getByRole('option', { name: 'First found' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(api.projects.save).toHaveBeenLastCalledWith(project)
  })

  it('hides Editor when no editor is found', async () => {
    render(<AddProject {...props} project={project} />)
    await userEvent.click(screen.getByRole('button', { name: /Review/ }))
    await act(async () => {})
    expect(screen.queryByRole('combobox', { name: 'Editor' })).not.toBeInTheDocument()
  })

  it('checks readiness at Start by default, and saves it turned off and back on', async () => {
    const { rerender } = render(<AddProject {...props} project={project} />)
    await userEvent.click(screen.getByRole('button', { name: /Review/ }))
    const check = screen.getByRole('switch', { name: 'Readiness check' })
    expect(check).toBeChecked()
    expect(check).toHaveAccessibleDescription(/Claude reads the ticket and says what it.s missing/)
    await userEvent.click(check)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(api.projects.save).toHaveBeenCalledWith({ ...project, readyCheck: false })
    rerender(<AddProject {...props} project={{ ...project, readyCheck: false }} key="again" />)
    await userEvent.click(screen.getByRole('button', { name: /Review/ }))
    await userEvent.click(screen.getByRole('switch', { name: 'Readiness check' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(api.projects.save).toHaveBeenLastCalledWith(project)
  })

  it('leaves automatic review off by default, and saves it turned on and back off', async () => {
    const { rerender } = render(<AddProject {...props} project={project} />)
    await userEvent.click(screen.getByRole('button', { name: /Review/ }))
    const auto = screen.getByRole('switch', { name: 'Automatic review' })
    expect(auto).not.toBeChecked()
    expect(auto).toHaveAccessibleDescription(
      /sends the High proposals to the session.*You can turn it on or off for each session in its side panel\.$/
    )
    await userEvent.click(auto)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(api.projects.save).toHaveBeenCalledWith({ ...project, autoReview: true })
    rerender(<AddProject {...props} project={{ ...project, autoReview: true }} key="again" />)
    await userEvent.click(screen.getByRole('button', { name: /Review/ }))
    await userEvent.click(screen.getByRole('switch', { name: 'Automatic review' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(api.projects.save).toHaveBeenLastCalledWith(project)
  })

  it('leaves commands unsandboxed by default, and saves the sandbox with its extra domains', async () => {
    const { rerender } = render(<AddProject {...props} project={project} />)
    await userEvent.click(screen.getByRole('button', { name: /Review/ }))
    const sandbox = screen.getByRole('switch', { name: 'Sandbox commands' })
    expect(sandbox).not.toBeChecked()
    expect(screen.queryByRole('textbox', { name: 'Allowed domains' })).toBeNull()
    await userEvent.click(sandbox)
    const domains = screen.getByRole('textbox', { name: 'Allowed domains' })
    expect(domains).toHaveAccessibleDescription(
      /github\.com, api\.github\.com, and registry\.npmjs\.org/
    )
    await userEvent.type(domains, 'PyPI.org, *.example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    const saved: Project = {
      ...project,
      sandbox: true,
      sandboxDomains: ['pypi.org', '*.example.com']
    }
    expect(api.projects.save).toHaveBeenCalledWith(saved)
    rerender(<AddProject {...props} project={saved} key="again" />)
    await userEvent.click(screen.getByRole('button', { name: /Review/ }))
    expect(screen.getByRole('textbox', { name: 'Allowed domains' })).toHaveValue(
      'pypi.org, *.example.com'
    )
    await userEvent.click(screen.getByRole('switch', { name: 'Sandbox commands' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(api.projects.save).toHaveBeenLastCalledWith(project)
  })

  it('refuses an allowed domain that is not a host name', async () => {
    render(<AddProject {...props} project={project} />)
    await userEvent.click(screen.getByRole('button', { name: /Review/ }))
    await userEvent.click(screen.getByRole('switch', { name: 'Sandbox commands' }))
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Allowed domains' }),
      'https://pypi.org'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(api.projects.save).not.toHaveBeenCalled()
    expect(screen.getByText(/Not a domain: https:\/\/pypi\.org/)).toBeInTheDocument()
  })

  describe('Claude Code account', () => {
    const work = { name: 'Work', dir: '/Users/me/.claude-work' }
    beforeEach(() => {
      vi.mocked(api.accounts.list).mockResolvedValue([
        { name: 'Default', dir: '/Users/me/.claude' },
        work
      ])
    })

    it('offers each account with its folder, Default checked, and saves the one chosen', async () => {
      render(<AddProject {...props} project={project} />)
      await userEvent.click(screen.getByRole('button', { name: /Review/ }))
      const group = screen.getByRole('radiogroup', { name: 'Claude Code account' })
      expect(await within(group).findByRole('radio', { name: /^Work/ })).not.toBeChecked()
      expect(within(group).getByRole('radio', { name: /^Default/ })).toBeChecked()
      expect(within(group).getByText('~/.claude-work')).toBeInTheDocument()
      await userEvent.click(within(group).getByRole('radio', { name: /^Work/ }))
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(api.projects.save).toHaveBeenCalledWith({ ...project, claudeDir: work.dir })
    })

    it("checks Default for a project saved with Default's folder", async () => {
      render(<AddProject {...props} project={{ ...project, claudeDir: '/Users/me/.claude' }} />)
      await userEvent.click(screen.getByRole('button', { name: /Review/ }))
      expect(await screen.findByRole('radio', { name: /^Default/ })).toBeChecked()
    })

    it('reloads the accounts when Settings closes over the form', async () => {
      vi.mocked(api.accounts.list).mockResolvedValueOnce([
        { name: 'Default', dir: '/Users/me/.claude' }
      ])
      const { rerender } = render(<AddProject {...props} project={project} />)
      await userEvent.click(screen.getByRole('button', { name: /Review/ }))
      await screen.findByRole('radio', { name: /^Default/ })
      expect(screen.queryByRole('radio', { name: /^Work/ })).not.toBeInTheDocument()
      rerender(<AddProject {...props} project={project} settingsOpen />)
      rerender(<AddProject {...props} project={project} settingsOpen={false} />)
      expect(await screen.findByRole('radio', { name: /^Work/ })).toBeInTheDocument()
    })

    it('keeps the saved account when editing, and Default drops it', async () => {
      render(<AddProject {...props} project={{ ...project, claudeDir: work.dir }} />)
      await userEvent.click(screen.getByRole('button', { name: /Review/ }))
      expect(await screen.findByRole('radio', { name: /^Work/ })).toBeChecked()
      await userEvent.click(screen.getByRole('radio', { name: /^Default/ }))
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(api.projects.save).toHaveBeenCalledWith(project)
    })
  })

  describe('Icon', () => {
    const review = async (p = project): Promise<void> => {
      render(<AddProject {...props} project={p} />)
      await userEvent.click(screen.getByRole('button', { name: /Review/ }))
    }

    it('saves the emoji picked from the grid, loaded without the network, and closes it', async () => {
      const fetch = vi.spyOn(globalThis, 'fetch')
      await review()
      expect(screen.getByText(/Without one, the tile shows the first letter/)).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Choose emoji' }))
      expect(screen.getByRole('dialog', { name: 'Emoji' })).toBeInTheDocument()
      expect(screen.getByRole('searchbox', { name: 'Search emoji' })).toHaveFocus()
      expect(screen.getByRole('grid', { name: 'Emoji' })).toBeInTheDocument()
      await userEvent.click(await screen.findByRole('gridcell', { name: 'Grinning face' }))
      expect(screen.queryByRole('searchbox', { name: 'Search emoji' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Change emoji' })).toHaveFocus()
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(api.projects.save).toHaveBeenCalledWith({ ...project, icon: '😀' })
      expect(fetch).not.toHaveBeenCalled()
    })

    it('shows a saved emoji when editing, and Clear drops it', async () => {
      await review({ ...project, icon: '🚀' })
      expect(screen.getByText('🚀', { ignore: '[aria-hidden="true"]' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Change emoji' })).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
      expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument()
      expect(screen.queryByText('🚀')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Choose emoji' })).toHaveFocus()
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(api.projects.save).toHaveBeenCalledWith(project)
    })

    it('picks an emoji with the keyboard alone and returns focus to the button', async () => {
      await review()
      screen.getByRole('button', { name: 'Choose emoji' }).focus()
      await userEvent.keyboard('{Enter}')
      await screen.findByRole('gridcell', { name: 'Grinning face' })
      await userEvent.keyboard('octopus')
      await waitFor(() =>
        expect(screen.getAllByRole('gridcell').map((c) => c.getAttribute('aria-label'))).toEqual([
          'Octopus'
        ])
      )
      await userEvent.keyboard('{ArrowDown}{Enter}')
      expect(screen.queryByRole('dialog', { name: 'Emoji' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Change emoji' })).toHaveFocus()
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(api.projects.save).toHaveBeenCalledWith({ ...project, icon: '🐙' })
    })

    it('closes on Escape and returns focus to the button', async () => {
      await review()
      await userEvent.click(screen.getByRole('button', { name: 'Choose emoji' }))
      expect(screen.getByRole('dialog', { name: 'Emoji' })).toBeInTheDocument()
      await userEvent.keyboard('{Escape}')
      expect(screen.queryByRole('dialog', { name: 'Emoji' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Choose emoji' })).toHaveFocus()
    })

    it('disables the Review controls while saving', async () => {
      vi.mocked(api.projects.save).mockReturnValue(new Promise(() => {}))
      await review({ ...project, icon: '🚀' })
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(screen.getByRole('button', { name: 'Change emoji' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled()
      expect(screen.getByRole('radio', { name: /Use the Settings default/ })).toBeDisabled()
    })

    it('shows when no emoji matches the search', async () => {
      await review()
      await userEvent.click(screen.getByRole('button', { name: 'Choose emoji' }))
      await userEvent.keyboard('zzzz')
      expect(await screen.findByRole('status')).toHaveTextContent('No emoji match')
    })
  })

  describe('Instructions', () => {
    const tab = (name: string | RegExp): HTMLElement => screen.getByRole('tab', { name })
    const field = (): HTMLElement => screen.getByRole('textbox', { name: /^Instructions for/ })
    async function addLabel(name: string): Promise<void> {
      await userEvent.click(screen.getByRole('button', { name: 'Add label' }))
      await userEvent.type(screen.getByPlaceholderText('Label name'), `${name}{Enter}`)
    }

    it('saves text for every ticket and for a label', async () => {
      render(<AddProject {...props} project={project} />)
      expect(tab('Every ticket')).toHaveAttribute('aria-selected', 'true')
      await userEvent.type(field(), 'Run the tests.')
      await addLabel('bug')
      expect(tab('bug')).toHaveAttribute('aria-selected', 'true')
      expect(field()).toHaveValue('')
      expect(field()).toHaveFocus()
      await userEvent.type(field(), 'Write a failing test first.')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(api.projects.save).toHaveBeenCalledWith({
        ...project,
        instructions: {
          all: 'Run the tests.',
          labels: [{ label: 'bug', text: 'Write a failing test first.' }]
        }
      })
    })

    it('shows saved instructions, moves between tabs with the arrow keys, and Remove drops a label', async () => {
      render(
        <AddProject
          {...props}
          project={{
            ...project,
            instructions: { all: 'Run the tests.', labels: [{ label: 'bug', text: 'Repro it.' }] }
          }}
        />
      )
      expect(field()).toHaveValue('Run the tests.')
      tab('Every ticket').focus()
      await userEvent.keyboard('{ArrowRight}')
      expect(tab('bug')).toHaveFocus()
      expect(tab('bug')).toHaveAttribute('aria-selected', 'true')
      expect(field()).toHaveValue('Repro it.')
      await userEvent.click(screen.getByRole('button', { name: 'Remove bug' }))
      expect(screen.queryByRole('tab', { name: 'bug' })).not.toBeInTheDocument()
      expect(tab('Every ticket')).toHaveAttribute('aria-selected', 'true')
      expect(field()).toHaveFocus()
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(api.projects.save).toHaveBeenCalledWith({
        ...project,
        instructions: { all: 'Run the tests.' }
      })
    })

    it('saves no instructions key when nothing is typed', async () => {
      render(<AddProject {...props} project={project} />)
      await addLabel('bug')
      await userEvent.type(field(), '   ')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(api.projects.save).toHaveBeenCalledWith(project)
    })

    it("suggests the board's labels when editing, and selects a label already added", async () => {
      vi.mocked(api.board.get).mockResolvedValue(
        boardView({
          tickets: [
            ticket(1, {
              labels: [
                { name: 'bug', color: 'd73a4a' },
                { name: 'sandtable: in progress', color: 'ededed' }
              ]
            }),
            ticket(2, {
              labels: [
                { name: 'Bug', color: 'd73a4a' },
                { name: 'docs', color: '0075ca' }
              ]
            })
          ]
        })
      )
      render(<AddProject {...props} project={project} />)
      await waitFor(() => expect(api.board.get).toHaveBeenCalledWith('p1'))
      await userEvent.click(screen.getByRole('button', { name: 'Add label' }))
      expect(await screen.findByRole('button', { name: 'bug' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Bug' })).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'sandtable: in progress' })
      ).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'docs' }))
      expect(tab('docs')).toHaveAttribute('aria-selected', 'true')
      await userEvent.click(screen.getByRole('button', { name: 'Add label' }))
      expect(screen.queryByRole('button', { name: 'docs' })).not.toBeInTheDocument()
      await userEvent.type(screen.getByPlaceholderText('Label name'), 'BUG{Enter}')
      await userEvent.click(screen.getByRole('button', { name: 'Add label' }))
      await userEvent.type(screen.getByPlaceholderText('Label name'), 'DOCS{Enter}')
      expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
        'Every ticket',
        'docs',
        'BUG'
      ])
      expect(tab('docs')).toHaveAttribute('aria-selected', 'true')
    })

    it('shows only the field for a new project', async () => {
      render(<AddProject {...props} />)
      await nameAndRepoIssues()
      await userEvent.type(screen.getByPlaceholderText('owner/name'), 'octo/sandtable{Enter}')
      folder('/Users/me/projects/sandtable', 'octo/sandtable')
      await userEvent.click(screen.getByRole('button', { name: 'Choose folder…' }))
      await screen.findByText('Remote matches')
      await next()
      await addLabel('bug')
      expect(tab('bug')).toHaveAttribute('aria-selected', 'true')
      expect(api.board.get).not.toHaveBeenCalled()
    })

    it('clears the typed label when the popover closes', async () => {
      render(<AddProject {...props} project={project} />)
      await userEvent.click(screen.getByRole('button', { name: 'Add label' }))
      await userEvent.type(screen.getByPlaceholderText('Label name'), 'bug{Escape}')
      await userEvent.click(screen.getByRole('button', { name: 'Add label' }))
      expect(screen.getByPlaceholderText('Label name')).toHaveValue('')
    })

    it('blocks Save while the instructions are over 3,000 bytes', async () => {
      render(
        <AddProject
          {...props}
          project={{ ...project, instructions: { all: 'é'.repeat(1480) + 'x' } }}
        />
      )
      const save = screen.getByRole('button', { name: 'Save' })
      expect(save).toBeEnabled()
      await userEvent.type(field(), 'ab')
      expect(save).toBeEnabled()
      await userEvent.type(field(), 'c')
      expect(screen.getByText('Shorten your instructions to 3,000 bytes')).toBeInTheDocument()
      expect(save).toBeDisabled()
    })
  })

  it('jumps back from Review with Edit and returns on Cancel', async () => {
    const onCancel = vi.fn()
    render(<AddProject {...props} project={project} onCancel={onCancel} />)
    await userEvent.click(screen.getByRole('button', { name: /Review/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Edit name' }))
    expect(screen.getByRole('heading', { name: 'Name the project' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
  })

  it("doesn't jump to a step not reached", () => {
    render(<AddProject {...props} />)
    expect(screen.getByRole('button', { name: /Repos/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Repos/ })).toHaveTextContent('Not started')
  })

  it('asks before deleting an edited project and only removes it', async () => {
    const onDeleted = vi.fn()
    render(<AddProject {...props} project={project} onDeleted={onDeleted} />)
    await userEvent.click(screen.getByRole('button', { name: /Review/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete project' }))
    expect(
      screen.getByText(/clean them up in Settings under Leftover sessions/i)
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(api.projects.remove).toHaveBeenCalledWith('p1')
    expect(onDeleted).toHaveBeenCalledWith('p1')
    expect(api.sessions.removeWorktree).not.toHaveBeenCalled()
  })
})

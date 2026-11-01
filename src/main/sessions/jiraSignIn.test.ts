import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '../../shared/types'
import { jiraProject, project, setup } from '../test/orchestrator'

vi.mock('../env/tools', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../env/tools')>()),
  stopChildren: vi.fn()
}))

beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }))
afterEach(() => {
  vi.useRealTimers()
})

describe('Jira sign-in', () => {
  const site = jiraProject.jira!.site
  const ready = async (): Promise<ReturnType<typeof setup>> => {
    const t = setup({ projects: [jiraProject] })
    await t.orch.reconnect()
    return t
  }

  it('lists saved accounts without tokens', async () => {
    const t = setup()
    expect(await t.orch.jiraAccounts()).toEqual([{ site, email: 'me@example.com' }])
  })

  it('verifies a sign-in before saving it', async () => {
    const t = setup()
    expect(await t.orch.jiraSignIn(site, ' me@example.com ', ' tok ')).toEqual({
      site,
      email: 'me@example.com'
    })
    expect(t.deps.jiraClientWith).toHaveBeenCalledWith(site, 'me@example.com', 'tok')
    expect(t.jira.viewer).toHaveBeenCalled()
    expect(t.deps.jiraCredentials.save).toHaveBeenCalledWith(site, 'me@example.com', 'tok')
  })

  it('saves nothing when Jira refuses the sign-in or the site is not Jira Cloud', async () => {
    const t = setup()
    t.jira.viewer.mockRejectedValueOnce(new Error('Jira answered 401: Unauthorized'))
    await expect(t.orch.jiraSignIn(site, 'me@example.com', 'bad')).rejects.toThrow(
      'Jira answered 401'
    )
    await expect(t.orch.jiraSignIn('evil.com', 'me@example.com', 'tok')).rejects.toThrow(
      'evil.com is not a Jira Cloud site'
    )
    await expect(t.orch.jiraSignIn(site, '', 'tok')).rejects.toThrow(
      'Enter the email of your Atlassian account'
    )
    await expect(t.orch.jiraSignIn(site, 'me@example.com', ' ')).rejects.toThrow(
      'Enter an API token'
    )
    expect(t.deps.jiraClientWith).toHaveBeenCalledTimes(1)
    expect(t.deps.jiraCredentials.save).not.toHaveBeenCalled()
  })

  it('asks the site who is signed in again after a new sign-in', async () => {
    const t = await ready()
    await t.orch.me('p1')
    await t.orch.jiraSignIn(site, 'me@example.com', 'tok')
    t.jira.viewer.mockResolvedValueOnce('jira-other')
    expect(await t.orch.me('p1')).toBe('jira-other')
  })

  it('lists each Jira site projects use, once', async () => {
    const at = (id: string, site: string): Project => ({
      ...jiraProject,
      id,
      jira: { ...jiraProject.jira!, site }
    })
    const t = setup({
      projects: [at('p1', site), at('p2', 'beta.atlassian.net'), at('p3', site), project]
    })
    await t.orch.reconnect()
    expect(t.orch.usedJiraSites()).toEqual([site, 'beta.atlassian.net'])
  })

  it('says which email and token Jira wants when it refuses them', async () => {
    const t = setup()
    t.jira.viewer.mockRejectedValueOnce(
      Object.assign(new Error('Jira answered 401: Unauthorized'), { status: 401 })
    )
    await expect(t.orch.jiraSignIn(site, 'me@example.com', 'tok')).rejects.toThrow(
      "Jira didn't accept that email and API token. Use the email of the Atlassian account that made the token."
    )
  })

  it("lists a project's boards", async () => {
    const t = setup()
    expect(await t.orch.jiraBoards(site, 'INF')).toEqual([{ id: 379, name: 'INF board' }])
    expect(t.jira.boards).toHaveBeenCalledWith('INF')
    await expect(t.orch.jiraBoards('evil.com', 'INF')).rejects.toThrow('not a Jira Cloud site')
    await expect(t.orch.jiraBoards(site, 'INF" OR')).rejects.toThrow('Not a Jira project key')
  })

  it("lists a site's projects", async () => {
    const t = setup()
    expect(await t.orch.jiraProjects(site)).toEqual([{ key: 'INF', name: 'Internal' }])
    await expect(t.orch.jiraProjects('evil.com')).rejects.toThrow('not a Jira Cloud site')
  })
})

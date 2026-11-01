import type { JiraAccount, Project } from '../../shared/types'
import { isJiraProjectKey } from '../jira/client'
import { assertSite } from '../jira/rest'
import type { Orchestrator, OrchestratorDeps } from '../orchestrator'

type JiraSignInApi = Pick<
  Orchestrator,
  'usedJiraSites' | 'jiraAccounts' | 'jiraSignIn' | 'jiraProjects' | 'jiraBoards'
>

/** Builds saved Jira accounts and the Jira lookups that Add project uses. */
export function createJiraSignIn(ctx: {
  deps: Pick<OrchestratorDeps, 'jira' | 'jiraClientWith' | 'jiraCredentials'>
  projects: () => Project[]
  viewers: Map<string, Promise<string>>
}): JiraSignInApi {
  const { deps, viewers } = ctx
  return {
    usedJiraSites: (): string[] => [
      ...new Set(ctx.projects().flatMap((p) => (p.jira ? [p.jira.site] : [])))
    ],

    jiraAccounts: (): Promise<JiraAccount[]> => deps.jiraCredentials.sites(),

    async jiraSignIn(site: string, email: string, token: string): Promise<JiraAccount> {
      assertSite(site)
      const address = email.trim()
      const secret = token.trim()
      if (!address || /\s/.test(address))
        throw new Error('Enter the email of your Atlassian account')
      if (!secret || /\s/.test(secret)) throw new Error('Enter an API token')
      await deps
        .jiraClientWith(site, address, secret)
        .viewer()
        .catch((err: { status?: number }) => {
          if (err?.status !== 401) throw err
          throw new Error(
            "Jira didn't accept that email and API token. Use the email of the Atlassian account that made the token."
          )
        })
      await deps.jiraCredentials.save(site, address, secret)
      viewers.delete(`jira:${site}`)
      return { site, email: address }
    },

    async jiraProjects(site: string): Promise<{ key: string; name: string }[]> {
      assertSite(site)
      return deps.jira(site).projects()
    },

    async jiraBoards(site: string, project: string): Promise<{ id: number; name: string }[]> {
      assertSite(site)
      if (!isJiraProjectKey(project)) throw new Error('Not a Jira project key')
      return deps.jira(site).boards(project)
    }
  }
}

import { promises as fs } from 'node:fs'
import { serial, writeAtomic } from '../store'
import { assertSite, jiraRest, type JiraFn } from './rest'

type Saved = Record<string, { email: string; token: string }>

/** Saved Jira sign-ins: save one, read a site's, or list them without tokens. */
export type JiraCredentials = {
  save(site: string, email: string, token: string): Promise<void>
  get(site: string): Promise<{ email: string; token: string } | undefined>
  sites(): Promise<{ site: string; email: string }[]>
}

/** Saved Jira sign-ins per site, with each token encrypted by crypt and stored as base64. */
export function createJiraCredentials(
  file: string,
  crypt: { encrypt(s: string): Buffer; decrypt(b: Buffer): string }
): JiraCredentials {
  const load = async (): Promise<Saved> => {
    try {
      return JSON.parse(await fs.readFile(file, 'utf8')) as Saved
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw err
    }
  }
  const queue = serial()
  return {
    save: (site, email, token) =>
      queue(async () => {
        assertSite(site)
        const saved = await load()
        saved[site] = { email, token: crypt.encrypt(token).toString('base64') }
        await writeAtomic(file, JSON.stringify(saved, null, 2), 0o600)
      }),
    async get(site) {
      try {
        const saved = await load()
        const s = Object.hasOwn(saved, site) ? saved[site] : undefined
        return s && { email: s.email, token: crypt.decrypt(Buffer.from(s.token, 'base64')) }
      } catch {
        throw new Error(
          `Couldn't read the saved Jira sign-in for ${site}; add the account again in Add project`
        )
      }
    },
    sites: async () => Object.entries(await load()).map(([site, s]) => ({ site, email: s.email }))
  }
}

/** A REST transport for site that reads its saved account on each request, so a new sign-in takes effect at once. */
export const savedJiraRest =
  (credentials: Pick<JiraCredentials, 'get'>, site: string): JiraFn =>
  async (method, path, body) => {
    const saved = await credentials.get(site)
    if (!saved) throw new Error(`No Jira account for ${site}; add one in Add project`)
    return jiraRest(site, saved.email, saved.token)(method, path, body)
  }

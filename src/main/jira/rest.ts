import { fetchJson } from '../http'

/* eslint-disable @typescript-eslint/no-explicit-any */
export type JiraFn = (method: string, path: string, body?: unknown) => Promise<any>

/** Throws unless site is a Jira Cloud host, `<name>.atlassian.net`. */
export function assertSite(site: string): void {
  if (!/^[a-z0-9-]+\.atlassian\.net$/.test(site))
    throw new Error(`${site} is not a Jira Cloud site (<name>.atlassian.net)`)
}

/** A Jira REST transport for site that signs in with email and an API token. */
export function jiraRest(site: string, email: string, token: string): JiraFn {
  assertSite(site)
  const authorization = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`
  return (method, path, body) =>
    fetchJson(
      'Jira',
      `https://${site}${path}`,
      {
        method,
        headers: { authorization, accept: 'application/json', 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error'
      },
      (j) => j?.errorMessages?.[0] ?? j?.message ?? Object.values(j?.errors ?? {})[0],
      true
    )
}

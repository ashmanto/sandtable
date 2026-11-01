import type { Project } from './types'

const SANDBOX_DOMAINS = ['github.com', 'api.github.com', 'registry.npmjs.org']

/** The domains a sandboxed session of `project` can reach: the built-in ones, its tracker's host, then its own. */
export function sandboxDomains(
  project: Pick<Project, 'linear' | 'jira' | 'sandboxDomains'>
): string[] {
  const tracker = project.linear ? ['api.linear.app'] : project.jira ? [project.jira.site] : []
  return [...new Set([...SANDBOX_DOMAINS, ...tracker, ...(project.sandboxDomains ?? [])])]
}

/** Whether `d` is a host name, optionally starting with `*.`, such as `pypi.org` or `*.example.com`. */
export const isSandboxDomain = (d: string): boolean =>
  /^(\*\.)?([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(d)

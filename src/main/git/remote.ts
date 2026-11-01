import { git } from './worktree'

const GITHUB_URL =
  /^(?:https:\/\/|ssh:\/\/git@|git@)github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i

/** Reads `owner/name`, lower-cased, from a GitHub remote URL; null for any other host. */
export function githubRepoFromUrl(url: string): string | null {
  const m = GITHUB_URL.exec(url.trim())
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null
}

/** The distinct GitHub repos a folder's git remotes point at; empty if it is not a repo. */
export async function githubReposOf(path: string): Promise<string[]> {
  const { stdout, code } = await git(path, 'remote', '-v')
  if (code !== 0) return []
  const repos = stdout
    .split('\n')
    .map((line) => line.split(/\s+/)[1])
    .map((url) => (url ? githubRepoFromUrl(url) : null))
  return [...new Set(repos.filter((r): r is string => r !== null))]
}

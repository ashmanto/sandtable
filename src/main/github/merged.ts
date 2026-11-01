import type { Ticket } from '../../shared/types'
import { splitRepo, type GraphqlFn } from './graphql'
import { newestMerged } from './repoIssues'

/** A merged pull request, with the text that can name a ticket key. */
export type MergedPr = {
  number: number
  headRefName: string
  title: string
  body: string
  url: string
  mergedAt: string
  updatedAt: string
}

const MERGED = `
query($owner: String!, $name: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(
      states: MERGED
      orderBy: { field: UPDATED_AT, direction: DESC }
      first: 100
      after: $cursor
    ) {
      pageInfo { hasNextPage endCursor }
      nodes { number headRefName title body url mergedAt updatedAt }
    }
  }
}`

/** repo's merged pull requests updated at or after since, newest first, up to 500; `truncated` hears when more remain. */
export async function mergedPullRequests(
  gql: GraphqlFn,
  repo: string,
  since: string,
  truncated?: (message: string) => void
): Promise<MergedPr[]> {
  const prs: MergedPr[] = []
  let cursor: string | null = null
  for (let pages = 1; ; pages++) {
    const conn: {
      nodes: MergedPr[]
      pageInfo: { hasNextPage: boolean; endCursor: string | null }
    } = (await gql(MERGED, { ...splitRepo(repo), cursor })).repository.pullRequests
    const recent = conn.nodes.filter((p) => p.updatedAt >= since)
    prs.push(...recent)
    if (recent.length < conn.nodes.length || !conn.pageInfo.hasNextPage) return prs
    if (pages >= 5) {
      truncated?.(
        `${repo} has more than 500 merged pull requests since ${since.slice(0, 10)}, so Sandtable didn't mark merges this sync.`
      )
      return prs
    }
    cursor = conn.pageInfo.endCursor
  }
}

/** The prs whose branch, title, or body names key as a whole word. */
export function prsNaming(key: string, prs: MergedPr[]): MergedPr[] {
  const names = new RegExp(`(?<![a-z0-9])${key.replace(/[^a-z0-9]/gi, '\\$&')}(?![0-9])`, 'i')
  return prs.filter((p) => [p.headRefName, p.title, p.body].some((t) => names.test(t)))
}

/** The newest of prs that names key. */
export const mergedFor = (key: string, prs: MergedPr[]): Pick<Ticket, 'mergedPr' | 'mergedAt'> =>
  newestMerged(prsNaming(key, prs))

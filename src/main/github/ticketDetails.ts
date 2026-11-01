import type { TicketDetails } from '../../shared/types'
import { splitRepo, type GraphqlFn } from './graphql'

const PR_FIELDS = `number title url state`

const QUERY = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      body
      labels(first: 50) { nodes { name color } }
      comments(last: 100) { nodes { author { login } createdAt body } }
      closedByPullRequestsReferences(first: 20) { nodes { ${PR_FIELDS} } }
      timelineItems(first: 50, itemTypes: [CROSS_REFERENCED_EVENT, CONNECTED_EVENT]) {
        nodes {
          ... on CrossReferencedEvent { source { __typename ... on PullRequest { ${PR_FIELDS} } } }
          ... on ConnectedEvent { source { __typename ... on PullRequest { ${PR_FIELDS} } } }
        }
      }
    }
  }
}`

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Reads an issue's body, labels, comments, and linked pull requests; read-only. */
export async function fetchTicketDetails(
  gql: GraphqlFn,
  repo: string,
  number: number
): Promise<TicketDetails> {
  const { repository } = await gql(QUERY, { ...splitRepo(repo), number })
  const i = repository.issue
  if (!i) throw new Error('Issue not found')
  const prs = new Map<number, any>()
  const sources = i.timelineItems.nodes.map((n: any) => n.source)
  for (const p of [...i.closedByPullRequestsReferences.nodes, ...sources])
    if (p.number !== undefined && !prs.has(p.number)) prs.set(p.number, p)
  return {
    body: i.body,
    labels: i.labels.nodes.map((l: any) => ({ name: l.name, color: l.color })),
    comments: i.comments.nodes.map((c: any) => ({
      author: c.author?.login ?? 'ghost',
      createdAt: c.createdAt,
      body: c.body
    })),
    pullRequests: [...prs.values()].map((p) => ({
      number: p.number,
      title: p.title,
      url: p.url,
      state: p.state.toLowerCase()
    }))
  }
}

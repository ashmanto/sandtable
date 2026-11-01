import { splitRepo, type GraphqlFn } from './graphql'

const ISSUE_ID = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { issue(number: $number) { id } }
}`

const ADD_COMMENT = `
mutation($subjectId: ID!, $body: String!) {
  addComment(input: { subjectId: $subjectId, body: $body }) { clientMutationId }
}`

/** Adds a comment to an issue. */
export async function postComment(
  gql: GraphqlFn,
  repo: string,
  number: number,
  body: string
): Promise<void> {
  const { repository } = await gql(ISSUE_ID, { ...splitRepo(repo), number })
  if (!repository.issue) throw new Error(`Issue #${number} not found`)
  await gql(ADD_COMMENT, { subjectId: repository.issue.id, body })
}

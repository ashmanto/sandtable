import type { BoardSource } from '../../shared/types'
import { splitRepo, type GraphqlFn } from './graphql'

const NEWEST = 'first: 1, orderBy: { field: UPDATED_AT, direction: DESC }'

/** A string that changes when the board's fields or any issue or pull request in `repos` changes. */
export async function changeStamp(
  gql: GraphqlFn,
  board: BoardSource | undefined,
  repos: string[]
): Promise<string> {
  const params: string[] = []
  const fields: string[] = []
  const vars: Record<string, unknown> = {}
  if (board) {
    const root = board.ownerType === 'user' ? 'user' : 'organization'
    params.push('$owner: String!', '$number: Int!')
    fields.push(`${root}(login: $owner) { projectV2(number: $number) { updatedAt } }`)
    Object.assign(vars, { owner: board.owner, number: board.number })
  }
  repos.forEach((repo, i) => {
    const { owner, name } = splitRepo(repo)
    params.push(`$o${i}: String!`, `$n${i}: String!`)
    fields.push(
      `r${i}: repository(owner: $o${i}, name: $n${i}) { issues(${NEWEST}) { nodes { updatedAt } } pullRequests(${NEWEST}) { nodes { updatedAt } } }`
    )
    Object.assign(vars, { [`o${i}`]: owner, [`n${i}`]: name })
  })
  return JSON.stringify(await gql(`query(${params.join(', ')}) {\n${fields.join('\n')}\n}`, vars))
}

import { cliToken, fetchJson, type GraphqlFn } from '../http'

export { paginate, type GraphqlFn } from '../http'

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Splits `owner/name` into the variables GitHub's repository queries take. */
export const splitRepo = (repo: string): { owner: string; name: string } => {
  const [owner, name] = repo.split('/')
  return { owner, name }
}

/** A GraphQL transport that posts to endpoint with the authorization header and names service in its errors. */
export const graphqlWith =
  (endpoint: string, authorization: string, service: string): GraphqlFn =>
  async (query, variables) => {
    const json = await fetchJson(
      service,
      endpoint,
      {
        method: 'POST',
        headers: { authorization, 'content-type': 'application/json' },
        body: JSON.stringify({ query, variables })
      },
      (j) => j?.message ?? j?.errors?.[0]?.message
    )
    if (json?.errors?.length)
      throw Object.assign(new Error(json.errors.map((e: any) => e.message).join('; ')), {
        data: json.data
      })
    return json.data
  }

/** A GraphQL transport made on first use and remade after a failure or a reset. */
export const lazyGraphql = (make: () => Promise<GraphqlFn>): { gql: GraphqlFn; reset(): void } => {
  let made: Promise<GraphqlFn> | undefined
  return {
    gql: async (query, vars) => {
      const mine = (made ??= make())
      try {
        const send = await mine
        return await send(query, vars)
      } catch (err) {
        if (made === mine) made = undefined
        throw err
      }
    },
    reset: () => void (made = undefined)
  }
}

/** Authenticates with the token from `gh auth token`. */
export async function githubGraphql(): Promise<GraphqlFn> {
  const token = await cliToken('gh', 'GitHub', 'GitHub CLI is not logged in; run `gh auth login`')
  return graphqlWith('https://api.github.com/graphql', `token ${token}`, 'GitHub')
}

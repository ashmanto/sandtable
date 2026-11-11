import { run } from './env/tools'
import { parseJson } from '../shared/json'
import type { GraphqlFn } from './github/graphql'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Connection = { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: any[] }

const TOKEN_TIMEOUT_MS = 10_000
const REQUEST_TIMEOUT_MS = 30_000

const timedOut =
  (service: string) =>
  (err: any): never => {
    if (err?.name === 'TimeoutError')
      throw new Error(`${service} didn't answer within ${REQUEST_TIMEOUT_MS / 1000} seconds`)
    throw err
  }

/** Follows a query's `$cursor` through every page of one connection, up to an optional limit. */
export async function paginate(
  gql: GraphqlFn,
  query: string,
  vars: Record<string, unknown>,
  connection: (data: any) => Connection,
  limit?: { pages: number; truncated: () => void }
): Promise<any[]> {
  const nodes: any[] = []
  let cursor: string | null = null
  for (let pages = 1; ; pages++) {
    const page = connection(await gql(query, { ...vars, cursor }))
    nodes.push(...page.nodes)
    if (!page.pageInfo.hasNextPage) return nodes
    if (limit && pages >= limit.pages) {
      limit.truncated()
      return nodes
    }
    cursor = page.pageInfo.endCursor
  }
}

/** Sends a request with the request timeout and returns its JSON, or undefined for an empty body when allowEmpty; a non-2xx answer throws with its `status` and `reason(json)` or the status text. */
export async function fetchJson(
  service: string,
  url: string,
  init: RequestInit,
  reason: (json: any) => string | undefined,
  allowEmpty = false
): Promise<any> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }).catch(
    timedOut(service)
  )
  const text = await res.text().catch(timedOut(service))
  const json: any = parseJson(text)
  if (!res.ok)
    throw Object.assign(
      new Error(`${service} answered ${res.status}: ${reason(json) ?? res.statusText}`),
      { status: res.status }
    )
  if (json === undefined && (text || !allowEmpty))
    throw new Error(`${service} answered ${res.status} with a body that is not JSON`)
  return json
}

/** Runs a CLI with args, throwing when it isn't installed or doesn't answer within 10 seconds. */
export async function runCli(
  bin: string,
  service: string,
  args: string[]
): Promise<{ stdout: string; stderr: string; code: number }> {
  const startedAt = Date.now()
  const result = await run(bin, args, undefined, TOKEN_TIMEOUT_MS)
  if (result.code !== 0 && Date.now() - startedAt >= TOKEN_TIMEOUT_MS)
    throw new Error(
      `${service} CLI didn't answer \`${[bin, ...args].join(' ')}\` within 10 seconds`
    )
  if (result.code === -1)
    throw new Error(
      result.stderr.includes('ENOENT')
        ? `${service} CLI isn't installed`
        : `${service} CLI failed: ${result.stderr}`
    )
  return result
}

/** Reads a CLI's token with `<bin> auth token` and args, throwing notSignedIn when it prints none. */
export async function cliToken(
  bin: string,
  service: string,
  notSignedIn: string,
  args: string[] = []
): Promise<string> {
  const { stdout, stderr, code } = await runCli(bin, service, ['auth', 'token', ...args])
  const token = stdout.trim()
  if (code === 2 && stderr.trim()) throw new Error(stderr.trim())
  if (code !== 0 || !token) throw new Error(notSignedIn)
  return token
}

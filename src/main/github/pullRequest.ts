import { stripVTControlCharacters } from 'node:util'
import type { PullRequestState } from '../../shared/types'
import type { RunFn } from '../env/tools'
import { fitBytes, withoutUnsafe } from '../sessions/claudeLaunch'
import { splitRepo, type GraphqlFn } from './graphql'

const MAX_LOG_LINES = 200
const MAX_LOG_BYTES = 50_000

const QUERY = `query($owner: String!, $name: String!, $branch: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(headRefName: $branch, states: OPEN, first: 10) {
      nodes {
        number title url reviewDecision headRepository { nameWithOwner }
        commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
          __typename
          ... on CheckRun { databaseId name status conclusion detailsUrl checkSuite { app { slug } } }
          ... on StatusContext { context state targetUrl }
        } } } } } }
        reviewThreads(first: 100) { nodes {
          id isResolved path diffSide line startLine
          comments(first: 1) { nodes { author { login } body url diffHunk } }
        } }
      }
    }
  }
}`

const DECISIONS = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changesRequested',
  REVIEW_REQUIRED: 'reviewRequired'
} as const

type Check = PullRequestState['checks'][number]

/* eslint-disable @typescript-eslint/no-explicit-any */
const checkOf = (c: any): Check => {
  if (c.__typename === 'CheckRun') {
    const state =
      c.status !== 'COMPLETED'
        ? 'pending'
        : ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(c.conclusion)
          ? 'passing'
          : 'failing'
    return {
      name: withoutUnsafe(c.name),
      state,
      ...(c.checkSuite?.app?.slug === 'github-actions' && { jobId: c.databaseId }),
      ...(c.detailsUrl && { url: c.detailsUrl })
    }
  }
  const state =
    c.state === 'SUCCESS'
      ? 'passing'
      : ['PENDING', 'EXPECTED'].includes(c.state)
        ? 'pending'
        : 'failing'
  return { name: withoutUnsafe(c.context), state, ...(c.targetUrl && { url: c.targetUrl }) }
}

const anchorOf = (hunk: string | undefined, start: number, end: number): string | null => {
  const lines = (hunk ?? '').split(/\r?\n/).filter((l) => /^[ +-]/.test(l))
  if (!lines.length || lines[lines.length - 1].startsWith('-')) return null
  const shown = lines.filter((l) => !l.startsWith('-'))
  return shown[shown.length - 1 - (end - start)]?.slice(1) ?? null
}

/** The open pull requests whose head is `branch` in `repo`, with their checks and unresolved threads. */
export async function fetchPullRequests(
  gql: GraphqlFn,
  repo: string,
  branch: string
): Promise<PullRequestState[]> {
  const data = await gql(QUERY, { ...splitRepo(repo), branch })
  return (data.repository?.pullRequests.nodes ?? [])
    .filter((p: any) => p.headRepository?.nameWithOwner === repo)
    .map((p: any): PullRequestState => ({
      repo,
      number: p.number,
      title: p.title,
      url: p.url,
      reviewDecision: DECISIONS[p.reviewDecision as keyof typeof DECISIONS] ?? null,
      checks: (p.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? []).map(checkOf),
      threads: p.reviewThreads.nodes
        .filter((t: any) => !t.isResolved)
        .map((t: any) => {
          const c = t.comments.nodes[0]
          const line = t.diffSide === 'LEFT' ? null : t.line
          const startLine = t.diffSide === 'LEFT' ? null : t.startLine
          return {
            id: t.id,
            path: t.path,
            line,
            startLine,
            anchor: line === null ? null : anchorOf(c?.diffHunk, startLine ?? line, line),
            author: c?.author?.login ?? 'ghost',
            body: withoutUnsafe(c?.body ?? ''),
            url: c?.url ?? ''
          }
        })
    }))
}

/** The last 200 lines, and at most 50 KB, of a GitHub Actions job's failed steps' log, read through `gh`. */
export async function failedLog(
  run: RunFn,
  gh: string,
  repo: string,
  jobId: number
): Promise<string> {
  const { stdout, stderr, code } = await run(
    gh,
    ['run', 'view', '--job', String(jobId), '--log-failed', '-R', repo],
    undefined,
    60_000
  )
  if (code !== 0)
    throw new Error(
      `Couldn't read the failed log: ${stderr.trim() || `gh exited with code ${code}`}`
    )
  const lines = stripVTControlCharacters(stdout).replace(/\n$/, '').split('\n')
  return fitBytes(lines.slice(-MAX_LOG_LINES).join('\n'), MAX_LOG_BYTES, true)
}

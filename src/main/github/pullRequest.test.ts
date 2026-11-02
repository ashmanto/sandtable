import { describe, expect, it, vi } from 'vitest'
import type { RunFn } from '../env/tools'
import { failedLog, fetchPullRequests } from './pullRequest'

const answer = {
  repository: {
    pullRequests: {
      nodes: [
        {
          number: 12,
          title: 'Dark mode',
          url: 'https://github.com/o/r/pull/12',
          reviewDecision: 'CHANGES_REQUESTED',
          mergeable: 'MERGEABLE',
          isDraft: false,
          baseRefName: 'main',
          headRepository: { nameWithOwner: 'o/r' },
          commits: {
            nodes: [
              {
                commit: {
                  statusCheckRollup: {
                    state: 'FAILURE',
                    contexts: {
                      nodes: [
                        {
                          __typename: 'CheckRun',
                          databaseId: 501,
                          name: 'test',
                          status: 'COMPLETED',
                          conclusion: 'FAILURE',
                          detailsUrl: 'https://github.com/o/r/actions/runs/1/job/501',
                          checkSuite: { app: { slug: 'github-actions' } }
                        },
                        {
                          __typename: 'CheckRun',
                          databaseId: 504,
                          name: 'codecov',
                          status: 'COMPLETED',
                          conclusion: 'FAILURE',
                          detailsUrl: null,
                          checkSuite: { app: { slug: 'codecov' } }
                        },
                        {
                          __typename: 'CheckRun',
                          databaseId: 502,
                          name: 'li\u200bnt',
                          status: 'COMPLETED',
                          conclusion: 'SKIPPED',
                          detailsUrl: null,
                          checkSuite: { app: { slug: 'github-actions' } }
                        },
                        {
                          __typename: 'CheckRun',
                          databaseId: 503,
                          name: 'e2e',
                          status: 'IN_PROGRESS',
                          conclusion: null,
                          detailsUrl: null,
                          checkSuite: { app: { slug: 'github-actions' } }
                        },
                        {
                          __typename: 'StatusContext',
                          context: 'ci/legacy',
                          state: 'ERROR',
                          targetUrl: 'https://ci.example/1'
                        },
                        {
                          __typename: 'StatusContext',
                          context: 'ci/wait',
                          state: 'PENDING',
                          targetUrl: null
                        }
                      ]
                    }
                  }
                }
              }
            ]
          },
          reviewThreads: {
            nodes: [
              {
                id: 'T_1',
                isResolved: false,
                path: 'src/a.ts',
                diffSide: 'RIGHT',
                line: 9,
                startLine: 7,
                comments: {
                  nodes: [
                    {
                      author: { login: 'rev' },
                      body: 'Off by one​.',
                      diffHunk: '@@ -5,4 +5,5 @@\n ctx\r\n+let i = 0\r\n-old\n+i++\n i--',
                      url: 'https://github.com/o/r/pull/12#r1'
                    }
                  ]
                }
              },
              {
                id: 'T_2',
                isResolved: true,
                path: 'src/b.ts',
                line: 1,
                startLine: null,
                comments: { nodes: [{ author: { login: 'rev' }, body: 'Done', url: 'u' }] }
              },
              {
                id: 'T_4',
                isResolved: false,
                path: 'src/old.ts',
                diffSide: 'LEFT',
                line: 4,
                startLine: 3,
                comments: { nodes: [{ author: { login: 'rev' }, body: 'Removed?', url: 'u4' }] }
              },
              {
                id: 'T_3',
                isResolved: false,
                path: 'src/c.ts',
                line: null,
                startLine: null,
                comments: { nodes: [{ author: null, body: 'Outdated', url: 'u3' }] }
              }
            ]
          }
        },
        {
          number: 13,
          title: 'From a fork',
          url: 'https://github.com/o/r/pull/13',
          reviewDecision: null,
          mergeable: 'CONFLICTING',
          isDraft: false,
          baseRefName: 'main',
          headRepository: { nameWithOwner: 'fork/r' },
          commits: { nodes: [] },
          reviewThreads: { nodes: [] }
        }
      ]
    }
  }
}

describe('fetchPullRequests', () => {
  it("reads the open pull requests from the repo's branch with checks and unresolved threads", async () => {
    const gql = vi.fn(async () => answer)
    expect(await fetchPullRequests(gql, 'o/r', '147-dark')).toEqual([
      {
        repo: 'o/r',
        number: 12,
        title: 'Dark mode',
        url: 'https://github.com/o/r/pull/12',
        reviewDecision: 'changesRequested',
        base: 'main',
        stage: 'checksFailing',
        checks: [
          {
            name: 'test',
            state: 'failing',
            jobId: 501,
            url: 'https://github.com/o/r/actions/runs/1/job/501'
          },
          { name: 'codecov', state: 'failing' },
          { name: 'lint', state: 'passing', jobId: 502 },
          { name: 'e2e', state: 'pending', jobId: 503 },
          { name: 'ci/legacy', state: 'failing', url: 'https://ci.example/1' },
          { name: 'ci/wait', state: 'pending' }
        ],
        threads: [
          {
            id: 'T_1',
            path: 'src/a.ts',
            line: 9,
            startLine: 7,
            anchor: 'let i = 0',
            author: 'rev',
            body: 'Off by one.',
            url: 'https://github.com/o/r/pull/12#r1'
          },
          {
            id: 'T_4',
            path: 'src/old.ts',
            line: null,
            startLine: null,
            anchor: null,
            author: 'rev',
            body: 'Removed?',
            url: 'u4'
          },
          {
            id: 'T_3',
            path: 'src/c.ts',
            line: null,
            startLine: null,
            anchor: null,
            author: 'ghost',
            body: 'Outdated',
            url: 'u3'
          }
        ]
      }
    ])
    expect(gql).toHaveBeenCalledWith(expect.stringContaining('states: OPEN'), {
      owner: 'o',
      name: 'r',
      branch: '147-dark'
    })
  })

  it("anchors a thread on its line's text from the diff hunk, and not on a removed line", async () => {
    const thread = (diffHunk: string, startLine: number | null = null): object => ({
      id: 'T',
      isResolved: false,
      path: 'a.ts',
      diffSide: 'RIGHT',
      line: 3,
      startLine,
      comments: { nodes: [{ author: { login: 'rev' }, body: 'b', url: 'u', diffHunk }] }
    })
    const pr = {
      ...answer.repository.pullRequests.nodes[1],
      headRepository: { nameWithOwner: 'o/r' },
      reviewThreads: {
        nodes: [
          thread('@@ -1,2 +1,3 @@\n a\n+b'),
          thread('@@ -1,2 +1,2 @@\n a\n-b'),
          thread('@@ -1 +1 @@\n+only', 1)
        ]
      }
    }
    const gql = vi.fn(async () => ({ repository: { pullRequests: { nodes: [pr] } } }))
    const [{ threads }] = await fetchPullRequests(gql, 'o/r', 'b')
    expect(threads.map((t) => t.anchor)).toEqual(['b', null, null])
    expect(gql).toHaveBeenCalledWith(expect.stringContaining('diffHunk'), expect.anything())
  })

  it('maps no review decision and no checks', async () => {
    const pr = {
      ...answer.repository.pullRequests.nodes[1],
      headRepository: { nameWithOwner: 'o/r' }
    }
    const gql = vi.fn(async () => ({ repository: { pullRequests: { nodes: [pr] } } }))
    expect(await fetchPullRequests(gql, 'o/r', 'b')).toMatchObject([
      { number: 13, reviewDecision: null, stage: 'conflicts', checks: [], threads: [] }
    ])
  })

  it('says ready to merge for a clean, approved, green pull request', async () => {
    const pr = {
      ...answer.repository.pullRequests.nodes[1],
      url: 'https://github.com/o/r/pull/14',
      reviewDecision: 'APPROVED',
      mergeable: 'MERGEABLE',
      headRepository: { nameWithOwner: 'o/r' },
      commits: {
        nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS', contexts: { nodes: [] } } } }]
      }
    }
    const gql = vi.fn(async () => ({ repository: { pullRequests: { nodes: [pr] } } }))
    expect(await fetchPullRequests(gql, 'o/r', 'b')).toMatchObject([{ stage: 'readyToMerge' }])
  })
})

describe('failedLog', () => {
  it('runs gh with an argument array and keeps the last 200 lines', async () => {
    const log = Array.from({ length: 250 }, (_, i) => `line ${i}`).join('\n') + '\n'
    const run = vi.fn<RunFn>(async () => ({ stdout: log, stderr: '', code: 0 }))
    const out = await failedLog(run, '/bin/gh', 'o/r', 501)
    expect(run.mock.calls[0].slice(0, 2)).toEqual([
      '/bin/gh',
      ['run', 'view', '--job', '501', '--log-failed', '-R', 'o/r']
    ])
    expect(out.split('\n')).toHaveLength(200)
    expect(out.startsWith('line 50\n')).toBe(true)
    expect(out.endsWith('line 249')).toBe(true)
  })

  it('keeps the last 50 KB of a log with long lines', async () => {
    const log = Array.from({ length: 100 }, (_, i) => `${i}é`.padEnd(1000, 'x')).join('\n')
    const run = vi.fn<RunFn>(async () => ({ stdout: log, stderr: '', code: 0 }))
    const out = await failedLog(run, 'gh', 'o/r', 1)
    expect(Buffer.byteLength(out)).toBeLessThanOrEqual(50_000)
    expect(out.endsWith(log.slice(-1000))).toBe(true)
    expect(out).not.toContain('\ufffd')
  })

  it('strips terminal color codes', async () => {
    const run = vi.fn<RunFn>(async () => ({
      stdout: '\x1b[31mError\x1b[0m: x\n',
      stderr: '',
      code: 0
    }))
    expect(await failedLog(run, 'gh', 'o/r', 1)).toBe('Error: x')
  })

  it('throws with stderr when gh fails', async () => {
    const run = vi.fn<RunFn>(async () => ({ stdout: '', stderr: 'no job 9\n', code: 1 }))
    await expect(failedLog(run, 'gh', 'o/r', 9)).rejects.toThrow(
      "Couldn't read the failed log: no job 9"
    )
  })
})

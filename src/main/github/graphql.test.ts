import { afterEach, describe, expect, it, vi } from 'vitest'
import { run } from '../env/tools'
import { githubGraphql, lazyGraphql, paginate, splitRepo } from './graphql'

vi.mock('../env/tools', () => ({ run: vi.fn() }))

const respond = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status })

const signedIn = (): void => {
  vi.mocked(run).mockResolvedValue({ stdout: 'tok\n', stderr: '', code: 0 })
}

afterEach(() => {
  vi.mocked(run).mockReset()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('githubGraphql', () => {
  it('posts the query with the gh token and returns data', async () => {
    signedIn()
    const fetch = vi.fn(async () => respond(200, { data: { viewer: { login: 'a' } } }))
    vi.stubGlobal('fetch', fetch)
    const gql = await githubGraphql()
    expect(await gql('query { viewer { login } }', { x: 1 })).toEqual({ viewer: { login: 'a' } })
    expect(run).toHaveBeenCalledWith('gh', ['auth', 'token'], undefined, 10_000)
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.github.com/graphql')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ authorization: 'token tok' })
    expect(JSON.parse(init.body as string)).toEqual({
      query: 'query { viewer { login } }',
      variables: { x: 1 }
    })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('throws with the status and GitHub message on a non-2xx response', async () => {
    signedIn()
    vi.stubGlobal('fetch', async () => respond(401, { message: 'Bad credentials' }))
    const gql = await githubGraphql()
    await expect(gql('q', {})).rejects.toThrow('GitHub answered 401: Bad credentials')
  })

  it('throws the joined error messages and keeps partial data', async () => {
    signedIn()
    vi.stubGlobal('fetch', async () =>
      respond(200, {
        data: { repository: { i5: { number: 5 }, i6: null } },
        errors: [{ message: 'Could not resolve 6' }, { message: 'other' }]
      })
    )
    const gql = await githubGraphql()
    const err = await gql('q', {}).catch((e) => e)
    expect(err.message).toBe('Could not resolve 6; other')
    expect(err.data).toEqual({ repository: { i5: { number: 5 }, i6: null } })
  })

  it('gives up after 30 seconds with an error that says so', async () => {
    signedIn()
    const controller = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
    vi.stubGlobal(
      'fetch',
      (_url: string, init: RequestInit) =>
        new Promise((_, reject) =>
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        )
    )
    const gql = await githubGraphql()
    const result = gql('q', {}).catch((e) => e)
    controller.abort(new DOMException('timed out', 'TimeoutError'))
    expect((await result).message).toBe("GitHub didn't answer within 30 seconds")
    expect(timeout).toHaveBeenCalledWith(30_000)
  })

  it('says GitHub did not answer when the body read times out', async () => {
    signedIn()
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      text: async () => {
        throw new DOMException('timed out', 'TimeoutError')
      }
    }))
    const gql = await githubGraphql()
    await expect(gql('q', {})).rejects.toThrow("GitHub didn't answer within 30 seconds")
  })

  it('throws a clear error when a 2xx body is not JSON', async () => {
    signedIn()
    vi.stubGlobal('fetch', async () => new Response('<html>proxy</html>', { status: 200 }))
    const gql = await githubGraphql()
    await expect(gql('q', {})).rejects.toThrow('GitHub answered 200 with a body that is not JSON')
  })

  it('refuses an empty 2xx body', async () => {
    signedIn()
    vi.stubGlobal('fetch', async () => new Response('', { status: 200 }))
    const gql = await githubGraphql()
    await expect(gql('q', {})).rejects.toThrow('GitHub answered 200 with a body that is not JSON')
  })

  it('says gh is not logged in when it prints no token', async () => {
    vi.mocked(run).mockResolvedValue({ stdout: '', stderr: '', code: 1 })
    await expect(githubGraphql()).rejects.toThrow('not logged in')
  })

  it("says the CLI isn't installed when it can't be spawned", async () => {
    vi.mocked(run).mockResolvedValue({ stdout: '', stderr: 'spawn gh ENOENT', code: -1 })
    await expect(githubGraphql()).rejects.toThrow("GitHub CLI isn't installed")
  })

  it('gives the reason when the CLI is installed but stopped', async () => {
    vi.mocked(run).mockResolvedValue({ stdout: '', stderr: 'killed by SIGTERM', code: -1 })
    await expect(githubGraphql()).rejects.toThrow('GitHub CLI failed: killed by SIGTERM')
  })

  it("says gh didn't answer when the token command times out", async () => {
    vi.mocked(run).mockImplementation(async () => {
      vi.advanceTimersByTime(10_000)
      return { stdout: '', stderr: '', code: -1 }
    })
    vi.useFakeTimers()
    await expect(githubGraphql()).rejects.toThrow("GitHub CLI didn't answer")
  })
})

describe('paginate', () => {
  const page = (nodes: number[], endCursor: string | null): unknown => ({
    conn: { pageInfo: { hasNextPage: endCursor !== null, endCursor }, nodes }
  })

  it('follows cursors and collects nodes', async () => {
    const gql = vi
      .fn()
      .mockResolvedValueOnce(page([1, 2], 'c1'))
      .mockResolvedValueOnce(page([3], null))
    expect(await paginate(gql, 'q', { a: 1 }, (d) => d.conn)).toEqual([1, 2, 3])
    expect(gql.mock.calls.map((c) => c[1])).toEqual([
      { a: 1, cursor: null },
      { a: 1, cursor: 'c1' }
    ])
  })

  it('stops at the page limit, keeps what it fetched, and says so', async () => {
    const gql = vi.fn(async () => page([1], 'next'))
    const truncated = vi.fn()
    expect(await paginate(gql, 'q', {}, (d) => d.conn, { pages: 3, truncated })).toEqual([1, 1, 1])
    expect(gql).toHaveBeenCalledTimes(3)
    expect(truncated).toHaveBeenCalledTimes(1)
  })
})

describe('splitRepo', () => {
  it('splits owner/name', () => {
    expect(splitRepo('o/r')).toEqual({ owner: 'o', name: 'r' })
  })
})

describe('lazyGraphql', () => {
  it("keeps a newer client when an older attempt's failure lands after a reset", async () => {
    let fail: (e: Error) => void = () => undefined
    const make = vi
      .fn()
      .mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)))
      .mockResolvedValue(async () => 'new')
    const lazy = lazyGraphql(make)
    const first = lazy.gql('q', {})
    lazy.reset()
    expect(await lazy.gql('q', {})).toBe('new')
    fail(new Error('old'))
    await expect(first).rejects.toThrow('old')
    expect(await lazy.gql('q', {})).toBe('new')
    expect(make).toHaveBeenCalledTimes(2)
  })

  it('makes a new transport after a call fails', async () => {
    const make = vi
      .fn()
      .mockResolvedValueOnce(async () => {
        throw new Error('bad credentials')
      })
      .mockResolvedValue(async () => 'ok')
    const lazy = lazyGraphql(make)
    await expect(lazy.gql('q', {})).rejects.toThrow('bad credentials')
    expect(await lazy.gql('q', {})).toBe('ok')
    expect(make).toHaveBeenCalledTimes(2)
  })

  it('keeps a newer transport when an older call fails late', async () => {
    let fail: (e: Error) => void = () => undefined
    const make = vi
      .fn()
      .mockResolvedValueOnce(() => new Promise((_, reject) => (fail = reject)))
      .mockResolvedValue(async () => 'new')
    const lazy = lazyGraphql(make)
    const first = lazy.gql('q', {})
    await Promise.resolve()
    await Promise.resolve()
    lazy.reset()
    expect(await lazy.gql('q', {})).toBe('new')
    fail(new Error('old'))
    await expect(first).rejects.toThrow('old')
    expect(await lazy.gql('q', {})).toBe('new')
    expect(make).toHaveBeenCalledTimes(2)
  })

  it('tries again after a failure', async () => {
    const make = vi
      .fn()
      .mockRejectedValueOnce(new Error('not signed in'))
      .mockResolvedValue(async () => 'ok')
    const lazy = lazyGraphql(make)
    await expect(lazy.gql('q', {})).rejects.toThrow('not signed in')
    expect(await lazy.gql('q', {})).toBe('ok')
  })
})

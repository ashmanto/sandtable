import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertSite, jiraRest } from './rest'

afterEach(() => vi.unstubAllGlobals())

describe('assertSite', () => {
  it.each(['acme.atlassian.net', 'my-team2.atlassian.net'])('accepts %s', (site) => {
    expect(() => assertSite(site)).not.toThrow()
  })

  it.each([
    'evil.com',
    'acme.atlassian.net.evil.com',
    'Acme.atlassian.net',
    'a.b.atlassian.net',
    'acme.atlassian.net/x',
    'https://acme.atlassian.net',
    '.atlassian.net'
  ])('refuses %s', (site) => {
    expect(() => assertSite(site)).toThrow(`${site} is not a Jira Cloud site`)
  })
})

describe('jiraRest', () => {
  it('sends JSON with Basic auth to the site', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: 1 })))
    vi.stubGlobal('fetch', fetch)
    const rest = jiraRest('acme.atlassian.net', 'me@example.com', 'tok')
    expect(await rest('POST', '/rest/api/2/x', { a: 1 })).toEqual({ ok: 1 })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://acme.atlassian.net/rest/api/2/x')
    expect(init.method).toBe('POST')
    expect(init.redirect).toBe('error')
    expect(init.body).toBe('{"a":1}')
    expect(init.headers).toMatchObject({
      authorization: `Basic ${Buffer.from('me@example.com:tok').toString('base64')}`,
      'content-type': 'application/json'
    })
  })

  it('returns undefined for an empty answer', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 204 }))
    expect(await jiraRest('acme.atlassian.net', 'e', 't')('PUT', '/x', {})).toBeUndefined()
  })

  it('refuses a site that is not atlassian.net before sending anything', () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    expect(() => jiraRest('evil.com', 'e', 't')).toThrow('evil.com is not a Jira Cloud site')
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    [{ errorMessages: ['Issue does not exist'] }, 'Jira answered 404: Issue does not exist'],
    [{ message: 'Unauthorized' }, 'Jira answered 404: Unauthorized'],
    [
      { errorMessages: [], errors: { summary: 'Summary is required' } },
      'Jira answered 404: Summary is required'
    ]
  ])('names the first error Jira gives', async (body, message) => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(body), { status: 404 }))
    await expect(jiraRest('acme.atlassian.net', 'e', 't')('GET', '/x')).rejects.toThrow(message)
  })

  it('keeps the status on the error', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 404 }))
    await expect(jiraRest('acme.atlassian.net', 'e', 't')('GET', '/x')).rejects.toMatchObject({
      status: 404
    })
  })

  it('names the status text when the error body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      async () => new Response('<html>', { status: 502, statusText: 'Bad Gateway' })
    )
    await expect(jiraRest('acme.atlassian.net', 'e', 't')('GET', '/x')).rejects.toThrow(
      'Jira answered 502: Bad Gateway'
    )
  })

  it('refuses a 2xx body that is not JSON', async () => {
    vi.stubGlobal('fetch', async () => new Response('<html>login</html>', { status: 200 }))
    await expect(jiraRest('acme.atlassian.net', 'e', 't')('GET', '/x')).rejects.toThrow(
      'Jira answered 200 with a body that is not JSON'
    )
  })

  it('says Jira did not answer when the request times out', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new DOMException('timed out', 'TimeoutError')
    })
    await expect(jiraRest('acme.atlassian.net', 'e', 't')('GET', '/x')).rejects.toThrow(
      "Jira didn't answer within 30 seconds"
    )
  })
})

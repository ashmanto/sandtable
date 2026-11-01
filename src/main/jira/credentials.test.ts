import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createJiraCredentials, savedJiraRest } from './credentials'

const crypt = {
  encrypt: (s: string) => Buffer.from(`enc:${s}`),
  decrypt: (b: Buffer) => b.toString().replace(/^enc:/, '')
}

let dir = ''
afterEach(() => rmSync(dir, { recursive: true, force: true }))
const file = (): string => join((dir = mkdtempSync(join(tmpdir(), 'jira-cred-'))), 'jira.json')

describe('createJiraCredentials', () => {
  it('saves the token encrypted and reads it back per site', async () => {
    const path = file()
    const creds = createJiraCredentials(path, crypt)
    await creds.save('acme.atlassian.net', 'me@example.com', 'secret')
    expect(readFileSync(path, 'utf8')).not.toContain('secret')
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(await creds.get('acme.atlassian.net')).toEqual({
      email: 'me@example.com',
      token: 'secret'
    })
    expect(await createJiraCredentials(path, crypt).sites()).toEqual([
      { site: 'acme.atlassian.net', email: 'me@example.com' }
    ])
  })

  it('has no sites before anything is saved', async () => {
    const creds = createJiraCredentials(file(), crypt)
    expect(await creds.sites()).toEqual([])
    expect(await creds.get('acme.atlassian.net')).toBeUndefined()
  })

  it('replaces a site and keeps the others', async () => {
    const creds = createJiraCredentials(file(), crypt)
    await creds.save('acme.atlassian.net', 'a@example.com', 'one')
    await creds.save('globex.atlassian.net', 'b@example.com', 'two')
    await creds.save('acme.atlassian.net', 'c@example.com', 'three')
    expect(await creds.sites()).toEqual([
      { site: 'acme.atlassian.net', email: 'c@example.com' },
      { site: 'globex.atlassian.net', email: 'b@example.com' }
    ])
    expect((await creds.get('acme.atlassian.net'))?.token).toBe('three')
  })

  it('says to add the account again when the saved token cannot be read', async () => {
    const path = file()
    await createJiraCredentials(path, crypt).save('acme.atlassian.net', 'me@example.com', 'secret')
    const broken = {
      ...crypt,
      decrypt: (): string => {
        throw new Error('Error while decrypting the ciphertext provided to safeStorage')
      }
    }
    await expect(createJiraCredentials(path, broken).get('acme.atlassian.net')).rejects.toThrow(
      "Couldn't read the saved Jira sign-in for acme.atlassian.net; add the account again in Add project"
    )
  })

  it('refuses a site that is not atlassian.net', async () => {
    await expect(createJiraCredentials(file(), crypt).save('evil.com', 'e', 't')).rejects.toThrow(
      'evil.com is not a Jira Cloud site'
    )
  })
})

describe('savedJiraRest', () => {
  afterEach(() => vi.unstubAllGlobals())

  it("signs each request in with the site's saved account", async () => {
    const creds = createJiraCredentials(file(), crypt)
    await creds.save('acme.atlassian.net', 'me@example.com', 'secret')
    const fetch = vi.fn(async () => new Response('{"ok":1}'))
    vi.stubGlobal('fetch', fetch)
    expect(await savedJiraRest(creds, 'acme.atlassian.net')('GET', '/x')).toEqual({ ok: 1 })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://acme.atlassian.net/x')
    expect(init.headers).toMatchObject({
      authorization: `Basic ${Buffer.from('me@example.com:secret').toString('base64')}`
    })
  })

  it('says to add an account for a site with none', async () => {
    const rest = savedJiraRest(createJiraCredentials(file(), crypt), 'acme.atlassian.net')
    await expect(rest('GET', '/x')).rejects.toThrow(
      'No Jira account for acme.atlassian.net; add one in Add project'
    )
  })
})

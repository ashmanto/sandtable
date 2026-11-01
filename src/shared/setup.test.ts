import { describe, expect, it } from 'vitest'
import { authCommand, setupSteps, type CheckRow, type SetupStep } from './setup'
import type { ToolCheck } from './types'

const good: ToolCheck = {
  ok: true,
  missing: [],
  paths: {},
  claudeSignedIn: true,
  accounts: [],
  gh: { loggedIn: true, scopes: ['repo', 'project', 'read:org'] },
  linear: true,
  linearWorkspaces: [],
  jira: true,
  jiraSites: []
}

const rows = (check: ToolCheck): Record<string, CheckRow> =>
  Object.fromEntries(
    setupSteps(check)
      .flatMap((s) => s.rows)
      .map((r) => [r.id, r])
  )
const step = (check: ToolCheck, id: string): SetupStep =>
  setupSteps(check).find((s) => s.id === id)!

describe('authCommand', () => {
  it('runs claude auth as is for Default and with the folder for another account', () => {
    expect(authCommand('login')).toBe('claude auth login')
    expect(authCommand('status', '/Users/a/.claude-work')).toBe(
      'CLAUDE_CONFIG_DIR=/Users/a/.claude-work claude auth status'
    )
  })
})

describe('setupSteps', () => {
  it('marks everything Ready when all checks pass', () => {
    const steps = setupSteps(good)
    expect(steps.map((s) => s.id)).toEqual(['tools', 'claude', 'gh', 'linear', 'jira'])
    for (const s of steps) {
      expect(s.blocked).toBe(false)
      expect(s.warn).toBe(false)
      for (const r of s.rows) {
        expect(r.word).toBe('Ready')
        expect(r.tone).toBe('ok')
        expect(r.fix).toBeUndefined()
      }
    }
  })

  it('shows the install command for a missing tool', () => {
    const check = { ...good, ok: false, missing: ['tmux' as const] }
    expect(rows(check).tmux).toMatchObject({ word: 'Missing', tone: 'fail' })
    expect(rows(check).tmux.fix?.command).toBe('brew install tmux')
    expect(rows(check).git.word).toBe('Ready')
    expect(step(check, 'tools').blocked).toBe(true)
    expect(step(check, 'claude').blocked).toBe(false)
  })

  it('warns Not signed in with the sign-in command, without blocking', () => {
    const check = { ...good, claudeSignedIn: false }
    expect(rows(check).claudeAuth).toMatchObject({ word: 'Not signed in', tone: 'warn' })
    expect(rows(check).claudeAuth.fix?.command).toBe('claude auth login')
    expect(rows(check).claudeAuth.fix?.text).toMatch(/API key/)
    expect(step(check, 'claude')).toMatchObject({ blocked: false, warn: true })
  })

  it('shows Not logged in with the login command', () => {
    const check = { ...good, gh: { loggedIn: false, scopes: null } }
    const r = rows(check)
    expect(r.ghAuth).toMatchObject({ word: 'Not logged in', tone: 'fail' })
    expect(r.ghAuth.fix?.command).toBe('gh auth login --scopes project')
    expect(r.ghRepo).toMatchObject({ word: 'Not checked', tone: 'idle' })
    expect(r.ghProject).toMatchObject({ word: 'Not checked', tone: 'idle' })
    expect(step(check, 'gh').blocked).toBe(true)
  })

  it('blocks on the repo scope and warns on the project scope', () => {
    const noRepo = { ...good, gh: { loggedIn: true, scopes: ['project'] } }
    expect(rows(noRepo).ghRepo).toMatchObject({ word: 'Missing scope', tone: 'fail' })
    expect(rows(noRepo).ghRepo.fix?.command).toBe('gh auth refresh --scopes repo')
    expect(step(noRepo, 'gh')).toMatchObject({ blocked: true, warn: false })

    const noProject = { ...good, gh: { loggedIn: true, scopes: ['repo'] } }
    expect(rows(noProject).ghProject).toMatchObject({ word: 'Missing scope', tone: 'warn' })
    expect(rows(noProject).ghProject.fix?.command).toBe('gh auth refresh --scopes project')
    expect(step(noProject, 'gh')).toMatchObject({ blocked: false, warn: true })
  })

  it("shows Can't check without blocking", () => {
    const check = { ...good, claudeSignedIn: null }
    expect(rows(check).claudeAuth).toMatchObject({
      word: "Can't check",
      tone: 'warn',
      fix: {
        text: "Sandtable couldn't run this check. Run it yourself to see why.",
        command: 'claude auth status'
      }
    })
    expect(step(check, 'claude')).toMatchObject({ blocked: false, warn: true })

    const ghUnknown = rows({ ...good, gh: null })
    expect(ghUnknown.ghAuth).toMatchObject({
      word: "Can't check",
      tone: 'warn',
      fix: { command: 'gh auth status' }
    })
    expect(ghUnknown.ghRepo.word).toBe('Not checked')
    expect(ghUnknown.ghProject.word).toBe('Not checked')

    const noScopes = { ...good, gh: { loggedIn: true, scopes: null } }
    for (const id of ['ghRepo', 'ghProject']) {
      expect(rows(noScopes)[id]).toMatchObject({
        word: "Can't check",
        tone: 'warn',
        fix: { command: 'gh auth status' }
      })
    }
    expect(step(noScopes, 'gh')).toMatchObject({ blocked: false, warn: true })
  })

  it('leaves rows of a missing tool Not checked', () => {
    const check = {
      ...good,
      ok: false,
      missing: ['gh' as const, 'claude' as const],
      gh: null,
      claudeSignedIn: null
    }
    const r = rows(check)
    expect(r.gh).toMatchObject({ word: 'Missing', tone: 'fail' })
    expect(r.gh.fix?.command).toBe('brew install gh')
    expect(r.claude.fix?.command).toBe('npm install -g @anthropic-ai/claude-code')
    for (const id of ['ghAuth', 'ghRepo', 'ghProject', 'claudeAuth']) {
      expect(r[id]).toMatchObject({ word: 'Not checked', tone: 'idle' })
      expect(r[id].fix).toBeUndefined()
    }
    expect(step(check, 'gh')).toMatchObject({ blocked: true, warn: false })
  })

  it('only warns when the Linear CLI is missing, and leaves sign-in Not checked', () => {
    const check = { ...good, missing: ['linear' as const], linear: null }
    expect(rows(check).linear).toMatchObject({ word: 'Missing', tone: 'warn' })
    expect(rows(check).linear.fix?.command).toBe('brew install schpet/tap/linear')
    expect(rows(check).linearAuth).toMatchObject({ word: 'Not checked', tone: 'idle' })
    expect(step(check, 'linear')).toMatchObject({ blocked: false, warn: true })
  })

  it('warns Not signed in with the Linear login command, without blocking', () => {
    const check = { ...good, linear: false }
    expect(rows(check).linearAuth).toMatchObject({ word: 'Not signed in', tone: 'warn' })
    expect(rows(check).linearAuth.fix?.command).toBe('linear auth login')
    expect(step(check, 'linear')).toMatchObject({ blocked: false, warn: true })
    expect(rows({ ...good, linear: null }).linearAuth.fix?.command).toBe('linear auth whoami')
  })

  it('adds a warn-only sign-in row for each workspace a project uses', () => {
    const check = {
      ...good,
      linearWorkspaces: [
        { slug: 'acme', signedIn: true },
        { slug: 'globex', signedIn: false },
        { slug: 'odd', signedIn: null }
      ]
    }
    expect(rows(check)['linearAuth:acme']).toMatchObject({
      label: 'Signed in to acme',
      word: 'Ready'
    })
    expect(rows(check)['linearAuth:globex']).toMatchObject({
      word: 'Not signed in',
      tone: 'warn',
      fix: { command: 'linear auth login' }
    })
    expect(rows(check)['linearAuth:odd'].fix?.command).toBe('linear auth whoami --workspace odd')
    expect(step(check, 'linear')).toMatchObject({ blocked: false, warn: true })
    const missing = { ...check, missing: ['linear' as const] }
    expect(rows(missing)['linearAuth:acme']).toMatchObject({ word: 'Not checked' })
  })

  it('only warns when acli is missing, and leaves Jira sign-in Not checked', () => {
    const check = { ...good, missing: ['acli' as const], jira: null }
    expect(step(check, 'jira')).toMatchObject({ title: 'Jira CLI', blocked: false, warn: true })
    expect(rows(check).acli).toMatchObject({ label: 'acli installed', word: 'Missing' })
    expect(rows(check).acli.fix?.command).toBe(
      'brew tap atlassian/homebrew-acli && brew install acli'
    )
    expect(rows(check).jiraAuth).toMatchObject({ word: 'Not checked', tone: 'idle' })
  })

  it('warns Not signed in with the acli login command, without blocking', () => {
    const check = { ...good, jira: false }
    expect(rows(check).jiraAuth).toMatchObject({ word: 'Not signed in', tone: 'warn' })
    expect(rows(check).jiraAuth.fix?.command).toBe('acli jira auth login --web')
    expect(step(check, 'jira')).toMatchObject({ blocked: false, warn: true })
    expect(rows({ ...good, jira: null }).jiraAuth.fix?.command).toBe('acli jira auth status')
  })

  it('adds a warn-only row for each Jira site a project uses', () => {
    const check = {
      ...good,
      jiraSites: [
        { site: 'acme.atlassian.net', signedIn: true },
        { site: 'beta.atlassian.net', signedIn: false }
      ]
    }
    expect(rows(check)['jiraAuth:acme.atlassian.net']).toMatchObject({
      label: 'Signed in to acme.atlassian.net',
      word: 'Ready'
    })
    expect(rows(check)['jiraAuth:beta.atlassian.net']).toMatchObject({
      word: 'Not signed in',
      tone: 'warn',
      fix: { command: 'acli jira auth switch --site beta.atlassian.net' }
    })
    expect(step(check, 'jira')).toMatchObject({ blocked: false, warn: true })
    expect(
      rows({ ...check, missing: ['acli' as const] })['jiraAuth:acme.atlassian.net']
    ).toMatchObject({ word: 'Not checked' })
  })

  describe('accounts', () => {
    const work = { name: 'Work', dir: '/Users/a/.claude-work' }

    it('adds a signed-in row per account to the Claude Code step', () => {
      const check = { ...good, accounts: [{ ...work, signedIn: true }] }
      expect(step(check, 'claude').rows.map((r) => r.label)).toEqual([
        'claude installed',
        'Signed in',
        'Work signed in'
      ])
      expect(rows(check)['claudeAuth:/Users/a/.claude-work']).toMatchObject({
        word: 'Ready',
        tone: 'ok'
      })
    })

    it('warns Not signed in with the folder in the sign-in command, without blocking', () => {
      const check = { ...good, accounts: [{ ...work, signedIn: false }] }
      expect(rows(check)['claudeAuth:/Users/a/.claude-work']).toMatchObject({
        word: 'Not signed in',
        tone: 'warn',
        fix: { command: 'CLAUDE_CONFIG_DIR=/Users/a/.claude-work claude auth login' }
      })
      expect(step(check, 'claude')).toMatchObject({ blocked: false, warn: true })
    })

    it("shows the status command with the folder when it can't check", () => {
      const check = { ...good, accounts: [{ ...work, signedIn: null }] }
      expect(rows(check)['claudeAuth:/Users/a/.claude-work'].fix?.command).toBe(
        'CLAUDE_CONFIG_DIR=/Users/a/.claude-work claude auth status'
      )
    })

    it('quotes a folder with characters a shell would read', () => {
      const check = {
        ...good,
        accounts: [{ name: 'Odd', dir: "/Users/a b/it's", signedIn: false }]
      }
      expect(rows(check)["claudeAuth:/Users/a b/it's"].fix?.command).toBe(
        "CLAUDE_CONFIG_DIR='/Users/a b/it'\\''s' claude auth login"
      )
    })

    it('leaves an account row Not checked when claude is missing', () => {
      const check = {
        ...good,
        missing: ['claude' as const],
        accounts: [{ ...work, signedIn: null }]
      }
      expect(rows(check)['claudeAuth:/Users/a/.claude-work'].word).toBe('Not checked')
    })
  })
})

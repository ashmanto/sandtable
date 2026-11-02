import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { setupSteps } from '../../shared/setup'
import { tempDirs } from '../test/tempDirs'
import {
  accountEnv,
  checkTools,
  claudeFolders,
  claudeSignedIn,
  findEditors,
  launchDetached,
  openInEditor,
  findTools,
  loginShellPath,
  run,
  runStoppable,
  stopChildren,
  type RunFn
} from './tools'

describe('loginShellPath', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('asks the login shell for its PATH', async () => {
    vi.stubEnv('SHELL', '/bin/fish')
    const fake = vi
      .fn<RunFn>()
      .mockResolvedValue({ stdout: '/opt/homebrew/bin:/usr/bin', stderr: '', code: 0 })
    expect(await loginShellPath(fake)).toBe('/opt/homebrew/bin:/usr/bin')
    expect(fake).toHaveBeenCalledWith('/bin/fish', ['-ilc', 'printf %s "$PATH"'], undefined, 5000)
  })

  it('ignores banner lines the rc files print before the PATH', async () => {
    const fake = vi
      .fn<RunFn>()
      .mockResolvedValue({ stdout: 'Last login: x\nnvm ready\n/usr/bin:/bin', stderr: '', code: 0 })
    expect(await loginShellPath(fake)).toBe('/usr/bin:/bin')
  })

  it('returns empty when the shell exits non-zero or times out', async () => {
    const fake = vi.fn<RunFn>().mockResolvedValue({ stdout: 'garbage', stderr: '', code: -1 })
    expect(await loginShellPath(fake)).toBe('')
  })

  it('defaults to /bin/zsh', async () => {
    vi.stubEnv('SHELL', '')
    const fake = vi.fn<RunFn>().mockResolvedValue({ stdout: '/usr/bin', stderr: '', code: 0 })
    await loginShellPath(fake)
    expect(fake.mock.calls[0][0]).toBe('/bin/zsh')
  })
})

describe('findTools', () => {
  const resolve: RunFn = async (_file, args, env) => {
    expect(env?.PATH).toBe('/opt/homebrew/bin')
    return { stdout: `/opt/homebrew/bin/${args[3]}\n`, stderr: '', code: 0 }
  }

  it('returns each absolute path when all tools resolve', async () => {
    const result = await findTools('/opt/homebrew/bin', resolve)
    expect(result).toEqual({
      missing: [],
      paths: {
        tmux: '/opt/homebrew/bin/tmux',
        claude: '/opt/homebrew/bin/claude',
        gh: '/opt/homebrew/bin/gh',
        git: '/opt/homebrew/bin/git',
        linear: '/opt/homebrew/bin/linear',
        acli: '/opt/homebrew/bin/acli'
      }
    })
  })

  it('reports a tool whose lookup exits non-zero as missing', async () => {
    const fake: RunFn = async (file, args, env) =>
      args[3] === 'tmux' ? { stdout: '', stderr: '', code: 1 } : resolve(file, args, env)
    const result = await findTools('/opt/homebrew/bin', fake)
    expect(result.missing).toEqual(['tmux'])
    expect(result.paths.tmux).toBeUndefined()
  })

  it('counts a missing linear as missing too', async () => {
    const fake: RunFn = async (file, args, env) =>
      args[3] === 'linear' ? { stdout: '', stderr: '', code: 1 } : resolve(file, args, env)
    expect((await findTools('/opt/homebrew/bin', fake)).missing).toEqual(['linear'])
  })
})

describe('checkTools', () => {
  type Answer = { stdout: string; stderr?: string; code: number }
  const ghHosts = (scopes: string): string =>
    JSON.stringify({
      hosts: {
        'github.com': [
          { state: 'success', active: true, host: 'github.com', login: 'x', scopes },
          { state: 'success', active: false, host: 'github.com', login: 'y', scopes: '' }
        ]
      }
    })
  const fakeRun = (
    claude: Answer = { stdout: '{"loggedIn":true,"authMethod":"claude.ai"}', code: 0 },
    gh: Answer = { stdout: ghHosts('repo, project, read:org'), code: 0 },
    missing: string[] = [],
    linear: Answer = { stdout: 'lin_api_x\n', code: 0 },
    acli: Answer = { stdout: '✓ Authenticated\n', code: 0 }
  ): Mock<RunFn> =>
    vi.fn<RunFn>(async (file, args) => {
      if (file === '/bin/sh') {
        return missing.includes(args[3])
          ? { stdout: '', stderr: '', code: 1 }
          : { stdout: `/opt/homebrew/bin/${args[3]}\n`, stderr: '', code: 0 }
      }
      const answers: Record<string, Answer> = { claude, linear, acli }
      const answer = answers[file.slice(file.lastIndexOf('/') + 1)] ?? gh
      return { stderr: '', ...answer }
    })

  it('reports signed in and logged in with scopes', async () => {
    expect(await checkTools('/opt/homebrew/bin', fakeRun())).toMatchObject({
      ok: true,
      claudeSignedIn: true,
      gh: { loggedIn: true, scopes: ['repo', 'project', 'read:org'] }
    })
  })

  it('asks claude and gh with the resolved paths and a 10 s timeout', async () => {
    const fake = fakeRun()
    await checkTools('/opt/homebrew/bin', fake)
    const env = expect.objectContaining({ PATH: '/opt/homebrew/bin' })
    expect(fake).toHaveBeenCalledWith('/opt/homebrew/bin/claude', ['auth', 'status'], env, 10000)
    expect(fake).toHaveBeenCalledWith(
      '/opt/homebrew/bin/gh',
      ['auth', 'status', '--json', 'hosts'],
      env,
      10000
    )
  })

  it('only warns when claude is signed out', async () => {
    const result = await checkTools('/x', fakeRun({ stdout: '{"loggedIn":false}', code: 1 }))
    expect(result).toMatchObject({ ok: true, claudeSignedIn: false })
  })

  it('blocks when gh has no hosts', async () => {
    const result = await checkTools('/x', fakeRun(undefined, { stdout: '{"hosts":{}}', code: 0 }))
    expect(result).toMatchObject({ ok: false, gh: { loggedIn: false, scopes: null } })
  })

  it('blocks when the active gh token is rejected', async () => {
    const stdout = JSON.stringify({
      hosts: {
        'github.com': [
          {
            state: 'error',
            error: 'non-200 OK status code: 401 Unauthorized',
            active: true,
            host: 'github.com',
            login: '',
            tokenSource: 'GH_TOKEN',
            gitProtocol: 'https'
          }
        ]
      }
    })
    const result = await checkTools('/x', fakeRun(undefined, { stdout, code: 0 }))
    expect(result).toMatchObject({ ok: false, gh: { loggedIn: false, scopes: null } })
  })

  const ghError = (host: Record<string, unknown>): Answer => ({
    stdout: JSON.stringify({
      hosts: { 'github.com': [{ active: true, host: 'github.com', login: 'x', ...host }] }
    }),
    code: 1
  })

  it("can't check gh when it can't reach GitHub", async () => {
    const answer = ghError({
      state: 'error',
      error:
        'Get "https://api.github.com/": proxyconnect tcp: dial tcp 127.0.0.1:9: connect: connection refused'
    })
    const result = await checkTools('/x', fakeRun(undefined, answer))
    expect(result).toMatchObject({ ok: true, gh: null })
  })

  it('blocks when GitHub answers Bad credentials', async () => {
    const answer = ghError({ state: 'error', error: 'HTTP 401: Bad credentials' })
    const result = await checkTools('/x', fakeRun(undefined, answer))
    expect(result).toMatchObject({ ok: false, gh: { loggedIn: false, scopes: null } })
  })

  it('counts a timed-out gh check as logged in with unknown scopes', async () => {
    const result = await checkTools('/x', fakeRun(undefined, ghError({ state: 'timeout' })))
    expect(result).toMatchObject({ ok: true, gh: { loggedIn: true, scopes: null } })
  })

  it.each([
    ['a non-array host list', { hosts: { 'github.com': {} } }],
    [
      'non-string scopes',
      { hosts: { 'github.com': [{ active: true, state: 'success', scopes: 1 }] } }
    ]
  ])("can't check gh with %s", async (_, body) => {
    const result = await checkTools(
      '/x',
      fakeRun(undefined, { stdout: JSON.stringify(body), code: 0 })
    )
    expect(result).toMatchObject({ ok: true, gh: null })
  })

  it.each([
    ['all good', fakeRun()],
    ['claude signed out', fakeRun({ stdout: '{"loggedIn":false}', code: 1 })],
    ['no repo scope', fakeRun(undefined, { stdout: ghHosts('project'), code: 0 })],
    ['no project scope', fakeRun(undefined, { stdout: ghHosts('repo'), code: 0 })],
    ['gh logged out', fakeRun(undefined, { stdout: '{"hosts":{}}', code: 0 })],
    ['tmux missing', fakeRun(undefined, undefined, ['tmux'])]
  ])('agrees with the setup steps on whether it blocks: %s', async (_, fake) => {
    const result = await checkTools('/x', fake)
    expect(result.ok).toBe(!setupSteps(result).some((s) => s.blocked))
  })

  it('blocks without the repo scope and only warns without project', async () => {
    const noRepo = await checkTools(
      '/x',
      fakeRun(undefined, { stdout: ghHosts('project'), code: 0 })
    )
    expect(noRepo.ok).toBe(false)
    const noProject = await checkTools(
      '/x',
      fakeRun(undefined, { stdout: ghHosts('repo'), code: 0 })
    )
    expect(noProject).toMatchObject({ ok: true, gh: { loggedIn: true, scopes: ['repo'] } })
  })

  it('treats an empty scope list as unknown', async () => {
    const result = await checkTools('/x', fakeRun(undefined, { stdout: ghHosts(''), code: 0 }))
    expect(result).toMatchObject({ ok: true, gh: { loggedIn: true, scopes: null } })
  })

  it("can't check a timed-out or unparsable answer", async () => {
    const result = await checkTools(
      '/x',
      fakeRun({ stdout: '', code: -1 }, { stdout: 'Logged in to github.com', code: 0 })
    )
    expect(result).toMatchObject({ ok: true, claudeSignedIn: null, gh: null })
  })

  it('asks linear for its token to tell whether it is signed in', async () => {
    const fake = fakeRun()
    expect(await checkTools('/x', fake)).toMatchObject({ ok: true, linear: true })
    expect(fake).toHaveBeenCalledWith(
      '/opt/homebrew/bin/linear',
      ['auth', 'token'],
      expect.objectContaining({ PATH: '/x' }),
      10000
    )
  })

  it.each([
    ['signed out', { stdout: '', code: 1 }, false],
    ['timed out', { stdout: '', code: -1 }, null]
  ])('reports linear %s without blocking', async (_, answer, linear) => {
    const result = await checkTools('/x', fakeRun(undefined, undefined, [], answer))
    expect(result).toMatchObject({ ok: true, linear })
  })

  it('asks linear for the token of each workspace projects use', async () => {
    const fake = fakeRun()
    fake.mockImplementation(async (file, args) =>
      file === '/bin/sh'
        ? { stdout: `/opt/homebrew/bin/${args[3]}\n`, stderr: '', code: 0 }
        : file.endsWith('/linear')
          ? args.includes('acme')
            ? { stdout: '', stderr: '', code: 1 }
            : { stdout: 'lin_api_x\n', stderr: '', code: 0 }
          : { stdout: '{"loggedIn":true}', stderr: '', code: 0 }
    )
    const result = await checkTools('/x', fake, [], ['globex', 'acme'])
    expect(result.linearWorkspaces).toEqual([
      { slug: 'globex', signedIn: true },
      { slug: 'acme', signedIn: false }
    ])
    expect(fake).toHaveBeenCalledWith(
      '/opt/homebrew/bin/linear',
      ['auth', 'token', '--workspace', 'acme'],
      expect.objectContaining({ PATH: '/x' }),
      10000
    )
  })

  it("doesn't block or ask when linear is missing", async () => {
    const fake = fakeRun(undefined, undefined, ['linear'])
    expect(await checkTools('/x', fake, [], ['acme'])).toMatchObject({
      ok: true,
      linear: null,
      linearWorkspaces: [{ slug: 'acme', signedIn: null }]
    })
    expect(fake.mock.calls.some(([file]) => file.endsWith('/linear'))).toBe(false)
  })

  it('asks acli whether it is signed in to Jira', async () => {
    const fake = fakeRun()
    expect(await checkTools('/x', fake)).toMatchObject({ ok: true, jira: true })
    expect(fake).toHaveBeenCalledWith(
      '/opt/homebrew/bin/acli',
      ['jira', 'auth', 'status'],
      expect.objectContaining({ PATH: '/x' }),
      10000
    )
  })

  it.each([
    ['signed out', { stdout: '', code: 1 }, false],
    ['timed out', { stdout: '', code: -1 }, null]
  ])('reports jira %s without blocking', async (_, answer, jira) => {
    const result = await checkTools('/x', fakeRun(undefined, undefined, [], undefined, answer))
    expect(result).toMatchObject({ ok: true, jira })
  })

  it("checks that acli's site is each Jira site projects use", async () => {
    const status = {
      stdout: '✓ Authenticated\n  Site: acme.atlassian.net\n  Email: me@example.com\n',
      code: 0
    }
    const fake = fakeRun(undefined, undefined, [], undefined, status)
    const result = await checkTools(
      '/x',
      fake,
      [],
      [],
      ['acme.atlassian.net', 'beta.atlassian.net']
    )
    expect(result.jiraSites).toEqual([
      { site: 'acme.atlassian.net', signedIn: true },
      { site: 'beta.atlassian.net', signedIn: false }
    ])
    expect(fake.mock.calls.filter(([file]) => file.endsWith('/acli'))).toHaveLength(1)
    const late = fakeRun(undefined, undefined, [], undefined, { stdout: '', code: -1 })
    expect((await checkTools('/x', late, [], [], ['acme.atlassian.net'])).jiraSites).toEqual([
      { site: 'acme.atlassian.net', signedIn: null }
    ])
  })

  it("doesn't block or ask when acli is missing", async () => {
    const fake = fakeRun(undefined, undefined, ['acli'])
    expect(await checkTools('/x', fake)).toMatchObject({ ok: true, jira: null })
    expect(fake.mock.calls.some(([file]) => file.endsWith('/acli'))).toBe(false)
  })

  it('skips the account checks for a missing tool', async () => {
    const fake = fakeRun(undefined, undefined, ['claude'])
    const result = await checkTools('/x', fake)
    expect(result).toMatchObject({ ok: false, missing: ['claude'], claudeSignedIn: null })
    expect(fake.mock.calls.some(([, args]) => args.join(' ') === 'auth status')).toBe(false)
  })
})

describe('checkTools accounts', () => {
  const answers: Record<string, string> = {
    '/Users/a/.claude-work': '{"loggedIn":true}',
    '/Users/a/.claude-side': '{"loggedIn":false}',
    '/Users/a/.claude-odd': 'nope'
  }
  const fake = vi.fn<RunFn>(async (file, args, env) => {
    if (file === '/bin/sh') return { stdout: `/bin/${args[3]}\n`, stderr: '', code: 0 }
    if (file.endsWith('/gh')) return { stdout: '', stderr: '', code: 1 }
    const dir = env?.CLAUDE_CONFIG_DIR
    return { stdout: dir ? answers[dir] : '{"loggedIn":true}', stderr: '', code: 0 }
  })
  beforeEach(() => {
    fake.mockClear()
    vi.stubEnv('CLAUDE_CONFIG_DIR', undefined)
  })
  afterEach(() => vi.unstubAllEnvs())

  it('asks claude about each account with its folder in CLAUDE_CONFIG_DIR', async () => {
    const accounts = [
      { name: 'Work', dir: '/Users/a/.claude-work' },
      { name: 'Side', dir: '/Users/a/.claude-side' },
      { name: 'Odd', dir: '/Users/a/.claude-odd' }
    ]
    const result = await checkTools('/x', fake, accounts)
    expect(result.accounts).toEqual([
      { ...accounts[0], signedIn: true },
      { ...accounts[1], signedIn: false },
      { ...accounts[2], signedIn: null }
    ])
    expect(fake).toHaveBeenCalledWith(
      '/bin/claude',
      ['auth', 'status'],
      expect.objectContaining({ PATH: '/x', CLAUDE_CONFIG_DIR: '/Users/a/.claude-work' }),
      10000
    )
    expect(result.claudeSignedIn).toBe(true)
  })

  it('reports no accounts when none are passed', async () => {
    expect((await checkTools('/x', fake)).accounts).toEqual([])
  })
})

describe('accountEnv', () => {
  it('sets CLAUDE_CONFIG_DIR only for a folder other than Default', () => {
    expect(accountEnv('/w', '/d')).toEqual({ CLAUDE_CONFIG_DIR: '/w' })
    expect(accountEnv('/d', '/d')).toBeUndefined()
    expect(accountEnv(undefined, '/d')).toBeUndefined()
  })
})

describe('claudeSignedIn', () => {
  it('reads loggedIn from claude auth status run with the given env', async () => {
    const fake = vi.fn<RunFn>(async () => ({ stdout: '{"loggedIn":false}', stderr: '', code: 1 }))
    const env = { CLAUDE_CONFIG_DIR: '/d' }
    expect(await claudeSignedIn('/bin/claude', env, fake)).toBe(false)
    expect(fake).toHaveBeenCalledWith('/bin/claude', ['auth', 'status'], env, 10000)
  })

  it("can't tell from an answer without a boolean loggedIn", async () => {
    const fake = vi.fn<RunFn>(async () => ({ stdout: '{}', stderr: '', code: 0 }))
    expect(await claudeSignedIn('/bin/claude', {}, fake)).toBeNull()
  })
})

describe('claudeFolders', () => {
  it('lists the .claude* folders in home, skipping files and the excluded folders', async () => {
    const home = mkdtempSync(join(tmpdir(), 'st-home-'))
    try {
      for (const d of ['.claude', '.claude-work', '.claude-side', '.config', 'claude'])
        mkdirSync(join(home, d))
      writeFileSync(join(home, '.claude.json'), '{}')
      expect(
        await claudeFolders(home, [join(home, '.claude'), join(home, '.claude-side')])
      ).toEqual([join(home, '.claude-work')])
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('lists nothing when the home folder cannot be read', async () => {
    expect(await claudeFolders('/no/such/home', [])).toEqual([])
  })
})

describe('run', () => {
  const tempDir = tempDirs()

  it('returns stdout and exit code 0', async () => {
    expect(await run('/bin/echo', ['hi'])).toEqual({ stdout: 'hi\n', stderr: '', code: 0 })
  })

  it('does not throw on a non-zero exit', async () => {
    expect(await run('/bin/sh', ['-c', 'echo out; echo err >&2; exit 3'])).toEqual({
      stdout: 'out\n',
      stderr: 'err\n',
      code: 3
    })
  })

  it('ends stdin at once, so a program that reads it does not wait', async () => {
    expect(await run('/bin/cat', [], undefined, 2000)).toEqual({ stdout: '', stderr: '', code: 0 })
  })

  it('passes env to the program', async () => {
    const r = await run('/bin/sh', ['-c', 'printf %s "$FOO"'], { FOO: 'bar' })
    expect(r).toEqual({ stdout: 'bar', stderr: '', code: 0 })
  })

  it(
    'runStoppable kills an interactive shell that ignores SIGTERM on timeout',
    { timeout: 10_000 },
    async () => {
      const zdotdir = tempDir('zdot-')
      const r = await runStoppable(
        '/bin/zsh',
        ['-ic', 'sleep 30; echo x'],
        { ...process.env, ZDOTDIR: zdotdir },
        300
      )
      expect(r.code).toBe(-1)
    }
  )

  it('runStoppable passes stdout to onStdout as it arrives', async () => {
    const chunks: string[] = []
    const r = await runStoppable(
      '/bin/sh',
      ['-c', 'echo a; sleep 0.1; echo b'],
      undefined,
      5000,
      undefined,
      {
        onStdout: (c) => chunks.push(c)
      }
    )
    expect(r).toEqual({ stdout: 'a\nb\n', stderr: '', code: 0 })
    expect(chunks.join('')).toBe('a\nb\n')
    expect(chunks.length).toBeGreaterThan(1)
  })

  it('runStoppable writes its input to stdin, then closes it', async () => {
    const r = await runStoppable('/bin/cat', [], undefined, 5000, undefined, { input: 'hi\n' })
    expect(r).toEqual({ stdout: 'hi\n', stderr: '', code: 0 })
  })

  it('runStoppable ends the program when its signal aborts', async () => {
    const stop = new AbortController()
    const r = await runStoppable(
      '/bin/sh',
      ['-c', 'echo a; exec sleep 10'],
      undefined,
      undefined,
      undefined,
      {
        signal: stop.signal,
        onStdout: () => stop.abort()
      }
    )
    expect(r).toEqual({ stdout: 'a\n', stderr: 'The operation was aborted', code: -1 })
  })

  it('resolves code -1 with the reason when the program cannot be spawned', async () => {
    const r = await run('/nonexistent/program', [])
    expect(r).toMatchObject({ stdout: '', code: -1 })
    expect(r.stderr).toContain('ENOENT')
  })

  it('returns 2 MiB of output whole', async () => {
    const r = await run('/bin/sh', ['-c', 'head -c 2097152 /dev/zero'])
    expect(r.code).toBe(0)
    expect(r.stdout.length).toBe(2 * 1024 * 1024)
  })

  it('stopChildren kills a runStoppable child but not a run child', async () => {
    const stoppable = runStoppable('/bin/sleep', ['30'])
    const plain = run('/bin/sleep', ['0.3'])
    stopChildren()
    expect(await stoppable).toEqual({ stdout: '', stderr: 'killed by SIGKILL', code: -1 })
    expect((await plain).code).toBe(0)
  })

  it('stops a timed-out run with SIGTERM, so git can clean up, and keeps the arguments out', async () => {
    const r = await run('/bin/sh', ['-c', 'sleep 30', 'secret-arg'], undefined, 200)
    expect(r).toEqual({ stdout: '', stderr: 'killed by SIGTERM', code: -1 })
  })
})

describe('findEditors', () => {
  it('returns the editors whose launcher resolves, also in the Toolbox scripts folder', async () => {
    const fake: RunFn = async (_file, args, env) => {
      expect(env?.PATH).toBe(
        `/bin:${join(homedir(), 'Library/Application Support/JetBrains/Toolbox/scripts')}`
      )
      return ['cursor', 'idea'].includes(args[3])
        ? { stdout: `/x/${args[3]}\n`, stderr: '', code: 0 }
        : { stdout: '', stderr: '', code: 1 }
    }
    expect(await findEditors('/bin', fake)).toEqual([
      { command: 'cursor', name: 'Cursor', path: '/x/cursor' },
      { command: 'idea', name: 'IntelliJ IDEA', path: '/x/idea' }
    ])
  })
})

describe('openInEditor', () => {
  const tempDir = tempDirs()
  const ok: RunFn = async () => ({ stdout: '', stderr: '', code: 0 })

  it("opens the folder with open -a when the launcher is inside an app, so the IDE isn't Sandtable's child", async () => {
    const dir = tempDir('sandtable-ed-')
    const app = join(dir, 'IntelliJ IDEA.app')
    mkdirSync(join(app, 'Contents/MacOS'), { recursive: true })
    writeFileSync(join(app, 'Contents/MacOS/idea'), '')
    const fake = vi.fn<RunFn>(ok)
    const idea = { command: 'idea', name: 'IntelliJ IDEA', path: join(app, 'Contents/MacOS/idea') }
    expect(await openInEditor(idea, '/w/shop', fake)).toBe('')
    expect(fake).toHaveBeenCalledWith('/usr/bin/open', ['-a', realpathSync(app), '/w/shop'])
  })

  it('runs a launcher outside an app with the folder, and says why it failed', async () => {
    const dir = tempDir('sandtable-ed-')
    writeFileSync(join(dir, 'idea'), '')
    const idea = { command: 'idea', name: 'IntelliJ IDEA', path: join(dir, 'idea') }
    const fake = vi.fn<RunFn>(ok)
    expect(await openInEditor(idea, '/w/shop', run, fake)).toBe('')
    expect(fake).toHaveBeenCalledWith(idea.path, ['/w/shop'])
    fake.mockResolvedValue({ stdout: '', stderr: 'no display\nmore', code: 1 })
    expect(await openInEditor(idea, '/w/shop', run, fake)).toBe('no display')
    fake.mockResolvedValue({ stdout: '', stderr: '', code: 2 })
    expect(await openInEditor(idea, '/w/shop', run, fake)).toBe('IntelliJ IDEA exited with code 2')
  })

  it('follows a launcher symlinked into an app, as code is', async () => {
    const dir = tempDir('sandtable-ed-')
    const app = join(dir, 'Visual Studio Code.app')
    const bin = join(app, 'Contents/Resources/app/bin')
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, 'code'), '')
    symlinkSync(join(bin, 'code'), join(dir, 'code'))
    const fake = vi.fn<RunFn>(ok)
    const code = { command: 'code', name: 'VS Code', path: join(dir, 'code') }
    expect(await openInEditor(code, '/w/shop', fake)).toBe('')
    expect(fake).toHaveBeenCalledWith('/usr/bin/open', ['-a', realpathSync(app), '/w/shop'])
  })
})

describe('launchDetached', () => {
  it('reports a launcher that fails at once, and leaves one that keeps running alone', async () => {
    expect(await launchDetached('/bin/sh', ['-c', 'echo nope >&2; exit 3'], 2000)).toEqual({
      stdout: '',
      stderr: 'nope\n',
      code: 3
    })
    const started = Date.now()
    expect(await launchDetached('/bin/sleep', ['5'], 200)).toMatchObject({ code: 0 })
    expect(Date.now() - started).toBeLessThan(2000)
    expect((await launchDetached('/nowhere/editor', [], 2000)).code).toBe(-1)
  })
})

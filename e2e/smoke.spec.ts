import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page
} from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const packaged = 'dist/mac-arm64/Sandtable.app/Contents/MacOS/Sandtable'

const temps: string[] = []
const tempDir = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  temps.push(dir)
  return dir
}

let tools: string | undefined
const passingTools = (): string => {
  if (tools) return tools
  const dir = (tools = tempDir('sandtable-tools-'))
  const gh = {
    hosts: { 'github.com': [{ state: 'success', active: true, scopes: 'repo, project' }] }
  }
  const answers = {
    tmux: '',
    git: '',
    claude: '{"loggedIn":true}',
    gh: JSON.stringify(gh),
    linear: 'lin_api_e2e',
    acli: ''
  }
  for (const [tool, out] of Object.entries(answers))
    writeFileSync(join(dir, tool), `#!/bin/sh\nprintf '%s' '${out}'\n`, { mode: 0o755 })
  return dir
}

const launched = new Set<ElectronApplication>()

test.afterEach(() => Promise.all([...launched].map((app) => app.close())))
test.afterAll(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })))

async function launch(
  args: string[],
  env: Record<string, string | undefined> = {},
  executablePath?: string,
  userData = tempDir('sandtable-e2e-')
): Promise<ElectronApplication> {
  const app = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [...args, `--user-data-dir=${userData}`],
    colorScheme: null,
    env: Object.fromEntries(
      Object.entries({
        ...process.env,
        SANDTABLE_E2E: '1',
        SANDTABLE_TOOLS_PATH: passingTools(),
        ...env
      }).filter(([, v]) => v !== undefined)
    ) as Record<string, string>
  })
  launched.add(app)
  app.on('close', () => launched.delete(app))
  return app
}

async function finishSetup(page: Page): Promise<void> {
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Add project' }).click()
}

test('a test run stays out of the Dock and does not take focus', async () => {
  const app = await launchShown(tempDir('sandtable-e2e-'))
  expect(
    await app.evaluate(({ app, BrowserWindow }) => [
      app.dock!.isVisible(),
      BrowserWindow.getFocusedWindow() === null,
      BrowserWindow.getAllWindows()[0]!.getOpacity()
    ])
  ).toEqual([false, true, 0])
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('settings')!.click())
  await expect((await app.firstWindow()).getByRole('heading', { name: 'Settings' })).toBeVisible()
  expect(await focused(app)).toBe(false)
  await app.close()
})

test('View > Next Needs You is disabled while nothing waits, and opens a closed window', async () => {
  const app = await launchShown(tempDir('sandtable-e2e-'))
  expect(
    await app.evaluate(({ Menu }) => {
      const item = Menu.getApplicationMenu()!.getMenuItemById('nextNeedsYou')
      return item && { label: item.label, accelerator: item.accelerator, enabled: item.enabled }
    })
  ).toEqual({ label: 'Next Needs You', accelerator: 'CmdOrCtrl+Shift+J', enabled: false })
  const windows = (): Promise<number> =>
    app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close())
  await expect.poll(windows).toBe(0)
  await app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()!.getMenuItemById('nextNeedsYou')!.click()
  )
  await expect.poll(windows).toBe(1)
  await app.close()
})

const focused = (app: ElectronApplication): Promise<boolean> =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow() !== null)

test('guides setup on a fresh install, then opens Add project', async () => {
  const app = await launch(['.'])
  const page = await app.firstWindow()
  await expect(page.getByRole('heading', { name: 'Set up Sandtable' })).toBeVisible()
  await finishSetup(page)
  await expect(page.getByRole('heading', { name: 'Add project' })).toBeVisible()
  await app.close()
})

test('Settings holds Appearance, which forces dark, and Keep awake, and both survive a restart', async () => {
  const userData = tempDir('sandtable-e2e-')
  let app = await launch(['.'], {}, undefined, userData)
  let page = await app.firstWindow()
  await finishSetup(page)
  const openSettings = (): Promise<void> =>
    app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('settings')!.click())
  const dark = (): Promise<boolean> =>
    page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)
  const choose = async (theme: string): Promise<void> => {
    await page.getByRole('radio', { name: theme }).click()
  }
  await expect(page.getByRole('radiogroup', { name: 'Appearance' })).toHaveCount(0)
  expect(
    await app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()!
        .items.find((m) => m.label === 'View')!
        .submenu!.items.map((i) => i.label)
    )
  ).not.toContain('Appearance')
  await openSettings()
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await expect(page.getByRole('navigation').getByRole('radiogroup')).toHaveCount(0)
  await choose('Light')
  await expect.poll(dark).toBe(false)
  await choose('System')
  await expect.poll(() => app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('system')
  expect(await dark()).toBe(
    await app.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors)
  )
  const keepAwake = page.getByRole('switch', { name: 'Keep your Mac awake while sessions run' })
  await expect(keepAwake).not.toBeChecked()
  await keepAwake.click()
  await expect(keepAwake).toBeChecked()
  await choose('Dark')
  await expect.poll(dark).toBe(true)
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Add project' })).toBeVisible()
  await app.close()

  app = await launch(['.'], {}, undefined, userData)
  page = await app.firstWindow()
  await finishSetup(page)
  expect(
    await app.evaluate(
      ({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('settings')!.accelerator
    )
  ).toBe('CmdOrCtrl+,')
  await openSettings()
  await expect(page.getByRole('radio', { name: 'Dark' })).toBeChecked()
  await expect(
    page.getByRole('switch', { name: 'Keep your Mac awake while sessions run' })
  ).toBeChecked()
  expect(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('dark')
  expect(await dark()).toBe(true)
  await app.close()
})

const noGitHub = (): Record<string, string | undefined> => ({
  GH_CONFIG_DIR: tempDir('sandtable-gh-'),
  GH_TOKEN: undefined,
  GITHUB_TOKEN: undefined
})

function seedRepos(count: number): string {
  const userData = tempDir('sandtable-e2e-')
  const repos = Array.from({ length: count }, (_, i) => ({
    github: `octo/repo${i}`,
    path: tmpdir()
  }))
  const project = { id: 'p1', name: 'App', repos }
  writeFileSync(
    join(userData, 'sandtable.json'),
    JSON.stringify({ projects: [project], sessions: [] })
  )
  return userData
}

const pageScroll = (page: Page): Promise<{ top: number; height: number; window: number }> =>
  page.evaluate(() => {
    const root = document.scrollingElement!
    return { top: root.scrollTop, height: root.scrollHeight, window: innerHeight }
  })

const shrink = async (app: ElectronApplication, page: Page): Promise<void> => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1200, 420))
  await expect.poll(() => page.evaluate(() => innerHeight)).toBe(420)
}

function seedTickets(repo = 'octo/app', sessions: unknown[] = [], more = 0): string {
  const userData = tempDir('sandtable-e2e-')
  const project = { id: 'p1', name: 'App', repos: [{ github: repo, path: tmpdir() }] }
  writeFileSync(join(userData, 'sandtable.json'), JSON.stringify({ projects: [project], sessions }))
  const ticket = (
    number: number,
    labels: string[],
    more: Record<string, unknown> = {}
  ): Record<string, unknown> => ({
    key: `${repo}#${number}`,
    itemId: `i${number}`,
    number,
    title: `Ticket ${number}`,
    body: '',
    url: `https://github.com/${repo}/issues/${number}`,
    repo,
    status: 'Open',
    doneAt: null,
    labels: labels.map((name) => ({ name, color: 'd73a4a' })),
    assignees: [],
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-02T00:00:00Z',
    parent: null,
    subIssues: { completed: 0, total: 0, items: [] },
    boardFields: [],
    blockedBy: [],
    ...more
  })
  const crowded = {
    prStage: 'changesRequested',
    assignees: ['Ada Lovelace', 'Grace Hopper', 'Alan Turing'].map((name, i) => ({
      id: `U_${i}`,
      login: `u${i}`,
      name
    }))
  }
  writeFileSync(
    join(userData, 'sync-cache.json'),
    JSON.stringify({
      p1: {
        tickets: [
          ticket(1, ['bug']),
          ticket(2, ['documentation']),
          ticket(3, []),
          ...Array.from({ length: more }, (_, i) =>
            ticket(10 + i, [], {
              parent: {
                key: `${repo}#1`,
                number: 1,
                title: 'Ticket 1',
                repo,
                url: `https://github.com/${repo}/issues/1`,
                column: 'todo'
              }
            })
          ),
          ...(sessions.length ? [ticket(123456, [], crowded)] : [])
        ],
        syncedAt: '2026-10-25T12:00:00Z'
      }
    })
  )
  return userData
}

test('filters the board by label and keeps the filter after a restart', async () => {
  const userData = seedTickets()
  let app = await launch(['.'], noGitHub(), undefined, userData)
  let page = await app.firstWindow()
  await page.getByRole('button', { name: /^Filters/ }).click()
  await page.getByRole('menuitemcheckbox', { name: 'bug' }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByText('2 hidden by filter')).toBeVisible()
  await expect(page.getByText('Ticket 2')).toHaveCount(0)
  await app.close()

  app = await launch(['.'], noGitHub(), undefined, userData)
  page = await app.firstWindow()
  await expect(page.getByText('Ticket 1')).toBeVisible()
  await expect(page.getByText('2 hidden by filter')).toBeVisible()
  await expect(page.getByText('Ticket 3')).toHaveCount(0)
  await app.close()
})

test('goes back and forward with the title-bar buttons and Command-[ and Command-]', async () => {
  const app = await launch(['.'], noGitHub(), undefined, seedTickets())
  const page = await app.firstWindow()
  const back = page.getByRole('button', { name: 'Go back' })
  const forward = page.getByRole('button', { name: 'Go forward' })
  await expect(back).toBeDisabled()
  await page.getByText('Ticket 1').click()
  await expect(page.getByRole('heading', { name: 'Ticket 1', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'Usage', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Usage' })).toBeVisible()
  await page.keyboard.press('Meta+BracketLeft')
  await expect(page.getByRole('heading', { name: 'Ticket 1', level: 1 })).toBeVisible()
  await back.click()
  await expect(page.getByText('Ticket 2')).toBeVisible()
  await expect(back).toBeDisabled()
  await page.keyboard.press('Meta+BracketRight')
  await expect(page.getByRole('heading', { name: 'Ticket 1', level: 1 })).toBeVisible()
  await forward.click()
  await expect(page.getByRole('heading', { name: 'Usage' })).toBeVisible()
  await expect(forward).toBeDisabled()
})

test('keeps a crowded card header inside the card', async () => {
  const repo = 'octo/a-repository-name-long-enough-to-crowd-the-header'
  const session = {
    id: 's1',
    projectId: 'p1',
    ticketKey: `${repo}#123456`,
    tmuxName: 'sandtable-e2e-crowded',
    worktrees: [],
    eventsFile: join(tmpdir(), 'sandtable-e2e-none.jsonl'),
    startedAt: '2026-10-01T00:00:00Z',
    removedAt: '2026-10-02T00:00:00Z',
    state: 'finished'
  }
  const app = await launch(['.'], noGitHub(), undefined, seedTickets(repo, [session]))
  const page = await app.firstWindow()
  const card = page.locator('[data-slot="card"]', { hasText: 'Ticket 123456' })
  const parts = [
    card.getByText('#123456'),
    card.getByText('Changes requested'),
    card.getByText('Finished'),
    card.getByRole('img', { name: 'Ada Lovelace' }),
    card.getByRole('img', { name: 'Grace Hopper' }),
    card.getByText('+1')
  ]
  await expect(parts[2]!).toBeVisible()
  const box = (await card.boundingBox())!
  for (const part of parts) {
    const b = (await part.boundingBox())!
    expect(b.x).toBeGreaterThanOrEqual(box.x)
    expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width)
  }
  await expect(card.getByTitle(repo)).toBeVisible()
  await app.close()
})

test('keeps long leftover names, repos, and branches inside the To clean up panel', async () => {
  const repo = 'octo/a-repository-name-long-enough-to-crowd-the-leftover-row'
  const leftover = (id: string, projectId: string, number: number): Record<string, unknown> => ({
    id,
    projectId,
    ticketKey: `${repo}#${number}`,
    branch: `${number}-a-branch-name-long-enough-to-run-past-the-edge-of-the-panel`,
    tmuxName: `sandtable-e2e-${id}`,
    worktrees: [tempDir('sandtable-e2e-wt-')],
    eventsFile: join(tmpdir(), 'sandtable-e2e-none.jsonl'),
    startedAt: '2026-10-01T00:00:00Z',
    state: 'finished'
  })
  const userData = seedTickets(repo, [leftover('s1', 'p1', 777), leftover('s2', 'gone', 778)])
  const app = await launch(['.'], noGitHub(), undefined, userData)
  const page = await app.firstWindow()
  await page.getByRole('button', { name: '2 sessions to clean up' }).click()
  const panel = page.getByRole('dialog')
  const rows = panel.getByRole('group')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toContainText('Off the board · App')
  await expect(rows.nth(1)).toContainText('Removed project')
  await expect
    .poll(async () => {
      const b = (await panel.boundingBox())!
      return b.x + b.width - (await page.evaluate(() => innerWidth))
    })
    .toBe(0)
  const box = (await panel.boundingBox())!
  for (const row of await rows.all()) {
    const b = (await row.getByRole('button', { name: 'Remove worktree' }).boundingBox())!
    expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width)
    expect((await row.boundingBox())!.height).toBeLessThan(80)
  }
  await page.screenshot({ path: join(tmpdir(), 'sandtable-e2e-leftovers.png') })
  await app.close()
})

test('keeps the board from scrolling past its columns in every layout', async () => {
  const app = await launch(['.'], noGitHub(), undefined, seedTickets('octo/app', [], 30))
  const page = await app.firstWindow()
  const fits = (): Promise<string[]> =>
    page.evaluate(() =>
      [...document.querySelectorAll('body *')]
        .filter((e) => getComputedStyle(e).overflowY !== 'visible')
        .filter(
          (e) =>
            !e.matches(
              '[data-slot="scroll-area-viewport"], .overflow-y-auto, .overflow-auto, .sr-only, .line-clamp-2'
            )
        )
        .filter((e) => e.scrollHeight > e.clientHeight)
        .map((e) => `${e.tagName}.${e.className.toString()}`)
    )
  await expect(page.getByText('Ticket 39')).toBeAttached()
  await page.getByRole('button', { name: 'New ticket' }).click()
  await expect(page.getByPlaceholder('Issue title')).toBeFocused()
  expect(await fits()).toEqual([])
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Display' }).click()
  await page.getByRole('menuitemradio', { name: 'Assignee' }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('region', { name: 'No assignee', exact: true })).toBeVisible()
  expect(await fits()).toEqual([])
  await page.getByRole('button', { name: 'List', exact: true }).click()
  await expect(page.getByRole('region', { name: 'No assignee', exact: true })).toBeVisible()
  expect(await fits()).toEqual([])
  await page.getByRole('button', { name: /^Display/ }).click()
  await page.getByRole('menuitemradio', { name: 'Parent' }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('region', { name: 'No parent', exact: true })).toBeVisible()
  expect(await fits()).toEqual([])
  await page.getByRole('button', { name: 'Board', exact: true }).click()
  await expect(page.getByRole('region', { name: '#1 Ticket 1', exact: true })).toBeVisible()
  expect(await fits()).toEqual([])
  await page.screenshot({ path: join(tmpdir(), 'sandtable-e2e-parent-lanes.png') })
})

test('shows the list with a collapsed group and keeps both after a restart', async () => {
  const userData = seedTickets()
  let app = await launch(['.'], noGitHub(), undefined, userData)
  let page = await app.firstWindow()
  await page.getByRole('button', { name: 'List', exact: true }).click()
  await page.getByRole('button', { name: /^To do/ }).click()
  await expect(page.getByRole('button', { name: /^To do/ })).toHaveAttribute(
    'aria-expanded',
    'false'
  )
  await expect(page.getByText('Ticket 1')).toHaveCount(0)
  await app.close()

  app = await launch(['.'], noGitHub(), undefined, userData)
  page = await app.firstWindow()
  await expect(page.getByRole('button', { name: 'List', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await expect(page.getByRole('button', { name: /^To do/ })).toHaveAttribute(
    'aria-expanded',
    'false'
  )
  await expect(page.getByRole('button', { name: /^Done/ })).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByText('Ticket 1')).toHaveCount(0)
  await app.close()
})

test('suggests a worktree setup from the main checkout, and Use saves it', async () => {
  const userData = seedTickets()
  const repo = tempDir('sandtable-suggest-')
  const git = (...args: string[]): void => void spawnSync('git', args, { cwd: repo })
  git('init', '-q')
  git('remote', 'add', 'origin', 'https://github.com/octo/app.git')
  writeFileSync(join(repo, '.gitignore'), '.env\n')
  writeFileSync(join(repo, '.env'), 'TOKEN=x\n')
  writeFileSync(join(repo, 'package-lock.json'), '{}\n')
  const store = join(userData, 'sandtable.json')
  const data = JSON.parse(readFileSync(store, 'utf8'))
  data.projects[0].repos[0].path = repo
  writeFileSync(store, JSON.stringify(data))
  const app = await launch(['.'], noGitHub(), undefined, userData)
  const page = await app.firstWindow()
  await page.getByRole('button', { name: 'App', exact: true }).hover()
  await page.getByRole('button', { name: 'More for App' }).click()
  await page.getByRole('menuitem', { name: 'Edit project' }).click()
  await page.getByRole('button', { name: /Repos/ }).click()
  await expect(page.getByText(/^Suggested:/)).toHaveText('Suggested: copy .env · npm install')
  await page.getByRole('button', { name: 'Use suggested worktree setup for octo/app' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
  expect(JSON.parse(readFileSync(store, 'utf8')).projects[0].repos[0].setup).toEqual({
    copy: ['.env'],
    command: 'npm install'
  })
  await app.close()
})

test('keeps a long repo list inside the add-project step on Repos and Review', async () => {
  const app = await launch(['.'], noGitHub(), undefined, seedRepos(40))
  const page = await app.firstWindow()
  await page.getByRole('button', { name: 'App', exact: true }).hover()
  await page.getByRole('button', { name: 'More for App' }).click()
  await page.getByRole('menuitem', { name: 'Edit project' }).click()
  for (const [step, heading] of [
    [/^Repos/, 'Repos and folders'],
    [/Review/, 'Review']
  ] as const) {
    await page.getByRole('list', { name: 'Steps' }).getByRole('button', { name: step }).click()
    await expect(page.getByRole('heading', { name: heading, level: 2 })).toBeVisible()
    await page.waitForFunction(() => !document.getAnimations().length)
    await page.mouse.move(700, 400)
    await page.mouse.wheel(0, 5000)
    const scroll = await pageScroll(page)
    expect(scroll.height).toBeLessThanOrEqual(scroll.window)
    expect(scroll.top).toBe(0)
  }
  await expect(page.getByRole('button', { name: 'Save' })).toBeInViewport()
  await shrink(app, page)
  const scroll = await pageScroll(page)
  expect(scroll.height).toBeLessThanOrEqual(scroll.window)
  await expect(page.getByRole('button', { name: 'Save' })).toBeInViewport()
})

test('keeps the New session dialog and Start on screen with many repos', async () => {
  const app = await launch(['.'], noGitHub(), undefined, seedRepos(40))
  const page = await app.firstWindow()
  await page.getByRole('button', { name: 'App', exact: true }).hover()
  await page.getByRole('button', { name: 'More for App' }).click()
  await page.getByRole('menuitem', { name: 'New session' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await page.waitForFunction(() => !document.getAnimations().length)
  const box = (await dialog.boundingBox())!
  const height = await page.evaluate(() => innerHeight)
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.y + box.height).toBeLessThanOrEqual(height)
  await expect(dialog.getByRole('button', { name: 'Start' })).toBeInViewport()
  await expect(dialog.getByRole('heading', { name: 'New session in App' })).toBeInViewport()
  const list = dialog.getByRole('radiogroup', { name: 'Repo' })
  expect(await list.evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true)
  await list.getByText('octo/repo39', { exact: true }).click()
  await expect(list.getByRole('radio', { name: 'octo/repo39' })).toBeChecked()
  await expect(dialog.getByRole('button', { name: 'Start' })).toBeInViewport()
  await shrink(app, page)
  const short = (await dialog.boundingBox())!
  expect(short.y).toBeGreaterThanOrEqual(0)
  expect(short.y + short.height).toBeLessThanOrEqual(420)
  const start = dialog.getByRole('button', { name: 'Start' })
  await start.scrollIntoViewIfNeeded()
  await expect(start).toBeInViewport()
  const close = (await dialog.getByRole('button', { name: 'Close' }).boundingBox())!
  expect(close.y).toBeGreaterThanOrEqual(short.y)
})

test('keeps the routine editor from scrolling as a whole in a short window', async () => {
  const app = await launch(['.'], noGitHub(), undefined, seedRepos(40))
  const page = await app.firstWindow()
  await shrink(app, page)
  await page.getByRole('button', { name: 'New routine' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await page.waitForFunction(() => !document.getAnimations().length)
  const box = (await dialog.boundingBox())!
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.y + box.height).toBeLessThanOrEqual(420)
  const body = dialog.locator('[data-slot="dialog-body"]')
  expect(await body.evaluate((d) => d.scrollHeight - d.clientHeight)).toBe(0)
})

test("picks a project's emoji on Review and shows it in the sidebar and header after a restart", async () => {
  const userData = seedTickets()
  let app = await launch(['.'], noGitHub(), undefined, userData)
  let page = await app.firstWindow()
  await page.getByRole('button', { name: 'App', exact: true }).hover()
  await page.getByRole('button', { name: 'More for App' }).click()
  await page.getByRole('menuitem', { name: 'Edit project' }).click()
  await page.getByRole('button', { name: /Review/ }).click()
  await page.getByRole('button', { name: 'Choose emoji' }).click()
  await page.getByRole('searchbox', { name: 'Search emoji' }).fill('octopus')
  await expect(page.getByRole('gridcell')).toHaveCount(1)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Change emoji' })).toBeFocused()
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('heading', { name: 'App', level: 1 })).toBeVisible()
  await app.close()

  const saved = JSON.parse(readFileSync(join(userData, 'sandtable.json'), 'utf8'))
  expect(saved.projects[0].icon).toBe('🐙')
  app = await launch(['.'], noGitHub(), undefined, userData)
  page = await app.firstWindow()
  await expect(page.getByRole('heading', { name: 'App', level: 1 }).locator('..')).toContainText(
    '🐙'
  )
  await expect(
    page
      .getByRole('listitem')
      .filter({ has: page.getByRole('button', { name: 'App', exact: true }) })
  ).toContainText('🐙')
  await app.close()
})

test('groups projects by drag, and keeps the order and collapsed groups after a restart', async () => {
  const userData = tempDir('sandtable-e2e-')
  const projects = ['App', 'Api', 'Docs'].map((name, i) => ({
    id: `p${i + 1}`,
    name,
    repos: [{ github: `octo/${name.toLowerCase()}`, path: tmpdir() }]
  }))
  writeFileSync(join(userData, 'sandtable.json'), JSON.stringify({ projects, sessions: [] }))
  const noGitHub = {
    GH_CONFIG_DIR: tempDir('sandtable-gh-'),
    GH_TOKEN: undefined,
    GITHUB_TOKEN: undefined
  }
  let app = await launch(['.'], noGitHub, undefined, userData)
  let page = await app.firstWindow()
  const name = (n: string): Locator => page.getByRole('button', { name: n, exact: true })
  const pointAt = async (to: Locator, at = 0.5): Promise<void> => {
    const box = (await to.boundingBox())!
    await page.mouse.move(box.x + 10, box.y + box.height * at, { steps: 10 })
  }
  const drop = async (): Promise<void> => {
    await page.mouse.up()
    // dnd-kit swallows clicks for 50 ms after a drop.
    await page.waitForTimeout(100)
  }
  await name('New group').click()
  await page.getByRole('textbox', { name: 'New group name' }).fill('Work')
  await page.keyboard.press('Enter')
  const work = page.getByRole('list', { name: 'Work' })
  const moved = page.getByRole('status').filter({ hasText: 'Moved' })

  await pointAt(name('Docs'))
  await page.mouse.down()
  await pointAt(work.getByText('Drag projects here'))
  await drop()
  await expect(moved).toHaveText('Moved Docs to Work.')

  await name('Work').click()
  await pointAt(name('Api'))
  await page.mouse.down()
  await pointAt(name('App'), 0.8)
  await expect(page.getByRole('listitem').filter({ has: name('App') })).toHaveClass(
    /after:absolute/
  )
  await expect(name('App').locator('..')).not.toHaveClass(/after:absolute/)
  await pointAt(name('Work'))
  await drop()
  await expect(moved).toHaveText('Moved Api to Work.')
  await expect(name('Work')).toHaveAttribute('aria-expanded', 'true')
  await expect(work.getByRole('button', { name: /^(Docs|Api)$/ })).toHaveText(['Docs', 'Api'])
  await name('Work').click()
  await expect(name('Docs')).toHaveCount(0)
  await app.close()

  const saved = JSON.parse(readFileSync(join(userData, 'sandtable.json'), 'utf8'))
  expect(saved.projects.map((p: { name: string; group?: string }) => [p.name, !!p.group])).toEqual([
    ['App', false],
    ['Docs', true],
    ['Api', true]
  ])
  app = await launch(['.'], noGitHub, undefined, userData)
  page = await app.firstWindow()
  await expect(name('Work')).toHaveAttribute('aria-expanded', 'false')
  await expect(name('Api')).toHaveCount(0)
  await name('Work').click()
  await expect(
    page.getByRole('list', { name: 'Work' }).getByRole('button', { name: /^(Docs|Api)$/ })
  ).toHaveText(['Docs', 'Api'])
  await app.close()
})

test('marks the drop under the pointer after the sidebar scrolls during a drag', async () => {
  const userData = tempDir('sandtable-e2e-')
  const projects = Array.from({ length: 60 }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Project ${i + 1}`,
    repos: [{ github: `octo/p${i + 1}`, path: tmpdir() }]
  }))
  writeFileSync(join(userData, 'sandtable.json'), JSON.stringify({ projects, sessions: [] }))
  const noGitHub = { GH_CONFIG_DIR: tempDir('sandtable-gh-') }
  const app = await launch(['.'], noGitHub, undefined, userData)
  const page = await app.firstWindow()
  const list = page.getByRole('list', { name: 'Projects' })
  const scroller = page.locator('[data-radix-scroll-area-viewport]').first()
  const start = (await list.getByRole('button', { name: 'Project 2', exact: true }).boundingBox())!
  const x = start.x + 10
  await page.mouse.move(x, start.y + start.height / 2)
  await page.mouse.down()
  const view = (await scroller.boundingBox())!
  await page.mouse.move(x, view.y + view.height - 2, { steps: 10 })
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(100)
  await page.mouse.move(x, view.y + view.height / 2, { steps: 5 })
  const middle = await list.evaluate(
    (ul, y) => {
      const away = (el: Element): number => {
        const r = el.getBoundingClientRect()
        return Math.abs(r.top + r.height / 2 - y)
      }
      const li = [...ul.children].sort((a, b) => away(a) - away(b))[0]
      return li?.querySelector('button:not([aria-label])')?.textContent ?? ''
    },
    view.y + view.height / 2
  )
  expect(middle, 'a project row near the middle of the sidebar').not.toBe('')
  const row = list
    .getByRole('listitem')
    .filter({ has: page.getByRole('button', { name: middle, exact: true }) })
  const box = (await row.boundingBox())!
  await page.mouse.move(x, box.y + box.height * 0.2, { steps: 5 })
  await expect(row).toHaveClass(/before:absolute/)
  await page.mouse.up()
  await app.close()
})

test('keeps the Sessions strip the same height with and without a session', async () => {
  const project = { id: 'p1', name: 'App', repos: [{ github: 'octo/app', path: tmpdir() }] }
  const session = {
    id: 'a1',
    projectId: 'p1',
    name: 'Oct 24, 10:00',
    tmuxName: 'sandtable-e2e-no-such-session',
    worktrees: [],
    checkout: tmpdir(),
    eventsFile: join(tempDir('sandtable-e2e-'), 'events'),
    startedAt: '2026-10-24T10:00:00.000Z',
    state: 'finished'
  }
  const stripHeight = async (sessions: unknown[]): Promise<number> => {
    const userData = tempDir('sandtable-e2e-')
    writeFileSync(
      join(userData, 'sandtable.json'),
      JSON.stringify({ projects: [project], sessions })
    )
    const app = await launch(
      ['.'],
      { GH_CONFIG_DIR: userData, GH_TOKEN: undefined, GITHUB_TOKEN: undefined },
      undefined,
      userData
    )
    const strip = (await app.firstWindow()).getByRole('region', { name: 'Sessions' })
    await expect(strip.getByRole('heading')).toHaveText(`Sessions${sessions.length}`)
    const height = (await strip.boundingBox())!.height
    await app.close()
    return height
  }
  expect(await stripHeight([session])).toBe(await stripHeight([]))
})

const windowBounds = (app: ElectronApplication): Promise<Electron.Rectangle> =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getBounds())
const workArea = (app: ElectronApplication): Promise<Electron.Rectangle> =>
  app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea)
const savedState = (userData: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(readFileSync(join(userData, 'window-state.json'), 'utf8'))
  } catch {
    return null
  }
}
async function launchShown(userData: string): Promise<ElectronApplication> {
  const app = await launch(['.'], {}, undefined, userData)
  await app.firstWindow()
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible()))
    .toBe(true)
  return app
}

test('reopens at the last window bounds', async () => {
  const userData = tempDir('sandtable-e2e-')
  let app = await launchShown(userData)
  const area = await workArea(app)
  const bounds = { x: area.x + 40, y: area.y + 30, width: 900, height: 600 }
  await app.evaluate(
    ({ BrowserWindow }, b) => BrowserWindow.getAllWindows()[0]!.setBounds(b),
    bounds
  )
  await expect.poll(() => savedState(userData)?.bounds).toEqual(bounds)
  await app.close()

  app = await launchShown(userData)
  expect(await windowBounds(app)).toEqual(bounds)
  expect(
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isFullScreenable())
  ).toBe(true)
  await app.close()
})

const headerClashes = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const header = [...document.querySelectorAll('header')].find((h) => h.offsetWidth > 0)!
    const box = header.getBoundingClientRect()
    const items = [...header.querySelectorAll('button, h1, [data-slot=badge], span[title]')]
      .filter((el) => el.getBoundingClientRect().width > 0 && !el.parentElement!.closest('button'))
      .map(
        (el) =>
          [el.textContent || el.getAttribute('aria-label'), el.getBoundingClientRect()] as const
      )
    return items.flatMap(([name, a], i) => [
      ...(a.left < box.left || a.right > box.right ? [`${name} is cut off`] : []),
      ...items
        .slice(i + 1)
        .filter(([, b]) => a.left < b.right - 1 && b.left < a.right - 1)
        .map(([other]) => `${name} overlaps ${other}`)
    ])
  })

test('keeps the panel at 560 px and the headers whole at the minimum width', async () => {
  const userData = seedTickets()
  const store = JSON.parse(readFileSync(join(userData, 'sandtable.json'), 'utf8'))
  store.sessions = [
    {
      id: 'a1',
      projectId: 'p1',
      ticketKey: 'octo/app#1',
      tmuxName: 'sandtable-e2e-no-such-session',
      branch: 'feat/160-make-every-view-work-at-narrow-window-widths',
      worktrees: [join(tmpdir(), 'no-such-worktree')],
      eventsFile: join(userData, 'events-a1'),
      startedAt: '2026-10-24T10:00:00.000Z',
      state: 'finished'
    },
    {
      id: 'a2',
      projectId: 'p1',
      name: 'A session with a long name to truncate',
      tmuxName: 'sandtable-e2e-no-such-session-2',
      branch: 'feat/160-make-every-view-work-at-narrow-window-widths',
      worktrees: [join(tmpdir(), 'no-such-worktree-2')],
      eventsFile: join(userData, 'events-a2'),
      startedAt: '2026-10-24T11:00:00.000Z',
      state: 'finished'
    }
  ]
  writeFileSync(join(userData, 'sandtable.json'), JSON.stringify(store))
  writeFileSync(
    join(userData, 'window-state.json'),
    JSON.stringify({ bounds: { x: 0, y: 0, width: 600, height: 700 }, sidebarWidth: 400 })
  )
  const app = await launch(['.'], noGitHub(), undefined, userData)
  const page = await app.firstWindow()
  expect((await windowBounds(app)).width).toBe(760)
  expect((await page.locator('main').boundingBox())!.width).toBe(560)
  await page.getByRole('button', { name: 'List' }).click()
  await page.getByText('Ticket 1').click()
  await expect(page.getByRole('heading', { name: 'Ticket 1', level: 1 })).toBeVisible()
  expect(await headerClashes(page)).toEqual([])
  await page.getByRole('button', { name: 'Back to board' }).click()
  await expect(page.getByRole('heading', { name: 'App', level: 1 })).toBeVisible()
  expect(await headerClashes(page)).toEqual([])
  await page.getByText('A session with a long name to truncate').first().click()
  await expect(page.getByRole('button', { name: 'More actions' })).toBeVisible()
  expect(await headerClashes(page)).toEqual([])
  await page.getByRole('button', { name: 'Hide sidebar' }).click()
  await expect(page.getByRole('button', { name: 'Show sidebar' })).toBeVisible()
  await expect.poll(async () => (await page.locator('main').boundingBox())!.x).toBe(8)
  expect((await page.locator('main').boundingBox())!.width).toBe(744)
  expect(await headerClashes(page)).toEqual([])
})

test('reopens maximized', async () => {
  test.skip(
    !!process.env.CI,
    'maximize() fires no maximize event on the CI runner, so nothing is saved'
  )
  const userData = tempDir('sandtable-e2e-')
  let app = await launchShown(userData)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.maximize())
  await expect.poll(() => savedState(userData)?.maximized).toBe(true)
  await app.close()

  app = await launchShown(userData)
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isMaximized())
    )
    .toBe(true)
  expect(await focused(app)).toBe(false)
  await app.close()
})

test('opens at the default size on the main display when the saved bounds are off every display', async () => {
  const userData = tempDir('sandtable-e2e-')
  writeFileSync(
    join(userData, 'window-state.json'),
    JSON.stringify({ bounds: { x: -20000, y: -20000, width: 900, height: 600 } })
  )
  const app = await launchShown(userData)
  const area = await workArea(app)
  const width = Math.min(1200, area.width)
  const height = Math.min(800, area.height)
  const bounds = await windowBounds(app)
  const expected = {
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2),
    width,
    height
  }
  // macOS sometimes makes a window as tall as the work area 1 px shorter (#4).
  for (const key of ['x', 'y', 'width', 'height'] as const)
    expect(Math.abs(bounds[key] - expected[key]), key).toBeLessThanOrEqual(1)
  await app.close()
})

test('View > Hide Sidebar hides the sidebar, and it stays hidden after a restart', async () => {
  const userData = tempDir('sandtable-e2e-')
  const sidebarItem = (
    app: ElectronApplication
  ): Promise<{ label: string; accelerator: string | null }> =>
    app.evaluate(({ Menu }) => {
      const item = Menu.getApplicationMenu()!.getMenuItemById('sidebar')!
      return { label: item.label, accelerator: item.accelerator }
    })
  let app = await launch(['.'], {}, undefined, userData)
  let page = await app.firstWindow()
  await finishSetup(page)
  expect(await sidebarItem(app)).toEqual({ label: 'Hide Sidebar', accelerator: 'Ctrl+Cmd+S' })
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('sidebar')!.click())
  await expect(page.getByRole('button', { name: 'Show sidebar' })).toBeVisible()
  await expect(page.getByRole('navigation')).toHaveAttribute('inert')
  await expect
    .poll(async () => {
      const box = (await page.getByRole('navigation').boundingBox())!
      return box.x + box.width
    })
    .toBe(0)
  expect((await sidebarItem(app)).label).toBe('Show Sidebar')
  await expect.poll(() => savedState(userData)?.sidebarHidden).toBe(true)
  await app.close()

  app = await launch(['.'], {}, undefined, userData)
  page = await app.firstWindow()
  await finishSetup(page)
  await page.getByRole('button', { name: 'Show sidebar' }).click()
  await expect(page.getByRole('button', { name: 'Hide sidebar' })).toBeVisible()
  expect((await sidebarItem(app)).label).toBe('Hide Sidebar')
  await expect.poll(() => savedState(userData)?.sidebarHidden).toBe(false)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setFullScreen(true))
  await page.getByRole('button', { name: 'Hide sidebar' }).click()
  const inset = (): Promise<string> =>
    page.evaluate(() => getComputedStyle(document.querySelector('main header')!).paddingLeft)
  await expect.poll(inset).toBe('16px')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setFullScreen(false))
  await expect.poll(inset).toBe('88px')
  await app.close()
})

test('drags the sidebar edge to resize it, keeps the width after a restart, and hides at that width', async () => {
  const userData = tempDir('sandtable-e2e-')
  const navBox = async (page: Page): Promise<{ x: number; width: number }> =>
    (await page.getByRole('navigation').boundingBox())!
  let app = await launch(['.'], {}, undefined, userData)
  let page = await app.firstWindow()
  await finishSetup(page)
  expect((await navBox(page)).width).toBe(224)
  const handle = (await page.getByRole('separator', { name: 'Resize sidebar' }).boundingBox())!
  const y = handle.y + handle.height / 2
  await page.mouse.move(handle.x + handle.width / 2, y)
  await page.mouse.down()
  await page.mouse.move(handle.x + handle.width / 2 + 76, y, { steps: 4 })
  await page.mouse.up()
  expect((await navBox(page)).width).toBe(300)
  await expect.poll(() => savedState(userData)?.sidebarWidth).toBe(300)
  await app.close()

  app = await launch(['.'], {}, undefined, userData)
  page = await app.firstWindow()
  await finishSetup(page)
  await expect.poll(async () => (await navBox(page)).width).toBe(300)
  await page.getByRole('button', { name: 'Hide sidebar' }).click()
  await expect.poll(async () => (await navBox(page)).x).toBe(-300)
  await page.getByRole('button', { name: 'Show sidebar' }).click()
  await expect.poll(async () => (await navBox(page)).x).toBe(0)
  await app.close()
})

test('names a missing tool and its install command', async () => {
  const empty = tempDir('sandtable-empty-')
  const app = await launch(['.'], { SANDTABLE_TOOLS_PATH: empty })
  const page = await app.firstWindow()
  await expect(page.getByRole('heading', { name: 'tmux and git' })).toBeVisible()
  await expect(page.getByText('Missing', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('brew install tmux')).toBeVisible()
  await app.close()
})

test.describe('packaged app', () => {
  test.skip(!existsSync(packaged) && !process.env.CI, 'run npm run build:mac first')

  test('finds tmux, claude, and gh from a Dock-like PATH and sets a UTF-8 LANG', async () => {
    const app = await launch(
      [],
      {
        SANDTABLE_TOOLS_PATH: undefined,
        PATH: '/usr/bin:/bin',
        HOME: process.env.HOME ?? '',
        LANG: undefined,
        LC_ALL: undefined,
        LC_CTYPE: undefined
      },
      packaged
    )
    const page = await app.firstWindow()
    expect(await app.evaluate(() => process.env.LANG)).toBe('en_US.UTF-8')
    await expect(page.getByRole('heading', { name: 'tmux and git' })).toBeVisible()
    await expect(page.getByText('Missing', { exact: true })).toHaveCount(0)
    for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByRole('button', { name: 'Add project' })).toBeVisible()
    await app.close()
  })

  test('is signed with its bundle identifier, so macOS lets it notify', () => {
    const { status, stderr } = spawnSync('codesign', ['-dv', join(packaged, '../../..')], {
      encoding: 'utf8'
    })
    expect(status).toBe(0)
    expect(stderr).toContain('Identifier=com.ashmanto.sandtable')
  })

  test('runs under the hardened runtime without DYLD variables or debugger attach', () => {
    const { status, stdout, stderr } = spawnSync(
      'codesign',
      ['-dv', '--entitlements', '-', '--xml', join(packaged, '../../..')],
      { encoding: 'utf8' }
    )
    expect(status).toBe(0)
    expect(stderr).toMatch(/flags=0x\w+\(adhoc,runtime\)/)
    expect(stdout).not.toContain('com.apple.security.cs.allow-dyld-environment-variables')
    expect(stdout).not.toContain('com.apple.security.get-task-allow')
  })

  test('quits on any switch but --user-data-dir when the inspector is closed', () => {
    const run = (flags: string[]): ReturnType<typeof spawnSync> =>
      spawnSync(packaged, [...flags, `--user-data-dir=${tempDir('sandtable-e2e-')}`], {
        timeout: 10_000,
        killSignal: 'SIGKILL',
        env: { ...process.env, SANDTABLE_E2E: '1', SANDTABLE_TOOLS_PATH: passingTools() }
      })
    const flags = [
      '--remote-debugging-port=0',
      '--remote-debugging-pipe',
      '--gpu-launcher=/usr/bin/true',
      '--browser-subprocess-path=/usr/bin/true',
      '--renderer-cmd-prefix=/usr/bin/true'
    ]
    expect(Object.fromEntries(flags.map((f) => [f, run([f]).status]))).toEqual(
      Object.fromEntries(flags.map((f) => [f, 1]))
    )
    expect(run([]).signal).toBe('SIGKILL')
  })

  test('turns off running as Node and NODE_OPTIONS, and loads only an intact asar', () => {
    const { status, stdout } = spawnSync(
      'npx',
      ['--no-install', 'electron-fuses', 'read', '--app', join(packaged, '../../..')],
      { encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '0' } }
    )
    expect(status).toBe(0)
    for (const line of [
      'RunAsNode is Disabled',
      'EnableNodeOptionsEnvironmentVariable is Disabled',
      'EnableEmbeddedAsarIntegrityValidation is Enabled',
      'OnlyLoadAppFromAsar is Enabled'
    ])
      expect(stdout).toContain(line)
  })

  test('packs only the build output and package.json, besides production modules, without local paths', () => {
    const { status, stdout } = spawnSync(
      'npx',
      ['--no-install', 'asar', 'list', join(packaged, '../../Resources/app.asar')],
      { encoding: 'utf8' }
    )
    expect(status).toBe(0)
    const extra = stdout
      .split('\n')
      .filter((f) => f && !/^\/(out|node_modules)(\/|$)/.test(f) && f !== '/package.json')
    expect(extra).toEqual([])
    const release = join(
      packaged,
      '../../Resources/app.asar.unpacked/node_modules/node-pty/build/Release'
    )
    for (const file of ['pty.node', 'spawn-helper'])
      expect(readFileSync(join(release, file)).includes(homedir()), file).toBe(false)
  })
})

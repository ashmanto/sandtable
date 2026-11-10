import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkRemovable, removeWorktree, worktreePath } from '../git/worktree'
import type { SessionRecord } from '../../shared/types'
import { project, session, settle, setup, tempDir, ticket } from '../test/orchestrator'

vi.mock('../env/tools', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../env/tools')>()),
  stopChildren: vi.fn()
}))

beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }))
afterEach(() => {
  vi.useRealTimers()
})

describe('leftover sessions', () => {
  const wt = (): string => tempDir('st-wt-')

  it('lists a running session of a removed project until endAndRemove cleans it', async () => {
    const t = setup({ sessions: [session({ worktrees: [wt()] })] })
    t.live.add('st-p1-octo-shop-147')
    await t.orch.reconnect()
    await t.orch.removeProject('p1')
    expect(await t.orch.leftovers()).toEqual([
      {
        kind: 'session',
        session: expect.objectContaining({ id: 's1' }),
        project: null,
        name: 'octo/shop#147',
        repo: 'octo/shop',
        keepWorktree: false,
        title: null,
        done: false
      }
    ])
    expect(await t.orch.endAndRemove('s1')).toEqual({ removed: true })
    expect(await t.orch.leftovers()).toEqual([])
  })

  it('leaves out a session on a visible ticket and a sidebar session', async () => {
    const adhoc = session({
      id: 'a1',
      ticketKey: undefined,
      name: 'Oct 24, 10:00',
      tmuxName: 'st-p1-session-a1',
      worktrees: [],
      checkout: '/repos/shop'
    })
    const t = setup({ sessions: [session({ worktrees: [wt()] }), adhoc] })
    t.live.add('st-p1-octo-shop-147').add('st-p1-session-a1')
    await t.orch.reconnect()
    await t.orch.sync('p1')
    expect(await t.orch.leftovers()).toEqual([])
  })

  it('lists a session whose ticket left the board while its worktree is on disk', async () => {
    const t = setup({
      tickets: [],
      sessions: [
        session({ state: 'finished', worktrees: [wt()] }),
        session({
          id: 's2',
          ticketKey: 'octo/shop#2',
          state: 'finished',
          worktrees: ['/gone']
        })
      ]
    })
    await t.orch.reconnect()
    await t.orch.sync('p1')
    expect(await t.orch.leftovers()).toEqual([
      {
        kind: 'session',
        session: expect.objectContaining({ id: 's1' }),
        project: 'Shop',
        name: 'octo/shop#147',
        repo: 'octo/shop',
        keepWorktree: false,
        title: null,
        done: false
      }
    ])
  })

  it('lists none of the ticket sessions of a project that never synced', async () => {
    const t = setup({ sessions: [session({ ticketKey: 'octo/shop#2', worktrees: [wt()] })] })
    t.live.add('st-p1-octo-shop-147')
    t.deps.board.tickets.mockRejectedValue(new Error('offline'))
    await t.orch.reconnect()
    await settle()
    expect(await t.orch.leftovers()).toEqual([])
  })

  it('leaves out a session whose worktree a shown session uses', async () => {
    const shared = wt()
    const t = setup({
      sessions: [
        session({ worktrees: [shared] }),
        session({ id: 's2', ticketKey: 'octo/shop#2', state: 'finished', worktrees: [shared] })
      ]
    })
    t.live.add('st-p1-octo-shop-147')
    await t.orch.reconnect()
    await t.orch.sync('p1')
    expect(await t.orch.leftovers()).toEqual([])
  })

  it('lists a live session on a ticket in the hidden column', async () => {
    const t = setup({
      tickets: [ticket({ status: 'Wont fix' })],
      sessions: [session({ worktrees: [wt()] })]
    })
    t.live.add('st-p1-octo-shop-147')
    await t.orch.reconnect()
    await t.orch.sync('p1')
    expect(await t.orch.leftovers()).toMatchObject([{ kind: 'session', session: { id: 's1' } }])
  })

  it('lists a live session whose worktree a shown session uses, to end only', async () => {
    const shared = wt()
    const t = setup({
      sessions: [
        session({ state: 'finished', worktrees: [shared] }),
        session({
          id: 's2',
          ticketKey: 'octo/shop#2',
          tmuxName: 'st-p1-2',
          worktrees: [shared]
        })
      ]
    })
    t.live.add('st-p1-2')
    await t.orch.reconnect()
    await t.orch.sync('p1')
    expect(await t.orch.leftovers()).toMatchObject([
      { kind: 'session', session: { id: 's2' }, keepWorktree: true }
    ])
  })

  describe('when another project shows the same ticket in the same worktree', () => {
    const twoProjects = (state: SessionRecord['state']): ReturnType<typeof setup> => {
      const shared = wt()
      const t = setup({
        projects: [project, { ...project, id: 'p2', name: 'Other' }],
        sessions: [
          session({ state, worktrees: [shared] }),
          session({ id: 's2', projectId: 'p2', tmuxName: 'st-p2-147', worktrees: [shared] })
        ]
      })
      t.live.add('st-p2-147')
      if (state === 'running') t.live.add('st-p1-octo-shop-147')
      return t
    }

    it("leaves out the removed project's finished session", async () => {
      const t = twoProjects('finished')
      await t.orch.reconnect()
      await t.orch.sync('p2')
      await t.orch.removeProject('p1')
      expect(await t.orch.leftovers()).toEqual([])
    })

    it("lists the removed project's live session to end only", async () => {
      const t = twoProjects('running')
      await t.orch.reconnect()
      await t.orch.sync('p2')
      await t.orch.removeProject('p1')
      expect(await t.orch.leftovers()).toMatchObject([
        { kind: 'session', session: { id: 's1' }, keepWorktree: true }
      ])
    })
  })

  describe('on done tickets', () => {
    const done = ticket({ status: 'Done' })

    it('lists a live done session', async () => {
      const t = setup({ tickets: [done], sessions: [session({ worktrees: [wt()] })] })
      t.live.add('st-p1-octo-shop-147')
      await t.orch.reconnect()
      await t.orch.sync('p1')
      expect(await t.orch.leftovers()).toEqual([
        {
          kind: 'session',
          session: expect.objectContaining({ id: 's1' }),
          project: 'Shop',
          name: 'octo/shop#147',
          repo: 'octo/shop',
          keepWorktree: false,
          title: 'Dark mode toggle',
          done: true
        }
      ])
    })

    it('lists a finished done session with its worktree on disk', async () => {
      const t = setup({
        tickets: [done],
        sessions: [session({ state: 'finished', worktrees: [wt()] })]
      })
      await t.orch.reconnect()
      await t.orch.sync('p1')
      expect(await t.orch.leftovers()).toMatchObject([
        { kind: 'session', session: { id: 's1' }, done: true }
      ])
    })

    it('leaves out a removed done session and an in-progress one', async () => {
      const t = setup({
        tickets: [done, ticket({ key: 'octo/shop#2', number: 2, status: 'In Progress' })],
        sessions: [
          session({ state: 'finished', worktrees: [wt()], removedAt: '2026-10-25T00:00:00.000Z' }),
          session({
            id: 's2',
            ticketKey: 'octo/shop#2',
            tmuxName: 'st-p1-2',
            worktrees: [wt()]
          })
        ]
      })
      t.live.add('st-p1-2')
      await t.orch.reconnect()
      await t.orch.sync('p1')
      expect(await t.orch.leftovers()).toEqual([])
    })

    it('lists the newest session once, though an older one shares its worktree', async () => {
      const shared = wt()
      const t = setup({
        tickets: [done],
        sessions: [
          session({
            id: 's0',
            state: 'finished',
            worktrees: [shared],
            startedAt: '2026-10-23T00:00:00.000Z'
          }),
          session({ state: 'finished', worktrees: [shared] })
        ]
      })
      await t.orch.reconnect()
      await t.orch.sync('p1')
      expect(await t.orch.leftovers()).toMatchObject([{ session: { id: 's1' } }])
    })
  })

  it('tags each session it starts with its data folder', async () => {
    const t = setup()
    await t.orch.reconnect()
    await t.orch.create('p1', 'octo/shop', false)
    expect(t.deps.tmux.startTmux.mock.calls[0][4]).toBe(t.dataDir)
  })

  it("does not show another Sandtable's or an untagged st- session as unknown", async () => {
    const t = setup()
    t.live.add('st-p1-theirs').add('st-p1-old')
    t.owners.set('st-p1-theirs', '/other/sandtable').set('st-p1-old', '')
    await t.orch.reconnect()
    expect(await t.orch.leftovers()).toEqual([])
    await expect(t.orch.endUnknown('st-p1-theirs')).rejects.toThrow('Unknown session')
    expect(t.deps.tmux.killTmux).not.toHaveBeenCalled()
  })

  it('does not show a session created while tmux lists as unknown', async () => {
    const t = setup()
    await t.orch.reconnect()
    const list = t.deps.tmux.listTmux.getMockImplementation()!
    t.deps.tmux.listTmux.mockImplementationOnce(async () => {
      await t.orch.create('p1', 'octo/shop', false)
      return list()
    })
    expect(await t.orch.leftovers()).toEqual([])
  })

  it('shows an st- tmux session with no record as unknown, and ends only that', async () => {
    const t = setup({ sessions: [session({ worktrees: [wt()] })] })
    t.live.add('st-p1-octo-shop-147').add('st-p1-stray').add('other')
    await t.orch.reconnect()
    await t.orch.sync('p1')
    expect(await t.orch.leftovers()).toEqual([{ kind: 'unknown', tmuxName: 'st-p1-stray' }])
    await expect(t.orch.endUnknown('st-p1-octo-shop-147')).rejects.toThrow('Unknown session')
    await expect(t.orch.endUnknown('other')).rejects.toThrow('Unknown session')
    expect(t.deps.tmux.killTmux).not.toHaveBeenCalled()
    await t.orch.endUnknown('st-p1-stray')
    expect(t.deps.tmux.killTmux).toHaveBeenCalledWith('st-p1-stray')
    expect(await t.orch.leftovers()).toEqual([])
  })

  it('says so when an unknown session will not die', async () => {
    const t = setup()
    t.live.add('st-p1-stray')
    await t.orch.reconnect()
    t.deps.tmux.killTmux.mockResolvedValue(undefined)
    await expect(t.orch.endUnknown('st-p1-stray')).rejects.toThrow("Couldn't end the session")
  })

  it('does not show a session being created as unknown', async () => {
    const t = setup()
    await t.orch.reconnect()
    let launched!: () => void
    t.deps.tmux.startTmux.mockImplementation(async (name) => {
      t.live.add(name)
      await new Promise<void>((r) => (launched = r))
    })
    const created = t.orch.create('p1', 'octo/shop', false)
    await vi.waitFor(() => expect(t.live.size).toBe(1))
    expect(await t.orch.leftovers()).toEqual([])
    launched()
    await created
    expect(await t.orch.leftovers()).toEqual([])
  })
})

describe('leftover sessions with real git', () => {
  const git = (cwd: string, ...args: string[]): string =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' })
  const branch = '147-dark-mode-toggle'
  let repo: string
  let wt: string

  beforeEach(() => {
    const root = tempDir('st-git-')
    repo = path.join(root, 'shop')
    git(root, 'init', '-b', 'main', repo)
    git(repo, 'config', 'user.name', 'Test')
    git(repo, 'config', 'user.email', 'test@example.com')
    git(repo, 'config', 'commit.gpgsign', 'false')
    git(repo, 'config', 'core.hooksPath', '/dev/null')
    writeFileSync(path.join(repo, 'a.txt'), 'a\n')
    git(repo, 'add', '.')
    git(repo, 'commit', '-m', 'init')
    git(root, 'clone', '--bare', repo, path.join(root, 'origin.git'))
    git(repo, 'remote', 'add', 'origin', path.join(root, 'origin.git'))
    wt = worktreePath(repo, branch)
    git(repo, 'worktree', 'add', '-b', branch, wt, 'main')
    git(wt, 'push', '-u', 'origin', branch)
  })

  const orchestrator = async (
    repos: { github: string; path: string }[],
    state: SessionRecord['state'] = 'finished'
  ): Promise<ReturnType<typeof setup>> => {
    const t = setup({
      projects: [{ ...project, repos }],
      sessions: [session({ state, worktrees: [wt] })]
    })
    t.deps.git.checkRemovable.mockImplementation(checkRemovable)
    t.deps.git.removeWorktree.mockImplementation(removeWorktree)
    if (state !== 'finished') t.live.add('st-p1-octo-shop-147')
    await t.orch.reconnect()
    return t
  }
  const deleted = async (state?: SessionRecord['state']): Promise<ReturnType<typeof setup>> => {
    const t = await orchestrator([{ ...project.repos[0], path: repo }], state)
    await t.orch.removeProject('p1')
    return t
  }

  it('removes a clean, pushed worktree of a deleted project', async () => {
    const t = await deleted()
    expect(await t.orch.removeWorktree('s1')).toEqual({ removed: true })
    expect(existsSync(wt)).toBe(false)
    expect(await t.orch.leftovers()).toEqual([])
  })

  it("ends a deleted project's live session and removes its worktree", async () => {
    const t = await deleted('running')
    expect(await t.orch.endAndRemove('s1')).toEqual({ removed: true })
    expect(existsSync(wt)).toBe(false)
    expect(await t.orch.leftovers()).toEqual([])
  })

  it('removes the worktree of a repo that left a project that still exists', async () => {
    const t = await orchestrator([project.repos[1]])
    expect(await t.orch.removeWorktree('s1')).toEqual({ removed: true })
    expect(existsSync(wt)).toBe(false)
  })

  it("refuses a deleted project's worktree with uncommitted changes", async () => {
    const t = await deleted()
    writeFileSync(path.join(wt, 'b.txt'), 'b\n')
    expect(await t.orch.removeWorktree('s1')).toEqual({
      removed: false,
      reason: 'Uncommitted changes'
    })
    expect(existsSync(wt)).toBe(true)
  })

  it("refuses a deleted project's worktree with unpushed commits", async () => {
    const t = await deleted()
    writeFileSync(path.join(wt, 'b.txt'), 'b\n')
    git(wt, 'add', '.')
    git(wt, 'commit', '-m', 'local')
    expect(await t.orch.removeWorktree('s1')).toEqual({
      removed: false,
      reason: 'Commits not pushed'
    })
    expect(existsSync(wt)).toBe(true)
  })
})

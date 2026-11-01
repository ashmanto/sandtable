import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStore, emptyStore, serial } from './store'
import type { StoreData } from './store'

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'sandtable-store-'))
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(dir, { recursive: true, force: true })
})

const data: StoreData = {
  ...emptyStore(),
  projects: [
    {
      id: 'p1',
      name: 'Demo',
      repos: [{ github: 'o/r', path: '/tmp/repo' }],
      board: {
        source: {
          url: 'https://github.com/orgs/o/projects/1',
          ownerType: 'org',
          owner: 'o',
          number: 1
        },
        statusMap: { todo: 'Todo', inProgress: 'In Progress', done: 'Done' }
      },
      claudeDir: '/Users/a/.claude-work'
    }
  ],
  sessions: [
    {
      id: 's1',
      projectId: 'p1',
      ticketKey: 'o/r#1',
      tmuxName: 'sandtable-1',
      branch: 'ticket-1',
      worktrees: ['/tmp/wt'],
      eventsFile: '/tmp/e.jsonl',
      startedAt: '2026-10-24T00:00:00.000Z',
      state: 'running',
      claudeDir: '/Users/a/.claude-work'
    }
  ],
  accounts: [{ name: 'Work', dir: '/Users/a/.claude-work' }]
}

describe('store', () => {
  it('loads empty data when the file is missing', async () => {
    const store = createStore(join(dir, 'sandtable.json'))
    expect(await store.load()).toEqual(emptyStore())
  })

  it('loads a missing field as empty', async () => {
    const file = join(dir, 'sandtable.json')
    await fs.writeFile(file, JSON.stringify({ projects: data.projects, sessions: [] }))
    expect(await createStore(file).load()).toEqual({ ...emptyStore(), projects: data.projects })
  })

  it('rejects a corrupt file instead of loading empty data', async () => {
    const file = join(dir, 'sandtable.json')
    await fs.writeFile(file, '{')
    await expect(createStore(file).load()).rejects.toThrow(SyntaxError)
  })

  it('round-trips saved data, creating the parent directory', async () => {
    const store = createStore(join(dir, 'nested', 'sandtable.json'))
    await store.save(data)
    expect(await store.load()).toEqual(data)
  })

  it('writes to <file>.tmp and renames it into place', async () => {
    const file = join(dir, 'sandtable.json')
    const rename = vi.spyOn(fs, 'rename')
    await createStore(file).save(data)
    expect(rename).toHaveBeenCalledWith(`${file}.tmp`, file)
    await expect(fs.access(`${file}.tmp`)).rejects.toThrow()
  })

  it('leaves the old file intact if the rename never happens', async () => {
    const file = join(dir, 'sandtable.json')
    const store = createStore(file)
    await store.save(data)
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('crash'))
    await expect(store.save(emptyStore())).rejects.toThrow('crash')
    expect(await store.load()).toEqual(data)
  })
})

describe('writeAtomic', () => {
  it('syncs the temp file to disk before renaming it into place', async () => {
    const file = join(dir, 'sandtable.json')
    const order: string[] = []
    const open = fs.open.bind(fs)
    vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await open(...args)
      const sync = handle.sync.bind(handle)
      handle.sync = async () => {
        order.push('sync')
        return sync()
      }
      return handle
    })
    const rename = fs.rename.bind(fs)
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      order.push('rename')
      return rename(from, to)
    })
    await createStore(file).save(data)
    expect(order).toEqual(['sync', 'rename'])
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual(data)
  })

  it('rejects with the write error when closing the temp file also fails', async () => {
    const open = fs.open.bind(fs)
    vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await open(...args)
      const close = handle.close.bind(handle)
      handle.writeFile = async () => {
        throw new Error('disk full')
      }
      handle.close = async () => {
        await close()
        throw new Error('bad descriptor')
      }
      return handle
    })
    await expect(createStore(join(dir, 'sandtable.json')).save(data)).rejects.toThrow('disk full')
  })
})

describe('serial', () => {
  it('runs each task after the previous one settles and passes results through', async () => {
    const run = serial()
    const order: string[] = []
    let release: () => void = () => undefined
    const first = run(
      () => new Promise<string>((r) => (release = () => (order.push('first'), r('a'))))
    )
    const second = run(async () => (order.push('second'), 'b'))
    await new Promise((r) => setImmediate(r))
    expect(order).toEqual([])
    release()
    expect(await Promise.all([first, second])).toEqual(['a', 'b'])
    expect(order).toEqual(['first', 'second'])
  })

  it("rejects a failed task's caller without blocking the next task", async () => {
    const run = serial()
    const failed = run(async () => {
      throw new Error('disk full')
    })
    await expect(failed).rejects.toThrow('disk full')
    expect(await run(async () => 'next')).toBe('next')
  })

  it('flushes once every queued task settles, without rejecting for a failed one', async () => {
    const run = serial()
    let release: () => void = () => undefined
    const first = run(
      () => new Promise<void>((_, reject) => (release = () => reject(new Error('x'))))
    )
    let flushed = false
    const flush = run.flush().then(() => (flushed = true))
    await new Promise((r) => setImmediate(r))
    expect(flushed).toBe(false)
    release()
    await expect(first).rejects.toThrow('x')
    await flush
    expect(flushed).toBe(true)
  })
})

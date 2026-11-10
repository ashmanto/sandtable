import { describe, expect, it, vi, type Mock } from 'vitest'
import type { StartFailure, Ticket } from '../shared/types'
import type { MergedPr } from './github/merged'
import { createSync, type SyncApi, type Synced } from './sync'
import { project, ticket } from './test/orchestrator'

const failure = (t: Ticket): string => `Couldn't move ${t.key}`

type Built = {
  sync: SyncApi
  tracker: Record<'tickets' | 'setColumn' | 'setAssignee' | 'details', Mock>
  synced: Map<string, Synced>
  setStartFailures: Mock
}

const build = (over: { clock?: () => Date; startFailures?: StartFailure[] } = {}): Built => {
  const tracker = {
    tickets: vi.fn(async (): Promise<Ticket[]> => [ticket()]),
    setColumn: vi.fn(async (): Promise<void> => undefined),
    setAssignee: vi.fn(async (): Promise<void> => undefined),
    details: vi.fn()
  }
  const synced = new Map<string, Synced>()
  const setStartFailures = vi.fn()
  const sync = createSync({
    deps: { mergedPullRequests: vi.fn(async (): Promise<MergedPr[]> => []) },
    now: over.clock ?? (() => new Date('2026-11-11T00:00:00Z')),
    projects: () => [project],
    sessions: () => [],
    routines: () => [],
    startFailures: () => over.startFailures ?? [],
    setStartFailures,
    synced,
    mergedPrs: new Map(),
    projectById: () => project,
    trackerFor: () => tracker as never,
    stampOf: async () => null,
    tracked: () => false,
    keepDoneDaysOf: () => 14,
    persist: async () => undefined,
    persistCache: () => undefined,
    changed: () => undefined,
    clearFixedFolders: async () => false,
    ticketId: (projectId, ticketKey) => `${projectId} ${ticketKey}`,
    syncedTicket: (projectId, ticketKey) =>
      synced.get(projectId)!.tickets.find((t) => t.key === ticketKey)!,
    onSync: () => undefined,
    autoOn: () => false,
    autoPrFindings: async () => undefined
  })
  return { sync, tracker, synced, setStartFailures }
}

describe('createSync', () => {
  it('writes into the shared synced map', async () => {
    const { sync, synced } = build()
    expect(await sync.sync('p1')).toBeNull()
    expect(synced.get('p1')?.tickets).toEqual([ticket()])
  })

  it('drops a sync that started before the last applied one', async () => {
    let t = 0
    const { sync, tracker, synced } = build({ clock: () => new Date(++t) })
    let release!: (x: Ticket[]) => void
    tracker.tickets.mockReturnValueOnce(new Promise((r) => (release = r)))
    tracker.tickets.mockResolvedValueOnce([ticket({ title: 'second' })])
    const first = sync.sync('p1')
    await sync.sync('p1')
    release([ticket({ title: 'first' })])
    await first
    expect(synced.get('p1')?.tickets.map((x) => x.title)).toEqual(['second'])
  })

  it('reapplies a pending move to fresh tickets', async () => {
    const { sync, tracker, synced } = build()
    await sync.sync('p1')
    tracker.setColumn.mockReturnValueOnce(new Promise(() => undefined))
    void sync.moveTicket(project, ticket().key, 'done', failure)
    await sync.sync('p1')
    expect(synced.get('p1')?.tickets[0].status).toBe('Done')
  })

  it('rolls back a failed move and records the error', async () => {
    const { sync, tracker, synced } = build()
    await sync.sync('p1')
    tracker.setColumn.mockRejectedValueOnce(new Error('nope'))
    await expect(sync.moveTicket(project, ticket().key, 'done', failure)).rejects.toThrow('nope')
    expect(synced.get('p1')?.tickets[0].status).toBe('Todo')
    expect(synced.get('p1')?.error).toBe(`${failure(ticket())}: nope`)
  })

  it('prunes start failures through the setter', async () => {
    const gone = { projectId: 'p1', ticketKey: 'octo/shop#9', at: '', reason: 'x', repo: null }
    const { sync, setStartFailures } = build({ startFailures: [gone] })
    await sync.sync('p1')
    expect(setStartFailures).toHaveBeenCalledWith([])
  })

  it("resetSource drops the project's moves", async () => {
    const { sync, synced } = build()
    await sync.sync('p1')
    await sync.moveTicket(project, ticket().key, 'done', failure)
    sync.resetSource('p1')
    await sync.sync('p1')
    expect(synced.get('p1')?.tickets[0].status).toBe('Todo')
  })
})

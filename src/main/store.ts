import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import type {
  Account,
  Chat,
  Finding,
  Project,
  ProjectGroup,
  Routine,
  SessionRecord,
  SkippedRun,
  StartFailure
} from '../shared/types'

export type StoreData = {
  projects: Project[]
  groups: ProjectGroup[]
  sessions: SessionRecord[]
  accounts: Account[]
  chats: Chat[]
  runs: Run[]
  findings: Finding[]
  routines: Routine[]
  skippedRuns: SkippedRun[]
  startFailures: StartFailure[]
  setupPending: string[]
  setupHintsOff: string[]
}
/** A `claude -p` run Sandtable started for a ticket, kept so its transcript counts toward the ticket's usage. */
export type Run = { projectId: string; ticketKey: string; claudeDir: string; id: string }
export type Store = { load(): Promise<StoreData>; save(data: StoreData): Promise<void> }

/** Writes `text` to `file`, created with `mode` when given, through a synced temp file and a rename, so readers never see half a file. */
export async function writeAtomic(file: string, text: string, mode?: number): Promise<void> {
  await fs.mkdir(dirname(file), { recursive: true })
  const handle = await fs.open(`${file}.tmp`, 'w', mode)
  try {
    await handle.writeFile(text)
    await handle.sync()
  } catch (err) {
    await handle.close().catch(() => undefined)
    throw err
  }
  await handle.close()
  await fs.rename(`${file}.tmp`, file)
}

/** A runner that starts each task after the previous one settles, so one failure never blocks the next. */
export function serial(): {
  <T>(task: () => Promise<T>): Promise<T>
  flush(): Promise<void>
} {
  let tail: Promise<unknown> = Promise.resolve()
  const run = <T>(task: () => Promise<T>): Promise<T> => {
    const next = tail.then(task)
    tail = next.catch(() => undefined)
    return next
  }
  return Object.assign(run, { flush: () => tail.then(() => undefined) })
}

/** The store's contents on a fresh install. */
export const emptyStore = (): StoreData => ({
  projects: [],
  groups: [],
  sessions: [],
  accounts: [],
  chats: [],
  runs: [],
  findings: [],
  routines: [],
  skippedRuns: [],
  startFailures: [],
  setupPending: [],
  setupHintsOff: []
})

/** A JSON file store that replaces the file atomically on save; missing fields load empty. */
export function createStore(file: string): Store {
  return {
    async load() {
      try {
        return { ...emptyStore(), ...(JSON.parse(await fs.readFile(file, 'utf8')) as StoreData) }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyStore()
        throw err
      }
    },
    save: (data) => writeAtomic(file, JSON.stringify(data, null, 2))
  }
}

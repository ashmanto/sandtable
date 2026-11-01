import type {
  Project,
  ProjectRepo,
  RemoveResult,
  SetupProgress,
  SetupSuggestion
} from '../../shared/types'
import { copyPathProblem, SETUP_CANCELLED, SETUP_FAILED } from '../../shared/worktreeSetup'
import type { Orchestrator, OrchestratorDeps } from '../orchestrator'
import { redact } from './claudeLaunch'

const SETUP_LINES = 20
const MAX_COPY_PATHS = 20
const MAX_SETUP_COMMAND = 1000
const SETUP_PUSH_MS = 200
const setupLine = (line: string): string => redact(line).slice(0, 300)
const KEY_BEGIN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/
const KEY_END = /-----END [A-Z0-9 ]*PRIVATE KEY-----/
const keyRedactor = (): ((line: string) => string | null) => {
  let inKey = false
  return (line) => {
    if (inKey) {
      inKey = !KEY_END.test(line)
      return null
    }
    if (!KEY_BEGIN.test(line)) return setupLine(line)
    inKey = !KEY_END.test(line)
    return '[redacted]'
  }
}
/** Setup output lines redacted, counting the lines before an END with no BEGIN as part of a key block. */
const redactedLines = (lines: string[]): string[] => {
  const end = lines.findIndex((l) => KEY_END.test(l))
  const cut = end >= 0 && !lines.slice(0, end + 1).some((l) => KEY_BEGIN.test(l))
  const kept = lines.slice(cut ? end + 1 : 0).map(keyRedactor())
  return [...(cut ? ['[redacted]'] : []), ...kept].filter((l): l is string => l !== null)
}

type SetupApi = Pick<
  Orchestrator,
  | 'setupProgress'
  | 'cancelSetup'
  | 'suggestSetup'
  | 'setupHint'
  | 'hideSetupHint'
  | 'onSetupProgress'
>

/** Builds worktree setup runs over the orchestrator's projects and stored setup state. */
export function createSetupRuns(ctx: {
  deps: Pick<OrchestratorDeps, 'git' | 'setup'>
  now: () => Date
  setupPending: () => string[]
  setSetupPending: (next: string[]) => void
  setupHintsOff: () => string[]
  setSetupHintsOff: (next: string[]) => void
  persist: () => Promise<void>
  projectById: (id: string) => Project
  repoOf: (project: Project, github: string) => ProjectRepo
  checkFolders: (repos: ProjectRepo[]) => Promise<void>
  subscribe: <T>(set: Set<T>, cb: T) => () => void
}): SetupApi & {
  showSetup: (target: string, progress: SetupProgress | null) => void
  unpend: (paths: string[]) => Promise<void>
  pend: (repo: ProjectRepo, made: { path: string; created: boolean }) => Promise<void>
  skipSetups: (target: string) => void
  removeTree: (path: string, repoPaths: string[]) => Promise<RemoveResult>
  removeKept: (path: string, repoPath: string) => Promise<unknown>
  keep: (target: string, path: string, repoPath: string) => void
  assertNoSetup: (target: string) => void
  runSetups: (
    target: string,
    pairs: { repo: ProjectRepo; worktree: string; created: boolean }[]
  ) => Promise<void>
  savedRepo: (repo: ProjectRepo, before?: ProjectRepo) => Promise<ProjectRepo>
} {
  const { deps, now, persist, projectById, repoOf, checkFolders, subscribe } = ctx
  const setupProgress = new Map<string, SetupProgress>()
  const setupListeners = new Set<(target: string, progress: SetupProgress | null) => void>()
  const setupRuns = new Map<string, AbortController>()
  const keptSetups = new Map<string, { path: string; repoPath: string }>()
  const showSetup = (target: string, progress: SetupProgress | null): void => {
    if (progress) setupProgress.set(target, progress)
    else if (!setupProgress.delete(target)) return
    setupListeners.forEach((cb) => cb(target, progress))
  }
  const unpend = async (paths: string[]): Promise<void> => {
    const left = ctx.setupPending().filter((p) => !paths.includes(p))
    if (left.length === ctx.setupPending().length) return
    ctx.setSetupPending(left)
    await persist()
  }
  const pend = async (
    repo: ProjectRepo,
    made: { path: string; created: boolean }
  ): Promise<void> => {
    if (!made.created || !hasSetup(repo) || ctx.setupPending().includes(made.path)) return
    ctx.setSetupPending([...ctx.setupPending(), made.path])
    await persist()
  }
  const skipSetups = (target: string): void => {
    assertNoSetup(target)
    keptSetups.delete(target)
    showSetup(target, null)
  }
  const removeTree = async (path: string, repoPaths: string[]): Promise<RemoveResult> => {
    const removed = await deps.git.removeWorktree(path, repoPaths)
    if (removed.removed) await unpend([path])
    return removed
  }
  const removeKept = (path: string, repoPath: string): Promise<unknown> =>
    removeTree(path, [repoPath]).catch(() => undefined)
  const hasSetup = (repo: ProjectRepo): boolean =>
    !!(repo.setup?.copy?.length || repo.setup?.command)
  const assertNoSetup = (target: string): void => {
    if (setupRuns.has(target)) throw new Error('Setup is already running')
  }
  const runSetups = async (
    target: string,
    pairs: { repo: ProjectRepo; worktree: string; created: boolean }[]
  ): Promise<void> => {
    assertNoSetup(target)
    keptSetups.delete(target)
    const controller = new AbortController()
    const assertNotCancelled = (): void => {
      if (controller.signal.aborted) throw new Error(SETUP_CANCELLED)
    }
    setupRuns.set(target, controller)
    try {
      const due = pairs.filter(
        ({ repo, worktree, created }) =>
          hasSetup(repo) && (created || ctx.setupPending().includes(worktree))
      )
      for (const { repo, worktree } of due) {
        assertNotCancelled()
        const { copy = [], command } = repo.setup ?? {}
        const startedAt = now().toISOString()
        showSetup(target, { repo: repo.github, state: 'running', notes: [], lines: [], startedAt })
        const notes = await deps.setup.copy(repo.path, worktree, copy, controller.signal)
        assertNotCancelled()
        const progress: SetupProgress = {
          repo: repo.github,
          state: 'running',
          notes,
          lines: [],
          startedAt
        }
        showSetup(target, progress)
        if (command) {
          let lines: string[] = []
          const shown = keyRedactor()
          let shownAt = 0
          let timer: ReturnType<typeof setTimeout> | undefined
          const show = (): void => {
            timer = undefined
            shownAt = Date.now()
            showSetup(target, { ...progress, lines })
          }
          const result = await deps.setup.run(worktree, command, {
            signal: controller.signal,
            onOutput: (raw) => {
              const line = shown(raw)
              if (line === null) return
              lines = [...lines.slice(1 - SETUP_LINES), line]
              timer ??= setTimeout(show, Math.max(0, shownAt + SETUP_PUSH_MS - Date.now()))
            }
          })
          clearTimeout(timer)
          if (result.why === 'cancelled') throw new Error(SETUP_CANCELLED)
          if (result.code !== 0) {
            const named =
              command.length <= 40 && !command.includes('\n') ? command : 'the setup command'
            const error = redact(result.why ?? `${named} exited with code ${result.code}`)
            const tail = redactedLines(result.lines).slice(-SETUP_LINES)
            showSetup(target, { ...progress, state: 'failed', error, lines: tail })
            throw new Error(`${SETUP_FAILED}: ${error}`)
          }
        }
        await unpend([worktree])
      }
      assertNotCancelled()
      showSetup(target, null)
    } catch (err) {
      if (setupProgress.get(target)?.state === 'running') showSetup(target, null)
      throw err
    } finally {
      setupRuns.delete(target)
    }
  }

  const savedRepo = async (
    { setup, ...repo }: ProjectRepo,
    before?: ProjectRepo
  ): Promise<ProjectRepo> => {
    if (setup === undefined) return repo
    if (typeof setup !== 'object' || setup === null || Array.isArray(setup))
      throw new Error('Not a worktree setup')
    const { copy = [], command = '' } = setup
    if (!Array.isArray(copy) || copy.some((p) => typeof p !== 'string'))
      throw new Error('Not a list of copy paths')
    if (copy.length > MAX_COPY_PATHS) throw new Error(`Copy at most ${MAX_COPY_PATHS} paths`)
    const twice = copy.find((p, i) => copy.indexOf(p) !== i)
    if (twice !== undefined) throw new Error(`${twice} is listed twice`)
    if (typeof command !== 'string' || command.includes('\0'))
      throw new Error('Not a setup command')
    const cmd = command.trim()
    if (cmd.length > MAX_SETUP_COMMAND) throw new Error('Shorten the setup command')
    for (const p of copy) {
      const syntax = copyPathProblem(p)
      if (syntax) throw new Error(`Can't copy ${p}: ${syntax}`)
    }
    const unchanged =
      before?.path === repo.path && (before.setup?.copy ?? []).join('\0') === copy.join('\0')
    if (copy.length && !unchanged)
      await checkFolders([repo]).catch(() => {
        throw new Error(`Choose a folder for ${repo.github} before setting its worktree setup`)
      })
    for (const p of unchanged ? [] : copy) {
      const why = await deps.setup.problem(repo.path, p)
      if (why) throw new Error(`Can't copy ${p}: ${why}. Only paths git ignores can be copied.`)
    }
    if (!copy.length && !cmd) return repo
    return {
      ...repo,
      setup: { ...(copy.length ? { copy } : {}), ...(cmd ? { command: cmd } : {}) }
    }
  }

  return {
    showSetup,
    unpend,
    pend,
    skipSetups,
    removeTree,
    removeKept,
    keep: (target, path, repoPath) => keptSetups.set(target, { path, repoPath }),
    assertNoSetup,
    runSetups,
    savedRepo,

    setupProgress: (target: string): SetupProgress | null => setupProgress.get(target) ?? null,

    async cancelSetup(target: string): Promise<void> {
      if (typeof target !== 'string') throw new Error('Not a setup target')
      setupRuns.get(target)?.abort()
      const kept = keptSetups.get(target)
      keptSetups.delete(target)
      if (setupProgress.get(target)?.state === 'failed') showSetup(target, null)
      if (kept) await removeKept(kept.path, kept.repoPath)
    },

    async suggestSetup(path: string): Promise<SetupSuggestion | null> {
      if (typeof path !== 'string' || !path.startsWith('/')) throw new Error('Not a folder')
      return deps.setup.suggest(path)
    },

    async setupHint(projectId: string, repo: string): Promise<SetupSuggestion | null> {
      const r = repoOf(projectById(projectId), repo)
      if (hasSetup(r) || ctx.setupHintsOff().includes(`${projectId}\n${r.github}`)) return null
      return deps.setup.suggest(r.path)
    },

    async hideSetupHint(projectId: string, repo: string): Promise<void> {
      const key = `${projectId}\n${repoOf(projectById(projectId), repo).github}`
      if (ctx.setupHintsOff().includes(key)) return
      ctx.setSetupHintsOff([...ctx.setupHintsOff(), key])
      await persist()
    },

    onSetupProgress: (cb: (target: string, progress: SetupProgress | null) => void) =>
      subscribe(setupListeners, cb)
  }
}

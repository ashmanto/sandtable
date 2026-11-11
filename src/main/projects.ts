import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'
import type {
  Account,
  JiraProject,
  Project,
  ProjectGroup,
  ProjectRepo,
  SessionRecord
} from '../shared/types'
import { withGroup } from '../shared/types'
import { isApp } from '../shared/editors'
import { isSandboxDomain } from '../shared/sandbox'
import { findRepo } from '../shared/repo'
import { instructionsBytes, keptInstructions, MAX_INSTRUCTIONS_BYTES } from '../shared/instructions'
import { TOKEN_CAPS } from '../shared/pricing'
import { isJiraProjectKey } from './jira/client'
import { assertSite } from './jira/rest'
import { accountEnv } from './env/tools'
import type { MergedPr } from './github/merged'
import type { Orchestrator, OrchestratorDeps } from './orchestrator'
import type { Synced } from './sync'

const sourceOf = (p: Project): string =>
  JSON.stringify([
    p.board?.source.url,
    p.linear?.team,
    p.linear?.projects.map((x) => x.id),
    p.linear?.workspace,
    p.jira?.site,
    p.jira?.project,
    p.jira?.board?.id
  ])

function savedInstructions(x: unknown): Project['instructions'] {
  if (x === undefined) return undefined
  if (typeof x !== 'object' || x === null) throw new Error('Not instructions')
  const { all, labels = [] } = x as { all?: unknown; labels?: unknown }
  if (
    (all !== undefined && typeof all !== 'string') ||
    !Array.isArray(labels) ||
    labels.some((l) => typeof l?.label !== 'string' || typeof l?.text !== 'string')
  )
    throw new Error('Not instructions')
  const out = keptInstructions({ ...(all !== undefined && { all }), labels })
  const bytes = instructionsBytes(out)
  if (bytes > MAX_INSTRUCTIONS_BYTES)
    throw new Error(
      `Your instructions are ${bytes.toLocaleString('en-US')} bytes; the limit is ${MAX_INSTRUCTIONS_BYTES.toLocaleString('en-US')}`
    )
  return out
}

/** What the projects module reads from the orchestrator. */
export type ProjectsContext = {
  deps: Pick<OrchestratorDeps, 'claudeDir' | 'jiraCredentials'>
  projects: () => Project[]
  setProjects: (next: Project[]) => void
  groups: () => ProjectGroup[]
  setGroups: (next: ProjectGroup[]) => void
  accounts: () => Account[]
  setAccounts: (next: Account[]) => void
  sessions: () => SessionRecord[]
  synced: Map<string, Synced>
  mergedPrs: Map<string, MergedPr[]>
  projectById: (id: string) => Project
  savedRepo: (repo: ProjectRepo, before?: ProjectRepo) => Promise<ProjectRepo>
  persist: () => Promise<void>
  persistCache: () => void
  changed: (projectId: string) => void
  clearFixedFolders: (p: Project) => Promise<boolean>
  resetSource: (projectId: string) => void
  assertModel: (m: unknown) => void
  assertEffort: (e: unknown) => void
  syncGate: (s: SessionRecord) => Promise<void>
  sync: (projectId: string) => Promise<unknown>
}

/** Project and account saving, editor choice, and project grouping. */
export type ProjectsApi = Pick<
  Orchestrator,
  | 'saveProject'
  | 'setEditor'
  | 'arrangeProjects'
  | 'listAccounts'
  | 'addAccount'
  | 'removeAccount'
  | 'usedAccounts'
> & { allAccounts(): Account[] }

/** Builds the projects module, which owns saving projects, editors, groups, and accounts. */
export function createProjects(ctx: ProjectsContext): ProjectsApi {
  const { deps } = ctx
  const assertJira = async (jira: JiraProject): Promise<void> => {
    assertSite(jira.site)
    if (!isJiraProjectKey(jira.project)) throw new Error('Not a Jira project key')
    if (typeof jira.name !== 'string' || /[\r\n]/.test(jira.name))
      throw new Error('Not a Jira project name')
    const { board } = jira
    if (
      board !== undefined &&
      (typeof board !== 'object' ||
        board === null ||
        !Number.isInteger(board.id) ||
        board.id <= 0 ||
        typeof board.name !== 'string' ||
        /[\r\n]/.test(board.name))
    )
      throw new Error('Not a Jira board')
    if (!(await deps.jiraCredentials.sites()).some((a) => a.site === jira.site))
      throw new Error(`No Jira account for ${jira.site}; add one in Add project`)
  }
  const added = (): Account[] => ctx.accounts().filter((a) => a.dir !== deps.claudeDir)
  const allAccounts = (): Account[] => [{ name: 'Default', dir: deps.claudeDir }, ...added()]

  return {
    allAccounts,
    async saveProject(project: Project): Promise<void> {
      if ([project.board, project.linear, project.jira].filter(Boolean).length > 1)
        throw new Error('Pick one ticket source')
      const workspace = project.linear?.workspace
      if (workspace !== undefined && !/^[A-Za-z0-9._-]+$/.test(workspace))
        throw new Error('Not a Linear workspace')
      if (project.linear && !/^[A-Za-z0-9_]+$/.test(project.linear.team))
        throw new Error('Not a Linear team')
      if (project.linear?.projects.some((p) => !/^[A-Za-z0-9-]+$/.test(p.id)))
        throw new Error('Not a Linear project')
      if (project.jira) await assertJira(project.jira)
      if (project.tokenCap !== undefined && !TOKEN_CAPS.includes(project.tokenCap))
        throw new Error('Not a token cap')
      ctx.assertModel(project.model)
      ctx.assertEffort(project.effort)
      if (project.editor !== undefined && typeof project.editor !== 'string')
        throw new Error('Not an editor')
      if (!isApp(project.editor)) delete project.editor
      if (project.sandbox !== undefined && project.sandbox !== true)
        throw new Error('Not a sandbox choice')
      if (project.sandboxDomains !== undefined && !Array.isArray(project.sandboxDomains))
        throw new Error('Not a domain list')
      for (const d of project.sandboxDomains ?? [])
        if (typeof d !== 'string' || !isSandboxDomain(d))
          throw new Error(`Not a domain: ${String(d)}`)
      const saved = ctx.projects().find((x) => x.id === project.id)?.repos ?? []
      const repos = await Promise.all(
        project.repos.map((r) => ctx.savedRepo(r, findRepo(saved, r.github)))
      )
      const { instructions, ...plain } = { ...project, repos }
      const kept = savedInstructions(instructions)
      const checked: Project = kept ? { ...plain, instructions: kept } : plain
      const { claudeDir, ...rest } = checked
      const p: Project =
        ctx.accounts().some((a) => a.dir === claudeDir) || accountEnv(claudeDir, deps.claudeDir)
          ? checked
          : rest
      if (p.claudeDir && !ctx.accounts().some((a) => a.dir === p.claudeDir))
        throw new Error(`Add the account for ${p.claudeDir} on Settings first`)
      const projects = ctx.projects()
      const i = projects.findIndex((x) => x.id === p.id)
      const resourced = i >= 0 && sourceOf(projects[i]) !== sourceOf(p)
      ctx.setProjects(
        i < 0
          ? [...projects, withGroup(p, undefined)]
          : projects.with(i, withGroup(p, projects[i].group))
      )
      const cleared = await ctx.clearFixedFolders(p)
      await ctx.persist()
      if (cleared) ctx.changed(p.id)
      for (const s of ctx.sessions()) if (s.projectId === p.id) await ctx.syncGate(s)
      if (resourced) {
        ctx.synced.delete(p.id)
        ctx.mergedPrs.delete(p.id)
        ctx.resetSource(p.id)
        ctx.persistCache()
      }
      void ctx.sync(p.id)
    },

    async setEditor(projectId, app) {
      if (!isApp(app)) throw new Error('Not an editor')
      const p = ctx.projectById(projectId)
      ctx.setProjects(ctx.projects().map((x) => (x === p ? { ...p, editor: app } : x)))
      await ctx.persist()
    },

    /** Replaces the groups and reorders projects to `order`; unlisted projects keep their order at the end. */
    async arrangeProjects(
      next: ProjectGroup[],
      order: { id: string; group?: string }[]
    ): Promise<void> {
      const byId = new Map(ctx.projects().map((p) => [p.id, p]))
      const valid = next
        .filter((g) => typeof g?.id === 'string' && typeof g.name === 'string')
        .map(({ id, name }) => ({ id, name }))
      const known = new Set(valid.map((g) => g.id))
      const placed = order.flatMap(({ id, group }) => {
        const p = byId.get(id)
        if (!p) return []
        byId.delete(id)
        return [withGroup(p, typeof group === 'string' ? group : undefined)]
      })
      ctx.setGroups(valid.filter((g, i) => valid.findIndex((x) => x.id === g.id) === i))
      ctx.setProjects(
        [...placed, ...byId.values()].map((p) =>
          withGroup(p, p.group && known.has(p.group) ? p.group : undefined)
        )
      )
      await ctx.persist()
    },

    listAccounts: async (): Promise<Account[]> => allAccounts(),

    async addAccount(a: Account): Promise<void> {
      const name = a.name.trim()
      const typed = a.dir.trim()
      if (!name) throw new Error('Enter a name')
      if (!typed) throw new Error('Enter a folder')
      const expanded = typed.startsWith('~/') ? homedir() + typed.slice(1) : typed
      if (!isAbsolute(expanded)) throw new Error('Enter a full path, starting with / or ~/')
      const dir = resolve(expanded)
      if (dir === homedir() || dir === '/')
        throw new Error(`${dir} can't be an account's folder. Use a folder such as ~/.claude-work.`)
      const all = allAccounts()
      if (all.some((x) => x.name.toLowerCase() === name.toLowerCase()))
        throw new Error(`An account named ${name} already exists`)
      const owner = all.find((x) => resolve(x.dir) === dir)
      if (owner) throw new Error(`${owner.name} already uses ${dir}`)
      ctx.setAccounts([...ctx.accounts(), { name, dir }])
      await ctx.persist()
    },

    async removeAccount(dir: string): Promise<void> {
      if (dir === deps.claudeDir) throw new Error("Default can't be removed")
      const account = ctx.accounts().find((a) => a.dir === dir)
      if (!account) throw new Error('Unknown account')
      const users = ctx
        .projects()
        .filter((p) => p.claudeDir === dir)
        .map((p) => p.name)
      if (users.length)
        throw new Error(
          `${users.join(', ')} ${users.length === 1 ? 'uses' : 'use'} ${account.name}. Pick another account for ${users.length === 1 ? 'it' : 'them'} first.`
        )
      ctx.setAccounts(ctx.accounts().filter((a) => a !== account))
      await ctx.persist()
    },

    usedAccounts: (): Account[] =>
      added().filter((a) => ctx.projects().some((p) => p.claudeDir === a.dir))
  }
}

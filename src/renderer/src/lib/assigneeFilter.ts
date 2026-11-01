import { hasLabel } from './labelFilter'
import { loadFilter, passesFilter, saveSaved, type SavedFilter } from './utils'

/** Whose tickets the board filters on, with `@me` and `@none` for the signed-in user and no one. */
export type AssigneeFilter = SavedFilter<'people'>

type Person = { login: string; name: string | null }
type Assigned = { assignees: Person[] }

const key = (projectId: string): string => `assigneeFilter:${projectId}`

/** The filter value and lane ID of tickets with no assignee. */
export const NO_ASSIGNEE = '@none'

/** A person's name, or their login when they have none. */
export const personName = (p: Person): string => p.name?.trim() || p.login

const matches = (person: string, t: Assigned, me: string | null): boolean => {
  if (person === NO_ASSIGNEE) return t.assignees.length === 0
  const login = person === '@me' ? me : person
  return login !== null && t.assignees.some((a) => hasLabel([login], a.login))
}

/** Whether the filter lets the ticket show; `me` is the signed-in login, null while unknown. */
export const passesAssignee = (f: AssigneeFilter, t: Assigned, me: string | null): boolean =>
  passesFilter(f, f.people, (p) => matches(p, t, me))

/** The tickets' assignees, plus any selected logins, once each by login, sorted by name. */
export function boardPeople(
  tickets: Assigned[],
  selected: string[]
): { login: string; name: string }[] {
  const byLogin = new Map<string, { login: string; name: string }>()
  const add = (p: Person): void => {
    const k = p.login.toLowerCase()
    if (!byLogin.has(k)) byLogin.set(k, { login: p.login, name: personName(p) })
  }
  for (const t of tickets) t.assignees.forEach(add)
  for (const login of selected) if (!login.startsWith('@')) add({ login, name: null })
  return [...byLogin.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** The filter saved for the project, or no filter. */
export const loadAssigneeFilter = (projectId: string): AssigneeFilter =>
  loadFilter(key(projectId), 'people')

/** Saves the project's filter for the next launch. */
export const saveAssigneeFilter = (projectId: string, f: AssigneeFilter): void =>
  saveSaved(key(projectId), f)

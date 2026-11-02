import type { Project, ProjectGroup } from './types'

/** One sidebar section: a group, or null for ungrouped, and its projects. */
export type Section = { group: ProjectGroup | null; projects: Project[] }

/** The sidebar's sections: ungrouped projects first, then each group in order. */
export function sections(projects: Project[], groups: ProjectGroup[]): Section[] {
  const known = new Set(groups.map((g) => g.id))
  return [
    { group: null, projects: projects.filter((p) => !p.group || !known.has(p.group)) },
    ...groups.map((group) => ({ group, projects: projects.filter((p) => p.group === group.id) }))
  ]
}

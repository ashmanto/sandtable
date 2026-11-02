import { sections } from '../../../shared/projectGroups'
import { withGroup, type Project, type ProjectGroup } from '../../../shared/types'

export { sections, type Section } from '../../../shared/projectGroups'

/** Moves a project into a group's section (null for ungrouped), beside a sibling or at the end, and returns the flattened list. */
export function moveProject(
  projects: Project[],
  groups: ProjectGroup[],
  id: string,
  to: string | null,
  beside?: { id: string; after: boolean }
): Project[] {
  const group = to && groups.some((g) => g.id === to) ? to : null
  const moving = projects.find((p) => p.id === id)
  if (!moving) return projects
  const moved = withGroup(moving, group ?? undefined)
  return sections(
    projects.filter((p) => p !== moving),
    groups
  ).flatMap((s) => {
    if ((s.group?.id ?? null) !== group) return s.projects
    const i = s.projects.findIndex((p) => p.id === beside?.id)
    const at = i < 0 ? s.projects.length : i + (beside?.after ? 1 : 0)
    return s.projects.toSpliced(at, 0, moved)
  })
}

/** Moves a group before or after another one. */
export function moveGroup(
  groups: ProjectGroup[],
  id: string,
  besideId: string,
  after: boolean
): ProjectGroup[] {
  const moving = groups.find((g) => g.id === id)
  const rest = groups.filter((g) => g.id !== id)
  const i = rest.findIndex((g) => g.id === besideId)
  if (!moving || i < 0) return groups
  return rest.toSpliced(i + (after ? 1 : 0), 0, moving)
}

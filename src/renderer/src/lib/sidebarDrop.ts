import type { UniqueIdentifier } from '@dnd-kit/core'

/** Where a sidebar drag lands: before or after a row, or into a section. */
export type Drop = { id: string; place: 'before' | 'after' | 'into' }

/** The drop for a dragged row over another, by the pointer's height `y` against the row's middle. */
export function dropOf(
  active: { id: UniqueIdentifier },
  over: { id: UniqueIdentifier; rect: { top: number; height: number } } | null,
  y: number
): Drop | null {
  if (!over || over.id === active.id) return null
  const id = String(over.id)
  const beside = y > over.rect.top + over.rect.height / 2 ? 'after' : 'before'
  if (String(active.id).startsWith('g:')) return id.startsWith('g:') ? { id, place: beside } : null
  return { id, place: id.startsWith('p:') ? beside : 'into' }
}

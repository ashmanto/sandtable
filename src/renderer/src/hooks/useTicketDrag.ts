import { useDraggable } from '@dnd-kit/core'
import { useFocus } from './useFocus'
import { ticketLabel } from '../../../shared/repo'
import type { Ticket } from '../../../shared/types'

/** Props that make an element a drag handle, with the ref dnd-kit needs. */
export type DragHandle = {
  ref: (el: HTMLElement | null) => void
} & React.HTMLAttributes<HTMLElement>

/** Drag handle props for a ticket's card or row: a focusable group named by its label and title, hidden while dragged, focused when `focused` turns true. */
export function useTicketDrag(
  ticket: Pick<Ticket, 'key' | 'number' | 'title'>,
  disabled: boolean,
  { id = ticket.key, focused = false }: { id?: string; focused?: boolean } = {}
): DragHandle {
  const focusRef = useFocus<HTMLElement>(focused)
  const { setNodeRef, setActivatorNodeRef, listeners, attributes, isDragging } = useDraggable({
    id,
    disabled,
    attributes: { role: 'group' }
  })
  return {
    ref: (el) => {
      focusRef.current = el
      setNodeRef(el)
      setActivatorNodeRef(el)
    },
    ...listeners,
    ...attributes,
    'aria-label': `${ticketLabel(ticket)} ${ticket.title}`,
    style: isDragging ? { opacity: 0 } : undefined
  }
}

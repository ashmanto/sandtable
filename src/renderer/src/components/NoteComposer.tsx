import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { NoteProps } from '@/hooks/useStartNote'
import { bare, enter, field } from './NewTicketComposer'

/** Start with a note for the session, in a New ticket field; hands `onStart` the trimmed note, or nothing when it's blank. */
export function NoteComposer({
  note,
  onChange,
  onStart,
  onCancel,
  className
}: NoteProps & { className?: string }): React.JSX.Element {
  const start = (): void => onStart(note.trim() || undefined)
  return (
    <form
      aria-label="Start with note"
      className={cn(field, enter, 'text-left', className)}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onSubmit={(e) => {
        e.preventDefault()
        start()
      }}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape' && !e.nativeEvent.isComposing) onCancel()
        if (e.key === 'Enter' && e.metaKey) {
          e.preventDefault()
          start()
        }
      }}
    >
      <textarea
        aria-label="Note for this session"
        placeholder="Add a note for this session…"
        rows={3}
        autoFocus
        value={note}
        onChange={(e) => onChange(e.target.value)}
        className={cn(bare, 'max-h-60 py-0.5')}
      />
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-fg-3">Esc to cancel · ⌘↩ to start</span>
        <Button type="submit" className="ml-auto">
          {note.trim() ? 'Start with note' : 'Start'}
        </Button>
      </div>
    </form>
  )
}

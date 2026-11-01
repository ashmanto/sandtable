import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

/** The props a `NoteComposer` takes from `useStartNote`. */
export type NoteProps = {
  note: string
  onChange: (note: string) => void
  onStart: (note: string | undefined) => void
  onCancel: () => void
}

/** The note composer's open state and text, kept until `clear` after a start succeeds; once Start isn't offered it closes and focus goes to `fallback`. */
export function useStartNote(
  offered: boolean,
  start: (note: string | undefined) => void,
  fallback: React.RefObject<HTMLElement | null>
): {
  open: boolean
  show: () => void
  clear: () => void
  button: (el: HTMLButtonElement | null) => void
  composer: NoteProps
} {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [closedOnItsOwn, setClosedOnItsOwn] = useState(0)
  const button = useRef<HTMLButtonElement | null>(null)
  if (open && !offered) {
    setOpen(false)
    setClosedOnItsOwn((n) => n + 1)
  }
  useEffect(() => {
    if (closedOnItsOwn && document.activeElement === document.body) fallback.current?.focus()
  }, [closedOnItsOwn, fallback])
  const close = (): void => {
    flushSync(() => setOpen(false))
    button.current?.focus()
  }
  return {
    open,
    show: () => setOpen(true),
    clear: () => setNote(''),
    button: (el) => {
      button.current = el
    },
    composer: {
      note,
      onChange: setNote,
      onStart: (n) => {
        close()
        start(n)
      },
      onCancel: () => {
        setNote('')
        close()
      }
    }
  }
}

import type { BoardColumn } from '../../../shared/types'

const ring = <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" />

const shapes: Record<BoardColumn, { color: string; shape: React.ReactNode }> = {
  todo: { color: 'text-fg-3', shape: ring },
  inProgress: {
    color: 'text-yellow',
    shape: (
      <>
        {ring}
        <path d="M7 3.5a3.5 3.5 0 0 1 0 7z" fill="currentColor" />
      </>
    )
  },
  done: {
    color: 'text-accent',
    shape: (
      <>
        <circle cx="7" cy="7" r="6.25" fill="currentColor" />
        <path
          d="m4.5 7.2 1.7 1.7 3.3-3.5"
          fill="none"
          className="stroke-surface"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </>
    )
  }
}

/** A ticket status's drawn icon: an empty ring, a half-filled ring, or a filled check. */
export function StatusIcon({ column }: { column: BoardColumn }): React.JSX.Element {
  const { color, shape } = shapes[column]
  return (
    <svg viewBox="0 0 14 14" aria-hidden="true" className={`size-3.5 shrink-0 ${color}`}>
      {shape}
    </svg>
  )
}

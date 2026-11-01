import { cn, optionId } from '@/lib/utils'
import type { SessionCommand } from '../../../shared/types'

const Key = ({ children }: { children: string }): React.JSX.Element => (
  <kbd className="inline-flex h-4.5 items-center rounded-sm px-1.25 font-mono text-fg-3 ring-1 ring-line-2 ring-inset">
    {children}
  </kbd>
)

/** The slash-command palette over the composer: a listbox of `commands` beside the active one's detail. */
export function CommandPalette({
  id,
  query,
  commands,
  active,
  error,
  onHover,
  onPick
}: {
  id: string
  query: string
  commands: SessionCommand[] | undefined
  active: number
  error: string | null
  onHover: (at: number) => void
  onPick: (command: SessionCommand) => void
}): React.JSX.Element {
  const c = commands?.[active]
  return (
    <div className="absolute inset-x-0 bottom-[calc(100%+6px)] z-10 flex h-62.5 animate-in overflow-hidden rounded-card bg-popover shadow-lg ring-1 ring-line-2 duration-150 ease-(--ease-out-cubic) fade-in-0 slide-in-from-bottom-1.5 motion-reduce:animate-none">
      <div className="w-[42%] shrink-0 overflow-y-auto border-r border-line p-1">
        {!commands ? (
          <p role="status" className={cn('px-2.5 py-2', error ? 'text-danger' : 'text-fg-3')}>
            {error ?? 'Loading commands…'}
          </p>
        ) : !commands.length ? (
          <p role="status" className="px-2.5 py-2 text-fg-3">
            No command matches /{query}
          </p>
        ) : (
          <ul role="listbox" id={id} aria-label="Commands">
            {commands.map((cmd, i) => (
              <li
                key={cmd.name}
                id={optionId(id, i)}
                role="option"
                aria-selected={i === active}
                ref={(el) => {
                  if (i === active) el?.scrollIntoView?.({ block: 'nearest' })
                }}
                className={cn(
                  'flex min-w-0 cursor-default items-baseline gap-2.5 rounded-sm px-2 py-1.25 font-mono text-xs',
                  i === active && 'bg-surface-3'
                )}
                onMouseMove={() => i !== active && onHover(i)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  onPick(cmd)
                }}
              >
                <span className="truncate text-fg">/{cmd.name}</span>
                {cmd.argumentHint && (
                  <>
                    {' '}
                    <span className="max-w-32 shrink-0 truncate text-fg-4">{cmd.argumentHint}</span>
                  </>
                )}
                <span className="sr-only">, {cmd.description}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {c && (
        <div className="flex min-w-0 flex-1 flex-col gap-2 px-4 py-3.5">
          <p className="font-mono break-words">
            /{c.name} {c.argumentHint && <span className="text-fg-4">{c.argumentHint}</span>}
          </p>
          <p className="break-words">{c.description}</p>
          {c.aliases.length > 0 && (
            <p className="text-xs text-fg-3">Also {c.aliases.map((a) => `/${a}`).join(', ')}</p>
          )}
          {c.source && <p className="text-xs text-fg-3">{c.source}</p>}
          <p aria-hidden className="mt-auto flex items-center gap-1 text-xs text-fg-4">
            <Key>↑</Key> <Key>↓</Key> to move · <Key>Tab</Key> or <Key>Enter</Key> to fill in ·{' '}
            <Key>Esc</Key> to close
          </p>
        </div>
      )}
    </div>
  )
}

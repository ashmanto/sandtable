import { Fragment } from 'react'
import { Lightbulb } from 'lucide-react'
import type { SetupHint as Hint } from '@/hooks/useSetupHint'
import { cn, stop } from '@/lib/utils'
import { insetClass } from './Activity'
import { LOCKFILES } from '../../../shared/worktreeSetup'

/** The text-link look of a setup suggestion's buttons. */
export const linkClass =
  'rounded-sm font-medium underline decoration-line-2 underline-offset-2 outline-none hover:decoration-fg-3 focus-ring'

const missing = ({ copy, command }: Hint['suggestion']): string[] => {
  const commands = command?.split(' && ') ?? []
  const built = LOCKFILES.filter((l) => l.builds && commands.includes(l.command)).map(
    (l) => l.builds!
  )
  return [...new Set([...copy, ...built])]
}

/** A Start's hint that the repo's worktrees need a setup, with **Set up** and **Not now**. */
export function SetupHint({
  hint,
  onSetUp,
  onNotNow
}: {
  hint: Hint | null
  onSetUp: (repo: string) => void
  onNotNow: () => void
}): React.JSX.Element | null {
  if (!hint) return null
  const items = missing(hint.suggestion)
  return (
    <div className="flex flex-col gap-1.5 text-xs" onClick={stop}>
      <p
        role="status"
        className={cn(insetClass, 'gap-2 px-2 py-1.5 text-xs text-fg-2 items-start')}
      >
        <Lightbulb aria-hidden className="mt-px size-3.5 shrink-0 text-fg-3" />
        <span className="min-w-0">
          {items.length ? (
            <>
              New worktrees here won&apos;t have{' '}
              {new Intl.ListFormat('en-US', { type: 'disjunction' })
                .formatToParts(items)
                .map((p, i) =>
                  p.type === 'element' ? (
                    <code key={i} className="font-mono">
                      {p.value}
                    </code>
                  ) : (
                    <Fragment key={i}>{p.value}</Fragment>
                  )
                )}
            </>
          ) : (
            <>
              New worktrees here won&apos;t run{' '}
              <code className="font-mono">{hint.suggestion.command}</code>
            </>
          )}
        </span>
      </p>
      <div className="flex gap-3">
        <button
          type="button"
          className={cn(linkClass, 'text-fg')}
          onClick={() => onSetUp(hint.repo)}
        >
          Set up
        </button>
        <button type="button" className={cn(linkClass, 'font-normal text-fg-3')} onClick={onNotNow}>
          Not now
        </button>
      </div>
    </div>
  )
}

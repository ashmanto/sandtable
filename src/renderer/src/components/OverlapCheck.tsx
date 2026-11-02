import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { OverlapRun } from '@/hooks/useOverlapCheck'
import { cn } from '@/lib/utils'
import { ticketLabel } from '../../../shared/repo'
import { Spinner } from './StepFlow'

const numbers = (list: { key: string; number: number }[]): string =>
  new Intl.ListFormat('en-US').format(list.map(ticketLabel))

/** The readiness and overlap checks' waiting line, verdict, or failure, with its buttons. */
export function OverlapCheck({
  check,
  cancel,
  startAnyway,
  refine,
  area,
  className
}: OverlapRun & { area: string | undefined; className?: string }): React.JSX.Element | null {
  if (!check) return null
  const waiting = check.kind === 'readying' || check.kind === 'waiting'
  return (
    <div
      className={cn('flex flex-col gap-1.5 text-xs', className)}
      onClick={(e) => e.stopPropagation()}
    >
      <div role="status" className="flex flex-col gap-1 text-fg-2">
        {check.kind === 'readying' ? (
          <p className="flex items-center gap-1.5">
            <Spinner />
            Checking whether the ticket is ready
          </p>
        ) : check.kind === 'gaps' ? (
          check.error ? (
            <p className="text-danger">{check.error}</p>
          ) : (
            <>
              <Badge className="bg-amber-soft text-amber">Not ready</Badge>
              <ul className="flex list-disc flex-col gap-0.5 pl-4">
                {check.gaps.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            </>
          )
        ) : check.kind === 'waiting' ? (
          <p className="flex items-center gap-1.5">
            <Spinner />
            Checking overlap with {numbers(check.candidates)}
          </p>
        ) : check.kind === 'overlaps' ? (
          <>
            <Badge className="bg-amber-soft text-amber">Overlaps</Badge>
            {check.overlaps.map((o) => (
              <p key={o.number}>
                <span className="font-mono">{ticketLabel(o)}</span> {o.reason}
              </p>
            ))}
          </>
        ) : (
          <>
            <p className="text-danger">{check.error}</p>
            <p>
              By area label: {numbers(check.candidates)}{' '}
              {check.candidates.length === 1 ? 'is' : 'are'} in progress in{' '}
              {area ?? 'the same area'}.
            </p>
          </>
        )}
      </div>
      <div className="flex gap-1.5">
        {check.kind === 'gaps' && check.gaps.length > 0 && (
          <Button variant="outline" size="xs" className="h-5" onClick={refine}>
            Refine in chat
          </Button>
        )}
        {check.kind === 'gaps' && check.gaps.length > 0 && (
          <Button variant="outline" size="xs" className="h-5" onClick={() => startAnyway(true)}>
            Start with planning
          </Button>
        )}
        <Button
          variant="outline"
          size="xs"
          className="h-5"
          disabled={waiting}
          onClick={() => startAnyway()}
        >
          {waiting ? 'Checking' : 'Start anyway'}
        </Button>
        <Button variant="ghost" size="xs" className="h-5" onClick={cancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

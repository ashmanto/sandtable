import { tokenCount } from '../../../shared/pricing'
import {
  compact,
  duration,
  full,
  hasPrice,
  hasUnpriced,
  money,
  percent,
  pricedTotal,
  SHADES,
  totalTokens
} from '@/lib/usage'
import { cn } from '@/lib/utils'
import type { ModelUsage } from '../../../shared/types'

const TYPES = [
  ['Input', 'input', SHADES[0]],
  ['Output', 'output', SHADES[1]],
  ['Cache write', 'cacheWrite', SHADES[2]],
  ['Cache read', 'cacheRead', SHADES[3]]
] as const

/** A compact count with the full count, or `title`, on hover, and an optional suffix for screen readers. */
export const Num = ({
  n,
  sr,
  title = full(n),
  className
}: {
  n: number
  sr?: string
  title?: string
  className?: string
}): React.JSX.Element => (
  <span className={cn('text-right tabular-nums', className)} title={title}>
    {compact(n)}
    {sr && <span className="sr-only"> {sr}</span>}
  </span>
)

/** The API price estimate of the priced models, marked with * when it leaves one out; nothing with no price. */
export const Estimate = ({
  usage,
  per = 1,
  className
}: {
  usage: ModelUsage[]
  per?: number
  className?: string
}): React.JSX.Element | null =>
  hasPrice(usage) ? (
    <span className={cn('text-right whitespace-nowrap tabular-nums', className)}>
      {money(pricedTotal(usage) / per)}
      {hasUnpriced(usage) && (
        <>
          <span aria-hidden>*</span>
          <span className="sr-only"> (leaves out a model with no price)</span>
        </>
      )}
      <span className="sr-only"> API estimate</span>
    </span>
  ) : null

/** A card's token use: tokens left and the estimate right, over a meter of its token cap when it has one. */
export function CardUsage({
  usage,
  cap,
  capped
}: {
  usage: ModelUsage[]
  cap?: number
  capped?: boolean
}): React.JSX.Element | null {
  const all = totalTokens(usage)
  if (!all) return null
  return (
    <div className="flex flex-col gap-1 text-xs text-fg-2">
      <p className="flex justify-between gap-2">
        <span>
          {cap ? (
            <>
              <Num n={all} sr="tokens" /> of <Num n={cap} /> cap
            </>
          ) : (
            <>
              <Num n={all} /> tokens
            </>
          )}
        </span>
        <Estimate usage={usage} />
      </p>
      {cap ? (
        <div
          role="img"
          aria-label={`${percent(all, cap)} of its token cap`}
          className="h-1 overflow-hidden rounded-full bg-surface-3"
        >
          <span
            className={cn('block h-full', capped ? 'bg-amber' : 'bg-fg-3')}
            style={{ width: `${Math.min(100, (all / cap) * 100)}%` }}
          />
        </div>
      ) : null}
      {capped && <p className="text-amber">Reached its token cap</p>}
    </div>
  )
}

/** A pill bar split by each part's share, in the shades cycling in order. */
export function ShareBar({
  parts,
  className
}: {
  parts: number[]
  className?: string
}): React.JSX.Element {
  const all = parts.reduce((a, b) => a + b, 0)
  return (
    <div
      aria-hidden
      className={cn('flex h-1.5 overflow-hidden rounded-full bg-surface-3', className)}
    >
      {parts.map((n, i) => (
        <span
          key={i}
          className={SHADES[i % SHADES.length]}
          style={{ width: `${(n / all) * 100}%` }}
        />
      ))}
    </div>
  )
}

/** Claude's working time, short on screen and in words for screen readers. */
export const Worked = ({ ms }: { ms: number }): React.JSX.Element => (
  <>
    <span aria-hidden>{duration(ms)}</span>
    <span className="sr-only">{duration(ms, true)}</span>
  </>
)

/** A ticket's token use: the total, Claude's working time, its share by token type, each model, and the API price estimate. */
export function Usage({
  usage,
  workMs = 0
}: {
  usage: ModelUsage[]
  workMs?: number
}): React.JSX.Element {
  const all = totalTokens(usage)
  const sum = (k: (typeof TYPES)[number][1]): number => usage.reduce((n, u) => n + u[k], 0)
  return (
    <>
      <p className="text-lg/6 font-medium tabular-nums" title={full(all)}>
        {compact(all)} tokens
      </p>
      {workMs > 0 && (
        <p className="text-fg-2">
          Claude worked <Worked ms={workMs} />
        </p>
      )}
      <ShareBar parts={TYPES.map(([, k]) => sum(k))} />
      <ul className="flex flex-col gap-1 text-fg-2">
        {TYPES.map(([name, k, shade]) => (
          <li key={k} className="flex items-center gap-2">
            <span aria-hidden className={cn('size-2 rounded-full', shade)} />
            <span className="flex-1">{name}</span>
            <Num n={sum(k)} />
            <span className="w-9 text-right text-xs text-fg-3 tabular-nums">
              {percent(sum(k), all)}
            </span>
          </li>
        ))}
      </ul>
      <h3 className="mt-3 text-xs font-medium text-fg-3">By model</h3>
      <ul className="flex flex-col gap-1">
        {usage.map((u) => (
          <li key={u.model} className="flex items-baseline gap-2">
            <span className={cn('min-w-0 flex-1 truncate', !u.name && 'font-mono')}>
              {u.name ?? u.model}
            </span>
            <Num n={tokenCount(u)} className="text-fg-2" />
            <span
              className={cn(
                'w-16 shrink-0 text-right whitespace-nowrap tabular-nums',
                u.price === null ? 'text-fg-3' : 'text-fg-2'
              )}
            >
              {u.price === null ? 'No price' : money(u.price)}
            </span>
          </li>
        ))}
      </ul>
      {hasPrice(usage) ? (
        <div className="mt-3 rounded-md bg-surface-3 p-2">
          <p className="flex justify-between">
            <span>API price estimate</span>
            <span className="tabular-nums">{money(pricedTotal(usage))}</span>
          </p>
          <p className="text-xs text-fg-3">
            What this usage would cost on the API, not what you paid.
            {hasUnpriced(usage) && ' Models without a price show tokens only.'}
          </p>
        </div>
      ) : (
        <p className="text-xs text-fg-3">No model here has a price, so this shows tokens only.</p>
      )}
    </>
  )
}

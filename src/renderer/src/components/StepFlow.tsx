import { Check, LoaderCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { ViewHeader } from './ViewHeader'

/** A 12 px spinner that stands still with reduced motion. */
export function Spinner(): React.JSX.Element {
  return <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" />
}

/** An error line in danger on danger-soft, with optional detail and actions. */
export function Problem({
  title,
  detail,
  children
}: {
  title: string
  detail?: string
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md bg-danger-soft px-3 py-2 text-danger"
    >
      <div className="min-w-0 flex-1">
        <p>{title}</p>
        {detail && <p className="text-xs break-all">{detail}</p>}
      </div>
      {children}
    </div>
  )
}

type RailStep = {
  title: string
  summary: string
  done: boolean
  open: boolean
  reached: boolean
  problem?: boolean
}

/** A step-by-step flow: header, progress rail, the current step, and a footer with Back and the hint. */
export function StepFlow({
  title,
  steps,
  step,
  dir,
  onGo,
  hint,
  footer,
  children
}: {
  title: string
  steps: RailStep[]
  step: number
  dir: 'fwd' | 'back' | null
  onGo: (i: number) => void
  hint: string | null
  footer: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-1 animate-in flex-col duration-200 ease-(--ease-out-cubic) fade-in">
      <ViewHeader>
        <h1 className="min-w-0 truncate font-medium">{title}</h1>
        <span className="text-xs text-fg-2">
          Step {step + 1} of {steps.length}
        </span>
      </ViewHeader>
      <div className="flex min-h-0 flex-1">
        <ol aria-label="Steps" className="flex w-55 shrink-0 flex-col gap-0.5 border-r px-2 py-4">
          {steps.map((s, i) => {
            const current = i === step
            return (
              <li key={s.title}>
                <button
                  type="button"
                  disabled={!current && !s.open}
                  aria-current={current ? 'step' : undefined}
                  onClick={() => !current && onGo(i)}
                  className={cn(
                    'highlight flex w-full items-start gap-2.5 rounded-md p-2 text-left outline-none hover:bg-surface-3 focus-ring disabled:text-fg-3',
                    current && 'bg-surface-3 hover:bg-surface-3'
                  )}
                >
                  <span
                    className={cn(
                      'grid size-5 shrink-0 place-items-center rounded-full border border-line-2 font-mono text-xs transition-[background-color,border-color,color] duration-100 ease-out',
                      current && 'border-foreground',
                      s.done && 'border-foreground bg-foreground text-background'
                    )}
                  >
                    {s.done ? <Check className="size-3" strokeWidth={2.25} /> : i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-medium">{s.title}</span>
                    <span
                      className={cn(
                        'block truncate text-xs',
                        !s.reached ? 'text-fg-3' : s.problem ? 'text-danger' : 'text-fg-2'
                      )}
                    >
                      {s.summary}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div
              key={step}
              className={cn(
                'max-w-150 px-10 py-8',
                dir && 'animate-in duration-200 ease-(--ease-out-cubic) fade-in',
                dir === 'fwd' && 'slide-in-from-right-2 motion-reduce:slide-in-from-right-0',
                dir === 'back' && 'slide-in-from-left-2 motion-reduce:slide-in-from-left-0'
              )}
            >
              {children}
            </div>
          </div>
          <footer className="border-t px-10 py-3">
            <div className="flex max-w-130 items-center gap-2">
              {step > 0 && (
                <Button variant="ghost" size="lg" onClick={() => onGo(step - 1)}>
                  Back
                </Button>
              )}
              <span aria-live="polite" className="mr-auto text-xs text-fg-2">
                {hint}
              </span>
              {footer}
            </div>
          </footer>
        </section>
      </div>
    </div>
  )
}

/** A list's loading line, or its error with Try again, or its children once loaded. */
export function LoadState({
  loading,
  text,
  failed,
  onRetry,
  children
}: {
  loading: boolean
  text: string
  failed: { title: string; detail: string } | null
  onRetry: () => void
  children?: React.ReactNode
}): React.ReactNode {
  if (loading)
    return (
      <p role="status" className="flex items-center gap-1.5 text-fg-2">
        <Spinner />
        {text}
      </p>
    )
  if (!failed) return children
  return (
    <Problem title={failed.title} detail={failed.detail}>
      <Button variant="ghost" size="xs" className="text-danger" onClick={onRetry}>
        Try again
      </Button>
    </Problem>
  )
}

/** A labeled select of `options`. */
export function LabeledSelect({
  id,
  label,
  small,
  value,
  onChange,
  options
}: {
  id: string
  label: string
  small?: boolean
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id} className={cn(small && 'text-xs text-fg-2')}>
        {label}
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder="Choose" />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

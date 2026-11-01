import { Check, CircleAlert, Copy, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tip } from './Tip'
import { cn, plural } from '@/lib/utils'
import { setupSteps, type CheckRow } from '../../../shared/setup'
import type { ToolCheck } from '../../../shared/types'
import { useCopy } from '../hooks/useCopy'
import { useSteps } from '../hooks/useSteps'
import { Problem, Spinner, StepFlow } from './StepFlow'

const UNCHECKED: ToolCheck = {
  ok: false,
  missing: [],
  paths: {},
  claudeSignedIn: null,
  accounts: [],
  gh: null,
  linear: null,
  linearWorkspaces: [],
  jira: null,
  jiraSites: []
}
const PROJECT = {
  title: 'First project',
  lede: 'Choose where its tickets come from and the local folder of each repo.'
}

const CHIP = {
  ok: ['bg-neutral-soft text-neutral', Check],
  fail: ['bg-danger-soft text-danger', CircleAlert],
  warn: ['bg-amber-soft text-amber', TriangleAlert],
  idle: ['text-fg-3', null]
} as const

function StatusChip({ row, busy }: { row: CheckRow; busy: boolean }): React.JSX.Element {
  const [tone, Icon] = busy ? (['text-fg-2', null] as const) : CHIP[row.tone]
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-medium',
        tone
      )}
    >
      {busy ? <Spinner /> : Icon && <Icon className="size-3" strokeWidth={2.25} />}
      {busy ? 'Checking…' : row.word}
    </span>
  )
}

/** A shell command in monospace with a Copy button. */
export function CommandBox({ command }: { command: string }): React.JSX.Element {
  const { copied, copy } = useCopy()
  return (
    <div className="flex items-center gap-2 rounded-md bg-window py-1 pr-1 pl-3">
      <code className="min-w-0 flex-1 truncate font-mono text-fg">{command}</code>
      <Tip label={copied ? 'Copied' : 'Copy'}>
        <Button variant="ghost" size="icon-xs" onClick={() => copy(command)}>
          {copied ? <Check /> : <Copy />}
        </Button>
      </Tip>
      <span role="status" className="sr-only">
        {copied && 'Copied'}
      </span>
    </div>
  )
}

/** The setup guide: one step per check, each with its fix, then the first project on first run. */
export function SetupGuide({
  check,
  firstRun,
  onCheckAgain,
  onDone
}: {
  check: ToolCheck | { error: string }
  firstRun: boolean
  onCheckAgain: () => Promise<void>
  onDone: () => void
}): React.JSX.Element {
  const failed = 'error' in check
  const checks = failed
    ? setupSteps(UNCHECKED).map((s) => ({ ...s, blocked: true, warn: false }))
    : setupSteps(check)
  const firstBlocked = checks.findIndex((s) => s.blocked)
  const { step, maxStep, dir, go } = useSteps(Math.max(0, firstBlocked))
  const [checking, setChecking] = useState(false)
  const last = checks.length - 1
  const cur = checks[step]
  const warnings = (i: number): number => checks[i].rows.filter((r) => r.tone === 'warn').length
  const reachable = (i: number): boolean =>
    i <= maxStep && checks.slice(0, i).every((s) => !s.blocked)

  const summary = (i: number): string => {
    if (i === step) return 'Current step'
    if (i > maxStep) return i > last ? 'Not started' : 'Not checked'
    if (i > last) return 'Opens the add-project flow'
    const s = checks[i]
    if (failed) return 'Not checked'
    const n = warnings(i)
    return (
      s.rows.find((r) => r.tone === 'fail')?.word ??
      (n ? `Ready, ${plural(n, 'warning')}` : 'Ready')
    )
  }

  async function checkAgain(): Promise<void> {
    setChecking(true)
    try {
      await onCheckAgain()
    } finally {
      setChecking(false)
    }
  }

  const hint = !cur
    ? ''
    : checking
      ? 'Checking…'
      : failed
        ? ''
        : cur.blocked
          ? `${cur.rows.find((r) => r.tone === 'fail')?.word}: run the command, then check again`
          : warnings(step) > 1
            ? 'You can continue; fix the warnings when you need them'
            : cur.warn
              ? 'You can continue; fix the warning when you need it'
              : ''
  const finish = !cur || (step === last && !firstRun)

  return (
    <div className="flex min-w-0 flex-1">
      <StepFlow
        title="Set up Sandtable"
        steps={[...checks, ...(firstRun ? [PROJECT] : [])].map((s, i) => ({
          title: s.title,
          summary: summary(i),
          done: i !== step && i <= Math.min(maxStep, last) && !failed && !checks[i].blocked,
          open: reachable(i),
          reached: i <= maxStep,
          problem: i !== step && !failed && !!checks[i]?.blocked
        }))}
        step={step}
        dir={dir}
        onGo={go}
        hint={hint}
        footer={
          <>
            {cur && (
              <Button
                variant="outline"
                size="lg"
                disabled={checking}
                onClick={() => void checkAgain()}
              >
                {checking ? (
                  <>
                    <Spinner />
                    Checking…
                  </>
                ) : (
                  'Check again'
                )}
              </Button>
            )}
            <Button
              size="lg"
              disabled={!!cur && (cur.blocked || checking)}
              onClick={() => (finish ? onDone() : go(step + 1))}
            >
              {!cur ? 'Add project' : finish ? 'Done' : 'Continue'}
            </Button>
          </>
        }
      >
        <h2 className="text-lg/6 font-medium">{(cur ?? PROJECT).title}</h2>
        <p className="mt-1 mb-6 text-fg-2">{(cur ?? PROJECT).lede}</p>
        {failed && cur ? (
          <Problem title={check.error} />
        ) : (
          cur && (
            <ul className="divide-y rounded-card bg-card px-4">
              {cur.rows.map((r) => (
                <li key={r.id} className="flex flex-col gap-2 py-2.5">
                  <div className="flex items-center gap-3">
                    <span className={cn('min-w-0 flex-1', r.tone === 'idle' && 'text-fg-3')}>
                      {r.label}
                    </span>
                    <StatusChip row={r} busy={checking} />
                  </div>
                  {!checking && r.fix && (
                    <div className="flex flex-col gap-2 pb-1">
                      <p className="text-fg-2">{r.fix.text}</p>
                      <CommandBox command={r.fix.command} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )
        )}
      </StepFlow>
    </div>
  )
}

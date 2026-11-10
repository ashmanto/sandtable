import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { errorMessage } from '@/lib/utils'
import { serviceOf, ticketLabel, type Service } from '../../../shared/repo'
import { APPLIED_BUT } from '../../../shared/areas'
import type { Pass } from '@/hooks/startFlow'
import type { Project, Ticket, Triage } from '../../../shared/types'

type Step =
  | { kind: 'checking'; quiet: boolean }
  | { kind: 'triaging' }
  | { kind: 'triaged'; triage: Triage; problems: string[] }
  | { kind: 'failed'; title: string; error: string; problems: string[] }
  | { kind: 'problems'; problems: string[] }

/** Start's check for blockers and a missing area; hands `onPass` what the readiness and overlap checks need. */
export function StartCheckDialog({
  project,
  ticket,
  onPass,
  onClose
}: {
  project: Project
  ticket: Omit<Ticket, 'body'>
  onPass: (pass: Pass) => void
  onClose: () => void
}): React.JSX.Element | null {
  const [step, setStep] = useState<Step>({ kind: 'checking', quiet: true })
  const [applying, setApplying] = useState(false)
  const run = useRef({})
  const found = useRef<string[]>([])
  const pass = useRef<Pass>({ overlap: [], ready: false })
  const api = window.sandtable.tickets
  const n = ticketLabel(ticket)

  function check(withTriage: boolean): Promise<void> {
    const mine = (run.current = {})
    const current = (): boolean => run.current === mine
    const fail = (title: string, err: unknown): void => {
      if (current())
        setStep({ kind: 'failed', title, error: errorMessage(err), problems: found.current })
    }
    return api.checkStart(project.id, ticket.key).then(
      (result) => {
        if (!current()) return
        pass.current = { overlap: result.overlap, ready: result.ready }
        if (withTriage) found.current = result.problems
        if (withTriage && result.triage) {
          setStep({ kind: 'triaging' })
          return api.triage(project.id, ticket.key).then(
            (triage) => {
              if (current()) setStep({ kind: 'triaged', triage, problems: result.problems })
            },
            (err) => fail(`Couldn't triage ${n}`, err)
          )
        }
        if (result.problems.length > 0)
          return setStep({ kind: 'problems', problems: result.problems })
        run.current = {}
        onPass(pass.current)
      },
      (err) => fail(`Couldn't check ${n}`, err)
    )
  }

  async function apply(triage: Triage): Promise<void> {
    const mine = (run.current = {})
    setApplying(true)
    try {
      await api.applyTriage(project.id, ticket.key, triage)
      if (run.current !== mine) return
      setStep({ kind: 'checking', quiet: false })
      await check(false)
    } catch (err) {
      if (run.current !== mine) return
      setApplying(false)
      const error = errorMessage(err)
      setStep({
        kind: 'failed',
        title: error.startsWith(APPLIED_BUT) ? `Couldn't check ${n}` : "Couldn't apply the triage",
        error,
        problems: found.current
      })
    }
  }

  useEffect(() => {
    void check(true)
    return () => {
      run.current = {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one check per open; a board sync that refreshes ticket must not restart it
  }, [])

  const close = (): void => {
    run.current = {}
    onClose()
  }
  const startAnyway = (): void => {
    run.current = {}
    onPass(pass.current)
  }

  if (step.kind === 'checking' && step.quiet) return null
  const view: { title: string; body?: React.ReactNode; actions?: React.ReactNode } =
    step.kind === 'checking'
      ? { title: `Checking ${n}…` }
      : step.kind === 'triaging'
        ? {
            title: 'Asking Claude for the area and blockers…',
            body: (
              <DialogDescription>
                {n} has no <span className="font-mono">area:</span> label. Claude reads the repo but
                can&apos;t change it. It can take up to 3 minutes.
              </DialogDescription>
            )
          }
        : step.kind === 'triaged'
          ? {
              title: `Claude's triage of ${n}`,
              body: (
                <>
                  {step.problems.length > 0 && <Problems problems={step.problems} />}
                  <TriageResult triage={step.triage} source={serviceOf(project)} />
                </>
              ),
              actions: (
                <>
                  <Button variant="outline" disabled={applying} onClick={startAnyway}>
                    Start anyway
                  </Button>
                  <Button disabled={applying} onClick={() => void apply(step.triage)}>
                    {applying ? 'Applying' : 'Apply'}
                  </Button>
                </>
              )
            }
          : step.kind === 'failed'
            ? {
                title: step.title,
                body: (
                  <>
                    <p className="text-danger">{step.error}</p>
                    {step.problems.length > 0 && <Problems problems={step.problems} />}
                  </>
                ),
                actions: <Button onClick={startAnyway}>Start anyway</Button>
              }
            : {
                title: `Start ${n} anyway?`,
                body: <Problems problems={step.problems} />,
                actions: <Button onClick={startAnyway}>Start anyway</Button>
              }

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent aria-describedby={undefined}>
        <div role="status" className="flex flex-col gap-3">
          <DialogHeader>
            <DialogTitle>{view.title}</DialogTitle>
          </DialogHeader>
          {view.body}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          {view.actions}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Problems({ problems }: { problems: string[] }): React.JSX.Element {
  return (
    <ul className="flex list-disc flex-col gap-1 pl-5">
      {problems.map((p) => (
        <li key={p}>{p}</li>
      ))}
    </ul>
  )
}

function TriageResult({ triage, source }: { triage: Triage; source: Service }): React.JSX.Element {
  const section = (title: string, children: React.ReactNode): React.JSX.Element => (
    <section className="flex flex-col gap-1">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
  return (
    <div className="flex flex-col gap-3">
      <DialogDescription>
        Apply writes these to {source}. Until then, nothing on {source} changes.
      </DialogDescription>
      {section('Area', <p className="font-mono">{triage.area}</p>)}
      {triage.newAreas.length > 0 &&
        section(
          'New area labels',
          <ul className="flex flex-col gap-1">
            {triage.newAreas.map((a) => (
              <li key={a.name}>{`${a.name} — ${a.description}`}</li>
            ))}
          </ul>
        )}
      {section(
        'Blocked by',
        triage.blockedBy.length === 0 ? (
          <p>None</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {triage.blockedBy.map((b) => (
              <li key={b.key}>{`${ticketLabel(b)} ${b.title}`}</li>
            ))}
          </ul>
        )
      )}
      {triage.reason && <p className="text-fg-2">{triage.reason}</p>}
    </div>
  )
}

import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn, errorMessage } from '@/lib/utils'
import { findRepo } from '../../../shared/repo'
import {
  capProblem,
  DEFAULT_DAILY_CAP,
  rulesProblem,
  scheduleLabel
} from '../../../shared/routines'
import {
  MODEL_CHOICES,
  modelLabel,
  type Model,
  type Project,
  type Routine,
  type RoutineInput,
  type RoutineProposal,
  type RoutineSource
} from '../../../shared/types'
import { FieldHeading, MessageField, RepoPicker, WherePicker } from './RadioBox'
import { RoutineChat } from './RoutineChat'
import { Segmented } from './Segmented'
import { chip } from './TicketCard'

/** The values another view hands the editor for a new routine, with the source of a copy. */
export type RoutineDraft = Pick<RoutineInput, 'repo' | 'worktree' | 'message'> &
  Partial<Pick<RoutineInput, 'name' | 'allow' | 'schedule' | 'on' | 'dailyCap' | 'model'>> & {
    copiedFrom?: RoutineSource
  }

/** Opens the routine editor for a new routine, an existing one, or a draft from another view. */
export type OpenRoutine = (project: Project, routine?: Routine, draft?: RoutineDraft) => void

const week = [
  [1, 'Monday'],
  [2, 'Tuesday'],
  [3, 'Wednesday'],
  [4, 'Thursday'],
  [5, 'Friday'],
  [6, 'Saturday'],
  [0, 'Sunday']
] as const

type Field = keyof RoutineProposal

const labels: Record<Field, string> = {
  name: 'Name',
  repo: 'Repo',
  worktree: 'Where it runs',
  message: 'First message',
  allow: 'Allowed without asking',
  schedule: 'Run on a schedule'
}

const fields = Object.keys(labels) as Field[]

const shown = (field: Field, value: RoutineProposal[Field]): string => {
  if (field === 'worktree') return value ? 'New worktree' : 'Main checkout'
  if (field === 'allow') return (value as string[]).join('\n')
  if (field === 'schedule') {
    const schedule = value as RoutineProposal['schedule']
    return schedule ? scheduleLabel(schedule) : 'Not scheduled'
  }
  return value as string
}

const changedMark = <span className={chip}>Changed by Claude</span>

function Offer({
  field,
  value,
  edited,
  onUse,
  onKeep
}: {
  field: Field
  value: RoutineProposal[Field]
  edited: boolean
  onUse: () => void
  onKeep: () => void
}): React.JSX.Element {
  const problem = field === 'allow' && rulesProblem(value as string[])
  return (
    <div
      role="group"
      aria-label={`Claude's suggestion for ${labels[field]}`}
      className="flex flex-col gap-1.5 rounded-md bg-card px-3 py-2"
    >
      <p className="text-xs text-fg-2">{edited && 'You edited this field. '}Claude suggests:</p>
      <p
        className={cn('break-words whitespace-pre-wrap', field === 'allow' && 'font-mono text-xs')}
      >
        {shown(field, value)}
      </p>
      {problem && <p className="text-xs text-danger">{problem}</p>}
      <div className="flex gap-1.5">
        <Button size="xs" variant="outline" onClick={onUse}>
          Use Claude&apos;s
        </Button>
        <Button size="xs" variant="ghost" onClick={onKeep}>
          Keep mine
        </Button>
      </div>
    </div>
  )
}

/** Creates, edits, or deletes one of a project's routines. */
export function RoutineEditor({
  project,
  routine,
  draft,
  onClose
}: {
  project: Project
  routine?: Routine
  draft?: RoutineDraft
  onClose: () => void
}): React.JSX.Element {
  const from = routine ?? draft
  const [id, setId] = useState(routine?.id)
  const [name, setName] = useState(from?.name ?? '')
  const [github, setGithub] = useState(
    findRepo(project.repos, from?.repo ?? '')?.github ??
      (draft?.copiedFrom && project.repos.length > 1 ? '' : (project.repos[0]?.github ?? ''))
  )
  const [worktree, setWorktree] = useState(from?.worktree ?? false)
  const [model, setModel] = useState<Model | 'default' | 'project'>(
    from?.model === undefined ? 'project' : (from.model ?? 'default')
  )
  const [message, setMessage] = useState(from?.message ?? '')
  const [allow, setAllow] = useState(from?.allow?.join('\n') ?? '')
  const [scheduled, setScheduled] = useState(!!from?.schedule)
  const [days, setDays] = useState<number[]>(from?.schedule?.days ?? [1, 2, 3, 4, 5])
  const [time, setTime] = useState(from?.schedule?.time ?? '02:00')
  const [label, setLabel] = useState(from?.on?.label ?? '')
  const [checksFail, setChecksFail] = useState(!!from?.on?.checksFail)
  const [dailyCap, setDailyCap] = useState(String(from?.dailyCap ?? DEFAULT_DAILY_CAP))
  const [busy, setBusy] = useState<'save' | 'start' | 'delete' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mine, setMine] = useState<Field[]>([])
  const [changed, setChanged] = useState<Field[]>([])
  const [offers, setOffers] = useState<Partial<RoutineProposal>>({})
  const [chatting, setChatting] = useState(false)
  const path = project.repos.find((r) => r.github === github)?.path
  const rules = allow
    .split('\n')
    .map((rule) => rule.trim())
    .filter(Boolean)
  const ruleProblem = rulesProblem(rules)
  const on = {
    ...(label.trim() && { label: label.trim() }),
    ...(checksFail && { checksFail: true as const })
  }
  const triggered = Object.keys(on).length > 0
  const capRefused = triggered && capProblem(dailyCap.trim() ? Number(dailyCap) : NaN)
  const form: RoutineProposal = {
    name,
    repo: github,
    worktree,
    message,
    allow: rules,
    schedule: scheduled
      ? { days: week.map(([d]) => d).filter((d) => days.includes(d)), time }
      : null
  }

  const put = (proposal: Partial<RoutineProposal>): void => {
    if (proposal.name !== undefined) setName(proposal.name)
    if (proposal.repo !== undefined) setGithub(proposal.repo)
    if (proposal.worktree !== undefined) setWorktree(proposal.worktree)
    if (proposal.message !== undefined) setMessage(proposal.message)
    if (proposal.allow) setAllow(proposal.allow.join('\n'))
    if (proposal.schedule !== undefined) {
      setScheduled(!!proposal.schedule)
      if (proposal.schedule) {
        setDays(proposal.schedule.days)
        setTime(proposal.schedule.time)
      }
    }
  }

  const edit = (field: Field): void => {
    setMine((m) => (m.includes(field) ? m : [...m, field]))
    setChanged((c) => c.filter((f) => f !== field))
  }

  const propose = (proposal: RoutineProposal, sent: RoutineProposal): string[] => {
    const set: Partial<RoutineProposal> = {}
    const offered: Partial<RoutineProposal> = { ...offers }
    const suggested: Field[] = []
    const strange = !project.repos.some((r) => r.github === proposal.repo)
    for (const f of fields) {
      const value = shown(f, proposal[f])
      if ((f === 'repo' && strange) || value === shown(f, sent[f]) || value === shown(f, form[f])) {
        delete offered[f]
        continue
      }
      if (mine.includes(f) || f === 'allow') {
        Object.assign(offered, { [f]: proposal[f] })
        suggested.push(f)
      } else Object.assign(set, { [f]: proposal[f] })
    }
    put(set)
    setOffers(offered)
    const next = fields.filter((f) => f in set)
    setChanged(next)
    return [
      ...(next.length ? [`Changed: ${next.map((f) => labels[f]).join(', ')}`] : []),
      ...(suggested.length ? [`Suggested: ${suggested.map((f) => labels[f]).join(', ')}`] : []),
      ...(strange ? [`Not in this project: ${proposal.repo}`] : [])
    ]
  }

  const drop = (field: Field): void =>
    setOffers((o) => Object.fromEntries(Object.entries(o).filter(([f]) => f !== field)))

  const use = (field: Field): void => {
    put({ [field]: offers[field] })
    drop(field)
    setMine((m) => m.filter((f) => f !== field))
    setChanged((c) => [...c, field])
  }

  const mark = (field: Field): React.ReactNode => changed.includes(field) && changedMark

  const offer = (field: Field): React.ReactNode =>
    field in offers && (
      <Offer
        field={field}
        value={offers[field] as RoutineProposal[Field]}
        edited={mine.includes(field)}
        onUse={() => use(field)}
        onKeep={() => drop(field)}
      />
    )

  const act = async (kind: 'save' | 'start' | 'delete'): Promise<void> => {
    setBusy(kind)
    setError(null)
    let step = kind === 'delete' ? 'delete' : 'save'
    try {
      if (kind === 'delete' && id) await window.sandtable.routines.remove(id)
      else {
        const saved = await window.sandtable.routines.save({
          ...(id && { id }),
          projectId: project.id,
          name,
          repo: github,
          worktree,
          message,
          ...(model !== 'project' && { model: model === 'default' ? null : model }),
          ...(rules.length > 0 && { allow: rules }),
          ...(form.schedule && { schedule: form.schedule }),
          ...(triggered && { on, dailyCap: Number(dailyCap) })
        })
        setId(saved.id)
        step = 'start'
        if (kind === 'start') await window.sandtable.routines.start(saved.id)
      }
      onClose()
    } catch (err) {
      setError(`Couldn't ${step}: ${errorMessage(err)}`)
      setBusy(null)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        showCloseButton={!busy}
        className="flex h-[min(640px,calc(100vh-2rem))] gap-0 p-0 sm:max-w-[880px]"
      >
        <div className="flex w-112 shrink-0 flex-col">
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pt-4 pb-3">
            <DialogHeader>
              <DialogTitle>
                {routine ? `Edit ${routine.name}` : `New routine in ${project.name}`}
              </DialogTitle>
              <DialogDescription>
                Starts a session without a ticket with this first message, in one click, on a
                schedule, or when a ticket gets a label or its checks fail.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-1.5">
              <FieldHeading htmlFor="routine-name" mark={mark('name')}>
                Name
              </FieldHeading>
              <Input
                id="routine-name"
                autoComplete="off"
                autoFocus
                value={name}
                onChange={(e) => {
                  edit('name')
                  setName(e.target.value)
                }}
              />
              {offer('name')}
            </div>
            <RepoPicker
              repos={project.repos}
              name="routine-repo"
              value={github}
              mark={mark('repo')}
              onChange={(repo) => {
                edit('repo')
                setGithub(repo)
              }}
            >
              {offer('repo')}
            </RepoPicker>
            <WherePicker
              name="routine-where"
              legend="Where it runs"
              path={path}
              worktree={worktree}
              mark={mark('worktree')}
              onChange={(where) => {
                edit('worktree')
                setWorktree(where)
              }}
            >
              {offer('worktree')}
            </WherePicker>
            <div className="flex flex-col gap-1.5">
              <FieldHeading id="routine-model">Model</FieldHeading>
              <Segmented
                options={[
                  ['project', 'Project', `Project (${modelLabel(project.model)})`],
                  ...MODEL_CHOICES.map((m): [Model | 'default', string] => [m, modelLabel(m)])
                ]}
                value={model}
                onChange={setModel}
                aria-labelledby="routine-model"
                aria-describedby="routine-model-help"
                className="auto-cols-auto"
              />
              <p id="routine-model-help" className="text-xs text-fg-2">
                Project follows the project&apos;s model, {modelLabel(project.model)}.
              </p>
            </div>
            <MessageField
              id="routine-message"
              value={message}
              mark={mark('message')}
              onChange={(text) => {
                edit('message')
                setMessage(text)
              }}
            >
              {offer('message')}
            </MessageField>
            <div className="flex flex-col gap-1.5">
              <FieldHeading htmlFor="routine-allow" mark={mark('allow')}>
                Allowed without asking
              </FieldHeading>
              <Textarea
                id="routine-allow"
                aria-describedby="routine-allow-help"
                placeholder="Bash(npm outdated)"
                spellCheck={false}
                rows={2}
                className="max-h-40 font-mono"
                value={allow}
                onChange={(e) => {
                  edit('allow')
                  setAllow(e.target.value)
                }}
              />
              <p
                id="routine-allow-help"
                className={cn('text-xs', ruleProblem ? 'text-danger' : 'text-fg-2')}
              >
                {ruleProblem ??
                  "One permission rule per line, such as Bash(npm audit:*). Only this routine's sessions you start or schedule use them without asking."}
              </p>
              {offer('allow')}
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <FieldHeading
                    htmlFor="routine-schedule"
                    mark={mark('schedule')}
                    className="font-medium"
                  >
                    Run on a schedule
                  </FieldHeading>
                  <Switch
                    id="routine-schedule"
                    aria-describedby="routine-schedule-help"
                    checked={scheduled}
                    onCheckedChange={(on) => {
                      edit('schedule')
                      setScheduled(on)
                    }}
                  />
                </div>
                <p id="routine-schedule-help" className="text-xs text-fg-2">
                  Starts while Sandtable is open and the Mac is awake. A time it misses is skipped.
                </p>
                {scheduled && (
                  <div className="flex flex-wrap items-center gap-3">
                    <div role="group" aria-label="Days" className="flex gap-1">
                      {week.map(([d, day]) => {
                        const on = days.includes(d)
                        return (
                          <button
                            key={d}
                            type="button"
                            aria-label={day}
                            aria-pressed={on}
                            onClick={() => {
                              edit('schedule')
                              setDays(on ? days.filter((x) => x !== d) : [...days, d])
                            }}
                            className="highlight h-6 w-10 rounded-full text-xs text-fg-3 ring-1 ring-line-2 outline-none ring-inset hover:text-fg-2 focus-ring aria-pressed:bg-neutral-soft aria-pressed:font-medium aria-pressed:text-fg"
                          >
                            {day.slice(0, 3)}
                          </button>
                        )
                      })}
                    </div>
                    <label className="flex items-center gap-2 text-xs text-fg-2">
                      Time
                      <Input
                        type="time"
                        className="h-7 w-28"
                        value={time}
                        onChange={(e) => {
                          edit('schedule')
                          setTime(e.target.value)
                        }}
                      />
                    </label>
                  </div>
                )}
              </div>
              {offer('schedule')}
            </div>
            <div className="flex flex-col gap-1.5">
              <FieldHeading htmlFor="routine-label">
                Start when a ticket gets the label
              </FieldHeading>
              <Input
                id="routine-label"
                aria-describedby="routine-label-help"
                placeholder="triage"
                spellCheck={false}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
              <p id="routine-label-help" className="text-xs text-fg-2">
                Starts once when a ticket gets this label, unless its last session is still open.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-3">
                <FieldHeading htmlFor="routine-checks" className="font-medium">
                  Start when a pull request&apos;s checks fail
                </FieldHeading>
                <Switch
                  id="routine-checks"
                  aria-describedby="routine-checks-help"
                  checked={checksFail}
                  onCheckedChange={setChecksFail}
                />
              </div>
              <p id="routine-checks-help" className="text-xs text-fg-2">
                Starts once when the checks of a GitHub ticket&apos;s pull request start failing.
              </p>
            </div>
            {triggered && (
              <div className="flex flex-col gap-1.5">
                <FieldHeading htmlFor="routine-cap">Automatic starts a day</FieldHeading>
                <Input
                  id="routine-cap"
                  type="number"
                  min={1}
                  max={50}
                  aria-describedby="routine-cap-help"
                  className="w-24"
                  value={dailyCap}
                  onChange={(e) => setDailyCap(e.target.value)}
                />
                <p
                  id="routine-cap-help"
                  className={cn('text-xs', capRefused ? 'text-danger' : 'text-fg-2')}
                >
                  {capRefused ||
                    'Label and check starts past this many in a day are skipped and listed in Run history.'}
                </p>
              </div>
            )}
          </div>
          <div className="flex flex-col gap-3 px-4 pb-4">
            {error && <p className="text-xs text-danger">{error}</p>}
            <DialogFooter>
              {routine && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" disabled={!!busy} className="text-danger sm:mr-auto">
                      Delete routine
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete {routine.name}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        The sessions it started stay. Its skipped times are deleted.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction variant="destructive" onClick={() => void act('delete')}>
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              <Button variant="outline" disabled={!!busy} onClick={onClose}>
                Cancel
              </Button>
              <Button
                variant="outline"
                disabled={!!busy || chatting}
                onClick={() => void act('start')}
              >
                {busy === 'start' ? 'Starting' : 'Save and start'}
              </Button>
              <Button disabled={!!busy || chatting} onClick={() => void act('save')}>
                {busy === 'save' ? 'Saving' : 'Save'}
              </Button>
            </DialogFooter>
          </div>
        </div>
        <RoutineChat
          projectId={project.id}
          form={form}
          copiedFrom={draft?.copiedFrom}
          onRoutine={propose}
          onPending={setChatting}
          onStartOver={() => {
            setChanged([])
            setOffers({})
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

import {
  CircleAlert,
  CircleCheck,
  CircleCheckBig,
  CircleDashed,
  CircleDot,
  CirclePause,
  CircleX,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  Hourglass,
  ScanSearch,
  TriangleAlert
} from 'lucide-react'
import { IN_PROGRESS_LABEL } from '../../../shared/columns'
import { serviceOf } from '../../../shared/repo'
import { resetsText } from '../../../shared/sessionStatus'
import { STATE_LABELS, type CardState } from '../../../shared/sessions'
import type { PrStage, Project, SessionRecord, SessionStop, Ticket } from '../../../shared/types'

export type { CardState }

/** Each card state's word, icon, and chip colors. */
export const stateLook: Record<
  CardState,
  { label: string; icon: typeof CircleDot; className: string }
> = {
  needsYou: {
    label: STATE_LABELS.needsYou,
    icon: CircleAlert,
    className: 'bg-amber-soft text-amber'
  },
  idle: { label: STATE_LABELS.idle, icon: CirclePause, className: 'bg-neutral-soft text-fg-2' },
  running: { label: STATE_LABELS.running, icon: CircleDot, className: 'bg-blue-soft text-blue' },
  reviewing: {
    label: STATE_LABELS.reviewing,
    icon: ScanSearch,
    className: 'bg-blue-soft text-blue [&>svg]:soft-pulse'
  },
  done: { label: STATE_LABELS.done, icon: CircleCheckBig, className: 'bg-added-soft text-added' },
  finished: {
    label: STATE_LABELS.finished,
    icon: CircleCheck,
    className: 'bg-neutral-soft text-neutral'
  },
  limitReached: {
    label: STATE_LABELS.limitReached,
    icon: Hourglass,
    className: 'bg-neutral-soft text-fg-2'
  },
  apiError: {
    label: STATE_LABELS.apiError,
    icon: TriangleAlert,
    className: 'bg-danger-soft text-danger'
  },
  doneOpen: {
    label: STATE_LABELS.doneOpen,
    icon: CircleDashed,
    className: 'bg-neutral-soft text-foreground ring-1 ring-line-2 ring-inset'
  },
  cantStart: {
    label: STATE_LABELS.cantStart,
    icon: CircleX,
    className: 'bg-danger-soft text-danger'
  }
}

/** A state's words, with a plan limit's reset time when the session has one. */
export const stateWords = (state: CardState, stop?: SessionStop): string =>
  state === 'limitReached' && stop?.resetsAt
    ? `${stateLook[state].label} · ${resetsText(stop.resetsAt, new Date())}`
    : stateLook[state].label

/** Another project's session state as this board shows it: Done, session open while the ticket is in Done here. */
export const elsewhereState = (session: SessionRecord, done: boolean): CardState =>
  done ? 'doneOpen' : session.state

/** A state that has a session count. */
export type Counted =
  'needsYou' | 'running' | 'reviewing' | 'idle' | 'done' | 'doneOpen' | 'limitReached'

/** A state's session count in words: "2 running". */
export const countLabel: Record<Counted, (n: number) => string> = {
  needsYou: (n) => `${n} ${n === 1 ? 'needs' : 'need'} you`,
  running: (n) => `${n} running`,
  reviewing: (n) => `${n} reviewing`,
  idle: (n) => `${n} idle`,
  done: (n) => `${n} done`,
  doneOpen: (n) => `${n} done, session open`,
  limitReached: (n) => `${n} at ${n === 1 ? 'its' : 'their'} limit`
}

/** A ticket's labels without Sandtable's own `sandtable: in progress`. */
export const shownLabels = (ticket: Pick<Ticket, 'labels'>): Ticket['labels'] =>
  ticket.labels.filter((l) => l.name !== IN_PROGRESS_LABEL.name)

/** The shape of a board card: padding, hairline, hover and press fills, and focus ring. */
export const cardClass =
  'group/card highlight flex scroll-mt-12 cursor-default flex-col gap-1.5 rounded-card bg-card p-3 text-card-foreground inset-ring inset-ring-border outline-none hover:bg-card-hover [&:active:not(:has(button:active,a:active,textarea:active))]:bg-popover focus-ring'

/** Each pull request state's word, icon, and chip colors. */
export const prLook = {
  open: { label: 'Open', icon: GitPullRequest, className: 'bg-blue-soft text-blue' },
  merged: { label: 'Merged', icon: GitMerge, className: 'bg-neutral-soft text-foreground' },
  closed: { label: 'Closed', icon: GitPullRequestClosed, className: 'bg-neutral-soft text-fg-3' }
}

/** Each open pull request stage's word and chip colors. */
export const stageLook: Record<PrStage, { label: string; className: string }> = {
  open: { label: 'PR open', className: 'bg-blue-soft text-blue' },
  conflicts: { label: 'Conflicts', className: 'bg-danger-soft text-danger' },
  checksFailing: { label: 'Checks failing', className: 'bg-danger-soft text-danger' },
  changesRequested: { label: 'Changes requested', className: 'bg-amber-soft text-amber' },
  readyToMerge: { label: 'Ready to merge', className: 'bg-added-soft text-added' }
}

/** Where a ticket that isn't on the board opens: "on GitHub" or "in Linear". */
export const opensIn = (project: Project): string =>
  serviceOf(project) === 'GitHub' ? 'on GitHub' : `in ${serviceOf(project)}`

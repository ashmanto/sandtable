import { ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { useLoad } from '@/hooks/useLoad'
import { useRun } from '@/hooks/useRun'
import { cn, couldnt, errorMessage, plural, visible } from '@/lib/utils'
import type {
  AutoReview,
  Finding,
  FindingsState,
  PullRequestState,
  SessionRecord
} from '../../../shared/types'
import { shortTime } from '../../../shared/time'
import { AUTO_REVIEW_ROUNDS } from '../../../shared/types'
import { Segmented } from './Segmented'
import { Problem, Spinner } from './StepFlow'
import { Tip } from './Tip'

type Refocus = { list: 'kept' | 'proposals' | 'sent'; index: number } | 'heading'

/** Where a finding sits in the diff. */
export type Place = { key?: string; start: number; end: number; outdated: boolean }

const SOURCE: Record<Finding['source'], string> = {
  you: 'You',
  review: 'Claude review',
  check: 'PR check',
  thread: 'PR comment'
}
const SEVERITY = {
  high: ['High', 'text-danger'],
  medium: ['Medium', 'text-amber'],
  low: ['Low', 'text-fg-3']
} as const
const CHECK = {
  passing: ['Passing', 'bg-added'],
  failing: ['Failing', 'bg-danger'],
  pending: ['Pending', 'bg-yellow']
} as const
const DECISION = {
  approved: 'Approved',
  changesRequested: 'Changes requested',
  reviewRequired: 'Review required'
}

/** The classes of a word in a `neutral-soft` chip, such as a change word or Sent. */
export const tag = 'rounded-full bg-neutral-soft px-1.5 text-xs text-fg-2'
const heading = 'flex items-center gap-2 px-2.5 pt-3 pb-1.5 text-xs font-medium text-fg-2'

const autoStatus = (a: AutoReview, reviewing: boolean): string =>
  a.on === false
    ? 'Automatic review is off for this session.'
    : a.stopped === 'clean'
      ? 'Automatic review stopped: the last review had no High line proposals.'
      : a.stopped === 'rounds'
        ? `Automatic review stopped after ${a.rounds} rounds.`
        : reviewing
          ? `Automatic review: round ${a.rounds + 1} of ${AUTO_REVIEW_ROUNDS}.`
          : a.rounds === 0
            ? 'Automatic review: waiting for Claude to end its turn with an open pull request.'
            : `Automatic review: ${a.rounds} of ${AUTO_REVIEW_ROUNDS} rounds done.`

const where = (path: string, p: Place): string =>
  visible(`${path}:${p.start}${p.end > p.start ? `–${p.end}` : ''}`)
const nameOf = (f: Finding, p: Place | null): string =>
  p ? where(f.path?.split('/').pop() ?? '', p) : visible(f.title ?? SOURCE[f.source])
const fullName = (f: Finding, p: Place | null): string =>
  p ? where(f.path ?? '', p) : nameOf(f, p)

function Item({
  f,
  place,
  latest,
  onJump,
  children
}: {
  f: Finding
  place: Place | null
  latest: number
  onJump: (key: string, line: number) => void
  children?: React.ReactNode
}): React.JSX.Element {
  const severity = f.severity && SEVERITY[f.severity]
  const label = nameOf(f, place)
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-center gap-1.5 text-xs text-fg-3">
        <span className="shrink-0">
          {SOURCE[f.source]}
          {f.author && ` · ${visible(f.author)}`}
        </span>
        {place?.key ? (
          <button
            type="button"
            title={f.path && visible(f.path)}
            aria-label={`Go to ${fullName(f, place)}`}
            className="min-w-0 truncate font-mono text-fg-2 hover:text-fg hover:underline"
            onClick={() => onJump(place.key!, place.start)}
          >
            {label}
          </button>
        ) : (
          <span className="min-w-0 truncate font-mono text-fg-2" title={f.path && visible(f.path)}>
            {label}
          </span>
        )}
        {severity && <span className={severity[1]}>{severity[0]}</span>}
        {place?.outdated && <span className={tag}>Outdated</span>}
        {latest > 1 && f.review === latest && <span className={tag}>New</span>}
      </div>
      <Body f={f}>{children}</Body>
    </div>
  )
}

function Body({ f, children }: { f: Finding; children: React.ReactNode }): React.JSX.Element {
  return (
    <>
      <p className={cn('wrap-anywhere whitespace-pre-wrap', f.sentAt && 'text-fg-3')}>
        {visible(f.text)}
      </p>
      {f.log && (
        <pre className="max-h-16 overflow-hidden rounded-sm bg-surface-3 px-2 py-1.5 font-mono text-xs text-fg-3">
          {f.log}
        </pre>
      )}
      <div className="flex gap-1.5">{children}</div>
    </>
  )
}

function SentRow({
  f,
  place,
  children
}: {
  f: Finding
  place: Place | null
  children: React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const severity = f.severity && SEVERITY[f.severity]
  return (
    <li className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        aria-label={[`${SOURCE[f.source]} ${fullName(f, place)}`, severity?.[0], 'Sent']
          .filter(Boolean)
          .join(', ')}
        title={f.path && visible(f.path)}
        onClick={() => setOpen(!open)}
        className="highlight flex min-h-7 min-w-0 items-center gap-1.5 rounded-sm px-2 text-left text-xs text-fg-3 outline-none hover:bg-surface-3 focus-ring"
      >
        <ChevronRight
          aria-hidden
          className={cn(
            'size-3 shrink-0 transition-transform duration-(--speed-highlight-out) ease-(--ease-out-quart) motion-reduce:transition-none',
            open && 'rotate-90'
          )}
        />
        <span className="shrink-0">{SOURCE[f.source]}</span>
        <span className="min-w-0 truncate font-mono">{nameOf(f, place)}</span>
        {severity && <span className={severity[1]}>{severity[0]}</span>}
        <span className={cn(tag, 'ml-auto')}>Sent</span>
      </button>
      {open && (
        <div className="flex min-w-0 flex-col gap-1 pr-2 pb-2 pl-6.5">
          <Body f={f}>{children}</Body>
        </div>
      )}
    </li>
  )
}

function PullRequests({
  session,
  prs,
  error,
  findings,
  run
}: {
  session: SessionRecord
  prs: PullRequestState[] | null
  error: string | null
  findings: Finding[]
  run: (what: string, action: () => Promise<unknown>) => void
}): React.JSX.Element {
  const has = (source: Finding['source'], ref: string): boolean =>
    findings.some(
      (f) => f.source === source && f.ref === ref && (source !== 'check' || f.log !== undefined)
    )
  const add = (
    added: boolean,
    name: string,
    what: string,
    action: () => Promise<unknown>
  ): React.JSX.Element => (
    <Button
      size="xs"
      variant="outline"
      disabled={added}
      aria-label={`${added ? 'Added' : 'Add'} ${name}`}
      onClick={() => run(what, action)}
    >
      {added ? 'Added' : 'Add'}
    </Button>
  )
  const row = 'flex min-h-7 min-w-0 items-center gap-2'
  if (error)
    return (
      <p className="px-2.5 text-xs text-danger">{`Couldn't read the pull request: ${error}`}</p>
    )
  if (!prs) return <p className="px-2.5 text-xs text-fg-3">Loading the pull request</p>
  if (prs.length === 0)
    return (
      <p className="px-2.5 text-xs text-fg-3">{`No open pull request for ${session.branch}.`}</p>
    )
  const id = session.id
  return (
    <div className="flex flex-col gap-2 px-2.5">
      {prs.map((pr) => (
        <div key={`${pr.repo}#${pr.number}`} className="flex flex-col">
          <a
            href={pr.url}
            target="_blank"
            rel="noreferrer"
            title={visible(`#${pr.number} ${pr.title}`)}
            className="truncate py-1 text-accent-bright hover:underline"
          >
            {visible(`#${pr.number} ${pr.title}`)}
          </a>
          {pr.checks.map((c, i) => (
            <div key={i} className={row}>
              <span aria-hidden className={cn('size-2 shrink-0 rounded-full', CHECK[c.state][1])} />
              <span className="min-w-0 flex-1 truncate">{visible(c.name)}</span>
              <span className="text-xs text-fg-3">{CHECK[c.state][0]}</span>
              {c.state === 'failing' &&
                c.jobId !== undefined &&
                add(has('check', String(c.jobId)), visible(c.name), 'add the check', () =>
                  window.sandtable.sessions.addCheck(id, pr.repo, c.jobId!, c.name)
                )}
            </div>
          ))}
          {pr.reviewDecision && (
            <div className={row}>
              <span className="min-w-0 flex-1">Review</span>
              <span className="text-xs text-fg-3">{DECISION[pr.reviewDecision]}</span>
            </div>
          )}
          {pr.threads.map((t) => (
            <div key={t.id} className={cn(row, 'py-1')}>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="flex min-w-0 gap-1.5 text-xs text-fg-3">
                  <span className="shrink-0">{visible(t.author)}</span>
                  <span
                    className="min-w-0 truncate font-mono"
                    title={visible(t.line === null ? t.path : `${t.path}:${t.line}`)}
                  >
                    {visible(t.line === null ? t.path : `${t.path}:${t.line}`)}
                  </span>
                </span>
                <span className="truncate" title={visible(t.body.split('\n')[0])}>
                  {visible(t.body.split('\n')[0])}
                </span>
              </div>
              {add(has('thread', t.id), `${visible(t.author)}'s thread`, 'add the thread', () =>
                window.sandtable.sessions.addThread(id, pr.repo, t.id)
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

/** The rail beside the diff: the session's pull request, review proposals, findings, and Send to session. */
export function Findings({
  session,
  found,
  loadError,
  attempt,
  placeOf,
  onJump
}: {
  session: SessionRecord
  found: FindingsState | null
  loadError: string | null
  attempt: number
  placeOf: (f: Finding) => Place | null
  onJump: (key: string, line: number) => void
}): React.JSX.Element {
  const [asked, setAsked] = useState(false)
  const [reviewFail, setReviewFail] = useState<string | null>(null)
  const [nothing, setNothing] = useState(false)
  const [list, setList] = useState<'unsent' | 'sent'>('unsent')
  const actions = useRun()
  const sending = useRun()
  const refocus = useRef<Refocus | null>(null)
  const keptList = useRef<HTMLUListElement>(null)
  const proposalList = useRef<HTMLUListElement>(null)
  const sentList = useRef<HTMLUListElement>(null)
  const keptHeading = useRef<HTMLHeadingElement>(null)
  const switcher = useRef<HTMLDivElement>(null)
  const id = session.id

  useEffect(() => {
    const to = refocus.current
    if (!to || !found) return
    refocus.current = null
    if (to === 'heading') return keptHeading.current?.focus()
    const lists = { kept: keptList, proposals: proposalList, sent: sentList }
    const rows = lists[to.list].current?.children
    const row = rows?.[to.index] ?? rows?.[to.index - 1]
    const first = {
      kept: '[role="checkbox"]',
      proposals: 'button[aria-label^="Keep "]',
      sent: 'button'
    }
    const target =
      row?.querySelector<HTMLElement>(first[to.list]) ??
      (to.list === 'sent'
        ? switcher.current?.querySelector<HTMLElement>('[aria-checked="true"]')
        : keptHeading.current)
    target?.focus()
  }, [found])

  const { data: prs = null, error: prError } = useLoad(
    () => window.sandtable.sessions.pullRequests(id),
    [id, attempt]
  )

  const findings = found?.findings ?? []
  const proposals = findings.filter((f) => f.proposed)
  const kept = findings.filter((f) => !f.proposed)
  const unsent = kept.filter((f) => !f.sentAt)
  const sent = kept.filter((f) => f.sentAt)
  const ready = unsent.filter((f) => f.checked)
  const latest = found?.reviews?.count ?? 0
  const sendable = session.state !== 'finished' && !session.asking
  const reviewing = asked || !!found?.reviewing
  const reviewProblem = found?.reviewError ?? reviewFail
  const why =
    sending.result && ready.length === 0
      ? sending.result
      : session.state === 'finished'
        ? "The session isn't running. Resume it to send."
        : session.asking
          ? 'Claude is asking you something. Answer it in the terminal first.'
          : kept.length === 0
            ? 'No findings to send.'
            : unsent.length === 0
              ? 'Nothing left to send.'
              : ready.length === 0
                ? 'Check the findings to send, or use Send all.'
                : `Pastes ${plural(ready.length, 'finding')} into the terminal as one message, after anything typed there. Sent findings aren't sent again.`
  const reviewLine = reviewing
    ? 'Claude is reviewing the diff.'
    : found?.reviews
      ? `Last Claude review: review ${found.reviews.count}, ${shortTime(found.reviews.at)}.`
      : "Claude review reads the branch's diff and proposes findings."
  const act = (what: string, action: () => Promise<unknown>, focus?: Refocus): void => {
    refocus.current = focus ?? null
    void actions.run(async () => {
      try {
        await couldnt(what, action())
      } catch (err) {
        refocus.current = null
        throw err
      }
    })
  }

  const review = (): void => {
    setAsked(true)
    setReviewFail(null)
    setNothing(false)
    window.sandtable.sessions
      .review(id)
      .then((stored) => setNothing(stored === 0))
      .catch((err) => setReviewFail(errorMessage(err)))
      .finally(() => setAsked(false))
  }

  const sendThese = (these: Finding[]): void =>
    void sending.run(async () => {
      await couldnt(
        'send',
        window.sandtable.sessions.sendFindings(
          id,
          these.map((f) => f.id)
        )
      )
      return { text: `Sent ${plural(these.length, 'finding')} to the session.`, danger: false }
    })
  const allChecked = unsent.length > 0 && unsent.every((f) => f.checked)
  const deleteButton = (f: Finding, place: Place | null, focus: Refocus): React.JSX.Element => (
    <Button
      size="xs"
      variant="ghost"
      className="-ml-2"
      aria-label={`Delete ${fullName(f, place)}`}
      onClick={() =>
        act('remove the finding', () => window.sandtable.sessions.removeFinding(id, f.id), focus)
      }
    >
      Delete
    </Button>
  )

  return (
    <aside
      aria-label="Findings"
      className="flex min-w-64 shrink basis-85 flex-col border-l bg-window"
    >
      <div ref={switcher} className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <Segmented
          aria-label="Findings to show"
          value={list}
          onChange={setList}
          options={[
            ['unsent', `To send ${unsent.length}`],
            ['sent', `Sent ${sent.length}`]
          ]}
        />
      </div>
      <div className="flex shrink-0 items-start gap-2 border-b px-3 py-2 text-xs text-fg-3">
        <div className="min-w-0 flex-1">
          <p>{reviewLine}</p>
          {found?.auto && <p>{autoStatus(found.auto, !!found.autoReviewing)}</p>}
        </div>
        <Tip
          label="Claude reads the branch's diff and proposes findings. Sent findings stay as they are."
          aria-label={reviewing ? 'Reviewing' : 'Claude review'}
        >
          <Button
            size="xs"
            variant="outline"
            className="shrink-0"
            disabled={reviewing}
            onClick={review}
          >
            {reviewing && <Spinner />}
            {reviewing ? 'Reviewing' : 'Claude review'}
          </Button>
        </Tip>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
        {list === 'sent' ? (
          <>
            {loadError ? (
              <p className="px-2.5 pt-3 text-xs text-danger">{`Couldn't read the findings: ${loadError}`}</p>
            ) : !found ? null : sent.length === 0 ? (
              <p className="px-2.5 pt-3 text-fg-3">Nothing sent yet.</p>
            ) : (
              <>
                <p className="px-2.5 pt-3 pb-1.5 text-xs text-fg-3">
                  These went to the session. They stay here and aren&apos;t sent again.
                </p>
                <ul ref={sentList} aria-label="Sent findings" className="flex flex-col gap-0.5">
                  {sent.map((f, i) => {
                    const place = placeOf(f)
                    return (
                      <SentRow key={f.id} f={f} place={place}>
                        {deleteButton(f, place, { list: 'sent', index: i })}
                      </SentRow>
                    )
                  })}
                </ul>
              </>
            )}
          </>
        ) : (
          <>
            <h2 className={heading}>Pull request</h2>
            <PullRequests
              session={session}
              prs={prs}
              error={prError}
              findings={findings}
              run={act}
            />
            {reviewProblem && (
              <div className="mx-1 mt-3">
                <Problem title={`Couldn't review the changes: ${reviewProblem}`} />
              </div>
            )}
            {nothing && !reviewProblem && !reviewing && (
              <p role="status" className="px-2.5 pt-3 text-fg-3">
                The review found nothing to change.
              </p>
            )}
            {proposals.length > 0 && (
              <>
                <h2 className={heading}>
                  Review proposals <span className="font-normal text-fg-3">{proposals.length}</span>
                  <Button
                    size="xs"
                    variant="ghost"
                    className="-my-1 ml-auto"
                    onClick={() =>
                      act(
                        'keep the proposals',
                        () =>
                          Promise.all(
                            proposals.map((f) =>
                              window.sandtable.sessions.updateFinding(id, f.id, { kept: true })
                            )
                          ),
                        'heading'
                      )
                    }
                  >
                    Keep all
                  </Button>
                </h2>
                <ul
                  ref={proposalList}
                  aria-label="Review proposals"
                  className="flex flex-col gap-1"
                >
                  {proposals.map((f, i) => (
                    <li key={f.id} className="rounded-sm bg-card p-2 inset-ring inset-ring-line-2">
                      <Item f={f} place={placeOf(f)} latest={latest} onJump={onJump}>
                        <Button
                          size="xs"
                          variant="outline"
                          aria-label={`Keep ${fullName(f, placeOf(f))}`}
                          onClick={() =>
                            act(
                              'update the finding',
                              () =>
                                window.sandtable.sessions.updateFinding(id, f.id, { kept: true }),
                              { list: 'proposals', index: i }
                            )
                          }
                        >
                          Keep
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          aria-label={`Discard ${fullName(f, placeOf(f))}`}
                          onClick={() =>
                            act(
                              'remove the finding',
                              () => window.sandtable.sessions.removeFinding(id, f.id),
                              { list: 'proposals', index: i }
                            )
                          }
                        >
                          Discard
                        </Button>
                      </Item>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className="flex items-center">
              <h2 ref={keptHeading} tabIndex={-1} className={cn(heading, 'flex-1 outline-none')}>
                To send <span className="font-normal text-fg-3">{unsent.length}</span>
              </h2>
              {unsent.length > 0 && (
                <label className="flex items-center gap-1.5 px-2.5 pt-3 pb-1.5 text-xs text-fg-3">
                  <Checkbox
                    checked={allChecked || (ready.length > 0 && 'indeterminate')}
                    onCheckedChange={() =>
                      act('update the findings', () =>
                        Promise.all(
                          unsent
                            .filter((f) => f.checked === allChecked)
                            .map((f) =>
                              window.sandtable.sessions.updateFinding(id, f.id, {
                                checked: !allChecked
                              })
                            )
                        )
                      )
                    }
                  />
                  Select all
                </label>
              )}
            </div>
            {loadError ? (
              <p className="px-2.5 text-xs text-danger">{`Couldn't read the findings: ${loadError}`}</p>
            ) : !found ? null : unsent.length === 0 ? (
              <p className="px-2.5 text-fg-3">
                {kept.length === 0
                  ? 'No findings yet. Comment on a line, or run Claude review.'
                  : 'Nothing left to send.'}
              </p>
            ) : (
              <ul ref={keptList} className="flex flex-col gap-0.5">
                {unsent.map((f, i) => {
                  const place = placeOf(f)
                  return (
                    <li
                      key={f.id}
                      className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-2 rounded-sm p-2 hover:bg-surface-3"
                    >
                      <Checkbox
                        className="mt-px"
                        aria-label={`Send ${fullName(f, place)}`}
                        checked={f.checked}
                        onCheckedChange={(on) =>
                          act('update the finding', () =>
                            window.sandtable.sessions.updateFinding(id, f.id, {
                              checked: on === true
                            })
                          )
                        }
                      />
                      <Item f={f} place={place} latest={latest} onJump={onJump}>
                        {deleteButton(f, place, { list: 'kept', index: i })}
                      </Item>
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        )}
      </div>
      {[actions.error, sending.error].map(
        (e, i) =>
          e && (
            <div key={i} className="mx-3 mb-2">
              <Problem title={e} />
            </div>
          )
      )}
      <div className="flex shrink-0 flex-col gap-2 border-t px-3 py-2.5">
        <span role="status" className="text-xs text-fg-3">
          {why}
        </span>
        <div className="flex justify-end gap-2">
          <Tip
            label="Sends every finding in To send, checked or not."
            aria-label={`Send all ${unsent.length}`}
          >
            <Button
              variant="outline"
              disabled={!sendable || unsent.length === 0 || sending.pending}
              onClick={() => sendThese(unsent)}
            >
              {`Send all ${unsent.length}`}
            </Button>
          </Tip>
          <Button
            disabled={!sendable || ready.length === 0 || sending.pending}
            onClick={() => sendThese(ready)}
          >
            Send to session
          </Button>
        </div>
      </div>
    </aside>
  )
}

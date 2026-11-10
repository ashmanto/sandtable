import { ChevronRight, Search, X } from 'lucide-react'
import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Button } from '@/components/ui/button'
import { useActivity } from '@/hooks/useActivity'
import { useFind } from '@/hooks/useFind'
import { useFollowEnd } from '@/hooks/useFollowEnd'
import { useLoad } from '@/hooks/useLoad'
import type { useLiveConversation } from '@/hooks/useLiveConversation'
import { useRun } from '@/hooks/useRun'
import { runOf, spoken } from '@/lib/activity'
import { type Queued, waiting } from '@/lib/queued'
import { useComposerDraft } from '@/lib/composerDrafts'
import { useSessionView } from '@/lib/sessionView'
import { cn, errorMessage, optionId, plural, textLink } from '@/lib/utils'
import { sessionDraft } from '../../../shared/drafts'
import { imageProblem, imagesOf } from '../../../shared/images'
import { isLive } from '../../../shared/sessions'
import { clock } from '../../../shared/time'
import {
  AUTO_REVIEW_ROUNDS,
  type ConversationEntry,
  type ReviewRound,
  type SessionCommand,
  type SessionRecord
} from '../../../shared/types'
import { Composer, FollowScroller, Working } from './ChatParts'
import { CommandPalette } from './CommandPalette'
import { FindBar, type Mine, YourMessages } from './ConversationTools'
import { QuestionCard } from './QuestionCard'
import { Spinner } from './StepFlow'
import { Loading, Message, Said } from './TabContent'
import { Terminal } from './Terminal'
import { Tip } from './Tip'

type Tool = Extract<ConversationEntry, { kind: 'tool' }>
const MB = 1024 * 1024
const sizeOf = (bytes: number): string =>
  bytes < MB ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / MB).toFixed(1)} MB`

const linked = (text: string): React.ReactNode[] =>
  text.split(/(https?:\/\/\S+)/).map((part, i) =>
    i % 2 ? (
      <a
        key={i}
        href={part}
        title={part}
        target="_blank"
        rel="noreferrer"
        className="text-accent-bright underline underline-offset-2"
      >
        {part}
      </a>
    ) : (
      part
    )
  )

const Pre = ({
  children,
  className
}: {
  children: string
  className?: string
}): React.JSX.Element => (
  <pre
    className={cn(
      'rounded-sm bg-surface-3 px-3 py-2 font-mono text-xs break-words whitespace-pre-wrap',
      className
    )}
  >
    {linked(children)}
  </pre>
)

const lowered = (t: Tool): { label: string; body: string } => ({
  label: `${t.name}\0${t.summary}\0${t.error ? 'error' : ''}`.toLowerCase(),
  body: `${t.input}\0${t.output ?? ''}`.toLowerCase()
})

function Fold({
  label,
  reveal = false,
  children
}: {
  label: React.ReactNode
  reveal?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        aria-expanded={open}
        className="highlight -mx-1.5 flex items-center gap-2 rounded-sm px-1.5 py-1 text-left hover:bg-surface-3"
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronRight
          aria-hidden
          className={cn(
            'size-3.5 shrink-0 text-fg-3 transition-transform duration-150 ease-(--ease-out-quart) motion-reduce:transition-none',
            open && 'rotate-90'
          )}
        />
        {label}
      </button>
      {(open || reveal) && (
        <div data-fold hidden={!open} className="contents">
          {children}
        </div>
      )}
    </>
  )
}

function ToolRow({ entry, reveal }: { entry: Tool; reveal: boolean }): React.JSX.Element {
  return (
    <Fold
      reveal={reveal}
      label={
        <>
          <span className="font-mono">{entry.name}</span>
          <span className="min-w-0 flex-1 truncate text-fg-2">{entry.summary}</span>
          {entry.error && <span className="text-xs text-danger">Error</span>}
        </>
      }
    >
      <div className="flex flex-col gap-1 py-2 pl-5.5">
        <p data-find-skip className="text-xs text-fg-3">
          Input
        </p>
        <Pre>{entry.input}</Pre>
        <p data-find-skip className="text-xs text-fg-3">
          Output
        </p>
        {!entry.output ? (
          <p data-find-skip className="text-fg-2">
            No output
          </p>
        ) : (
          <Pre>{entry.output}</Pre>
        )}
      </div>
    </Fold>
  )
}

function ToolGroup({
  tools,
  reveal,
  reveals
}: {
  tools: Tool[]
  reveal: boolean
  reveals: boolean[]
}): React.JSX.Element {
  const last = tools[tools.length - 1]
  return (
    <Fold
      reveal={reveal}
      label={
        <>
          <span data-find-skip className="text-fg-3">
            Ran {plural(tools.length, 'tool')}
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-fg-2">
            {last.summary ? `${last.name} · ${last.summary}` : last.name}
          </span>
        </>
      }
    >
      <div className="flex flex-col gap-0.5 pt-1 pl-5.5">
        {tools.map((t, i) => (
          <ToolRow key={i} entry={t} reveal={reveals[i] ?? false} />
        ))}
      </div>
    </Fold>
  )
}

const stopped = (entry: ConversationEntry): boolean => entry.kind === 'user' && !!entry.stopped

type Row =
  | { at: number; entry: Exclude<ConversationEntry, Tool> }
  | { at: number; tools: Tool[]; text: { label: string; body: string }[] }

const rowsOf = (entries: ConversationEntry[]): Row[] =>
  entries.reduce<Row[]>((rows, entry, at) => {
    const prev = rows[rows.length - 1]
    if (entry.kind !== 'tool') rows.push({ at, entry })
    else if (prev && 'tools' in prev) {
      prev.tools.push(entry)
      prev.text.push(lowered(entry))
    } else rows.push({ at, tools: [entry], text: [lowered(entry)] })
    return rows
  }, [])

function SentImages({
  sessionId,
  paths
}: {
  sessionId: string
  paths: string[]
}): React.JSX.Element {
  const { data } = useLoad(
    () =>
      Promise.all(
        paths.map((p) => window.sandtable.sessions.image(sessionId, p).catch(() => null))
      ),
    [sessionId, paths.join('\n')]
  )
  const [open, setOpen] = useState<number | null>(null)
  return (
    <>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {paths.map((p, i) =>
          data?.[i] === null ? (
            <span
              key={p}
              data-find-skip
              className="grid size-11 place-items-center rounded-sm text-xs text-fg-3 ring-1 ring-line ring-inset"
            >
              Deleted
            </span>
          ) : (
            <Tip key={p} label={`Show image ${i + 1} larger`}>
              <button
                aria-label={`Show image ${i + 1} larger`}
                aria-expanded={open === i}
                className="size-11 overflow-hidden rounded-sm ring-1 ring-line ring-inset focus-ring aria-expanded:ring-2 aria-expanded:ring-fg-3"
                onClick={() => setOpen((o) => (o === i ? null : i))}
              >
                {data && <img src={data[i]!} alt="" className="size-full object-cover" />}
              </button>
            </Tip>
          )
        )}
      </div>
      {open !== null && data?.[open] && (
        <img
          src={data[open]}
          alt={`Image ${open + 1}`}
          className="mt-1.5 w-full rounded-sm ring-1 ring-line"
        />
      )}
    </>
  )
}

function UserMessage({ sessionId, text }: { sessionId: string; text: string }): React.JSX.Element {
  const sent = imagesOf(text, sessionId)
  return (
    <>
      <Said user text={sent.text} />
      {sent.paths.length > 0 && <SentImages sessionId={sessionId} paths={sent.paths} />}
    </>
  )
}

const waits = (n: number): string => `${n} ${n === 1 ? 'waits' : 'wait'} for you.`

const outcome = ({ error, found, sent = 0, waiting = 0 }: ReviewRound): string =>
  error ??
  (!sent && !waiting
    ? 'Found nothing to fix.'
    : found === 0
      ? `Found nothing new. ${waits(waiting)}`
      : `${sent ? `Sent ${plural(sent, 'proposal')} to Claude.` : 'Sent nothing to Claude.'} ${
          waiting ? waits(waiting) : 'None wait for you.'
        }`)

function RoundBlock({
  round,
  onOpenChanges
}: {
  round: ReviewRound
  onOpenChanges?: () => void
}): React.JSX.Element {
  return (
    <li data-find-skip className="overflow-hidden rounded-card text-xs ring-1 ring-line">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-surface-2 px-3 py-1.5 text-fg-2">
        <span>
          Automatic review · round {round.round} of {AUTO_REVIEW_ROUNDS}
        </span>
        <span className="shrink-0 text-fg-3 tabular-nums">{clock(round.startedAt)}</span>
      </div>
      <div className="flex items-center gap-3 px-3 py-2">
        <p className="flex min-w-0 flex-1 items-center gap-1.5 break-words text-fg-2">
          {round.endedAt ? (
            outcome(round)
          ) : (
            <>
              <Spinner />
              {`Reviewing ${plural(round.files, 'changed file')}…`}
            </>
          )}
        </p>
        {onOpenChanges && (
          <button type="button" className={cn(textLink, 'shrink-0')} onClick={onOpenChanges}>
            Open Changes
          </button>
        )}
      </div>
    </li>
  )
}

function Entries({
  sessionId,
  entries,
  query,
  rounds,
  onOpenChanges,
  ref
}: {
  sessionId: string
  entries: ConversationEntry[]
  query: string
  rounds: (ReviewRound & { at: number })[]
  onOpenChanges?: () => void
  ref: React.Ref<HTMLOListElement>
}): React.JSX.Element {
  const rows = useMemo(() => rowsOf(entries), [entries])
  const needle = query.toLowerCase()
  const blocks = (after: number, upTo: number): React.ReactNode =>
    rounds
      .filter((r) => r.at > after && r.at <= upTo)
      .map((r) => <RoundBlock key={r.startedAt} round={r} onOpenChanges={onOpenChanges} />)
  return (
    <ol ref={ref} className="flex flex-col gap-5">
      {rows.map((row, i) => (
        <Fragment key={row.at}>
          {blocks(i ? rows[i - 1].at : -1, row.at)}
          <li
            data-at={row.at}
            className={cn(
              'flex min-w-0 scroll-mt-12 flex-col gap-1',
              'entry' in row &&
                row.entry.kind === 'user' &&
                !stopped(row.entry) &&
                'max-w-4/5 self-end rounded-card bg-card px-3 py-2'
            )}
          >
            {'tools' in row ? (
              <ToolGroup
                tools={row.tools}
                reveal={!!needle && row.text.some((t) => `${t.label}\0${t.body}`.includes(needle))}
                reveals={row.text.map((t) => !!needle && t.body.includes(needle))}
              />
            ) : stopped(row.entry) ? (
              <p data-find-skip className="text-xs text-fg-3">
                You stopped Claude.
              </p>
            ) : row.entry.kind === 'compact' ? (
              <p data-find-skip className="text-xs text-fg-3">
                Conversation compacted at {clock(row.entry.at)}
              </p>
            ) : row.entry.kind === 'user' ? (
              <UserMessage sessionId={sessionId} text={row.entry.text} />
            ) : row.entry.kind === 'command' ? (
              <div className="overflow-hidden rounded-card ring-1 ring-line">
                <div className="flex items-center justify-between gap-3 border-b border-line bg-surface-2 px-3 py-1.5">
                  <span className="min-w-0 font-mono text-xs break-words text-fg-2">
                    {row.entry.args ? `${row.entry.name} ${row.entry.args}` : row.entry.name}
                  </span>
                  <span data-find-skip className="shrink-0 text-xs text-fg-3">
                    Command output
                  </span>
                </div>
                {row.entry.output && (
                  <Pre className="rounded-none bg-transparent">{row.entry.output}</Pre>
                )}
              </div>
            ) : (
              <Said user={false} copy text={row.entry.text} />
            )}
          </li>
        </Fragment>
      ))}
      {blocks(rows.at(-1)!.at, Infinity)}
    </ol>
  )
}

const matching = (commands: SessionCommand[], query: string): SessionCommand[] => {
  const q = query.toLowerCase()
  const names = (c: SessionCommand): string[] => [c.name, ...c.aliases].map((n) => n.toLowerCase())
  const rank = (c: SessionCommand): number =>
    names(c).includes(q) ? 0 : names(c).some((n) => n.startsWith(q)) ? 1 : 2
  return commands
    .filter((c) => names(c).some((n) => n.includes(q)))
    .map((c) => ({ c, rank: rank(c) }))
    .sort((x, y) => x.rank - y.rank)
    .map(({ c }) => c)
}

const firstLine = (text: string, images: number): string =>
  text.trim().split('\n')[0] || plural(images, 'image')

const mineOf = (entries: ConversationEntry[], sessionId: string): Mine[] =>
  entries.flatMap((entry, at) => {
    if (entry.kind !== 'user' || stopped(entry)) return []
    const sent = imagesOf(entry.text, sessionId)
    return [{ at, text: firstLine(sent.text, sent.paths.length) }]
  })

/** A session's live conversation with its review rounds and composer, or its terminal alone. */
export function SessionConversation({
  session,
  conversation,
  panel,
  actions,
  head,
  active = true,
  onOpenChanges
}: {
  session: SessionRecord
  conversation: ReturnType<typeof useLiveConversation>
  panel: React.ReactNode
  actions?: React.ReactNode
  head?: React.ReactNode
  active?: boolean
  onOpenChanges?: () => void
}): React.JSX.Element {
  const { entries, start, error: loadError, missing } = conversation
  const newestRound = session.reviewRounds?.at(-1)
  const activity = useActivity(session)
  const { error, run, clear } = useRun()
  const { text, setText, images, setImages } = useComposerDraft(sessionDraft(session.id))
  const [refused, setRefused] = useState<string | null>(null)
  const [reading, setReading] = useState(0)
  const [stopping, setStopping] = useState(false)
  if (stopping && session.state !== 'running') setStopping(false)
  const live = isLive(session)
  const [view] = useSessionView()
  const talking = live && view === 'conversation'
  const [queued, setQueued] = useState<Queued[]>([])
  const shown = !live ? [] : entries ? waiting(queued, entries, start) : queued
  if (shown.length !== queued.length) setQueued(shown)
  const chain = useRef(Promise.resolve())
  const asking = live && !!session.asking
  const answered = entries?.filter((e) => e.kind === 'tool' && e.output !== null).length ?? 0
  const [answers, setAnswers] = useState(0)
  const promptKey = asking ? `${session.id}:${entries?.length ?? 0}:${answered}:${answers}` : null
  const { data: loaded, error: promptError } = useLoad(
    async () => ({ key: promptKey, prompt: await window.sandtable.sessions.prompt(session.id) }),
    [promptKey],
    !!promptKey
  )
  const fresh = !!promptKey && loaded?.key === promptKey
  const prompt = fresh ? loaded.prompt : null
  const inTerminal = (fresh && !prompt) || (!!promptKey && !!promptError)
  const box = useRef<HTMLTextAreaElement>(null)
  const [drawer, setDrawer] = useState({ open: false, mine: false, asking: false, typing: false })
  if (drawer.asking !== inTerminal)
    setDrawer((d) => ({
      open: inTerminal || (d.open && d.mine),
      mine: d.open && d.mine,
      asking: inTerminal,
      typing: inTerminal && !d.open && !!box.current && document.activeElement === box.current
    }))
  const open = drawer.open
  const toggle = useRef<HTMLButtonElement>(null)
  const hide = useRef<HTMLButtonElement>(null)
  const sheet = useRef<HTMLElement>(null)
  const { scroller, ref: follower, follow, away } = useFollowEnd()
  const list = useRef<HTMLOListElement>(null)
  const findBox = useRef<HTMLInputElement>(null)
  const findButton = useRef<HTMLButtonElement>(null)
  const [query, setQuery] = useState<string | null>(null)
  if (view === 'terminal' && query !== null) setQuery(null)
  const [found, step] = useFind(list, scroller, query ?? '')
  const findable = !loadError && !missing && !!entries?.length
  const mine = entries ? mineOf(entries, session.id) : []
  const paletteId = useId()
  const hintId = useId()
  const [closed, setClosed] = useState(false)
  const [picked, setPicked] = useState(0)
  const slash = /^\/(\S*)$/.exec(text)?.[1]
  const palette = talking && !asking && slash !== undefined && !closed
  const [wanted, setWanted] = useState(false)
  if (palette && !wanted) setWanted(true)
  const {
    data: listed,
    error: commandsError,
    reload: reloadCommands
  } = useLoad(() => window.sandtable.sessions.commands(session.id), [], wanted)
  const matches = listed && slash !== undefined ? matching(listed, slash) : undefined
  const at = matches?.length ? Math.min(picked, matches.length - 1) : 0
  const idle = talking && session.state !== 'running' && !asking
  const [held, setHeld] = useState<string | null>(null)
  if (held && !idle) setHeld(null)
  const suggestion = idle && text === '' ? held : null

  useEffect(() => {
    if (!active || !findable) return
    const onKey = (e: KeyboardEvent): void => {
      if (!e.metaKey || e.shiftKey || e.ctrlKey || e.altKey || e.key.toLowerCase() !== 'f') return
      if (document.querySelector('[role=dialog],[role=alertdialog]')) return
      if (!scroller.current?.checkVisibility()) return
      e.preventDefault()
      findBox.current?.focus()
      findBox.current?.select()
      setQuery((q) => q ?? '')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, findable, scroller])

  const closeFind = (): void => {
    flushSync(() => setQuery(null))
    ;(box.current && !box.current.disabled ? box.current : findButton.current)?.focus()
  }

  useEffect(() => {
    if (open || !sheet.current?.contains(document.activeElement)) return
    ;(box.current?.disabled ? toggle : box).current?.focus()
  }, [open])

  useEffect(() => {
    if (active && (sheet.current?.hasAttribute('inert') ?? true)) box.current?.focus()
  }, [active])

  const carded = !!prompt
  useEffect(() => {
    if (!carded && active && document.activeElement === document.body) box.current?.focus()
  }, [carded, active])

  useEffect(() => {
    if (open && drawer.typing) hide.current?.focus()
  }, [open, drawer.typing])

  const polling = active && idle && text === '' && !queued.some((q) => q.typed === null && !q.error)
  useEffect(() => {
    if (!polling) return
    let current = true
    const read = (): void =>
      void window.sandtable.sessions.suggestion(session.id).then(
        (text) => current && setHeld(text),
        () => current && setHeld(null)
      )
    read()
    const timer = setInterval(read, 3000)
    return () => {
      current = false
      clearInterval(timer)
    }
  }, [polling, session.id])

  const type = (value: string): void => {
    if (value === '/' && commandsError) reloadCommands()
    setText(value)
    setClosed(false)
    setPicked(0)
  }
  const fill = (c: SessionCommand): void => {
    setText(`/${c.name}${c.argumentHint ? ' ' : ''}`)
    setClosed(true)
  }
  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.nativeEvent.isComposing) return
    if (palette) {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setClosed(true)
      }
      if (!matches?.length) return
      const by = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
      if (by) {
        e.preventDefault()
        setPicked((at + by + matches.length) % matches.length)
      } else if ((e.key === 'Tab' || e.key === 'Enter') && !e.shiftKey) {
        e.preventDefault()
        fill(matches[at])
      }
    } else if (suggestion && !e.shiftKey && (e.key === 'Tab' || e.key === 'ArrowRight')) {
      e.preventDefault()
      setText(suggestion)
    }
  }

  useEffect(() => {
    if (!stopping) return
    const timer = setTimeout(() => setStopping(false), 3000)
    return () => clearTimeout(timer)
  }, [stopping])

  const attach = (files: File[]): void => {
    setRefused(null)
    clear()
    for (const file of files) {
      const problem = imageProblem(file.type, file.size)
      if (problem) {
        setRefused(`"${file.name}" wasn't attached. ${problem}`)
        continue
      }
      const reader = new FileReader()
      reader.onload = () =>
        setImages((list) => [
          ...list,
          { id: crypto.randomUUID(), name: file.name, size: file.size, url: String(reader.result) }
        ])
      reader.onloadend = () => setReading((n) => n - 1)
      setReading((n) => n + 1)
      reader.readAsDataURL(file)
    }
  }
  const deliver = (q: Queued): void => {
    follow()
    setQueued((list) => [...list.filter((x) => x.id !== q.id), q])
    chain.current = chain.current.then(async () => {
      const done = await window.sandtable.sessions.send(session.id, q.text, q.images).then(
        (typed) => ({ typed }),
        (err: unknown) => ({ error: errorMessage(err) })
      )
      setQueued((list) => list.map((x) => (x.id === q.id ? { ...x, ...done } : x)))
    })
  }
  const send = (): void => {
    if ((!text.trim() && !images.length) || reading) return
    setRefused(null)
    clear()
    const urls = images.map((i) => i.url)
    deliver({
      id: crypto.randomUUID(),
      text,
      images: urls,
      from: start + (entries?.length ?? 0),
      typed: null,
      error: null
    })
    setText('')
    setImages([])
    setHeld(null)
  }
  const refocus = (): void => (box.current?.disabled ? toggle : box).current?.focus()
  const retry = (q: Queued): void => {
    deliver({ ...q, from: start + (entries?.length ?? 0), error: null })
    refocus()
  }
  const time = session.state === 'running' && runOf(activity?.since ?? null, activity?.now ?? 0)
  const latest = activity?.steps[0]
  const current =
    latest &&
    (!activity.since || (latest.at && Date.parse(latest.at) >= Date.parse(activity.since)))
      ? latest
      : undefined

  return (
    <div className="flex min-h-0 flex-1">
      {view === 'terminal' ? (
        <div className="flex min-w-0 flex-1 flex-col">
          {head && <div className="px-4 pt-3 pb-2">{head}</div>}
          {live ? (
            <Terminal
              key={`${session.id}-${!!session.remoteControl}`}
              sessionId={session.id}
              active={active}
            />
          ) : (
            <div role="status" className="contents">
              <Message title="The session ended." text="Its terminal closed with it.">
                <div className="mt-3">{actions}</div>
              </Message>
            </div>
          )}
        </div>
      ) : (
        <div className="@container relative flex min-w-0 flex-1 flex-col overflow-hidden">
          <FollowScroller
            follower={follower}
            away={away && !open}
            onEnd={() => {
              follow()
              refocus()
            }}
            className={cn(open && 'pb-70')}
          >
            {head && (
              <div
                className={cn(
                  'mx-auto w-full max-w-180 px-8 pt-6',
                  findable && '@max-[800px]:pr-20'
                )}
              >
                {head}
              </div>
            )}
            {loadError ? (
              <Message title="Couldn't load the conversation" text={loadError} />
            ) : !entries ? (
              <Loading label="Loading conversation" />
            ) : missing ? (
              <Message
                title="Conversation not found"
                text="Claude Code hasn't written this session's conversation, or its history was cleared."
              />
            ) : (
              <div className="mx-auto flex w-full max-w-180 flex-col gap-5 px-8 py-6">
                {entries.length === 0 ? (
                  <Message title="No messages yet" text="The conversation is empty." />
                ) : (
                  <Entries
                    ref={list}
                    sessionId={session.id}
                    entries={entries}
                    query={query ?? ''}
                    rounds={(session.reviewRounds ?? []).flatMap(({ at, ...r }) =>
                      at === undefined || at < start ? [] : [{ ...r, at: at - start }]
                    )}
                    onOpenChanges={onOpenChanges}
                  />
                )}
                <p aria-live="polite" data-find-skip className="sr-only">
                  {newestRound &&
                    (newestRound.endedAt
                      ? outcome(newestRound)
                      : `Automatic review round ${newestRound.round} of ${AUTO_REVIEW_ROUNDS} started.`)}
                </p>
                {prompt && (
                  <QuestionCard
                    key={JSON.stringify(prompt)}
                    sessionId={session.id}
                    prompt={prompt}
                    onTerminal={() =>
                      setDrawer((d) => ({ ...d, open: true, mine: true, typing: false }))
                    }
                    onAnswered={() => setAnswers((n) => n + 1)}
                  />
                )}
                {session.state === 'running' && !asking && (
                  <div className="flex items-center gap-2">
                    <Working step={current}>Claude is working…</Working>
                    {time && (
                      <>
                        <span aria-hidden className="text-fg-3 tabular-nums">
                          {time.short}
                        </span>
                        <span className="sr-only">{spoken(time)}</span>
                      </>
                    )}
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={stopping}
                      onClick={() => {
                        setStopping(true)
                        void run(() => window.sandtable.sessions.interrupt(session.id))
                      }}
                    >
                      Stop
                    </Button>
                  </div>
                )}
              </div>
            )}
          </FollowScroller>
          {findable &&
            (query === null ? (
              <div className="absolute top-2 right-4 z-10 flex gap-0.5 rounded-full bg-panel p-0.5 ring-1 ring-line">
                <Tip label="Find in conversation" shortcut="⌘F">
                  <Button
                    ref={findButton}
                    size="icon-xs"
                    variant="ghost"
                    className="text-fg-3"
                    onClick={() => setQuery('')}
                  >
                    <Search />
                  </Button>
                </Tip>
                {mine.length > 0 && <YourMessages mine={mine} list={list} scroller={scroller} />}
              </div>
            ) : (
              <FindBar
                inputRef={findBox}
                query={query}
                found={found}
                onQuery={setQuery}
                onStep={step}
                onClose={closeFind}
              />
            ))}
          {(refused ?? error) && (
            <p role="alert" className="bg-danger-soft px-4 py-1.5 text-xs text-danger">
              {refused ?? error}
            </p>
          )}
          <div className="px-8 pt-2 pb-4">
            <div className="mx-auto w-full max-w-180">
              <p aria-live="polite" className="sr-only">
                {queued.length > 0 && `${plural(queued.length, 'message')} waiting for Claude`}
              </p>
              {queued.length > 0 && (
                <ul aria-label="Messages waiting for Claude" className="mb-1.5 flex flex-col gap-1">
                  {queued.map((q) => (
                    <li key={q.id}>
                      <div
                        className={cn(
                          'flex min-h-8 items-center gap-2 rounded-sm bg-surface-2 py-1 pr-1 pl-2.5 ring-1 ring-line ring-inset',
                          q.error && 'ring-danger'
                        )}
                      >
                        <span className="w-14 shrink-0 text-xs text-fg-3">
                          {q.error
                            ? 'Not sent'
                            : session.state === 'running'
                              ? 'Queued'
                              : 'Sending'}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-fg-2">
                          {firstLine(q.text, q.images.length)}
                        </span>
                        {q.error && (
                          <>
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() => {
                                setQueued((list) => list.filter((x) => x.id !== q.id))
                                refocus()
                              }}
                            >
                              Remove
                            </Button>
                            <Button
                              size="xs"
                              variant="outline"
                              disabled={asking}
                              onClick={() => retry(q)}
                            >
                              Send again
                            </Button>
                          </>
                        )}
                      </div>
                      {q.error && (
                        <p role="alert" className="px-2.5 pt-0.5 text-xs text-danger">
                          {q.error}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {live ? (
                <Composer
                  value={text}
                  placeholder={
                    suggestion ??
                    (!asking
                      ? 'Message Claude'
                      : inTerminal
                        ? 'Answer Claude in the terminal first'
                        : "Answer Claude's question to send a message")
                  }
                  disabled={asking}
                  boxRef={box}
                  onChange={type}
                  onKey={onKey}
                  box={{
                    role: 'combobox',
                    'aria-describedby': suggestion ? hintId : undefined,
                    'aria-expanded': palette && !!matches?.length,
                    'aria-autocomplete': 'list',
                    'aria-controls': palette && matches?.length ? paletteId : undefined,
                    'aria-activedescendant':
                      palette && matches?.length ? optionId(paletteId, at) : undefined
                  }}
                  overlay={
                    palette && (
                      <CommandPalette
                        id={paletteId}
                        query={slash}
                        commands={matches}
                        active={at}
                        error={commandsError}
                        onHover={setPicked}
                        onPick={fill}
                      />
                    )
                  }
                  onSend={send}
                  onFiles={attach}
                  canSend={(text.trim() !== '' || images.length > 0) && !reading}
                  attachments={
                    images.length > 0 && (
                      <ul aria-label="Images" className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                        {images.map((im, i) => (
                          <li
                            key={im.id}
                            className="flex h-6 max-w-55 items-center gap-1.5 rounded-full bg-neutral-soft px-0.5 text-xs ring-1 ring-line ring-inset"
                          >
                            <img src={im.url} alt="" className="size-5 rounded-full object-cover" />
                            <span className="truncate text-fg-2">{im.name}</span>
                            <span className="shrink-0 text-fg-3">· {sizeOf(im.size)}</span>
                            <Tip label={`Remove image ${i + 1}`}>
                              <Button
                                size="icon-xs"
                                variant="ghost"
                                className="size-5 text-fg-3"
                                aria-label={`Remove image ${i + 1}`}
                                onClick={() =>
                                  setImages((list) => list.filter((x) => x.id !== im.id))
                                }
                              >
                                <X />
                              </Button>
                            </Tip>
                          </li>
                        ))}
                      </ul>
                    )
                  }
                >
                  <Button
                    ref={toggle}
                    size="xs"
                    variant="ghost"
                    aria-pressed={open}
                    onClick={() =>
                      setDrawer((d) => ({ ...d, open: !d.open, mine: !d.open, typing: false }))
                    }
                  >
                    Terminal
                  </Button>
                  {suggestion && (
                    <span
                      aria-hidden
                      className="inline-flex h-4.5 items-center rounded-full bg-neutral-soft px-1.75 text-xs text-fg-3"
                    >
                      Suggested · Tab
                    </span>
                  )}
                  <p id={hintId} aria-live="polite" className="sr-only">
                    {suggestion && `Suggestion: ${suggestion}. Press Tab to use it.`}
                  </p>
                </Composer>
              ) : (
                actions
              )}
            </div>
          </div>
          {live && (
            <section
              ref={sheet}
              aria-label="Terminal"
              inert={!open}
              className={cn(
                'absolute inset-x-4 bottom-0 z-10 flex h-70 flex-col overflow-hidden rounded-t-card bg-surface shadow-card ring-1 ring-line-2 transition-transform duration-250 ease-(--ease-drawer) motion-reduce:transition-none',
                !open && 'translate-y-[calc(100%+8px)]'
              )}
            >
              <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line pr-2 pl-3.5 text-xs text-fg-3">
                <span className={cn('flex-1', asking && 'text-amber')}>
                  {asking ? 'Claude is asking you something' : 'Terminal'}
                </span>
                <Button
                  ref={hide}
                  size="xs"
                  variant="ghost"
                  onClick={() => setDrawer((d) => ({ ...d, open: false }))}
                >
                  Hide
                </Button>
              </div>
              <Terminal
                key={`${session.id}-${!!session.remoteControl}`}
                sessionId={session.id}
                active={open && active && !drawer.typing}
              />
            </section>
          )}
        </div>
      )}
      {panel}
    </div>
  )
}

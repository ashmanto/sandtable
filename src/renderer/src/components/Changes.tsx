import { RefreshCw } from 'lucide-react'
import { Fragment, memo, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn, couldnt, errorMessage, plural, visible } from '@/lib/utils'
import { anchorLine, wasCut } from '../../../shared/findings'
import { repoName } from '../../../shared/sessions'
import type { FileDiff, Finding, RepoChanges, SessionRecord } from '../../../shared/types'
import { useLoad } from '@/hooks/useLoad'
import { useRun } from '@/hooks/useRun'
import { Findings, tag, type Place } from './Findings'
import { LoadError, Loading, Message } from './TabContent'
import { Tip } from './Tip'

const WORDS: Record<FileDiff['change'], string> = {
  added: 'Added',
  modified: 'Modified',
  deleted: 'Deleted',
  renamed: 'Renamed'
}

function Counts({
  added,
  removed,
  binary
}: Pick<FileDiff, 'added' | 'removed' | 'binary'>): React.JSX.Element {
  if (binary) return <span className="text-xs text-fg-3">Binary</span>
  return (
    <span className="font-mono text-xs whitespace-nowrap tabular-nums">
      <span className="text-added">+{added}</span> <span className="text-removed">−{removed}</span>
    </span>
  )
}

const Word = ({ file }: { file: FileDiff }): React.JSX.Element => (
  <span className={tag}>{WORDS[file.change]}</span>
)

const SIGN = { added: '+', removed: '−', context: '' }
const SAID = { added: 'Added: ', removed: 'Removed: ', context: '' }

type Range = { start: number; end: number }
type Selection = { key: string; pivot: number; to: number; text: string }

function Diff({
  file,
  picked,
  marks,
  composer,
  onLine
}: {
  file: FileDiff
  picked: Range | null
  marks: Range[]
  composer: React.ReactNode
  onLine: (line: number, extend: boolean) => void
}): React.JSX.Element {
  const within = (r: Range | null, n?: number): boolean =>
    !!r && n !== undefined && n >= r.start && n <= r.end
  const stop = picked?.start ?? linesOf(file).find((l) => l.new !== undefined)?.new
  const step = (e: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const all = [
      ...(e.currentTarget.closest('table')?.querySelectorAll<HTMLElement>('[data-line] button') ??
        [])
    ]
    all[all.indexOf(e.currentTarget) + (e.key === 'ArrowDown' ? 1 : -1)]?.focus()
  }
  if (file.binary) return <p className="px-4 py-3 text-fg-2">Binary file, not shown.</p>
  if (file.tooLarge)
    return (
      <p className="px-4 py-3 text-fg-2">
        {`This file changed ${plural(file.added + file.removed, 'line')}; the diff is too large to show them here.`}
      </p>
    )
  if (file.hunks.length === 0) return <p className="px-4 py-3 text-fg-2">No line changes.</p>
  return (
    <table className="w-full border-collapse font-mono text-xs leading-[18px]">
      {file.hunks.map((h, i) => (
        <tbody key={i}>
          <tr className="bg-window text-fg-3">
            <td colSpan={5} className="px-4 py-0.5 whitespace-pre">
              {h.header}
            </td>
          </tr>
          {h.lines.map((l, j) => {
            const selected = within(picked, l.new)
            const marked = marks.some((m) => within(m, l.new))
            return (
              <Fragment key={j}>
                <tr
                  data-line={l.new}
                  className={cn(
                    'group/line',
                    selected
                      ? 'bg-(--selection)'
                      : cn(
                          l.kind === 'added' && 'bg-added-soft',
                          l.kind === 'removed' && 'bg-removed-soft'
                        )
                  )}
                >
                  <td
                    className={cn(
                      'w-px pl-4 text-right text-fg-4 tabular-nums select-none',
                      marked && !selected && 'shadow-[inset_2px_0_0_var(--fg-3)]'
                    )}
                  >
                    {marked && <span className="sr-only">Has a finding</span>}
                    {l.old}
                  </td>
                  <td className="w-px pl-2 text-right text-fg-4 tabular-nums select-none">
                    {l.new}
                  </td>
                  <td className="w-px pl-2 align-top select-none">
                    {l.new !== undefined && (
                      <button
                        type="button"
                        aria-label={`Comment on line ${l.new}`}
                        aria-pressed={selected}
                        tabIndex={l.new === stop ? 0 : -1}
                        title="Shift-click or Shift+Enter to select a range"
                        className={cn(
                          'mt-px flex size-4 items-center justify-center rounded-full text-fg-4 opacity-0 outline-none group-hover/line:opacity-100 hover:bg-fg hover:text-surface focus-visible:opacity-100 focus-ring',
                          selected && 'bg-fg text-surface opacity-100'
                        )}
                        onClick={(e) => onLine(l.new!, e.shiftKey)}
                        onKeyDown={step}
                      >
                        +
                      </button>
                    )}
                  </td>
                  <td
                    aria-hidden
                    className={cn(
                      'w-px px-2 select-none',
                      l.kind === 'added' ? 'text-added' : 'text-removed'
                    )}
                  >
                    {SIGN[l.kind]}
                  </td>
                  <td className="pr-4 whitespace-pre">
                    <span className="sr-only">{SAID[l.kind]}</span>
                    {visible(l.text)}
                  </td>
                </tr>
                {picked && l.new === picked.end && (
                  <tr>
                    <td colSpan={5} className="bg-panel py-1.5 pr-4 pl-24 font-sans text-sm">
                      {composer}
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      ))}
    </table>
  )
}

const keyOf = (r: RepoChanges, f: FileDiff): string => `${r.worktree}\n${f.change}\n${f.path}`

const linesOf = (f: FileDiff): FileDiff['hunks'][number]['lines'] => f.hunks.flatMap((h) => h.lines)

const reanchored = (sel: Selection, repos: RepoChanges[]): Selection | null => {
  const file = repos.flatMap((r) => r.files.filter((f) => keyOf(r, f) === sel.key))[0]
  const moved =
    file && anchorLine(linesOf(file), { start: sel.pivot, end: sel.to, anchor: sel.text })
  if (!moved) return null
  return moved.start === sel.pivot ? sel : { ...sel, pivot: moved.start, to: moved.end }
}

function Composer({
  name,
  range,
  draft,
  onDraft,
  onAdd,
  onCancel
}: {
  name: string
  range: Range
  draft: React.RefObject<string>
  onDraft: (text: string) => void
  onAdd: (text: string) => Promise<void>
  onCancel: () => void
}): React.JSX.Element {
  const [text, setText] = useState(() => draft.current)
  const { error, pending, run } = useRun()
  const add = (): void => {
    if (text.trim() && !pending) void run(() => couldnt('add the comment', onAdd(text)))
  }
  return (
    <div className="flex max-w-160 flex-col gap-1.5 rounded-sm bg-card p-2 inset-ring inset-ring-line-2">
      <p className="text-xs text-fg-3">
        {`Comment on ${name}, ${
          range.start === range.end ? `line ${range.start}` : `lines ${range.start}–${range.end}`
        }`}
      </p>
      <Textarea
        autoFocus
        aria-label="Comment"
        placeholder="What should change here?"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          onDraft(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter' && e.metaKey) {
            e.preventDefault()
            add()
          } else if (e.key === 'Escape') onCancel()
        }}
      />
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-1.5">
        <Button size="xs" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="xs" disabled={!text.trim() || pending} onClick={add}>
          Add comment
        </Button>
      </div>
    </div>
  )
}

/** The diff of a session's worktrees against their default branch: a file list beside one file's diff. */
export const Changes = memo(function Changes({
  session,
  active,
  onCount
}: {
  session: SessionRecord
  active: boolean
  onCount?: (files: number) => void
}): React.JSX.Element {
  const [shown, setShown] = useState(active)
  const [attempt, setAttempt] = useState(0)
  const [repos, setRepos] = useState<RepoChanges[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [lastState, setLastState] = useState(session.state)
  const [reread, setReread] = useState(0)
  const [sel, setSel] = useState<Selection | null>(null)
  const selNow = useRef(sel)
  const draft = useRef('')
  const [jump, setJump] = useState<{ key: string; line: number } | null>(null)
  const list = useRef<HTMLUListElement>(null)
  const diffBox = useRef<HTMLDivElement>(null)
  if (active && !shown) setShown(true)
  if (session.state !== lastState) {
    setLastState(session.state)
    if (
      lastState === 'running' &&
      (session.state === 'needsYou' || session.state === 'reviewing' || session.state === 'idle')
    )
      setAttempt((n) => n + 1)
  }
  const removed = !!session.removedAt

  useEffect(() => {
    if (removed) return
    let current = true
    window.sandtable.sessions.changes(session.id).then(
      (r) => {
        if (!current) return
        setRepos(r)
        setSel((prev) => prev && reanchored(prev, r))
        setError(null)
      },
      (err) => current && setError(errorMessage(err))
    )
    return () => {
      current = false
    }
  }, [session.id, removed, attempt, reread])

  const { data: found = null, error: foundError } = useLoad(
    () => window.sandtable.sessions.findings(session.id),
    [session.id, reread],
    shown && !removed
  )

  useEffect(
    () =>
      window.sandtable.board.onChange((id) => {
        if (id === session.projectId) setReread((n) => n + 1)
      }),
    [session.projectId]
  )

  useEffect(() => {
    selNow.current = sel
  }, [sel])

  useEffect(() => {
    if (!jump) return
    const row = diffBox.current?.querySelector(`[data-line="${jump.line}"]`)
    row?.scrollIntoView({ block: 'center' })
    row?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true })
    list.current
      ?.querySelector(`[data-key="${CSS.escape(jump.key)}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [jump])

  const failed =
    error ?? (repos?.every((r) => r.error) ? repos.map((r) => r.error).join('; ') : null)
  const files =
    repos && !failed
      ? repos.flatMap((r) =>
          r.files.map((f) => ({ key: keyOf(r, f), worktree: r.worktree, file: f }))
        )
      : []
  const count = removed ? 0 : files.length
  useEffect(() => onCount?.(count), [count, onCount])

  if (removed)
    return (
      <Message
        title="Worktree removed"
        text="The branch stays on GitHub. Its changes show on the pull request."
      />
    )
  const placeOf = (f: Finding): Place | null => {
    if (!f.path || f.start === undefined) return null
    const at = files.find(
      (x) => x.worktree === f.worktree && x.file.path === f.path && x.file.change !== 'deleted'
    )
    const stored = { start: f.start, end: f.end ?? f.start }
    const moved =
      f.anchor === undefined
        ? stored
        : at && anchorLine(linesOf(at.file), { ...stored, anchor: f.anchor })
    return { key: at?.key, ...(moved ?? stored), outdated: !failed && !moved }
  }
  const onJump = (key: string, line: number): void => {
    setPicked(key)
    setJump({ key, line })
  }
  const rail = (
    <Findings
      session={session}
      found={found}
      loadError={foundError}
      attempt={attempt}
      placeOf={placeOf}
      onJump={onJump}
    />
  )
  if (failed)
    return (
      <>
        <LoadError
          className="min-w-0 flex-1 self-start"
          text={`Couldn't read the changes: ${failed}`}
          onRetry={() => {
            setError(null)
            setRepos(null)
            setAttempt((n) => n + 1)
          }}
        />
        {rail}
      </>
    )
  if (!repos) return <Loading label="Loading changes" />
  const refresh = (): void => setAttempt((n) => n + 1)

  if (files.length === 0 && !repos.some((r) => r.error))
    return (
      <>
        <Message
          title="No changes"
          text={`Nothing changed since the branch left ${repos.map((r) => r.base).join(', ')}.`}
        >
          <Button size="xs" variant="outline" className="mx-auto mt-3" onClick={refresh}>
            Refresh
          </Button>
        </Message>
        {rail}
      </>
    )
  const current = files.find((f) => f.key === picked) ?? files[0]
  const added = files.reduce((n, f) => n + f.file.added, 0)
  const removedLines = files.reduce((n, f) => n + f.file.removed, 0)
  const many = repos.length > 1
  const kept = found?.findings.filter((f) => !f.proposed) ?? []

  const places = kept.map(placeOf)
  const countOn = (key: string): number => places.filter((p) => p?.key === key).length
  const marks = places.filter((p): p is Place => !!p && p.key === current?.key && !p.outdated)
  const range =
    current && sel?.key === current.key
      ? { start: Math.min(sel.pivot, sel.to), end: Math.max(sel.pivot, sel.to) }
      : null

  const onLine = (line: number, extend: boolean): void => {
    if (!current) return
    const text = linesOf(current.file).find((l) => l.new === line)?.text ?? ''
    setSel(
      extend && sel?.key === current.key
        ? { ...sel, to: line }
        : { key: current.key, pivot: line, to: line, text }
    )
  }
  const focusLine = (line: number): void =>
    diffBox.current?.querySelector<HTMLElement>(`[data-line="${line}"] button`)?.focus()
  const cancel = (): void => {
    if (range) focusLine(range.start)
    setSel(null)
    draft.current = ''
  }
  const addComment = async (text: string): Promise<void> => {
    if (!current || !range) return
    const submitted = sel
    const anchor = linesOf(current.file).find((l) => l.new === range.start)?.text
    await window.sandtable.sessions.addFinding(session.id, {
      source: 'you',
      worktree: current.worktree,
      path: current.file.path,
      start: range.start,
      end: range.end,
      ...(anchor !== undefined && !wasCut(anchor) && { anchor }),
      text
    })
    if (selNow.current?.key === submitted?.key && selNow.current?.text === submitted?.text) cancel()
  }
  const composer = range && current && (
    <Composer
      name={visible(current.file.path.split('/').pop() ?? '')}
      range={range}
      draft={draft}
      onDraft={(t) => (draft.current = t)}
      onAdd={addComment}
      onCancel={cancel}
    />
  )
  const move = (e: React.KeyboardEvent): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const i = (current ? files.indexOf(current) : -1) + (e.key === 'ArrowDown' ? 1 : -1)
    const next = files[i]
    if (!next) return
    setPicked(next.key)
    list.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(next.key)}"]`)?.focus()
  }

  return (
    <>
      <aside className="flex min-w-48 shrink basis-75 flex-col border-r bg-window">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
          <span className="text-xs text-fg-3">{plural(files.length, 'file')} changed</span>
          <Counts added={added} removed={removedLines} />
          <Tip label="Refresh">
            <Button size="icon-xs" variant="ghost" className="ml-auto" onClick={refresh}>
              <RefreshCw />
            </Button>
          </Tip>
        </div>
        <ul
          ref={list}
          aria-label="Changed files"
          className="flex min-h-0 flex-1 flex-col overflow-y-auto px-1.5 pt-1 pb-3"
          onKeyDown={move}
        >
          {repos.map((r) => (
            <li key={r.worktree} className="flex flex-col">
              {many && (
                <h2 className="px-1.5 pt-2.5 pb-1 text-xs font-medium text-fg-3">
                  {repoName(r.worktree)}
                </h2>
              )}
              {r.error ? (
                <p className="px-1.5 pb-1 text-xs text-danger">{`Couldn't read the changes: ${r.error}`}</p>
              ) : (
                many &&
                r.files.length === 0 && (
                  <p className="px-1.5 pb-1 text-xs text-fg-3">No changes in this repo</p>
                )
              )}
              <ul className="flex flex-col">
                {r.files.map((f) => {
                  const key = keyOf(r, f)
                  const slash = f.path.lastIndexOf('/')
                  const selected = key === current?.key
                  return (
                    <li key={key}>
                      <button
                        data-key={key}
                        aria-current={selected || undefined}
                        title={visible(f.oldPath ? `${f.oldPath} → ${f.path}` : f.path)}
                        className={cn(
                          'grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-2 rounded-sm px-2 py-1.5 text-left',
                          selected
                            ? 'bg-card shadow-[inset_0_0_0_1px_var(--line-2)]'
                            : 'hover:bg-surface-3'
                        )}
                        onClick={() => setPicked(key)}
                      >
                        <span className="truncate font-medium">
                          {visible(f.path.slice(slash + 1))}
                        </span>
                        <Counts {...f} />
                        <span className="truncate font-mono text-xs text-fg-3">
                          {visible(f.path.slice(0, Math.max(slash, 0)))}
                        </span>
                        <span className="flex gap-1 justify-self-end">
                          {countOn(key) > 0 && (
                            <span className={tag}>{plural(countOn(key), 'finding')}</span>
                          )}
                          <Word file={f} />
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </li>
          ))}
        </ul>
      </aside>
      {current ? (
        <section aria-label={current.file.path} className="flex min-w-60 flex-1 flex-col">
          <div className="flex h-10 shrink-0 items-center gap-2 border-b px-4">
            <span className="min-w-0 truncate font-mono">
              {visible(
                current.file.oldPath
                  ? `${current.file.oldPath} → ${current.file.path}`
                  : current.file.path
              )}
            </span>
            <Word file={current.file} />
            <Counts {...current.file} />
            <span className="ml-auto shrink-0 text-xs text-fg-3">
              ↑ ↓ in the list to move between files
            </span>
          </div>
          <div ref={diffBox} className="min-h-0 flex-1 overflow-auto">
            <Diff
              file={current.file}
              picked={range}
              marks={marks}
              composer={composer}
              onLine={onLine}
            />
          </div>
        </section>
      ) : (
        <Message title="No changes" text="The repos Sandtable could read have no changes." />
      )}
      {rail}
    </>
  )
})

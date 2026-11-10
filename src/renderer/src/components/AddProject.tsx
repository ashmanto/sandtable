import { Check, Folder, Lightbulb } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
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
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { RadioBox } from './RadioBox'
import { useLatestLoad } from '../hooks/useLatestLoad'
import { useSteps } from '../hooks/useSteps'
import { LabeledSelect, LoadState, Problem, Spinner, StepFlow } from './StepFlow'
import { EmojiPicker } from './EmojiPicker'
import { ProjectTile } from './ProjectTile'
import { InstructionsField } from './InstructionsField'
import { JiraReview, JiraStep } from './JiraStep'
import { LinearReview, LinearStep } from './LinearStep'
import { useJiraSource } from '../hooks/useJiraSource'
import { useLinearSource } from '../hooks/useLinearSource'
import { insetClass } from './Activity'
import { linkClass } from './SetupHint'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { cn, errorMessage, home, onEnter, plural } from '@/lib/utils'
import { parseBoardUrl } from '../../../shared/boardUrl'
import { IN_PROGRESS_LABEL } from '../../../shared/columns'
import {
  instructionsBytes,
  keptInstructions,
  MAX_INSTRUCTIONS_BYTES
} from '../../../shared/instructions'
import { sameRepo } from '../../../shared/repo'
import { isSandboxDomain, sandboxDomains } from '../../../shared/sandbox'
import { appName, isApp } from '../../../shared/editors'
import { AUTO_REVIEW_ROUNDS, MODEL_CHOICES, modelLabel } from '../../../shared/types'
import { DEFAULT_KEEP_DONE_DAYS, KEEP_DONE_DAYS } from '../../../shared/visibleTickets'
import { TOKEN_CAPS } from '../../../shared/pricing'
import { compact } from '@/lib/usage'
import type {
  Account,
  Model,
  Project,
  ProjectRepo,
  SetupSuggestion,
  StatusMap
} from '../../../shared/types'

type Source = 'board' | 'issues' | 'linear' | 'jira'
type Picked = { path: string; repos: string[] }
type Entry = {
  github: string
  path: string | null
  include: boolean
  checking?: boolean
  checked?: boolean
  filled?: boolean
  refused?: Picked
  setup?: ProjectRepo['setup']
  setupOpen?: boolean
}

const keptSetup = (setup: Entry['setup']): ProjectRepo['setup'] => {
  const copy = setup?.copy?.filter((p) => p.trim()) ?? []
  const command = setup?.command?.trim()
  return copy.length || command
    ? { ...(copy.length && { copy }), ...(command && { command }) }
    : undefined
}

const setupSummary = (setup: Entry['setup']): string => {
  const { copy, command } = keptSetup(setup) ?? {}
  return [copy && plural(copy.length, 'path'), command].filter(Boolean).join(' · ') || 'None'
}

const STEPS = ['Name', 'Tickets from', 'Repos', 'Review']
const HEADINGS = ['Name the project', 'Where tickets come from', 'Repos and folders', 'Review']
const STATUS_FIELDS: { key: keyof StatusMap; label: string; usual: string }[] = [
  { key: 'todo', label: 'To do', usual: 'Todo' },
  { key: 'inProgress', label: 'In progress', usual: 'In Progress' },
  { key: 'done', label: 'Done', usual: 'Done' }
]
const SOURCES: { value: Source; title: string; help: string }[] = [
  {
    value: 'board',
    title: 'GitHub Projects board',
    help: "Tickets and columns come from the board's Status field."
  },
  {
    value: 'issues',
    title: 'Repo issues',
    help: "Each repo's issues are the tickets. Open issues are To do, or In progress with Sandtable's label, which Start adds and dragging changes; closed issues are Done."
  },
  {
    value: 'linear',
    title: 'Linear team',
    help: "Tickets are a Linear team's issues. Columns follow each issue's workflow state: unstarted is To do, started is In progress, completed is Done; canceled, backlog, triage, and duplicate issues stay hidden."
  },
  {
    value: 'jira',
    title: 'Jira project',
    help: "Tickets are a Jira project's issues. Columns follow each issue's status category."
  }
]
const REMOTE: { value: boolean | undefined; title: string; help: string }[] = [
  {
    value: undefined,
    title: 'Use the Settings default',
    help: 'The Remote Control switch in Settings decides.'
  },
  { value: true, title: 'On', help: "This project's sessions start with Remote Control on." },
  { value: false, title: 'Off', help: "This project's sessions start with Remote Control off." }
]

const boardName = (url: string): string | null => {
  try {
    const { owner, number } = parseBoardUrl(url)
    return `${owner}/projects/${number}`
  } catch {
    return null
  }
}

/** The add-project flow: name, tickets from, repos, and review; prefilled to edit. */
export function AddProject({
  project,
  onCancel,
  onSaved,
  onDeleted,
  settingsOpen,
  repo,
  onChanged
}: {
  project?: Project
  settingsOpen?: boolean
  repo?: string
  onCancel?: () => void
  onSaved: (project: Project) => void
  onDeleted: (id: string) => void
  onChanged?: () => void
}): React.JSX.Element {
  const board0 = project?.board
  const [id] = useState(() => project?.id ?? crypto.randomUUID())
  const { step, maxStep, dir, go } = useSteps(project ? (repo ? 2 : 3) : 0, project ? 3 : 0)
  const [name, setName] = useState(project?.name ?? '')
  const [icon, setIcon] = useState(project?.icon)
  const emojiButton = useRef<HTMLButtonElement>(null)
  const [source, setSource] = useState<Source | null>(
    project
      ? board0
        ? 'board'
        : project.linear
          ? 'linear'
          : project.jira
            ? 'jira'
            : 'issues'
      : null
  )
  const linear = useLinearSource(project)
  const jira = useJiraSource(project)
  const [url, setUrl] = useState(board0?.source.url ?? '')
  const boardLoad = useLatestLoad(
    board0
      ? {
          url: board0.source.url,
          options: [...new Set(Object.values(board0.statusMap))],
          repos: project?.repos.map((r) => r.github) ?? []
        }
      : null
  )
  const { data: loaded, loading, error: boardError } = boardLoad
  const [badUrl, setBadUrl] = useState(false)
  const [statusMap, setStatusMap] = useState<Partial<StatusMap>>(board0?.statusMap ?? {})
  const [entries, setEntries] = useState<Entry[]>(
    project?.repos.map((r) => ({ ...r, include: true })) ?? []
  )
  const [remoteControl, setRemoteControl] = useState(project?.remoteControl)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [claudeDir, setClaudeDir] = useState(project?.claudeDir)
  const [keepDoneDays, setKeepDoneDays] = useState(project?.keepDoneDays ?? DEFAULT_KEEP_DONE_DAYS)
  const [tokenCap, setTokenCap] = useState(project?.tokenCap ?? 0)
  const [model, setModel] = useState(project?.model)
  const [editor, setEditor] = useState(isApp(project?.editor) ? project.editor : undefined)
  const [readyCheck, setReadyCheck] = useState(project?.readyCheck !== false)
  const [autoReview, setAutoReview] = useState(!!project?.autoReview)
  const [sandbox, setSandbox] = useState(!!project?.sandbox)
  const [domains, setDomains] = useState(project?.sandboxDomains?.join(', ') ?? '')
  const [instructions, setInstructions] = useState(project?.instructions)
  const [typed, setTyped] = useState('')
  const [typedError, setTypedError] = useState<string | null>(null)
  const [folderError, setFolderError] = useState<{ title: string; path?: string } | null>(null)
  const [choosing, setChoosing] = useState<Picked | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [suggested, setSuggested] = useState<Record<string, SetupSuggestion | null>>({})
  const suggesting = useRef(new Set<string>())
  const focusedUse = useRef(false)
  const savedProject = useRef(project)
  const [savedSetup, setSavedSetup] = useState<string | null>(null)

  useEffect(() => {
    for (const e of entries) {
      const path = e.path
      if (!path || suggesting.current.has(path) || keptSetup(e.setup)) continue
      suggesting.current.add(path)
      void window.sandtable.setup.suggest(path).then(
        (found) => setSuggested((s) => ({ ...s, [path]: found })),
        () => undefined
      )
    }
  }, [entries])

  useEffect(() => {
    if (!settingsOpen) void window.sandtable.accounts.list().then(setAccounts)
  }, [settingsOpen])

  const board = source === 'board' && loaded?.url === url.trim() ? loaded : null
  const included = entries.filter((e) => e.include)
  function issue(i: number): string | null {
    if (i === 0) return name.trim() ? null : 'Enter a name'
    if (i === 1) {
      if (!source) return 'Choose where tickets come from'
      if (source === 'issues') return null
      if (source === 'jira') return jira.issue
      if (source === 'linear') return linear.issue
      if (loading) return 'Loading the board…'
      if (!board) return 'Load the board'
      const missing = STATUS_FIELDS.find((f) => !statusMap[f.key])
      return missing ? `Choose a board status for ${missing.label}` : null
    }
    if (i === 2) {
      if (source === 'board' && !board) return 'Load the board first'
      if (!included.length)
        return source === 'board' ? 'Include at least one repo' : 'Add at least one repo'
      if (included.some((e) => e.checking)) return 'Checking remote…'
      const missing = included.find((e) => !e.path)
      return missing ? `Choose a folder for ${missing.github}` : null
    }
    return (
      [0, 1, 2].map(issue).find(Boolean) ??
      (instructionsBytes(keptInstructions(instructions)) > MAX_INSTRUCTIONS_BYTES
        ? `Shorten your instructions to ${MAX_INSTRUCTIONS_BYTES.toLocaleString('en-US')} bytes`
        : null)
    )
  }
  const reachable = (i: number): boolean =>
    i <= maxStep && [0, 1, 2].slice(0, i).every((j) => !issue(j))
  const hint = issue(step)

  function advance(): void {
    if (hint || saving) return
    if (step === 3) void save()
    else go(step + 1)
  }

  function loadBoard(): void {
    if (!boardName(url)) return setBadUrl(true)
    const target = url.trim()
    void boardLoad.load(
      async () => {
        const [options, repos] = await Promise.all([
          window.sandtable.projects.statusOptions(target),
          window.sandtable.projects.boardRepos(target)
        ])
        return { url: target, options, repos }
      },
      ({ options, repos }) => {
        setStatusMap((m) =>
          Object.fromEntries(
            STATUS_FIELDS.map(({ key, usual }) => {
              const kept = m[key]
              return [
                key,
                kept && options.includes(kept) ? kept : options.includes(usual) ? usual : undefined
              ]
            })
          )
        )
        setEntries((es) => [
          ...repos.map(
            (github) =>
              es.find((e) => sameRepo(e.github, github)) ?? { github, path: null, include: false }
          ),
          ...es.filter((e) => e.include && !repos.some((r) => sameRepo(r, e.github)))
        ])
      }
    )
  }

  function changeUrl(value: string): void {
    setUrl(value)
    setBadUrl(false)
    boardLoad.cancel()
    if (loaded) {
      boardLoad.set(null)
      setEntries((es) => es.filter((e) => e.include && e.path))
      setFolderError(null)
      setChoosing(null)
    }
  }

  function chooseSource(value: Source): void {
    if (value === source) return
    setSource(value)
    boardLoad.set(null)
    linear.reset()
    if (value === 'linear') linear.activate()
    if (value === 'jira') jira.activate()
    else jira.reset()
    setEntries((es) => es.filter((e) => e.include))
    setFolderError(null)
    setTypedError(null)
    setChoosing(null)
  }

  const patch = (github: string, p: Partial<Entry>): void =>
    setEntries((es) => es.map((e) => (e.github === github ? { ...e, ...p } : e)))

  async function pick(): Promise<Picked | null> {
    try {
      return await window.sandtable.projects.pickFolder()
    } catch (err) {
      setFolderError({ title: errorMessage(err) })
      return null
    }
  }

  async function chooseFolder(github: string): Promise<void> {
    patch(github, { checking: true, refused: undefined, filled: false })
    const picked = await pick()
    if (!picked) return patch(github, { checking: false })
    patch(
      github,
      picked.repos.some((r) => sameRepo(r, github))
        ? { checking: false, path: picked.path, checked: true }
        : { checking: false, refused: picked }
    )
  }

  function fill(repo: string, path: string): void {
    setChoosing(null)
    const filled = { include: true, path, checked: true, filled: true, refused: undefined }
    setEntries((es) =>
      es.some((e) => sameRepo(e.github, repo))
        ? es.map((e) => (sameRepo(e.github, repo) ? { ...e, ...filled } : e))
        : [...es, { github: repo, ...filled }]
    )
  }

  async function addFromFolder(): Promise<void> {
    setFolderError(null)
    setChoosing(null)
    const picked = await pick()
    if (!picked) return
    const { path, repos } = picked
    if (!repos.length)
      return setFolderError({
        title: "This folder has no GitHub remote, so Sandtable can't tell which repo it is.",
        path
      })
    const fits =
      source === 'board' ? repos.filter((r) => entries.some((e) => sameRepo(e.github, r))) : repos
    if (!fits.length)
      return setFolderError({ title: `No tickets on this board come from ${repos[0]}.`, path })
    if (fits.length > 1) return setChoosing({ path, repos: fits })
    fill(fits[0], path)
  }

  function addTyped(): void {
    const repo = typed.trim()
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo))
      return setTypedError('Enter a repo as owner/name, such as acme/api.')
    if (entries.some((e) => sameRepo(e.github, repo)))
      return setTypedError(`${repo} is already in this project.`)
    setEntries((es) => [...es, { github: repo, path: null, include: true }])
    setTyped('')
    setTypedError(null)
  }

  async function applySuggestion(e: Entry, suggestion: SetupSuggestion): Promise<void> {
    const base = savedProject.current
    const kept = base?.repos.find((r) => sameRepo(r.github, e.github))
    if (!base || !kept || kept.path !== e.path)
      return patch(e.github, { setup: suggestion, setupOpen: true })
    const setup = keptSetup(suggestion)
    const next = {
      ...base,
      repos: base.repos.map((r) => (r === kept ? { ...r, ...(setup && { setup }) } : r))
    }
    setError(null)
    try {
      await window.sandtable.projects.save(next)
    } catch (err) {
      return setError(`Couldn't save the worktree setup: ${errorMessage(err)}`)
    }
    savedProject.current = next
    patch(e.github, { setup })
    setSavedSetup(e.github)
    onChanged?.()
  }

  async function save(): Promise<void> {
    setError(null)
    const sandboxDomains = sandbox
      ? domains
          .toLowerCase()
          .split(/[\s,]+/)
          .filter(Boolean)
      : []
    const wrong = sandboxDomains.find((d) => !isSandboxDomain(d))
    if (wrong) return setError(`Not a domain: ${wrong}. Type host names such as pypi.org.`)
    setSaving(true)
    const kept = keptInstructions(instructions)
    const saved: Project = {
      id,
      name: name.trim(),
      ...(icon && { icon }),
      repos: included.flatMap((e) => {
        const setup = keptSetup(e.setup)
        return e.path ? [{ github: e.github, path: e.path, ...(setup && { setup }) }] : []
      }),
      ...(source === 'board' && {
        board: { source: parseBoardUrl(url), statusMap: statusMap as StatusMap }
      }),
      ...(source === 'linear' && linear.saved && { linear: linear.saved }),
      ...(source === 'jira' && jira.saved && { jira: jira.saved }),
      ...(remoteControl !== undefined && { remoteControl }),
      ...(claudeDir !== undefined && { claudeDir }),
      ...(keepDoneDays !== DEFAULT_KEEP_DONE_DAYS && { keepDoneDays }),
      ...(model && { model }),
      ...(editor && { editor }),
      ...(tokenCap > 0 && { tokenCap }),
      ...(!readyCheck && { readyCheck: false as const }),
      ...(autoReview && { autoReview: true as const }),
      ...(sandbox && { sandbox: true as const }),
      ...(sandboxDomains.length > 0 && { sandboxDomains: [...new Set(sandboxDomains)] }),
      ...(kept && { instructions: kept })
    }
    try {
      await window.sandtable.projects.save(saved)
      onSaved(saved)
    } catch (err) {
      setError(`Couldn't save the project: ${errorMessage(err)}`)
      setSaving(false)
    }
  }

  async function remove(): Promise<void> {
    if (!project) return
    try {
      await window.sandtable.projects.remove(project.id)
      onDeleted(project.id)
    } catch (err) {
      setError(`Couldn't delete the project: ${errorMessage(err)}`)
    }
  }

  function summary(i: number): string {
    if (i === step) return 'Current step'
    if (i > maxStep) return 'Not started'
    const problem = issue(i)
    if (problem || i === 3) return problem ?? 'Ready to save'
    if (i === 0) return name.trim()
    if (i === 1)
      return source === 'board'
        ? 'Board, statuses chosen'
        : source === 'linear'
          ? linear.summary
          : source === 'jira'
            ? jira.summary
            : 'Repo issues'
    return plural(included.length, 'repo')
  }

  function folderRow(e: Entry): React.JSX.Element {
    return (
      <>
        <div className={cn('flex min-h-6 items-center gap-2', source === 'board' && 'pl-6')}>
          {e.path ? (
            <span
              className="flex min-w-0 flex-1 items-center gap-1.5 font-mono text-xs"
              title={e.path}
            >
              <Folder className="size-3.5 shrink-0" />
              <span className="truncate">{home(e.path)}</span>
            </span>
          ) : (
            <span className="flex-1 text-fg-2">No folder chosen</span>
          )}
          {e.checking ? (
            <span role="status" className="flex items-center gap-1.5 text-xs text-fg-2">
              <Spinner />
              Checking remote…
            </span>
          ) : (
            e.checked && (
              <span className="flex items-center gap-1 rounded-full bg-neutral-soft px-1.5 text-xs text-neutral">
                <Check className="size-3" />
                Remote matches
              </span>
            )
          )}
          <Button
            variant="outline"
            size="xs"
            disabled={e.checking}
            onClick={() => void chooseFolder(e.github)}
          >
            {e.path ? 'Change folder…' : 'Choose folder…'}
          </Button>
        </div>
        {e.filled && (
          <p className={cn('text-xs text-fg-2', source === 'board' && 'pl-6')}>
            Filled in {e.github} from the folder&apos;s remote.
          </p>
        )}
        {e.refused && (
          <Problem
            title={`This folder's git remote doesn't point at ${e.github}`}
            detail={`${e.refused.path} ${
              e.refused.repos.length
                ? `points at ${e.refused.repos.join(', ')}`
                : 'has no GitHub remote'
            }. The folder wasn't added.`}
          />
        )}
        {e.path && setupRow(e)}
      </>
    )
  }

  function setupRow(e: Entry): React.JSX.Element {
    const id = `setup-${e.github}`
    const setup = e.setup ?? {}
    const summary = setupSummary(e.setup)
    const verb = e.setupOpen ? 'Hide' : summary === 'None' ? 'Add' : 'Edit'
    const suggestion = !e.setupOpen && summary === 'None' && e.path ? suggested[e.path] : null
    return (
      <div className={cn('flex flex-col gap-2', source === 'board' && 'pl-6')}>
        <div className="flex min-h-6 items-center gap-2 text-xs">
          <span className="font-medium text-fg-2">Worktree setup</span>
          <span className="min-w-0 flex-1 truncate font-mono text-fg-3">{summary}</span>
          {savedSetup === e.github && (
            <span role="status" className="flex items-center gap-1 text-fg-2">
              <Check aria-hidden className="size-3.5" />
              Saved
            </span>
          )}
          <Button
            variant="outline"
            size="xs"
            aria-label={`${verb} worktree setup for ${e.github}`}
            aria-expanded={!!e.setupOpen}
            onClick={() => {
              setSavedSetup(null)
              patch(e.github, { setupOpen: !e.setupOpen })
            }}
          >
            {verb}
          </Button>
        </div>
        {suggestion && (
          <p className={cn(insetClass, 'items-center gap-2 px-2 py-1.5 text-xs text-fg-2')}>
            <Lightbulb aria-hidden className="size-3.5 shrink-0 text-fg-3" />
            <span className="min-w-0 flex-1 truncate">
              Suggested:{' '}
              {suggestion.copy.length > 0 && (
                <>
                  copy <code className="font-mono">{suggestion.copy.join(', ')}</code>
                </>
              )}
              {suggestion.copy.length > 0 && suggestion.command && ' · '}
              {suggestion.command && <code className="font-mono">{suggestion.command}</code>}
            </span>
            <button
              type="button"
              ref={(el) => {
                if (!el || focusedUse.current || !repo || !sameRepo(repo, e.github)) return
                focusedUse.current = true
                el.focus()
              }}
              aria-label={`Use suggested worktree setup for ${e.github}`}
              className={cn(linkClass, 'shrink-0 text-fg')}
              onClick={() => void applySuggestion(e, suggestion)}
            >
              Use
            </button>
          </p>
        )}
        {e.setupOpen && (
          <>
            <p className="text-xs text-fg-3">
              Runs only in a worktree Sandtable makes, before Claude Code starts.
            </p>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${id}-copy`} className="text-xs text-fg-2">
                Copy from the main checkout
              </Label>
              <Textarea
                id={`${id}-copy`}
                rows={2}
                placeholder=".env"
                aria-describedby={`${id}-copy-help`}
                className="font-mono"
                value={setup.copy?.join('\n') ?? ''}
                onChange={(ev) =>
                  patch(e.github, { setup: { ...setup, copy: ev.target.value.split('\n') } })
                }
              />
              <span id={`${id}-copy-help`} className="text-xs text-fg-2">
                One path per line. Only files and folders git ignores.
              </span>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${id}-command`} className="text-xs text-fg-2">
                Setup command
              </Label>
              <Input
                id={`${id}-command`}
                placeholder="npm install"
                className="font-mono"
                value={setup.command ?? ''}
                onChange={(ev) =>
                  patch(e.github, { setup: { ...setup, command: ev.target.value } })
                }
              />
            </div>
            <p className="text-xs text-fg-3">
              Kept as you type, and saved when you save the project.
            </p>
          </>
        )}
      </div>
    )
  }

  const stepName = (
    <div className="flex flex-col gap-2">
      <Label htmlFor="project-name">Name</Label>
      <Input
        id="project-name"
        autoFocus
        autoComplete="off"
        spellCheck={false}
        placeholder="Acme"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={onEnter(advance)}
      />
    </div>
  )

  const stepSource = (
    <>
      <div role="radiogroup" aria-label="Tickets from" className="flex flex-col gap-2">
        {SOURCES.map((s, i) => (
          <RadioBox
            key={s.value}
            name="ticket-source"
            checked={source === s.value}
            title={s.title}
            help={s.help}
            autoFocus={source ? source === s.value : i === 0}
            onChange={() => chooseSource(s.value)}
          />
        ))}
      </div>
      {source === 'board' && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="board-url">Board URL</Label>
            <div className="flex gap-2">
              <Input
                id="board-url"
                autoFocus
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
                placeholder="https://github.com/users/you/projects/1"
                value={url}
                onChange={(e) => changeUrl(e.target.value)}
                onKeyDown={onEnter(() => !loading && loadBoard())}
              />
              <Button
                variant="outline"
                size="lg"
                disabled={loading || !url.trim()}
                onClick={() => loadBoard()}
              >
                {board ? 'Reload' : 'Load board'}
              </Button>
            </div>
          </div>
          {badUrl ? (
            <Problem title="Enter a board URL such as https://github.com/users/you/projects/1" />
          ) : (
            <LoadState
              loading={loading}
              text="Loading board…"
              failed={boardError ? { title: "Couldn't load the board.", detail: boardError } : null}
              onRetry={loadBoard}
            >
              {board && (
                <p role="status" className="flex items-center gap-1.5 text-fg-2">
                  <Check className="size-3.5" />
                  Board loaded: tickets from {plural(board.repos.length, 'repo')}
                </p>
              )}
            </LoadState>
          )}
          {board && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 font-medium">Board status for each column</legend>
              <div className="grid grid-cols-3 gap-3">
                {STATUS_FIELDS.map((f) => (
                  <LabeledSelect
                    key={f.key}
                    id={`status-${f.key}`}
                    label={f.label}
                    small
                    value={statusMap[f.key] ?? ''}
                    onChange={(v) => setStatusMap((m) => ({ ...m, [f.key]: v }))}
                    options={board.options.map((o) => ({ value: o, label: o }))}
                  />
                ))}
              </div>
            </fieldset>
          )}
        </div>
      )}
      {source === 'linear' && <LinearStep source={linear} />}
      {source === 'jira' && <JiraStep source={jira} />}
    </>
  )

  const stepRepos = (
    <>
      {source === 'board' && (
        <p className="mb-3 text-xs text-fg-2">
          Repos found among this board&apos;s tickets. Only tickets from repos you include show on
          the board.
        </p>
      )}
      <div className="flex flex-col gap-2">
        {entries.map((e, i) => (
          <div
            key={e.github}
            role="group"
            aria-label={e.github}
            className="flex flex-col gap-2 rounded-card bg-card px-3 py-2.5"
          >
            {source === 'board' ? (
              <div className="flex items-center gap-2.5">
                <Checkbox
                  id={`include-${i}`}
                  autoFocus={i === 0}
                  checked={e.include}
                  onCheckedChange={(on) =>
                    patch(e.github, { include: on === true, refused: undefined })
                  }
                />
                <Label
                  htmlFor={`include-${i}`}
                  className={cn('font-mono', !e.include && 'font-normal text-fg-2')}
                >
                  {e.github}
                </Label>
                <span className="ml-auto text-xs text-fg-3">
                  {e.include ? 'Included' : 'Not included'}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="font-mono">{e.github}</span>
                <Button
                  variant="ghost"
                  size="xs"
                  className="ml-auto"
                  aria-label={`Remove ${e.github}`}
                  onClick={() => setEntries((es) => es.filter((x) => x !== e))}
                >
                  Remove
                </Button>
              </div>
            )}
            {e.include && folderRow(e)}
          </div>
        ))}
        {source !== 'board' && !entries.length && <p className="text-fg-2">No repos yet.</p>}
      </div>
      {source !== 'board' && (
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="typed-repo" className="sr-only">
              GitHub repo
            </Label>
            <Input
              id="typed-repo"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              className="w-55 font-mono"
              placeholder="owner/name"
              value={typed}
              onChange={(e) => {
                setTyped(e.target.value)
                setTypedError(null)
              }}
              onKeyDown={onEnter(addTyped)}
            />
            <Button variant="outline" size="lg" disabled={!typed.trim()} onClick={addTyped}>
              Add repo
            </Button>
          </div>
          {typedError && <Problem title={typedError} />}
        </div>
      )}
      <div className="mt-3 flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => void addFromFolder()}>
          <Folder />
          Add from a folder…
        </Button>
        <span className="text-xs text-fg-3">Picks the repo from the folder&apos;s remote</span>
      </div>
      {choosing && (
        <div className="mt-3 flex flex-col gap-2 rounded-card bg-card px-3 py-2.5">
          <p className="text-xs text-fg-2">
            {home(choosing.path)} has remotes for several repos. Choose the one to add.
          </p>
          <div className="flex flex-wrap gap-2">
            {choosing.repos.map((r) => (
              <Button
                key={r}
                variant="outline"
                size="xs"
                className="font-mono"
                onClick={() => fill(r, choosing.path)}
              >
                {r}
              </Button>
            ))}
          </div>
        </div>
      )}
      {folderError && (
        <div className="mt-3">
          <Problem title={folderError.title} detail={folderError.path} />
        </div>
      )}
    </>
  )

  const row = (label: string, to: number | null, value: React.ReactNode): React.JSX.Element => (
    <div className="grid grid-cols-[120px_1fr_auto] items-start gap-3 border-b py-2.5">
      <dt className="text-fg-2">{label}</dt>
      <dd className="flex min-w-0 flex-col gap-1">{value}</dd>
      {to !== null && (
        <Button
          variant="ghost"
          size="xs"
          aria-label={`Edit ${label.toLowerCase()}`}
          onClick={() => go(to)}
        >
          Edit
        </Button>
      )}
    </div>
  )

  const stepReview = (
    <fieldset disabled={saving} className="min-w-0">
      <dl className="flex flex-col border-t">
        {row('Name', 0, name.trim())}
        {row(
          'Icon',
          null,
          <div className="flex items-center gap-2">
            <ProjectTile name={name.trim()} icon={icon} />
            {icon && <span className="sr-only">{icon}</span>}
            <EmojiPicker
              ref={emojiButton}
              label={icon ? 'Change emoji' : 'Choose emoji'}
              onPick={setIcon}
            />
            {icon ? (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  setIcon(undefined)
                  emojiButton.current?.focus()
                }}
              >
                Clear
              </Button>
            ) : (
              <span className="text-xs text-fg-3">
                Optional. Without one, the tile shows the first letter.
              </span>
            )}
          </div>
        )}
        {row(
          'Tickets from',
          1,
          source === 'board' ? (
            <>
              <span>GitHub Projects board</span>
              <span className="truncate font-mono text-xs text-fg-2">{url.trim()}</span>
            </>
          ) : source === 'jira' ? (
            <JiraReview source={jira} />
          ) : source === 'linear' ? (
            <LinearReview source={linear} />
          ) : (
            'Repo issues'
          )
        )}
        {row(
          'Columns',
          1,
          source === 'board' ? (
            STATUS_FIELDS.map((f) => (
              <span key={f.key} className="flex gap-2">
                <span className="text-fg-2">{f.label}</span>
                <span>{statusMap[f.key]}</span>
              </span>
            ))
          ) : source === 'jira' ? (
            <span>
              Issues in the To Do category are To do; In Progress, In progress; Done, Done.
              {jira.saved?.board &&
                " Only the board's issues show: those in its active sprints, or, on a board without sprints, those outside its backlog."}
            </span>
          ) : source === 'linear' ? (
            <span>
              Unstarted issues are To do; started issues are In progress; completed issues are Done.
              Canceled, backlog, triage, and duplicate issues stay hidden.
            </span>
          ) : (
            <span>
              Open issues are To do; open issues with the label{' '}
              <code className="font-mono">{IN_PROGRESS_LABEL.name}</code> are In progress; closed
              issues are Done.
            </span>
          )
        )}
        {row(
          'Repos',
          2,
          included.map((e) => (
            <span key={e.github} className="flex min-w-0 flex-col">
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="font-mono">{e.github}</span>
                <span className="truncate font-mono text-xs text-fg-3" title={e.path ?? undefined}>
                  {e.path && home(e.path)}
                </span>
              </span>
              {e.path && (
                <span className="truncate text-xs text-fg-3" title={setupSummary(e.setup)}>
                  Worktree setup: <span className="font-mono">{setupSummary(e.setup)}</span>
                </span>
              )}
            </span>
          ))
        )}
        {row(
          'Remote Control',
          null,
          <div role="radiogroup" aria-label="Remote Control" className="flex flex-col gap-2">
            {REMOTE.map((r) => (
              <RadioBox
                key={r.title}
                name="remote-control"
                checked={remoteControl === r.value}
                title={r.title}
                help={r.help}
                onChange={() => setRemoteControl(r.value)}
              />
            ))}
          </div>
        )}
        {row(
          'Claude Code account',
          null,
          <div role="radiogroup" aria-label="Claude Code account" className="flex flex-col gap-2">
            {accounts.map((a, i) => (
              <RadioBox
                key={a.dir}
                name="claude-account"
                checked={i === 0 ? (claudeDir ?? a.dir) === a.dir : claudeDir === a.dir}
                title={a.name}
                help={home(a.dir)}
                onChange={() => setClaudeDir(i === 0 ? undefined : a.dir)}
              />
            ))}
          </div>
        )}
        {row(
          'Model',
          null,
          <div className="flex items-center gap-3">
            <Select
              value={model ?? 'default'}
              onValueChange={(v) => setModel(v === 'default' ? undefined : (v as Model))}
            >
              <SelectTrigger
                aria-label="Model"
                aria-describedby="model-help"
                className="w-40 shrink-0"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODEL_CHOICES.map((m) => (
                  <SelectItem key={m} value={m}>
                    {modelLabel(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span id="model-help" className="text-xs text-fg-2">
              The model sessions run on. Start and New session can pick another for one session.
            </span>
          </div>
        )}
        {row(
          'Editor',
          null,
          <div className="flex items-center gap-3">
            <span id="editor-name" className={cn('w-40 shrink-0 truncate', !editor && 'text-fg-2')}>
              {editor ? appName(editor) : 'None'}
            </span>
            <Button
              variant="outline"
              size="sm"
              aria-label="Choose editor"
              aria-describedby="editor-name editor-help"
              onClick={() =>
                void window.sandtable.projects.pickEditor().then((app) => app && setEditor(app))
              }
            >
              Choose…
            </Button>
            {editor && (
              <Button
                variant="ghost"
                size="sm"
                aria-label="Clear editor"
                aria-describedby="editor-name editor-help"
                onClick={() => setEditor(undefined)}
              >
                Clear
              </Button>
            )}
            <span id="editor-help" className="text-xs text-fg-2">
              The editor a session&apos;s side panel opens its folders in.
            </span>
          </div>
        )}
        {row(
          'Keep done tickets',
          null,
          <Select value={String(keepDoneDays)} onValueChange={(v) => setKeepDoneDays(Number(v))}>
            <SelectTrigger aria-label="Keep done tickets" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KEEP_DONE_DAYS.map((d) => (
                <SelectItem key={d} value={String(d)}>
                  {plural(d, 'day')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {row(
          'Token cap',
          null,
          <div className="flex items-center gap-3">
            <Select value={String(tokenCap)} onValueChange={(v) => setTokenCap(Number(v))}>
              <SelectTrigger
                aria-label="Token cap"
                aria-describedby="token-cap-help"
                className="w-32 shrink-0"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[0, ...TOKEN_CAPS].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n ? `${compact(n)} tokens` : 'Off'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span id="token-cap-help" className="text-xs text-fg-2">
              Stops a session from running tools once it has used this many tokens, until you raise
              its cap.
            </span>
          </div>
        )}
        {row(
          'Readiness check',
          null,
          <div className="flex items-start gap-3">
            <Switch
              aria-label="Readiness check"
              aria-describedby="ready-check-help"
              checked={readyCheck}
              onCheckedChange={setReadyCheck}
            />
            <span id="ready-check-help" className="text-xs text-fg-2">
              At Start, Claude reads the ticket and says what it&apos;s missing, such as how
              you&apos;d tell it&apos;s done.
            </span>
          </div>
        )}
        {row(
          'Automatic review',
          null,
          <div className="flex items-start gap-3">
            <Switch
              aria-label="Automatic review"
              aria-describedby="auto-review-help"
              checked={autoReview}
              onCheckedChange={setAutoReview}
            />
            <span id="auto-review-help" className="text-xs text-fg-2">
              When Claude ends its turn with an open pull request, Claude reviews the changes,
              Sandtable sends the High proposals to the session, and the rest wait for you. Up to{' '}
              {AUTO_REVIEW_ROUNDS} rounds. You can turn it on or off for each session in its side
              panel.
            </span>
          </div>
        )}
        {row(
          'Sandbox commands',
          null,
          <div className="flex flex-col gap-2">
            <div className="flex items-start gap-3">
              <Switch
                aria-label="Sandbox commands"
                aria-describedby="sandbox-help"
                checked={sandbox}
                onCheckedChange={setSandbox}
              />
              <span id="sandbox-help" className="text-xs text-fg-2">
                Runs a session&apos;s Bash commands in Claude Code&apos;s sandbox: they write only
                the session&apos;s folders, can&apos;t read credential folders such as ~/.ssh,
                ~/.aws, or ~/.kube, or Sandtable&apos;s data, and reach only the allowed domains and
                the macOS trust service. SSH remotes, Docker, and tmux don&apos;t work there.
                Routines aren&apos;t sandboxed.
              </span>
            </div>
            {sandbox && (
              <>
                <Input
                  aria-label="Allowed domains"
                  aria-describedby="sandbox-domains-help"
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono"
                  placeholder="pypi.org, *.example.com"
                  value={domains}
                  onChange={(e) => setDomains(e.target.value)}
                />
                <span id="sandbox-domains-help" className="text-xs text-fg-2">
                  Added to{' '}
                  {new Intl.ListFormat('en').format(
                    sandboxDomains({
                      ...(source === 'linear' && linear.saved && { linear: linear.saved }),
                      ...(source === 'jira' && jira.saved && { jira: jira.saved })
                    })
                  )}
                  , which sessions always reach.
                </span>
              </>
            )}
          </div>
        )}
        {row(
          'Instructions',
          null,
          <InstructionsField
            value={instructions}
            onChange={setInstructions}
            projectId={project?.id}
          />
        )}
      </dl>
      {source === 'issues' && (
        <p className="mt-3 text-xs text-fg-2">
          Sandtable creates the <code className="font-mono">{IN_PROGRESS_LABEL.name}</code> label in
          a repo the first time it needs it there: when a session starts, or when you drag a card to
          In progress.
        </p>
      )}
      {project && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="sm" className="mt-6 text-danger">
              Delete project
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {project.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes the project from Sandtable. Its sessions keep running and its worktrees
                stay on disk; clean them up in Settings under Leftover sessions.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => void remove()}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </fieldset>
  )

  const ledes = [
    'Shown in the sidebar and the board header.',
    "A GitHub Projects board, the issues in the project's repos, a Linear team's issues, or a Jira project's issues.",
    source === 'board'
      ? "Include the board's repos you work on, then pick the local folder for each. Sessions start in these folders."
      : source === 'linear' || source === 'jira'
        ? `Add each GitHub repo, then pick its local folder. Sessions start in these folders. ${source === 'jira' ? 'Jira' : 'Linear'} doesn't know about repos, so Start asks which one when it can't tell from a repo:<name> label or the issue's last session.`
        : 'Add each GitHub repo, then pick its local folder. Sessions start in these folders.',
    'Check the project, then save.'
  ]

  return (
    <StepFlow
      title={project ? `Edit ${project.name}` : 'Add project'}
      steps={STEPS.map((title, i) => ({
        title,
        summary: summary(i),
        done: i !== step && i < 3 && i <= maxStep && !issue(i),
        open: reachable(i),
        reached: i <= maxStep
      }))}
      step={step}
      dir={dir}
      onGo={go}
      hint={hint}
      footer={
        <>
          {onCancel && (
            <Button variant="outline" size="lg" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button size="lg" disabled={!!hint || saving} onClick={advance}>
            {saving ? (
              <>
                <Spinner />
                Saving…
              </>
            ) : step === 3 ? (
              'Save'
            ) : (
              'Continue'
            )}
          </Button>
        </>
      }
    >
      <h2 className="text-lg/6 font-medium">{HEADINGS[step]}</h2>
      <p className="mt-1 mb-6 text-fg-2">{ledes[step]}</p>
      {[stepName, stepSource, stepRepos, stepReview][step]}
      {error && (
        <div className="mt-4">
          <Problem title={error} />
        </div>
      )}
    </StepFlow>
  )
}

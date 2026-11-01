import { Sparkles } from 'lucide-react'
import { ToggleGroup } from 'radix-ui'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { draftKey, drafts } from '@/lib/ticketDrafts'
import { cn, errorMessage } from '@/lib/utils'
import { CREATED, ticketLabel } from '../../../shared/repo'
import type { Project, Ticket } from '../../../shared/types'

/** A rounded `card` field that holds bare text boxes, as in New ticket and the chat composer. */
export const field =
  'flex flex-col gap-1.5 rounded-card bg-card p-3 ring-1 ring-line-2 highlight ring-inset focus-within:ring-ring'
/** A text area with no chrome of its own, for use inside a `field`. */
export const bare =
  'w-full resize-none bg-transparent outline-none [field-sizing:content] placeholder:text-fg-4'

/** The rise a composer enters with. */
export const enter =
  'animate-in duration-200 ease-(--ease-out-cubic) fade-in slide-in-from-bottom-1.5 motion-reduce:slide-in-from-bottom-0'

/** A card at the end of To do, or under a ticket's sub-issues with `parent`, that files an issue as typed or drafts it with Claude. */
export function NewTicketComposer({
  project,
  parent,
  onDrafted,
  onClose,
  onLockChange
}: {
  project: Project
  parent?: Pick<Ticket, 'key' | 'number'>
  onDrafted?: (sessionId: string) => void
  onClose: () => void
  onLockChange?: (locked: boolean) => void
}): React.JSX.Element {
  const { linear, jira } = project
  const key = draftKey(project.id, parent?.key)
  const [kept] = useState(() => drafts.get(key))
  const [title, setTitle] = useState(kept?.title ?? '')
  const [body, setBody] = useState(kept?.body ?? '')
  const [busy, setBusy] = useState<'create' | 'draft' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const mounted = useRef(true)
  const created = error?.startsWith(CREATED) ?? false
  const short = (github: string): string => github.split('/')[1]
  const label = (github: string): string =>
    project.repos.filter((r) => short(r.github) === short(github)).length > 1
      ? github
      : short(github)
  const choices = linear
    ? linear.projects.map((p) => ({ value: p.id, label: p.name }))
    : jira || parent
      ? []
      : project.repos.map((r) => ({ value: r.github, label: label(r.github) }))
  const [where, setWhere] = useState(
    choices.find((c) => c.value === kept?.where)?.value ?? choices[0]?.value ?? ''
  )
  const close = (): void => {
    drafts.delete(key)
    onClose()
  }

  useEffect(() => {
    if (title || body) drafts.set(key, { title, body, where })
    else drafts.delete(key)
  }, [key, title, body, where])

  useEffect(() => onLockChange?.(!!busy || created), [busy, created, onLockChange])

  useEffect(() => {
    const form = formRef.current
    if (!form) return
    const sizes = new ResizeObserver(() => form.scrollIntoView({ block: 'nearest' }))
    sizes.observe(form)
    return () => sizes.disconnect()
  }, [])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const run = async (draft: boolean): Promise<void> => {
    if (created || busy) return
    setBusy(draft ? 'draft' : 'create')
    setError(null)
    setStatus(null)
    try {
      if (draft) {
        const repo = linear || jira ? project.repos[0].github : where
        const id = await window.sandtable.sessions.create(project.id, repo, false, {
          title,
          body,
          ...(linear && { linearProject: where })
        })
        drafts.delete(key)
        if (mounted.current) onDrafted?.(id)
        return
      }
      setStatus(
        `Created ${await window.sandtable.tickets.create(project.id, where, title, body, parent?.key)}`
      )
      setTitle('')
      setBody('')
    } catch (err) {
      const message = errorMessage(err)
      setError(
        message.startsWith(CREATED) ? message : `Couldn't ${draft ? 'start' : 'create'}: ${message}`
      )
    }
    setBusy(null)
    titleRef.current?.focus()
  }

  return (
    <form
      ref={formRef}
      aria-label={parent ? 'Add sub-issue' : 'New ticket'}
      className={cn(field, enter)}
      onSubmit={(e) => {
        e.preventDefault()
        void run(false)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !busy && !e.nativeEvent.isComposing) close()
      }}
    >
      {parent && (
        <p className="text-xs text-fg-3">
          Sub-issue of <span className="font-mono">{ticketLabel(parent)}</span>
        </p>
      )}
      <input
        ref={titleRef}
        aria-label="Title"
        placeholder="Issue title"
        autoComplete="off"
        autoFocus
        readOnly={created}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="w-full bg-transparent py-0.5 text-fg outline-none placeholder:text-fg-4"
      />
      <textarea
        aria-label="Description"
        placeholder="Add a description…"
        rows={3}
        readOnly={created}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        className={cn(bare, 'max-h-60 py-0.5 text-fg-2')}
      />
      {choices.length > 1 && (
        <ToggleGroup.Root
          type="single"
          role="radiogroup"
          aria-label={linear ? 'Linear project' : 'Repo'}
          value={where}
          onValueChange={(g: string) => {
            if (!g) return
            setWhere(g)
            setError((e) => (e?.startsWith(CREATED) ? e : null))
          }}
          className="flex w-fit flex-wrap rounded-full p-0.5 ring-1 ring-line-2 ring-inset"
        >
          {choices.map((c) => (
            <ToggleGroup.Item
              key={c.value}
              value={c.value}
              className="highlight h-4.5 rounded-full px-2 text-xs text-fg-3 outline-none hover:text-fg-2 focus-ring data-[state=on]:bg-neutral-soft data-[state=on]:text-fg data-[state=on]:hover:text-fg"
            >
              {c.label}
            </ToggleGroup.Item>
          ))}
        </ToggleGroup.Root>
      )}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      <div role="status" className="contents">
        {status && <p className="text-xs text-fg-3">{status}</p>}
      </div>
      <div className="flex items-center gap-1.5">
        {created ? (
          <Button type="button" className="ml-auto" onClick={close}>
            Close
          </Button>
        ) : (
          <>
            {!parent && (
              <Button
                variant="outline"
                type="button"
                disabled={!!busy}
                onClick={() => void run(true)}
              >
                <Sparkles />
                {busy === 'draft' ? 'Starting' : 'Draft with Claude'}
              </Button>
            )}
            <span className="ml-auto text-xs text-fg-3">Esc to cancel</span>
            <Button type="submit" disabled={!!busy}>
              {busy === 'create' ? 'Creating' : 'Create'}
            </Button>
          </>
        )}
      </div>
    </form>
  )
}

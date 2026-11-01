import { TriangleAlert } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useFollowEnd } from '@/hooks/useFollowEnd'
import { useRun } from '@/hooks/useRun'
import { useStop } from '@/hooks/useStop'
import { sameRepo } from '../../../shared/repo'
import type { RoutineProposal, RoutineSource, Step } from '../../../shared/types'
import { Composer, FollowScroller, type Turn, Turns, Working } from './ChatParts'
import { Problem } from './StepFlow'
import { Message } from './TabContent'

/** The routine editor's chat with Claude, which fills the form from each reply's proposal. */
export function RoutineChat({
  projectId,
  form,
  copiedFrom,
  onRoutine,
  onPending,
  onStartOver
}: {
  projectId: string
  form: RoutineProposal
  copiedFrom?: RoutineSource
  onRoutine: (routine: RoutineProposal, sent: RoutineProposal) => string[]
  onPending: (pending: boolean) => void
  onStartOver: () => void
}): React.JSX.Element {
  const elsewhere = copiedFrom && !sameRepo(form.repo, copiedFrom.repo)
  const fit = elsewhere && form.repo ? fitMessage(form.repo) : ''
  const [turns, setTurns] = useState<Turn[]>([])
  const [conversationId, setConversationId] = useState<string>()
  const [text, setText] = useState(fit)
  const [filled, setFilled] = useState(fit)
  if (!turns.length && fit !== filled) {
    setFilled(fit)
    if (text === filled) setText(fit)
  }
  const { error, busy, pending, clear, run } = useRun()
  const [steps, setSteps] = useState<Step[]>([])
  const runId = useRef('')
  const { stop, unlessStopped } = useStop(() => window.sandtable.routines.stopChat(runId.current))
  if (!pending && steps.length) setSteps([])
  const apply = useRef(onRoutine)
  const refocus = useRef(false)
  const box = useRef<HTMLTextAreaElement>(null)
  const { ref: follower, follow, away } = useFollowEnd()
  const heading = useId()

  useEffect(() => {
    apply.current = onRoutine
  })

  useEffect(() => onPending(pending), [pending, onPending])

  useEffect(
    () =>
      window.sandtable.routines.onChatSteps((id, next) => {
        if (id === runId.current) setSteps(next)
      }),
    []
  )

  useEffect(() => {
    if (!refocus.current || pending) return
    refocus.current = false
    box.current?.focus()
  }, [pending])

  const send = (): void => {
    const message = text
    if (pending || !message.trim()) return
    refocus.current = true
    follow()
    runId.current = crypto.randomUUID()
    void run(async () => {
      const answer = await unlessStopped(
        window.sandtable.routines.chat({
          projectId,
          conversationId,
          repo: form.repo,
          message,
          form,
          ...(copiedFrom && { copiedFrom }),
          runId: runId.current
        })
      )
      if (!answer) return
      setConversationId(answer.conversationId)
      const notes = answer.routine ? apply.current(answer.routine, form) : []
      setTurns((t) => [
        ...t,
        { user: true, text: message },
        { user: false, text: answer.reply, notes }
      ])
      setText('')
    }, 'Claude is answering')
  }

  const startOver = (): void => {
    setTurns([])
    setConversationId(undefined)
    setText((t) => t || fit)
    clear()
    onStartOver()
    box.current?.focus()
  }

  return (
    <section
      aria-labelledby={heading}
      className="flex min-w-0 flex-1 flex-col rounded-r-card border-l bg-window"
    >
      <header className="flex h-10 shrink-0 items-center gap-2 pr-10 pl-4">
        <h2 id={heading} className="mr-auto font-medium">
          Build with Claude
        </h2>
        {turns.length > 0 && (
          <Button size="xs" variant="ghost" disabled={pending} onClick={startOver}>
            Start over
          </Button>
        )}
      </header>
      <FollowScroller
        follower={follower}
        away={away}
        onEnd={() => {
          follow()
          box.current?.focus()
        }}
        className="flex flex-col gap-4 p-4"
      >
        {turns.length ? (
          <Turns turns={turns} />
        ) : elsewhere ? (
          <WrittenFor source={copiedFrom} repo={form.repo} />
        ) : (
          <Message
            title="Describe the routine"
            text="Claude reads the repo's code, asks what it needs, and fills in the fields. Nothing is saved until you click Save."
          />
        )}
        {pending && <Working step={steps.at(-1)}>{busy}</Working>}
      </FollowScroller>
      <div className="flex flex-col gap-2 px-4 pb-4">
        {error && <Problem title={error} />}
        <Composer
          value={text}
          placeholder="Describe what the routine should do"
          disabled={pending}
          boxRef={box}
          onChange={setText}
          onSend={send}
          onStop={pending ? stop : undefined}
        />
      </div>
    </section>
  )
}

const fitMessage = (repo: string): string =>
  `Fit this routine to ${repo}: check its first message and allowed rules against this repo's code.`

function WrittenFor({ source, repo }: { source: RoutineSource; repo: string }): React.JSX.Element {
  return (
    <div
      role="note"
      className="m-auto flex max-w-85 gap-2 rounded-card bg-amber-soft p-4 text-fg-2"
    >
      <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0 text-amber" />
      <div>
        <p className="font-medium text-fg">Written for {source.project}</p>
        <p>
          Its commands and allowed rules come from <span className="font-mono">{source.repo}</span>{' '}
          and might not work in {repo ? <span className="font-mono">{repo}</span> : 'this project'}.{' '}
          {repo ? 'Send' : 'Pick a repo, then send'} the message to have Claude fit them.
        </p>
      </div>
    </div>
  )
}

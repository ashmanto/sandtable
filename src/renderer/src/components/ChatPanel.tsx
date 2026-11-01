import { PanelRightClose } from 'lucide-react'
import { memo, useCallback, useEffect, useEffectEvent, useId, useRef, useState } from 'react'
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
import { Tip } from './Tip'
import { useFollowEnd } from '@/hooks/useFollowEnd'
import { useRun } from '@/hooks/useRun'
import { useStop } from '@/hooks/useStop'
import { useComposerDraft } from '@/lib/composerDrafts'
import { cn, errorMessage } from '@/lib/utils'
import { chatDraft } from '../../../shared/drafts'
import type { Service } from '../../../shared/repo'
import type { Chat as Saved, ChatState, Step } from '../../../shared/types'
import { Composer, FollowScroller, Turns, Working } from './ChatParts'
import { Segmented } from './Segmented'
import { Problem } from './StepFlow'
import { LoadError, Loading, Message } from './TabContent'
import { bare, field } from './NewTicketComposer'
import { chip } from './TicketCard'

const SUGGESTIONS = [
  'Which files would this touch?',
  "What's unclear in this ticket?",
  'How would you split this into tasks?'
]

/** A ticket's chat with Claude beside Details, read once first shown and again on each change, and its comment draft in the same composer. */
export const ChatPanel = memo(function ChatPanel({
  projectId,
  ticketKey,
  service,
  active,
  hidden,
  onPosted,
  onHide,
  hideRef,
  ask,
  takeAsk
}: {
  projectId: string
  ticketKey: string
  service: Service
  active: boolean
  hidden: boolean
  onPosted: () => void
  onHide: () => void
  hideRef?: React.Ref<HTMLButtonElement>
  ask?: string | null
  takeAsk?: () => string | null
}): React.JSX.Element {
  const [shown, setShown] = useState(active)
  const [attempt, setAttempt] = useState(0)
  const [chat, setChat] = useState<Saved | null | undefined>(undefined)
  const [answering, setAnswering] = useState(false)
  const [summarizing, setSummarizing] = useState(false)
  const [failed, setFailed] = useState<string | undefined>(undefined)
  const [loadError, setLoadError] = useState<string | null>(null)
  const { text, setText } = useComposerDraft(chatDraft(projectId, ticketKey))
  const [draft, setDraft] = useState<string | null>(null)
  const [mode, setMode] = useState<'chat' | 'comment'>('chat')
  const [saveError, setSaveError] = useState<string | null>(null)
  const savedDraft = useRef<string | undefined>(undefined)
  const typed = useRef<string | null>(null)
  const saving = useRef<Promise<void>>(Promise.resolve())
  const refocus = useRef(false)
  const box = useRef<HTMLTextAreaElement>(null)
  const { ref: follower, follow, away } = useFollowEnd()
  const draftBox = useRef<HTMLTextAreaElement>(null)
  const draftId = useId()
  const { error, result, pending, busy, run } = useRun()
  const [steps, setSteps] = useState<Step[]>([])
  if (active && !shown) setShown(true)
  const { tickets } = window.sandtable
  const { stop, unlessStopped } = useStop(() => tickets.stopChat(projectId, ticketKey))

  const apply = useCallback((loaded: ChatState): void => {
    setChat(loaded.chat)
    setAnswering(loaded.answering)
    setSummarizing(!!loaded.summarizing)
    setFailed(loaded.failed)
    if (loaded.chat?.draft === savedDraft.current) return
    savedDraft.current = loaded.chat?.draft
    setDraft(loaded.chat?.draft ?? null)
    if (loaded.chat?.draft?.trim() && document.activeElement !== box.current) setMode('comment')
  }, [])

  useEffect(() => {
    if (!shown) return
    let current = true
    window.sandtable.tickets.chat(projectId, ticketKey).then(
      (c) => current && apply(c),
      (err) => current && setLoadError(errorMessage(err))
    )
    return () => {
      current = false
    }
  }, [projectId, ticketKey, shown, attempt, apply])

  useEffect(() => {
    if (!shown) return
    return window.sandtable.board.onChange((id) => {
      if (id === projectId) setAttempt((n) => n + 1)
    })
  }, [projectId, shown])

  const keep = useCallback(
    (text: string | null): void => {
      if (text === null || text === savedDraft.current) return
      if (!text.trim() && savedDraft.current === undefined) return
      const before = savedDraft.current
      const empty = !text.trim()
      savedDraft.current = empty ? undefined : text
      saving.current = (
        empty
          ? window.sandtable.tickets.discardDraft(projectId, ticketKey)
          : window.sandtable.tickets.saveDraft(projectId, ticketKey, text)
      ).then(
        () => setSaveError(null),
        (err: unknown) => {
          if (savedDraft.current === (empty ? undefined : text)) savedDraft.current = before
          setSaveError(errorMessage(err))
        }
      )
    },
    [projectId, ticketKey]
  )

  useEffect(() => {
    typed.current = draft
  }, [draft])

  useEffect(() => () => keep(typed.current), [keep])

  const drafting = draft !== null
  useEffect(() => {
    if (!refocus.current || pending || answering) return
    ;(mode === 'comment' ? draftBox : box).current?.focus()
    refocus.current = false
  }, [pending, answering, drafting, mode])

  const waiting = pending || answering
  const stoppable = pending ? !!busy?.startsWith('Claude') : answering && !summarizing

  useEffect(
    () =>
      window.sandtable.tickets.onChatSteps((p, k, next) => {
        if (p === projectId && k === ticketKey) setSteps(next)
      }),
    [projectId, ticketKey]
  )
  if (!waiting && steps.length) setSteps([])

  const send = (message = text): void => {
    if (waiting || !message.trim()) return
    follow()
    void run(async () => {
      const next = await unlessStopped(tickets.sendChat(projectId, ticketKey, message))
      if (!next) return
      setChat(next)
      setText((t) => (t === message ? '' : t))
      refocus.current = true
    }, 'Claude is answering')
  }
  const sendAsk = useEffectEvent((): void => {
    const message = takeAsk?.()
    if (!message) return
    setText(message)
    send(message)
  })
  useEffect(() => {
    if (ask && active && chat !== undefined && !waiting) sendAsk()
  }, [ask, active, chat, waiting])
  const draftComment = (): Promise<boolean> =>
    run(async () => {
      const next = await unlessStopped(tickets.draftComment(projectId, ticketKey))
      if (next === undefined) return
      setDraft(next)
      apply(await tickets.chat(projectId, ticketKey))
      refocus.current = true
    }, 'Claude is drafting a comment')
  const rewrite = (mine: string): Promise<boolean> =>
    run(async () => {
      await saving.current
      const next = await unlessStopped(tickets.draftComment(projectId, ticketKey, mine))
      if (next === undefined) return
      setDraft(next)
      apply(await tickets.chat(projectId, ticketKey))
      refocus.current = true
    }, 'Claude is rewriting the comment')
  const switchTo = (next: 'chat' | 'comment'): void => {
    if (next === 'chat') keep(draft)
    else setDraft((d) => d ?? '')
    refocus.current = true
    setMode(next)
  }
  const post = (body: string): Promise<boolean> =>
    run(async () => {
      await saving.current
      await tickets.postComment(projectId, ticketKey, body)
      savedDraft.current = undefined
      setDraft(null)
      setMode('chat')
      refocus.current = true
      onPosted()
      return { text: 'Comment posted', danger: false }
    }, 'Posting comment')
  const discard = (): Promise<boolean> =>
    run(async () => {
      await saving.current
      await tickets.discardDraft(projectId, ticketKey)
      savedDraft.current = undefined
      setDraft(null)
      setMode('chat')
      refocus.current = true
    })
  const startOver = (): Promise<boolean> =>
    run(async () => {
      await tickets.clearChat(projectId, ticketKey)
      savedDraft.current = undefined
      setChat(null)
      setDraft(null)
      setMode('chat')
      setFailed(undefined)
    }, 'Starting over')

  const onStop = (): void => {
    refocus.current = true
    stop()
  }

  const startOverDialog = (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="xs" variant="ghost" disabled={waiting}>
          Start over
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Start over?</AlertDialogTitle>
          <AlertDialogDescription>
            This deletes the chat with Claude about this ticket. Comments you posted stay on{' '}
            {service}.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => void startOver()}>
            Start over
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  const body = loadError ? (
    <LoadError
      className="m-4"
      text={`Couldn't load the chat: ${loadError}`}
      onRetry={() => {
        setLoadError(null)
        setAttempt((n) => n + 1)
      }}
    />
  ) : chat === undefined ? (
    <Loading label="Loading chat" className="p-4" />
  ) : (
    <>
      <FollowScroller
        follower={follower}
        away={away}
        onEnd={() => {
          follow()
          ;(mode === 'comment' ? draftBox : box).current?.focus()
        }}
        className="flex flex-col gap-4 p-4"
      >
        {chat?.messages.length ? (
          <Turns turns={chat.messages.map((m) => ({ user: m.role === 'user', text: m.text }))} />
        ) : (
          <Message
            title="Ask Claude about this ticket"
            text="Claude reads the ticket and the repo's code, and can't change anything."
          >
            <div className="mt-2 flex flex-wrap justify-center gap-1.5">
              {SUGGESTIONS.map((s) => (
                <Button
                  key={s}
                  size="xs"
                  variant="outline"
                  disabled={waiting}
                  onClick={() => send(s)}
                >
                  {s}
                </Button>
              ))}
            </div>
          </Message>
        )}
        {(busy || (answering && !pending)) && (
          <Working step={steps.at(-1)}>
            {busy || (summarizing ? 'Claude is summarizing the session' : 'Claude is answering')}
          </Working>
        )}
      </FollowScroller>
      <div className="flex flex-col gap-2 px-4 pb-4">
        {result && (
          <p role="status" className="text-xs text-fg-2">
            {result}
          </p>
        )}
        {error && <Problem title={error} />}
        {drafting && saveError && <Problem title={`Couldn't save the draft: ${saveError}`} />}
        {failed && <Problem title={`Couldn't draft the session summary: ${failed}`} />}
        <Segmented
          aria-label="Write to"
          className="self-start"
          value={mode}
          onChange={switchTo}
          options={[
            ['chat', 'Ask Claude'],
            [
              'comment',
              mode === 'chat' && draft?.trim() ? 'Comment •' : 'Comment',
              mode === 'chat' && draft?.trim() ? 'Comment, has a draft' : 'Comment'
            ]
          ]}
        />
        {mode === 'chat' ? (
          <Composer
            value={text}
            placeholder="Ask about this ticket"
            disabled={waiting}
            boxRef={box}
            onChange={setText}
            onSend={() => send()}
            onStop={stoppable ? onStop : undefined}
          />
        ) : (
          <div className={cn(field, 'pb-2')}>
            <label htmlFor={draftId} className="flex items-center gap-2 text-xs text-fg-3">
              {chat?.summary && (
                <>
                  <span className={chip}>Session summary</span>{' '}
                </>
              )}
              Reply on {service} as you
            </label>
            <textarea
              ref={draftBox}
              id={draftId}
              rows={6}
              placeholder="Write a comment"
              className={cn(
                bare,
                'max-h-60 min-h-24 text-fg disabled:cursor-not-allowed disabled:opacity-50'
              )}
              value={draft ?? ''}
              disabled={waiting}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => keep(draft)}
            />
            <div className="flex items-center gap-2">
              <Button
                size="xs"
                variant="outline"
                disabled={waiting || !(draft?.trim() || chat?.messages.length)}
                onClick={() => void (draft?.trim() ? rewrite(draft) : draftComment())}
              >
                {draft?.trim() ? 'Rewrite with Claude' : 'Draft with Claude'}
              </Button>
              <Button
                size="xs"
                variant="ghost"
                className="ml-auto"
                disabled={waiting}
                onClick={() => void discard()}
              >
                Discard
              </Button>
              {stoppable ? (
                <Button size="sm" onClick={(e) => e.detail < 2 && onStop()}>
                  Stop
                </Button>
              ) : (
                <Button
                  size="sm"
                  disabled={waiting || !draft?.trim()}
                  onClick={() => draft && void post(draft)}
                >
                  Post comment
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  )

  return (
    <aside
      aria-label="Chat"
      hidden={hidden}
      className="flex w-95 max-w-1/2 shrink-0 flex-col border-l bg-window"
    >
      <header className="flex h-10 shrink-0 items-center gap-2 pr-2 pl-4">
        <h2 className="mr-auto font-medium">Chat</h2>
        {chat && startOverDialog}
        <Tip label="Hide chat">
          <Button ref={hideRef} size="icon-xs" variant="ghost" onClick={onHide}>
            <PanelRightClose />
          </Button>
        </Tip>
      </header>
      {body}
    </aside>
  )
})

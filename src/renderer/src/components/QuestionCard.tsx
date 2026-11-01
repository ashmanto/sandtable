import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useRun } from '@/hooks/useRun'
import { cn } from '@/lib/utils'
import {
  asksForText,
  takesNote,
  takesOther,
  type PromptAnswer,
  type Question,
  type QuestionAnswer,
  type SessionPrompt
} from '../../../shared/prompt'
import { SessionBadge } from './SessionBadge'
import { Spinner } from './StepFlow'
import { Md } from './TabContent'

const TITLE: Record<SessionPrompt['kind'], string> = {
  questions: 'Claude is asking you something',
  permission: 'Claude needs your permission',
  plan: 'Claude is waiting for you to approve a plan'
}

const rowClass =
  'highlight flex w-full items-start gap-2.5 rounded-sm px-2 py-1.5 text-left hover:bg-surface-3 focus-ring'

function Choice({
  n,
  label,
  description,
  current,
  ...props
}: {
  n: number
  label: string
  description?: string
  current?: boolean
} & React.ComponentProps<'button'>): React.JSX.Element {
  const id = useId()
  return (
    <li>
      <button
        aria-label={label}
        aria-describedby={description ? id : undefined}
        className={cn(rowClass, current && 'bg-surface-3')}
        {...props}
      >
        <span aria-hidden className="w-3 shrink-0 text-fg-3 tabular-nums">
          {n}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="break-words">{label}</span>
          {description && (
            <span id={id} className="text-xs text-fg-3">
              {description}
            </span>
          )}
        </span>
      </button>
    </li>
  )
}

function TextAndSend({
  label,
  value,
  onChange,
  onSend,
  send,
  placeholder = label,
  multiline = false
}: {
  label: string
  placeholder?: string
  value: string
  onChange: (v: string) => void
  onSend: () => void
  send: string
  multiline?: boolean
}): React.JSX.Element {
  const Field = multiline ? Textarea : Input
  return (
    <div className="flex flex-col gap-2">
      <Field
        autoFocus
        aria-label={label}
        placeholder={placeholder}
        value={value}
        rows={multiline ? 3 : undefined}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && value.trim()) {
            e.preventDefault()
            onSend()
          }
        }}
      />
      <div className="flex justify-end">
        <Button size="sm" disabled={!value.trim()} onClick={onSend}>
          {send}
        </Button>
      </div>
    </div>
  )
}

function QuestionStep({
  q,
  answer,
  last,
  onAnswer
}: {
  q: Question
  answer: QuestionAnswer
  last: boolean
  onAnswer: (a: QuestionAnswer, next: boolean) => void
}): React.JSX.Element {
  const [focus, setFocus] = useState(answer.picked[0] ?? 0)
  const [noting, setNoting] = useState(false)
  const [otherOpen, setOtherOpen] = useState(!!answer.other)
  const next = last ? 'Send' : 'Next'
  const other = answer.other ?? ''

  if (q.multiSelect) {
    const toggle = (i: number, on: boolean): void =>
      onAnswer(
        { ...answer, picked: on ? [...answer.picked, i] : answer.picked.filter((p) => p !== i) },
        false
      )
    return (
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-medium">
          {q.question} <span className="font-normal text-fg-3">Choose any.</span>
        </legend>
        <ul className="flex flex-col">
          {q.options.map((o, i) => (
            <li key={i}>
              <label className={rowClass}>
                <Checkbox
                  className="mt-0.5"
                  checked={answer.picked.includes(i)}
                  onCheckedChange={(on) => toggle(i, on === true)}
                />
                <span className="flex min-w-0 flex-col">
                  <span className="break-words">{o.label}</span>
                  <span className="text-xs text-fg-3">{o.description}</span>
                </span>
              </label>
            </li>
          ))}
          <li>
            <label className={rowClass}>
              <Checkbox
                className="mt-0.5"
                checked={otherOpen}
                onCheckedChange={(on) => {
                  setOtherOpen(on === true)
                  if (on !== true) onAnswer({ ...answer, other: '' }, false)
                }}
              />
              <span className="flex flex-col">
                <span>Other</span>
                <span className="text-xs text-fg-3">Type your own answer.</span>
              </span>
            </label>
          </li>
        </ul>
        {otherOpen && (
          <Input
            autoFocus
            aria-label="Other answer"
            placeholder="Your answer"
            value={other}
            onChange={(e) => onAnswer({ ...answer, other: e.target.value }, false)}
          />
        )}
        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={!answer.picked.length && !other.trim()}
            onClick={() => onAnswer(answer, true)}
          >
            {next}
          </Button>
        </div>
      </fieldset>
    )
  }

  const focused = q.options[focus]
  const list = (
    <ul className="flex min-w-0 flex-col">
      {q.options.map((o, i) => (
        <Choice
          key={i}
          n={i + 1}
          label={o.label}
          description={o.description}
          current={takesNote(q) && focus === i}
          onFocus={() => !noting && setFocus(i)}
          onMouseEnter={() => !noting && setFocus(i)}
          onClick={() =>
            onAnswer(
              { picked: [i], ...(focus === i && answer.note && { note: answer.note }) },
              true
            )
          }
        />
      ))}
      {takesOther(q) && (
        <Choice
          n={q.options.length + 1}
          label="Other"
          description="Type your own answer."
          aria-expanded={otherOpen}
          onClick={() => setOtherOpen((o) => !o)}
        />
      )}
    </ul>
  )
  return (
    <div className="flex flex-col gap-2">
      <p className="font-medium">{q.question}</p>
      {takesNote(q) ? (
        <div className="grid grid-cols-2 items-start gap-3">
          {list}
          <div className="flex min-w-0 flex-col gap-1.5">
            <pre
              role="region"
              aria-label={`Preview of ${focused.label}`}
              className="overflow-x-auto rounded-sm bg-neutral-soft px-3 py-2 font-mono text-xs whitespace-pre"
            >
              {focused.preview ?? ''}
            </pre>
            {noting ? (
              <TextAndSend
                label={`Note on ${focused.label}`}
                value={answer.note ?? ''}
                onChange={(note) => onAnswer({ picked: [focus], note }, false)}
                onSend={() => onAnswer({ picked: [focus], note: answer.note }, true)}
                send={`Pick ${focused.label}`}
              />
            ) : (
              <div>
                <Button size="sm" variant="ghost" onClick={() => setNoting(true)}>
                  Add a note on {focused.label}
                </Button>
              </div>
            )}
          </div>
        </div>
      ) : (
        list
      )}
      {otherOpen && (
        <TextAndSend
          label="Other answer"
          placeholder="Your answer"
          value={other}
          onChange={(v) => onAnswer({ picked: [], other: v }, false)}
          onSend={() => onAnswer({ picked: [], other }, true)}
          send={next}
        />
      )}
    </div>
  )
}

function Questions({
  questions,
  onSend
}: {
  questions: Question[]
  onSend: (a: PromptAnswer) => void
}): React.JSX.Element {
  const [step, setStep] = useState(0)
  const [moved, setMoved] = useState(false)
  const stepBox = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (moved) stepBox.current?.focus()
  }, [step, moved])
  const go = (i: number): void => {
    setStep(i)
    setMoved(true)
  }
  const [answers, setAnswers] = useState<QuestionAnswer[]>(questions.map(() => ({ picked: [] })))
  const many = questions.length > 1
  const done = (a: QuestionAnswer): boolean => a.picked.length > 0 || !!a.other?.trim()
  const shown = (q: Question, a: QuestionAnswer): string =>
    [
      ...a.picked.map(
        (i) => q.options[i].label + (a.note?.trim() ? ` (note: ${a.note.trim()})` : '')
      ),
      ...(a.other?.trim() ? [a.other.trim()] : [])
    ].join(', ')
  const submit = (list: QuestionAnswer[]): void => onSend({ kind: 'questions', answers: list })
  return (
    <>
      {many && (
        <div role="group" aria-label="Questions" className="flex flex-wrap gap-1">
          {[...questions.map((q) => q.header), 'Submit'].map((h, i) => (
            <Button
              key={i}
              size="sm"
              variant={step === i ? 'outline' : 'ghost'}
              aria-current={step === i ? 'step' : undefined}
              disabled={i === questions.length && !answers.every(done)}
              onClick={() => go(i)}
            >
              {i < questions.length && done(answers[i]) && (
                <span className="sr-only">Answered: </span>
              )}
              {h}
            </Button>
          ))}
        </div>
      )}
      <div ref={stepBox} tabIndex={-1} className="outline-none">
        {step < questions.length ? (
          <QuestionStep
            key={step}
            q={questions[step]}
            answer={answers[step]}
            last={!many}
            onAnswer={(a, next) => {
              const list = answers.map((x, i) => (i === step ? a : x))
              setAnswers(list)
              if (!next) return
              const open = list.findIndex((x) => !done(x))
              if (many) go(open === -1 ? questions.length : open)
              else submit(list)
            }}
          />
        ) : (
          <div className="flex flex-col gap-2">
            <p className="font-medium">Review your answers</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              {questions.map((q, i) => (
                <div key={i} className="contents">
                  <dt className="text-fg-3">{q.header}</dt>
                  <dd>{shown(q, answers[i])}</dd>
                </div>
              ))}
            </dl>
            <div className="flex justify-end">
              <Button size="sm" onClick={() => submit(answers)}>
                Submit answers
              </Button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

function Choices({
  choices,
  onSend
}: {
  choices: string[]
  onSend: (a: PromptAnswer) => void
}): React.JSX.Element {
  const [typing, setTyping] = useState<number | null>(null)
  const [text, setText] = useState('')
  return (
    <>
      <ul className="flex flex-col">
        {choices.map((label, i) => (
          <Choice
            key={i}
            n={i + 1}
            label={label}
            aria-expanded={asksForText(label) ? typing === i : undefined}
            onClick={() =>
              asksForText(label)
                ? setTyping((t) => (t === i ? null : i))
                : onSend({ kind: 'choice', choice: i + 1, label })
            }
          />
        ))}
      </ul>
      {typing !== null && (
        <TextAndSend
          multiline
          label="Tell Claude what to change"
          value={text}
          onChange={setText}
          onSend={() =>
            onSend({ kind: 'choice', choice: typing + 1, label: choices[typing], text })
          }
          send="Send changes"
        />
      )}
    </>
  )
}

/** Claude's question, permission prompt, or plan approval, answered from the conversation by typing the keys the terminal takes. */
export function QuestionCard({
  sessionId,
  prompt,
  onTerminal,
  onAnswered
}: {
  sessionId: string
  prompt: SessionPrompt
  onTerminal: () => void
  onAnswered: () => void
}): React.JSX.Element {
  const { error, pending, run } = useRun()
  const [sent, setSent] = useState(false)
  const sending = pending || sent
  const send = (answer: PromptAnswer): void =>
    void run(() => window.sandtable.sessions.answer(sessionId, prompt, answer)).then((ok) => {
      setSent(ok)
      if (ok && prompt.kind === 'permission' && prompt.agent) onAnswered()
    })
  const box = useRef<HTMLElement>(null)
  useEffect(() => {
    const at = document.activeElement
    if (!at || at === document.body || (at as HTMLTextAreaElement).disabled) box.current?.focus()
  }, [])
  return (
    <section
      ref={box}
      tabIndex={-1}
      aria-label={TITLE[prompt.kind]}
      className="flex flex-col gap-2.5 rounded-card bg-card p-3 ring-1 ring-line outline-none ring-inset"
    >
      <div className="flex items-center gap-2">
        <SessionBadge state="needsYou" />
        <span className="min-w-0 flex-1 truncate font-medium">{TITLE[prompt.kind]}</span>
        <Button size="sm" variant="ghost" onClick={onTerminal}>
          Open in terminal
        </Button>
      </div>
      <div inert={sending} className="flex flex-col gap-2.5">
        {prompt.kind === 'questions' ? (
          <Questions questions={prompt.questions} onSend={send} />
        ) : prompt.kind === 'permission' ? (
          <>
            <p className="font-mono text-xs text-fg-3">
              {prompt.tool}
              {prompt.agent && ` · from the ${prompt.agent} agent`}
            </p>
            <pre className="max-h-60 overflow-auto rounded-sm bg-neutral-soft px-3 py-2 font-mono text-xs break-words whitespace-pre-wrap">
              {prompt.input}
            </pre>
            <p className="text-fg-2">Do you want to proceed?</p>
            <Choices choices={prompt.choices} onSend={send} />
          </>
        ) : (
          <>
            {prompt.plan && (
              <div
                role="region"
                tabIndex={0}
                aria-label="Claude's plan"
                className="max-h-96 overflow-y-auto rounded-sm px-1 focus-ring"
              >
                <Md>{prompt.plan}</Md>
              </div>
            )}
            <p className="text-fg-2">Would you like to proceed?</p>
            <Choices choices={prompt.choices} onSend={send} />
          </>
        )}
        {prompt.kind === 'questions' && (
          <div>
            <Button size="sm" variant="ghost" onClick={() => send({ kind: 'chat' })}>
              Chat about this
            </Button>
          </div>
        )}
      </div>
      <p role="status" className="flex items-center gap-1.5 text-xs text-fg-3 empty:hidden">
        {pending ? (
          <>
            <Spinner />
            Sending…
          </>
        ) : (
          sent && 'Sent'
        )}
      </p>
      {error && (
        <p role="alert" className="rounded-sm bg-danger-soft px-2 py-1 text-xs text-danger">
          {error}
        </p>
      )}
    </section>
  )
}

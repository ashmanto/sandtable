import { existsSync } from 'node:fs'
import { parseJson } from '../../shared/json'
import type { Service } from '../../shared/repo'
import type { Step, Ticket, TicketDetails } from '../../shared/types'
import { stepsOf } from './activity'
import {
  fitBytes,
  ISSUE_TEXT_RULE,
  NO_SECRETS_RULE,
  oneLine,
  openingPrompt,
  parseAnswer,
  printArgs,
  READ_ONLY_ARGS,
  visibleText,
  withoutUnsafe
} from './claudeLaunch'

const MAX_COMMENT_BYTES = 50_000

/** The most a chat message you type may hold, in bytes. */
export const MAX_CHAT_MESSAGE_BYTES = 100_000

/** The system prompt for every chat turn. */
export const CHAT_RULES = [ISSUE_TEXT_RULE, NO_SECRETS_RULE].join('\n')

/** The read-only `claude -p` arguments that stream each step as a JSON line. */
export const STREAM_ARGS = [
  ...READ_ONLY_ARGS.map((a) => (a === 'json' ? 'stream-json' : a)),
  '--verbose'
]

/** The `claude` arguments for one read-only chat turn, starting or resuming the conversation, streaming its steps as JSON lines, with a JSON answer when `schema` is given. */
export const chatArgs = (opts: {
  prompt: string
  conversationId: string
  resume: boolean
  name: string
  rules: string
  schema?: object
}): string[] =>
  printArgs(
    STREAM_ARGS,
    [
      opts.resume ? '--resume' : '--session-id',
      opts.conversationId,
      '-n',
      opts.name,
      ...(opts.schema ? ['--json-schema', JSON.stringify(opts.schema)] : [])
    ],
    opts.rules,
    opts.prompt
  )

/** Runs one chat turn under the busy check, with an abort stopper, and clears both and the recorded run afterwards. */
export async function chatRun<T>(
  guard: {
    answering: Set<string>
    busyKey: string
    stoppers: Map<string, AbortController>
    stopKey: string
    runsInFlight: Set<string>
  },
  turn: (signal: AbortSignal, recorded: (runId: string) => void) => Promise<T>
): Promise<T> {
  const { answering, busyKey, stoppers, stopKey, runsInFlight } = guard
  if (answering.has(busyKey)) throw new Error('Claude is still answering')
  const stop = new AbortController()
  let run: string | undefined
  answering.add(busyKey)
  stoppers.set(stopKey, stop)
  try {
    return await turn(stop.signal, (id) => (run = id))
  } finally {
    if (run) runsInFlight.delete(run)
    answering.delete(busyKey)
    stoppers.delete(stopKey)
  }
}

/** Records a one-shot claude run against a ticket, then runs it and returns its output. */
export type PrintRun = (
  projectId: string,
  ticketKey: string,
  label: string,
  cwd: string,
  argsFor: (runId: string) => string[],
  timeoutMs?: number
) => Promise<string>

/** Runs one `claude -p` in `cwd` as the account in `dir` and returns its output. */
export type PrintClaude = (
  label: string,
  slow: string,
  cwd: string,
  args: string[],
  dir: string | undefined,
  live?: { signal?: AbortSignal; onStdout?: (chunk: string) => void }
) => Promise<string>

/** What a running chat turn listens to: the signal that stops it and where its steps so far go. */
type ChatLive = { signal: AbortSignal; onSteps: (steps: Step[]) => void }

const isResult = (line: string): boolean =>
  (parseJson(line) as { type?: unknown } | undefined)?.type === 'result'

const stepReader = (cwd: string, onSteps: ChatLive['onSteps']): ((chunk: string) => void) => {
  const steps: Step[] = []
  let rest = ''
  return (chunk) => {
    const lines = (rest + chunk).split('\n')
    rest = lines.pop() ?? ''
    const added = lines.flatMap((line) => stepsOf(parseJson(line), cwd))
    if (!added.length) return
    steps.push(...added)
    onSteps([...steps])
  }
}

/** Runs one chat turn and returns its result row, passing its steps to `live`, and asks for Start over when a resumed chat's folder or conversation is gone. */
export async function printChat(
  print: PrintClaude,
  label: string,
  place: { cwd: string; claudeDir: string | undefined },
  args: string[],
  resume: boolean,
  live?: ChatLive
): Promise<string> {
  if (resume && !existsSync(place.cwd))
    throw new Error("This chat's repo folder is gone. Use Start over.")
  try {
    const stdout = await print(
      label,
      "Claude didn't answer within 3 minutes",
      place.cwd,
      args,
      place.claudeDir,
      live && { signal: live.signal, onStdout: stepReader(place.cwd, live.onSteps) }
    )
    const row = stdout.split('\n').findLast(isResult) ?? ''
    if (row) parseAnswer(row, label)
    return row
  } catch (err) {
    if (resume && /No conversation found/.test(String(err)))
      throw new Error("Claude Code no longer has this chat's conversation. Use Start over.", {
        cause: err
      })
    throw err
  }
}

/** The text with no opening or closing tag of these names left, even one that removing another rebuilt. */
export function withoutTags(s: string, names: string): string {
  const tag = new RegExp(`<\\s*(?:\\/\\s*(?:${names})\\b[^<>\\n]*|(?:${names}))\\s*>`, 'gi')
  let prev
  do {
    prev = s
    s = s.replace(tag, '')
  } while (s !== prev)
  return s
}

/** The text without the tags Sandtable wraps issue text and transcripts in. */
export const untagged = (s: string): string => withoutTags(s, 'issue|comments|transcript')

function commentBlock(ticket: Ticket, comments: TicketDetails['comments']): string {
  if (!comments.length) return 'No comments'
  const kept: string[] = []
  let bytes = 0
  for (const c of [...comments].reverse()) {
    const text = `${oneLine(c.author)} on ${c.createdAt}:\n${visibleText(c.body)}`
    bytes += Buffer.byteLength(text) + 2
    if (bytes > MAX_COMMENT_BYTES) {
      if (!kept.length)
        kept.push(
          `${fitBytes(text, MAX_COMMENT_BYTES)}\n\n[Comment truncated. Read it at ${ticket.url}]`
        )
      break
    }
    kept.unshift(text)
  }
  if (kept.length < comments.length)
    kept.unshift(`[Earlier comments left out. Read them at ${ticket.url}]`)
  return kept.join('\n\n')
}

/** The first chat message: the ticket and its newest comments in tags, then the person's question. */
export function chatPrompt(
  ticket: Ticket,
  comments: TicketDetails['comments'],
  message: string,
  service: Service
): string {
  return [
    "I want to talk about the issue below. Read the code in the current folder if it helps you answer. Don't change any files.",
    '',
    '<issue>',
    untagged(openingPrompt(ticket, service)),
    '</issue>',
    '',
    '<comments>',
    untagged(commentBlock(ticket, comments)),
    '</comments>',
    '',
    'My question:',
    withoutUnsafe(message)
  ].join('\n')
}

/** The turn that asks Claude to sum up the chat as a comment for the issue. */
export const DRAFT_PROMPT =
  "Sum up this conversation's conclusion as a comment in Markdown, written for the issue's readers. Leave out any preamble, and reply with only the comment text."

/** The turn that asks Claude to rewrite your draft comment for the issue. */
export const rewritePrompt = (draft: string): string =>
  [
    "Rewrite my draft comment below for the issue's readers, using the issue and this conversation. Keep what I meant, write it in Markdown, leave out any preamble, and reply with only the comment text.",
    '',
    '<draft>',
    withoutTags(withoutUnsafe(draft), 'draft'),
    '</draft>'
  ].join('\n')

/** Reads `claude -p` JSON output or a `stream-json` result row into the answer. */
export const parseChat = (stdout: string): string =>
  parseAnswer<object>(stdout, 'Chat').result ?? ''

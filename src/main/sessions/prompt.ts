import { stripVTControlCharacters } from 'node:util'
import { parseJson } from '../../shared/json'
import {
  asksForText,
  takesNote,
  takesOther,
  type PromptAnswer,
  type Question,
  type SessionPrompt
} from '../../shared/prompt'
import type { ConversationEntry } from '../../shared/types'
import { oneLine } from './claudeLaunch'
import { blocks, isRow, summaryOf, waitingTool } from './conversation'
import type { AgentRequest } from './hookEvents'

/** A tmux key name, or text typed as it is. */
export type Key = string | { text: string }

const CHOICE = /^(\s*(?:❯\s+)?)(\d+)\.\s+(.*?)\s*$/
const HINT = /^(shift\+tab|ctrl\+|esc\b|enter\b|tab\b)/i
const RULE = /^\s*─{3,}/
const FIRST_FOCUSED = /^\s*❯ 1\./
const FROM_AGENT = / · from the (\S+) agent(?:\s|$)/
// The terminal wraps long words mid-word, so wrapped lines can't be joined with a space.
const bare = (text: string): string => text.replace(/\s+/g, '')

/** The last numbered list of choices on a terminal screen, with wrapped lines joined, and the 1-based choice the cursor is on; null when there's none. */
export function choicesOf(pane: string): { choices: string[]; focused: number } | null {
  let run: { choices: string[]; focused: number } | null = null
  let last: { choices: string[]; focused: number } | null = null
  let column = 0
  for (const line of pane.split('\n')) {
    const m = CHOICE.exec(line)
    const n = m ? Number(m[2]) : 0
    if (m && (n === 1 || (run && n === run.choices.length + 1))) {
      if (n === 1) last = run = { choices: [], focused: 0 }
      run!.choices.push(m[3])
      if (m[1].includes('❯')) run!.focused = n
      column = m[1].length + m[2].length + 2
      continue
    }
    const text = line.trim()
    if (run && text && !HINT.test(text) && line.length - line.trimStart().length >= column)
      run.choices[run.choices.length - 1] += ` ${text}`
    else run = null
  }
  return last && last.focused ? last : null
}

const questionsOf = (input: unknown): Question[] | null => {
  const questions = blocks(isRow(input) ? input.questions : null).map((q) => ({
    question: typeof q.question === 'string' ? q.question : '',
    header: typeof q.header === 'string' ? q.header : '',
    multiSelect: q.multiSelect === true,
    options: blocks(q.options).map((o) => ({
      label: typeof o.label === 'string' ? o.label : '',
      description: typeof o.description === 'string' ? o.description : '',
      ...(typeof o.preview === 'string' && { preview: o.preview })
    }))
  }))
  return questions.length && questions.every((q) => q.question && q.options.length)
    ? questions
    : null
}

const agentPrompt = (
  dialog: string,
  agent: string,
  requests: AgentRequest[]
): SessionPrompt | null => {
  const choices = choicesOf(dialog)?.choices
  const asking = requests.filter((r) => {
    const summary = bare(summaryOf(r.input))
    return r.agent === agent && summary && bare(dialog).includes(summary)
  })
  if (!choices || asking.length !== 1) return null
  const { tool, input } = asking[0]
  const shown = JSON.stringify(input ?? {}, null, 2)
  return { kind: 'permission', tool, summary: summaryOf(input), input: shown, choices, agent }
}

/** What the session's Claude waits on you to answer, or null when the card can't show it. */
export function pendingPrompt(
  entries: ConversationEntry[],
  pane: string,
  requests: AgentRequest[] = []
): SessionPrompt | null {
  const lines = pane.split('\n')
  const dialog = lines.slice(lines.findLastIndex((l) => RULE.test(l)) + 1)
  const agent = FROM_AGENT.exec(dialog.find((l) => l.trim()) ?? '')?.[1]
  if (agent) return agentPrompt(dialog.join('\n'), agent, requests)
  const tool = waitingTool(entries)
  if (!tool || tool.name === 'Agent' || tool.name === 'Task') return null
  const input = parseJson(tool.input)
  if (tool.name === 'AskUserQuestion') {
    const questions = questionsOf(input)
    return questions && { kind: 'questions', questions }
  }
  const choices = choicesOf(pane)?.choices
  if (!choices) return null
  return tool.name === 'ExitPlanMode'
    ? { kind: 'plan', plan: summaryOf(input, ['plan']), choices }
    : { kind: 'permission', tool: tool.name, summary: tool.summary, input: tool.input, choices }
}

/** Whether the terminal still shows `prompt` as Claude asked it, with nothing picked and the cursor on the first choice. */
export function untouched(prompt: SessionPrompt, pane: string): boolean {
  if (prompt.kind !== 'questions') {
    const shown = choicesOf(pane)
    return shown?.focused === 1 && shown.choices.join('\n') === prompt.choices.join('\n')
  }
  const lines = pane.split('\n')
  const at = lines.findIndex((l) => FIRST_FOCUSED.test(l))
  if (at === -1) return false
  let top = at
  while (top > 0 && !RULE.test(lines[top - 1])) top--
  const asked = bare(lines.slice(top, at).join('\n').replace(/^\s*│/gm, ''))
  return (
    asked.includes(bare(prompt.questions[0].question)) &&
    !/☒|\[✔\]/.test(lines.slice(top).join('\n'))
  )
}

const downs = (n: number): Key[] => Array<Key>(n).fill('Down')
const typed = (text: string): Key => ({ text: oneLine(text) })
const refuse = (): never => {
  throw new Error("That answer doesn't fit what Claude asked.")
}

/** The keys that give `answer` to `prompt` in a terminal that shows it untouched; throws when the answer doesn't fit. */
export function answerKeys(prompt: SessionPrompt, answer: PromptAnswer): Key[] {
  if (prompt.kind !== 'questions') {
    if (answer.kind !== 'choice' || prompt.choices[answer.choice - 1] !== answer.label)
      return refuse()
    const { choice, label, text = '' } = answer
    if (!asksForText(label)) return [String(choice)]
    if (!oneLine(text)) throw new Error('Type what to tell Claude first.')
    return [String(choice), typed(text), 'Enter']
  }
  const { questions } = prompt
  if (answer.kind === 'chat') {
    const q = questions[0]
    return [...downs(q.options.length + +takesOther(q) + +q.multiSelect), 'Enter']
  }
  if (answer.kind !== 'questions' || answer.answers.length !== questions.length) return refuse()
  const { answers } = answer
  const keys = questions.flatMap((q, i): Key[] => {
    const { picked, other, note } = answers[i]
    const n = q.options.length
    const otherText = oneLine(other ?? '')
    const noteText = oneLine(note ?? '')
    if (!Array.isArray(picked) || picked.some((p) => !Number.isInteger(p) || p < 0 || p >= n))
      return refuse()
    if ((otherText && !takesOther(q)) || (noteText && !takesNote(q))) return refuse()
    if (q.multiSelect) {
      if (!picked.length && !otherText) return refuse()
      const toggles = [...new Set(picked)].sort((a, b) => a - b).map((p) => String(p + 1))
      return otherText
        ? [...toggles, ...downs(n), typed(otherText), 'Down', 'Enter']
        : [...toggles, ...downs(n + 1), 'Enter']
    }
    if (otherText) return picked.length ? refuse() : [...downs(n), typed(otherText), 'Enter']
    if (picked.length !== 1) return refuse()
    return [...downs(picked[0]), ...(noteText ? ['n', typed(noteText)] : []), 'Enter']
  })
  return questions.length > 1 || questions[0].multiSelect ? [...keys, 'Enter'] : keys
}

const SUGGESTION =
  // eslint-disable-next-line no-control-regex
  /^(?:\x1b\[[\d;]*m)*❯[ \u00a0]\x1b\[2m([^\x1b]+)\x1b\[(?:0|22)m(?:\x1b\[[\d;]*m)*\s*$/
const PLACEHOLDER = /^(Try "|Message @|Press (up|Enter) )/

const promptLine = (pane: string): string | undefined =>
  pane.split('\n').findLast((line) => /^❯[ \u00a0]/.test(stripVTControlCharacters(line)))

/** Whether the last prompt line of a screen captured with colors holds text you typed, not a dim suggestion or placeholder. */
export function promptTyped(pane: string): boolean {
  const prompt = promptLine(pane)
  return !!prompt && !SUGGESTION.test(prompt) && !!stripVTControlCharacters(prompt).slice(2).trim()
}

/** The dim next-message suggestion on the last prompt line of a screen captured with colors; null when there's none. */
export function suggestionOf(pane: string): string | null {
  const prompt = promptLine(pane)
  // shortcut: a suggestion wider than the terminal wraps and reads as none; join wrapped lines if that shows up.
  const text = prompt && SUGGESTION.exec(prompt)?.[1].trim()
  return text && !PLACEHOLDER.test(text) ? text : null
}

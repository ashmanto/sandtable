import { tooLong } from './sessions'
import type { Routine, RoutineInput, Schedule } from './types'

/** The most event starts a day a routine has unless it sets its own. */
export const DEFAULT_DAILY_CAP = 5

const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** The local times `schedule` falls on after `after`, up to and including `until`, oldest first. */
export function dueTimes(schedule: Schedule, after: Date, until: Date): Date[] {
  const [hours, minutes] = schedule.time.split(':').map(Number)
  const times: Date[] = []
  const day = new Date(after.getFullYear(), after.getMonth(), after.getDate())
  for (; day <= until; day.setDate(day.getDate() + 1)) {
    const t = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes)
    if (schedule.days.includes(t.getDay()) && t > after && t <= until) times.push(t)
  }
  return times
}

/** A schedule as "Weekdays at 02:00" or "Mon, Wed at 18:00". */
export function scheduleLabel(schedule: Schedule): string {
  const days = [...new Set(schedule.days)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
  const key = days.join()
  const named =
    key === '1,2,3,4,5,6,0'
      ? 'Every day'
      : key === '1,2,3,4,5'
        ? 'Weekdays'
        : key === '6,0'
          ? 'Weekends'
          : days.map((d) => dayNames[d]).join(', ')
  return `${named} at ${schedule.time}`
}

const RULE = /^[A-Za-z][\w-]*(\(.+\))?$/
const RUNNERS = new Set([
  ...'sh bash zsh fish dash ksh env xargs eval exec command sudo nohup nice time timeout'.split(
    ' '
  ),
  ...'node python python3 perl ruby php deno bun npx bunx pnpx uvx osascript'.split(' '),
  ...'npm pnpm yarn uv'.split(' '),
  ...['npm exec', 'pnpm exec', 'pnpm dlx', 'yarn exec', 'yarn dlx', 'bun x', 'uv run']
])
const OPTION_OR_VALUE = /^(-|\d|\w+=)/

const anyCommand = (rule: string): boolean => {
  if (rule === 'Bash') return true
  const command = /^Bash\((.*)\)$/.exec(rule)?.[1]
  if (!command?.includes('*')) return false
  const prefix = command.slice(0, command.indexOf('*'))
  let words = prefix
    .replace(/:\s*$/, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase().split('/').pop() ?? '')
  // Bash(x*) has no word boundary, so a partial last word also matches any runner it starts.
  const partial = /[\s:]$/.test(prefix) ? undefined : words.pop()
  const runsAny = (): boolean =>
    partial === undefined ||
    OPTION_OR_VALUE.test(partial) ||
    [...RUNNERS].some((r) => r.startsWith(partial))
  if (!words.length) return runsAny()
  for (;;) {
    const runner = RUNNERS.has(words.slice(0, 2).join(' ')) ? 2 : RUNNERS.has(words[0]) ? 1 : 0
    if (!runner) return false
    words = words.slice(runner)
    while (words.length && OPTION_OR_VALUE.test(words[0])) words = words.slice(1)
    if (!words.length) return runsAny()
  }
}

const ruleProblem = (rule: unknown): string | null => {
  const r = typeof rule === 'string' ? rule.trim() : String(rule)
  if (typeof rule === 'string' && !r) return null
  if (typeof rule !== 'string' || !RULE.test(r))
    return `${r} isn't a permission rule. Write a tool such as Read, or a tool and what it may do, such as Bash(npm outdated)`
  return anyCommand(r)
    ? `${r} lets the session run any command. Name the commands, such as Bash(npm outdated)`
    : null
}

/** The first allowed rule's problem, or null when every rule is usable. */
export function rulesProblem(rules: unknown[]): string | null {
  for (const rule of rules) {
    const problem = ruleProblem(rule)
    if (problem) return problem
  }
  return null
}

/** What stops `input` from saving among the project's `others`, or null when nothing does. */
export function routineProblem(
  input: RoutineInput,
  others: Routine[],
  projectName: string
): string | null {
  const name = input.name.trim()
  if (!name) return 'Enter a name'
  if (name.length > 200) return 'Shorten the name'
  if (others.some((r) => r.id !== input.id && r.name.trim().toLowerCase() === name.toLowerCase()))
    return `${projectName} already has a routine named ${name}`
  if (!input.message.trim()) return 'Write the first message'
  if (tooLong(input.message)) return 'Shorten the first message'
  if (typeof input.worktree !== 'boolean') return 'Pick where it runs'
  if (input.allow !== undefined) {
    if (!Array.isArray(input.allow)) return 'Write one allowed rule per line'
    const problem = rulesProblem(input.allow)
    if (problem) return problem
  }
  if (input.schedule) {
    const { days } = input.schedule
    if (days.length === 0) return 'Pick at least one day'
    if (days.length > 7 || !days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6))
      return 'Pick days from the list'
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.schedule.time)) return 'Enter a time such as 02:00'
  }
  const label = input.on?.label
  if (label !== undefined) {
    if (typeof label !== 'string' || !label.trim()) return 'Enter a label'
    if (label.trim().length > 100) return 'Shorten the label'
  }
  const cap = input.dailyCap
  if (cap !== undefined && !(Number.isInteger(cap) && cap >= 1 && cap <= 50))
    return 'Enter a daily cap from 1 to 50'
  return null
}

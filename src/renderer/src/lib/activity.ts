import {
  Bot,
  FileText,
  Globe,
  Pencil,
  Search,
  Sparkles,
  SquareTerminal,
  Wrench
} from 'lucide-react'
import type { Step } from '../../../shared/types'
import { duration } from './usage'

const looks: Record<string, { verb: string; icon: typeof Wrench }> = {
  Edit: { verb: 'Editing', icon: Pencil },
  Write: { verb: 'Editing', icon: Pencil },
  MultiEdit: { verb: 'Editing', icon: Pencil },
  NotebookEdit: { verb: 'Editing', icon: Pencil },
  Bash: { verb: 'Running', icon: SquareTerminal },
  Read: { verb: 'Reading', icon: FileText },
  Grep: { verb: 'Searching', icon: Search },
  Glob: { verb: 'Searching', icon: Search },
  WebSearch: { verb: 'Searching', icon: Search },
  WebFetch: { verb: 'Fetching', icon: Globe },
  Task: { verb: 'Asking an agent', icon: Bot },
  Agent: { verb: 'Asking an agent', icon: Bot },
  Skill: { verb: 'Using', icon: Sparkles }
}

/** A step's verb and icon; a tool without its own verb is named as it is, with a wrench. */
export const stepLook = (step: Step): { verb: string; icon: typeof Wrench } =>
  Object.hasOwn(looks, step.tool) ? looks[step.tool] : { verb: step.tool, icon: Wrench }

/** A step in words, such as "Running npm test". */
export const stepText = (step: Step): string => `${stepLook(step).verb} ${step.target}`

/** A run's length since `since`, short for the eye and in words for a screen reader. */
export type Run = { short: string; words: string } | null
/** How long it has run since `since`, or null without a start. */
export const runOf = (since: string | null, now: number): Run =>
  since
    ? {
        short: duration(now - Date.parse(since)),
        words: duration(now - Date.parse(since), true)
      }
    : null

/** A run's length as the words a screen reader hears after a line. */
export const spoken = (time: Run): string => (time ? `, for ${time.words}` : '')

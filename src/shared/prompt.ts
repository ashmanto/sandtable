/** One question of Claude's AskUserQuestion tool. */
export interface Question {
  question: string
  header: string
  multiSelect: boolean
  options: { label: string; description: string; preview?: string }[]
}

/** What Claude waits on you to answer in a live session: its questions, a tool's permission, or its plan, with the choices its terminal shows. */
export type SessionPrompt =
  | { kind: 'questions'; questions: Question[] }
  | {
      kind: 'permission'
      tool: string
      summary: string
      input: string
      choices: string[]
      agent?: string
    }
  | { kind: 'plan'; plan: string; choices: string[] }

/** Your answer to one question: the indexes of the options you picked, the text you typed as Other, and a note on the picked option. */
export interface QuestionAnswer {
  picked: number[]
  other?: string
  note?: string
}

/** Your answer to a session prompt: the questions answered, Chat about this, or the 1-based choice you picked, with its text when it asks for some. */
export type PromptAnswer =
  | { kind: 'questions'; answers: QuestionAnswer[] }
  | { kind: 'chat' }
  | { kind: 'choice'; choice: number; label: string; text?: string }

const previewed = (q: Question): boolean => q.options.some((o) => o.preview)

/** Whether the terminal offers a typed Other answer for a question, which it leaves out of a single-select question with previews. */
export const takesOther = (q: Question): boolean => q.multiSelect || !previewed(q)

/** Whether the terminal takes a note on a question's picked option, which it does only beside previews. */
export const takesNote = (q: Question): boolean => !q.multiSelect && previewed(q)

/** Whether picking a choice opens a field for what to tell Claude, as the plan's "Tell Claude what to change". */
export const asksForText = (label: string): boolean => /^Tell Claude\b/.test(label)

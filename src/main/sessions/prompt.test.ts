import { describe, expect, it } from 'vitest'
import type { ConversationEntry } from '../../shared/types'
import type { PromptAnswer, Question, SessionPrompt } from '../../shared/prompt'
import { summaryOf } from './conversation'
import {
  answerKeys,
  choicesOf,
  pendingPrompt,
  promptTyped,
  suggestionOf,
  untouched
} from './prompt'

const tool = (name: string, input: object, output: string | null = null): ConversationEntry => ({
  kind: 'tool',
  name,
  summary: summaryOf(input),
  input: JSON.stringify(input, null, 2),
  output,
  error: false
})

const PERMISSION_PANE = `
⏺ Creating an empty file named made-by-claude.txt
  ⎿  $ touch made-by-claude.txt

────────────────────────────────────────────
 Bash command
 touch made-by-claude.txt
 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and always allow access to /private/tmp/claude-501/st296/proj
      from this project
   3. Yes, and switch to auto mode · auto mode handles these prompts for you
   4. No

 Esc to cancel · Tab to amend
`

const AGENT_PANE = `
✻ Waiting for 2 background agents to finish
────────────────────────────────────────────
 Bash command · from the general-purpose agent                         2 of 3
 Tip: auto mode handles these prompts for you — choose "switch to auto mode" below
 Create empty file one.txt
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
 touch one.txt
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and don’t ask again for: touch *
   3. Yes, and switch to auto mode · auto mode handles these prompts for you
   4. No
 Esc to cancel · Tab to amend · ctrl+x ctrl+k twice to stop background agents
`

const PLAN_PANE = `
   Ready to code?
   1. Create hello.txt in the repository root.
   2. Write the text hi.
  ─────────────────────────────────
   Claude has written up a plan and is ready to execute. Would you like to proceed?

   ❯ 1. Yes, and use auto mode
     2. Yes, manually approve edits
     3. Tell Claude what to change
        shift+tab to approve with this feedback

   ctrl+g to edit in Vim · ~/.claude/plans/plan.md
`

const SEVERAL_PANE = `
←  ☐ Database  ☐ Hosting  ✔ Submit  →

Which database should the service use?

❯ 1. Postgres
     A full-featured relational database that handles heavy concurrent writes well.
  2. SQLite
     A file-based database that runs inside the service with no separate server.
  3. MySQL
     A widely hosted relational database with broad tooling support.
  4. Type something.
──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  5. Chat about this

Enter to select · Tab/Arrow keys to navigate · Esc to cancel
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────── sandtable#305 ─
`

const SEVERAL_TABBED_PANE = `
←  ☐ Database  ☐ Hosting  ✔ Submit  →

Where should the service run?

❯ 1. Fly.io
     Runs the service as containers in regions close to your users.
  2. Render
     Deploys the service from your Git repository with managed infrastructure.
  3. Type something.
──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  4. Chat about this

Enter to select · Tab/Arrow keys to navigate · Esc to cancel


────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────── sandtable#305 ─
`

const CLIPPED_PANE = `
Which kind of time do you want it to count?

❯ 1. [ ] Claude working time
         Counts only the time Claude spends actively working on a task.
  2. [ ] Wall-clock time
         Counts the full elapsed time from when a task starts to when it ends.
  3. [ ] Waiting time
         Counts the time a task sits idle while it waits for input or approval.
↓ 4. [ ] Review time
         Counts the time a person spends reviewing Claude's work.
     Next
──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  6. Chat about this

Enter to select · Tab/Arrow keys to navigate · Esc to cancel
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────── sandtable#305 ─
`

const MULTI_SELECT_PANE = `
Which checks should run before every push?

❯ 1. [ ] Unit tests
         Runs the unit test suite to catch broken behavior.
  2. [ ] Lint
         Scans the code for style problems and likely bugs.
  3. [ ] Type check
         Confirms that the code passes the type checker without errors.
↓ 4. [ ] Format check
         Confirms that the code matches the project's formatting rules.
     Submit
──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  6. Chat about this

Enter to select · ↑/↓ to navigate · Esc to cancel
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────── sandtable#305 ─
`

const TICKED_PANE = `
Which checks should run before every push?

❯ 1. [ ] Unit tests
         Runs the unit test suite to catch broken behavior.
  2. [✔] Lint
         Scans the code for style problems and likely bugs.
  3. [ ] Type check
         Confirms that the code passes the type checker without errors.
↓ 4. [ ] Format check
         Confirms that the code matches the project's formatting rules.
     Submit
──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  6. Chat about this

Enter to select · ↑/↓ to navigate · Esc to cancel
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────── sandtable#305 ─
`

const MOVED_PANE = `
Which checks should run before every push?

  1. [ ] Unit tests
         Runs the unit test suite to catch broken behavior.
❯ 2. [ ] Lint
         Scans the code for style problems and likely bugs.
  3. [ ] Type check
         Confirms that the code passes the type checker without errors.
↓ 4. [ ] Format check
         Confirms that the code matches the project's formatting rules.
     Submit
──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  6. Chat about this

Enter to select · ↑/↓ to navigate · Esc to cancel
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────── sandtable#305 ─
`

const PREVIEW_PANE = `
 ☐ Layout

Which layout should the settings page use?

❯ 1. Sidebar                      ┌──────────────────────────────────────────┐
  2. Tabs                         │ +---------+----------------+             │
  3. Single page                  ├─── ✂ ─── 3 lines hidden ─────────────────┤
                                  └──────────────────────────────────────────┘

                                  Notes: press n to add notes

──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  Chat about this

Enter to select · ↑/↓ to navigate · n to add notes · Esc to cancel
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────── sandtable#305 ─
`

const WRAPPED_PANE = `
──────────────────────────────────────────────────────────────────────
 ☐ Script

│ Which \`npm\` script should the **pre-push** hook run before it lets a
│ push through to the remote, given that the full test suite takes
│ about four minutes?

❯ 1. test
     Runs everything.
  2. lint
     Fast.
  3. Type something.
──────────────────────────────────────────────────────────────────────
  4. Chat about this

Enter to select · ↑/↓ to navigate · Esc to cancel
────────────────────────────────────────────────────── sandtable#305 ─
`

const BROKEN_PATH_PANE = `
────────────────────────────────────────────────────────────────────────────────────────────────────
 ☐ Button look

│ Which scroll-to-end button should I build? Open
│ /private/tmp/claude-501/-Users-myuser-projects-sandtable-wt-noindex-317-conversation-stops-short-o
│ f-the-end-when-claud/73942fb7-62e8-467d-bd17-b9c876ffc0b6/scratchpad/scroll-to-end-prototype.html
│ in a browser, scroll the conversation, and press 1, 2, or 3 to flip between variants. All three
│ sit inside the conversation area, so none of them covers the composer or the message tray.

❯ 1. Lift
     32 px raised round button, centered at the bottom of the conversation, with a shadow. It rises
     in. It's the easiest to spot, but it sits over the text in the middle of the reading column.
  2. Pill
     24 px button in the same pill as the Find button, in the bottom-right corner, mirroring Find in
     the top-right corner. It fades in. It's the quietest and most consistent with Find, but it's
     the easiest to miss.
  3. Gutter
     28 px flat round button in the gutter to the right of the reading column, at the bottom. It
     scales in. It stays clear of the text on wide views, but it moves closer to the text in narrow
     ones, such as the ticket chat panel.
  4. Type something.
────────────────────────────────────────────────────────────────────────────────────────────────────
  5. Chat about this

Enter to select · ↑/↓ to navigate · Esc to cancel
`

const BROKEN_PATH_SHORT_PANE = `
│ Which scroll-to-end button should I build? Open
│ /private/tmp/claude-501/-Users-myuser-projects-sandtable-wt-noindex-317-conver
│ sation-stops-short-of-the-end-when-claud/73942fb7-62e8-467d-bd17-b9c876ffc0b6/
│ scratchpad/scroll-to-end-prototype.html in a browser, scroll the conversation,
│ and press 1, 2, or 3 to flip between variants. All three sit inside the
│ conversation area, so none of them covers the composer or the message tray.

❯ 1. Lift
     32 px raised round button, centered at the bottom of the conversation, with
     a shadow. It rises in. It's the easiest to spot, but it sits over the text
     in the middle of the reading column.
  2. Pill
     24 px button in the same pill as the Find button, in the bottom-right
     corner, mirroring Find in the top-right corner. It fades in. It's the
     quietest and most consistent with Find, but it's the easiest to miss.
  3. Gutter
     28 px flat round button in the gutter to the right of the reading column,
     at the bottom. It scales in. It stays clear of the text on wide views, but
     it moves closer to the text in narrow ones, such as the ticket chat panel.
  4. Type something.
────────────────────────────────────────────────────────────────────────────────
  5. Chat about this

Enter to select · ↑/↓ to navigate · Esc to cancel
`

const PATH_QUESTION =
  'Which scroll-to-end button should I build? Open /private/tmp/claude-501/-Users-myuser-projects-sandtable-wt-noindex-317-conversation-stops-short-of-the-end-when-claud/73942fb7-62e8-467d-bd17-b9c876ffc0b6/scratchpad/scroll-to-end-prototype.html in a browser, scroll the conversation, and press 1, 2, or 3 to flip between variants. All three sit inside the conversation area, so none of them covers the composer or the message tray.'

const color: Question = {
  question: 'Which color do you prefer?',
  header: 'Color',
  multiSelect: false,
  options: [
    { label: 'Red', description: 'Warm.', preview: 'Red' },
    { label: 'Blue', description: 'Cool.', preview: 'Blue' },
    { label: 'Green', description: 'Natural.', preview: 'Green' }
  ]
}
const fruits: Question = {
  question: 'Which fruits do you like?',
  header: 'Fruits',
  multiSelect: true,
  options: [
    { label: 'Apple', description: 'Crisp.' },
    { label: 'Pear', description: 'Soft.' },
    { label: 'Plum', description: 'Tart.' }
  ]
}
const season: Question = {
  question: 'Which season?',
  header: 'Season',
  multiSelect: false,
  options: [
    { label: 'Spring', description: 'Mild.' },
    { label: 'Summer', description: 'Warm.' }
  ]
}

describe('choicesOf', () => {
  it('reads the numbered choices, joining wrapped lines and dropping hints', () => {
    expect(choicesOf(PERMISSION_PANE)).toEqual({
      choices: [
        'Yes',
        'Yes, and always allow access to /private/tmp/claude-501/st296/proj from this project',
        'Yes, and switch to auto mode · auto mode handles these prompts for you',
        'No'
      ],
      focused: 1
    })
    expect(choicesOf(PLAN_PANE)).toEqual({
      choices: [
        'Yes, and use auto mode',
        'Yes, manually approve edits',
        'Tell Claude what to change'
      ],
      focused: 1
    })
  })

  it('takes the last numbered list, so a plan numbered 1. 2. above the choices is left out', () => {
    expect(choicesOf(PLAN_PANE)?.choices[0]).toBe('Yes, and use auto mode')
  })

  it('reports where the terminal cursor is', () => {
    expect(
      choicesOf(PLAN_PANE.replace('❯ 1.', '  1.').replace('  2. Yes, m', '❯ 2. Yes, m'))?.focused
    ).toBe(2)
  })

  it('is null when the screen shows no choice', () => {
    expect(choicesOf('❯ \n  ⏵⏵ auto mode on')).toBeNull()
  })
})

describe('pendingPrompt', () => {
  it('reads an unanswered AskUserQuestion from the transcript', () => {
    const entries = [
      { kind: 'assistant', text: 'Asking' } as const,
      tool('AskUserQuestion', { questions: [color, fruits] })
    ]
    expect(pendingPrompt(entries, '')).toEqual({ kind: 'questions', questions: [color, fruits] })
  })

  it('reads a plan with the choices on the screen', () => {
    expect(pendingPrompt([tool('ExitPlanMode', { plan: '1. Do it' })], PLAN_PANE)).toEqual({
      kind: 'plan',
      plan: '1. Do it',
      choices: [
        'Yes, and use auto mode',
        'Yes, manually approve edits',
        'Tell Claude what to change'
      ]
    })
  })

  it('reads a permission prompt from the waiting tool and the screen', () => {
    const p = pendingPrompt(
      [
        tool('Read', { file_path: '/a' }, 'ok'),
        tool('Bash', { command: 'touch made-by-claude.txt' })
      ],
      PERMISSION_PANE
    )
    expect(p).toMatchObject({
      kind: 'permission',
      tool: 'Bash',
      summary: 'touch made-by-claude.txt'
    })
    expect(p?.kind === 'permission' && p.choices).toHaveLength(4)
  })

  it('is null when nothing waits, the screen has no choices, or an agent asks', () => {
    expect(pendingPrompt([tool('Bash', { command: 'ls' }, 'ok')], PERMISSION_PANE)).toBeNull()
    expect(pendingPrompt([tool('Bash', { command: 'ls' })], 'nothing here')).toBeNull()
    expect(pendingPrompt([tool('Agent', { prompt: 'x' })], PERMISSION_PANE)).toBeNull()
    expect(pendingPrompt([tool('AskUserQuestion', { questions: 'bad' })], '')).toBeNull()
  })
})

describe('pendingPrompt for a subagent', () => {
  const one = {
    agent: 'general-purpose',
    tool: 'Bash',
    input: { command: 'touch one.txt', description: 'Create empty file one.txt' }
  }
  const two = { ...one, input: { command: 'ls two', description: 'List two' } }

  it("reads the request of the subagent the terminal names, with the screen's choices", () => {
    expect(pendingPrompt([], AGENT_PANE, [two, one])).toEqual({
      kind: 'permission',
      tool: 'Bash',
      summary: 'Create empty file one.txt',
      input: JSON.stringify(one.input, null, 2),
      choices: [
        'Yes',
        'Yes, and don’t ask again for: touch *',
        'Yes, and switch to auto mode · auto mode handles these prompts for you',
        'No'
      ],
      agent: 'general-purpose'
    })
  })

  it("reads the subagent's request even while the main session waits on a tool of its own", () => {
    const p = pendingPrompt([tool('Bash', { command: 'npm test' })], AGENT_PANE, [one])
    expect(p).toMatchObject({ tool: 'Bash', summary: 'Create empty file one.txt' })
  })

  it('is null when no request of that subagent shows on the screen, or more than one does', () => {
    expect(pendingPrompt([], AGENT_PANE, [two])).toBeNull()
    expect(pendingPrompt([], AGENT_PANE, [{ ...one, agent: 'Explore' }])).toBeNull()
    expect(pendingPrompt([], AGENT_PANE, [one, { ...one, tool: 'Other' }])).toBeNull()
    expect(pendingPrompt([], AGENT_PANE.replace(/^ +(❯ )?\d\. .*\n/gm, ''), [one])).toBeNull()
  })

  it('matches only inside the dialog, and never on a request with no summary', () => {
    const above = `⏺ Ran ls two\n · from the general-purpose agent\n${AGENT_PANE}`
    expect(pendingPrompt([], above, [two])).toBeNull()
    expect(pendingPrompt([], AGENT_PANE, [{ ...one, input: { query: 'x' } }])).toBeNull()
  })

  it("reads the main session's prompt when only the conversation names a subagent", () => {
    const pane = `Bash command · from the general-purpose agent\n${PERMISSION_PANE}`
    expect(pendingPrompt([tool('Bash', { command: 'ls' })], pane, [one])).toMatchObject({
      summary: 'ls'
    })
  })

  it("leaves the main session's prompts to the transcript", () => {
    expect(pendingPrompt([tool('Bash', { command: 'ls' })], PERMISSION_PANE, [one])).toMatchObject({
      summary: 'ls'
    })
    expect(pendingPrompt([], PERMISSION_PANE, [one])).toBeNull()
  })
})

describe('untouched', () => {
  const asks = (...texts: string[]): SessionPrompt => ({
    kind: 'questions',
    questions: texts.map((question) => ({ ...season, question }))
  })
  const several = asks('Which database should the service use?', 'Where should the service run?')
  const checks = asks('Which checks should run before every push?')

  it('holds while the terminal shows the first question with nothing picked', () => {
    expect(untouched(several, SEVERAL_PANE)).toBe(true)
    expect(untouched(checks, MULTI_SELECT_PANE)).toBe(true)
    expect(untouched(asks('Which layout should the settings page use?'), PREVIEW_PANE)).toBe(true)
    expect(
      untouched(
        asks(
          'Which `npm` script should the **pre-push** hook run before it lets a push through to the remote, given that the full test suite takes about four minutes?'
        ),
        WRAPPED_PANE
      )
    ).toBe(true)
  })

  it('holds when the terminal breaks a long word of the question across lines', () => {
    expect(untouched(asks(PATH_QUESTION), BROKEN_PATH_PANE)).toBe(true)
    expect(untouched(asks(PATH_QUESTION), BROKEN_PATH_SHORT_PANE)).toBe(true)
    expect(untouched(asks(PATH_QUESTION.replace('short', 'long')), BROKEN_PATH_PANE)).toBe(false)
    const moved = BROKEN_PATH_PANE.replace('❯ 1.', '  1.').replace('  2. Pill', '❯ 2. Pill')
    expect(untouched(asks(PATH_QUESTION), moved)).toBe(false)
  })

  it('holds when a short terminal cuts off the tabs and headers above the question', () => {
    const time = asks(
      'Which kind of time do you want it to count?',
      'Where should the time show up?'
    )
    expect(untouched(time, CLIPPED_PANE)).toBe(true)
  })

  it('fails once you moved, picked, answered, or went to another question in the terminal', () => {
    expect(untouched(several, SEVERAL_TABBED_PANE)).toBe(false)
    expect(untouched(several, SEVERAL_PANE.replace('☐ Database', '☒ Database'))).toBe(false)
    expect(untouched(checks, TICKED_PANE)).toBe(false)
    expect(untouched(checks, MOVED_PANE)).toBe(false)
    expect(untouched(several, MULTI_SELECT_PANE)).toBe(false)
    expect(untouched(checks, 'no prompt')).toBe(false)
  })

  it('checks a choice prompt shows the same choices with the cursor on the first', () => {
    const plan = pendingPrompt([tool('ExitPlanMode', { plan: '' })], PLAN_PANE)!
    expect(untouched(plan, PLAN_PANE)).toBe(true)
    expect(untouched(plan, PLAN_PANE.replace('manually', 'carefully'))).toBe(false)
    expect(
      untouched(plan, PLAN_PANE.replace('❯ 1.', '  1.').replace('  3. Tell', '❯ 3. Tell'))
    ).toBe(false)
  })
})

describe('answerKeys', () => {
  const questions = (...q: Question[]): SessionPrompt => ({
    kind: 'questions' as const,
    questions: q
  })

  it('moves to a single-select option and picks it, with a note on a previewed question', () => {
    expect(answerKeys(questions(color), { kind: 'questions', answers: [{ picked: [1] }] })).toEqual(
      ['Down', 'Enter']
    )
    expect(
      answerKeys(questions(color), {
        kind: 'questions',
        answers: [{ picked: [2], note: 'my\nnote' }]
      })
    ).toEqual(['Down', 'Down', 'n', { text: 'my note' }, 'Enter'])
  })

  it('types Other into the row after the options', () => {
    expect(
      answerKeys(questions(season), {
        kind: 'questions',
        answers: [{ picked: [], other: 'Winter' }]
      })
    ).toEqual(['Down', 'Down', { text: 'Winter' }, 'Enter'])
  })

  it('toggles multi-select options by number, then submits, and confirms the review step', () => {
    expect(
      answerKeys(questions(fruits, season), {
        kind: 'questions',
        answers: [{ picked: [0, 2] }, { picked: [0] }]
      })
    ).toEqual(['1', '3', 'Down', 'Down', 'Down', 'Down', 'Enter', 'Enter', 'Enter'])
    expect(
      answerKeys(questions(fruits), {
        kind: 'questions',
        answers: [{ picked: [1], other: 'Mango' }]
      })
    ).toEqual(['2', 'Down', 'Down', 'Down', { text: 'Mango' }, 'Down', 'Enter', 'Enter'])
  })

  it('moves to Chat about this past every row of the first question', () => {
    expect(answerKeys(questions(color), { kind: 'chat' })).toEqual([
      'Down',
      'Down',
      'Down',
      'Enter'
    ])
    expect(answerKeys(questions(season), { kind: 'chat' })).toEqual([
      'Down',
      'Down',
      'Down',
      'Enter'
    ])
    expect(answerKeys(questions(fruits), { kind: 'chat' })).toEqual([
      'Down',
      'Down',
      'Down',
      'Down',
      'Down',
      'Enter'
    ])
  })

  it('presses a choice number, then types its text and Enter only when it asks for text', () => {
    const plan = pendingPrompt([tool('ExitPlanMode', { plan: '' })], PLAN_PANE)!
    expect(
      answerKeys(plan, { kind: 'choice', choice: 2, label: 'Yes, manually approve edits' })
    ).toEqual(['2'])
    expect(
      answerKeys(plan, {
        kind: 'choice',
        choice: 3,
        label: 'Tell Claude what to change',
        text: 'Shorter'
      })
    ).toEqual(['3', { text: 'Shorter' }, 'Enter'])
  })

  it('refuses answers that don’t fit the prompt', () => {
    const plan = pendingPrompt([tool('ExitPlanMode', { plan: '' })], PLAN_PANE)!
    const bad = [
      [questions(color), { kind: 'questions', answers: [] }],
      [questions(color), { kind: 'questions', answers: [{ picked: [3] }] }],
      [questions(color), { kind: 'questions', answers: [{ picked: [0, 1] }] }],
      [questions(color), { kind: 'questions', answers: [{ picked: [], other: 'x' }] }],
      [questions(season), { kind: 'questions', answers: [{ picked: [0], note: 'x' }] }],
      [questions(fruits), { kind: 'questions', answers: [{ picked: [] }] }],
      [plan, { kind: 'choice', choice: 1, label: 'Yes, manually approve edits' }],
      [plan, { kind: 'choice', choice: 3, label: 'Tell Claude what to change', text: ' ' }],
      [plan, { kind: 'chat' }]
    ] as [SessionPrompt, PromptAnswer][]
    for (const [p, a] of bad) expect(() => answerKeys(p, a), JSON.stringify(a)).toThrow()
  })
})

describe('suggestionOf', () => {
  const E = '\x1b'
  const history = `${E}[38;5;246m${E}[48;5;237m❯ ${E}[38;5;231mCreate a file${E}[39m`
  const rule = '────────────────────'

  it('reads the dim text Claude Code suggests on the last prompt line', () => {
    const pane = [
      history,
      rule,
      `${E}[39m❯\u00a0${E}[2mshow me the file contents${E}[0m`,
      rule
    ].join('\n')
    expect(suggestionOf(pane)).toBe('show me the file contents')
  })

  it('reads nothing from typed text or an empty prompt', () => {
    expect(suggestionOf([history, rule, `${E}[39m❯\u00a0abc`, rule].join('\n'))).toBeNull()
    expect(suggestionOf([history, rule, `${E}[39m❯\u00a0`, rule].join('\n'))).toBeNull()
  })

  it("reads nothing from Claude Code's own placeholders", () => {
    for (const hint of [
      'Try "edit <filepath> to..."',
      'Message @reviewer…',
      'Press up to edit queued messages'
    ])
      expect(
        suggestionOf([rule, `${E}[39m❯\u00a0${E}[2m${hint}${E}[0m`, rule].join('\n'))
      ).toBeNull()
  })

  it('reads only the last prompt line', () => {
    const earlier = `${E}[39m❯\u00a0${E}[2mold suggestion${E}[0m`
    expect(suggestionOf([earlier, rule, `${E}[39m❯\u00a0abc`, rule].join('\n'))).toBeNull()
  })
})

describe('promptTyped', () => {
  const E = '\x1b'
  const history = `${E}[38;5;246m${E}[48;5;237m❯ ${E}[38;5;231mCreate a file${E}[39m`
  const rule = '────────────────────'
  const pane = (prompt: string): string => [history, rule, prompt, rule].join('\n')

  it('sees text typed on the last prompt line', () => {
    expect(promptTyped(pane(`${E}[39m❯\u00a0abc`))).toBe(true)
  })

  it('sees nothing on an empty prompt, a dim suggestion, or a placeholder', () => {
    expect(promptTyped(pane(`${E}[39m❯\u00a0`))).toBe(false)
    expect(promptTyped(pane(`${E}[39m❯\u00a0${E}[2mshow me the file${E}[0m`))).toBe(false)
    expect(promptTyped(pane(`${E}[39m❯\u00a0${E}[2mTry "edit <filepath> to..."${E}[0m`))).toBe(
      false
    )
  })
})

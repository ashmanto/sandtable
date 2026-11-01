import { shellQuote } from './shell'
import type { ToolCheck } from './types'

/** One check in a setup step, with its word, tone, and the fix when it isn't Ready. */
export type CheckRow = {
  id: string
  label: string
  word: string
  tone: 'ok' | 'fail' | 'warn' | 'idle'
  fix?: { text: string; command: string }
}

/** One step of the setup guide and whether it blocks or only warns. */
export type SetupStep = {
  id: 'tools' | 'claude' | 'gh' | 'linear' | 'jira'
  title: string
  lede: string
  rows: CheckRow[]
  blocked: boolean
  warn: boolean
}

const CANT_CHECK = "Sandtable couldn't run this check. Run it yourself to see why."

const row = (
  id: string,
  label: string,
  ok: boolean | null | undefined,
  failWord: string,
  fix: NonNullable<CheckRow['fix']>,
  statusCommand = '',
  warn = false
): CheckRow =>
  ok === undefined
    ? { id, label, word: 'Not checked', tone: 'idle' }
    : ok === null
      ? {
          id,
          label,
          word: "Can't check",
          tone: 'warn',
          fix: { text: CANT_CHECK, command: statusCommand }
        }
      : ok
        ? { id, label, word: 'Ready', tone: 'ok' }
        : { id, label, word: failWord, tone: warn ? 'warn' : 'fail', fix }

const shellWord = (s: string): string => (/^[A-Za-z0-9_./-]+$/.test(s) ? s : shellQuote(s))

/** A `claude auth` command, run with an account's folder unless it's Default. */
export const authCommand = (verb: 'login' | 'status', dir?: string): string =>
  `${dir ? `CLAUDE_CONFIG_DIR=${shellWord(dir)} ` : ''}claude auth ${verb}`

/** Turns a tool check into the setup guide's steps. */
export function setupSteps(check: Omit<ToolCheck, 'ok'>): SetupStep[] {
  const has = (tool: ToolCheck['missing'][number]): boolean => !check.missing.includes(tool)
  const gh = has('gh') ? check.gh : undefined
  const scopes = gh?.loggedIn ? gh.scopes : undefined
  const scope = (name: string): boolean | null | undefined =>
    scopes === undefined ? undefined : scopes === null ? null : scopes.includes(name)
  const steps: Omit<SetupStep, 'blocked' | 'warn'>[] = [
    {
      id: 'tools',
      title: 'tmux and git',
      lede: 'Each session runs in tmux, so it keeps going after you close the window. Each ticket gets its own git worktree.',
      rows: [
        row('tmux', 'tmux installed', has('tmux'), 'Missing', {
          text: 'Install tmux with Homebrew, then check again.',
          command: 'brew install tmux'
        }),
        row('git', 'git installed', has('git'), 'Missing', {
          text: 'Install the Xcode command-line tools, then check again.',
          command: 'xcode-select --install'
        })
      ]
    },
    {
      id: 'claude',
      title: 'Claude Code',
      lede: 'Every ticket gets an interactive Claude Code session.',
      rows: [
        row('claude', 'claude installed', has('claude'), 'Missing', {
          text: 'Install Claude Code, then check again.',
          command: 'npm install -g @anthropic-ai/claude-code'
        }),
        row(
          'claudeAuth',
          'Signed in',
          has('claude') ? check.claudeSignedIn : undefined,
          'Not signed in',
          {
            text: "Sessions can't start until Claude Code is signed in. Sign in in a terminal, then check again. If you use an API key, you can continue.",
            command: authCommand('login')
          },
          authCommand('status'),
          true
        ),
        ...check.accounts.map((a) =>
          row(
            `claudeAuth:${a.dir}`,
            `${a.name} signed in`,
            has('claude') ? a.signedIn : undefined,
            'Not signed in',
            {
              text: `Sessions for projects that use ${a.name} can't start until it's signed in. Sign in in a terminal, then check again. If you use an API key, you can continue.`,
              command: authCommand('login', a.dir)
            },
            authCommand('status', a.dir),
            true
          )
        )
      ]
    },
    {
      id: 'gh',
      title: 'GitHub CLI',
      lede: 'Sandtable reads tickets and changes their status with your GitHub CLI login.',
      rows: [
        row('gh', 'gh installed', has('gh'), 'Missing', {
          text: 'Install the GitHub CLI with Homebrew, then check again.',
          command: 'brew install gh'
        }),
        row(
          'ghAuth',
          'Logged in to github.com',
          gh === undefined ? undefined : gh === null ? null : gh.loggedIn,
          'Not logged in',
          {
            text: 'Log in with the scopes Sandtable uses, then check again.',
            command: 'gh auth login --scopes project'
          },
          'gh auth status'
        ),
        row(
          'ghRepo',
          'Token can read and label issues (repo)',
          scope('repo'),
          'Missing scope',
          {
            text: 'Add the repo scope to your login, then check again.',
            command: 'gh auth refresh --scopes repo'
          },
          'gh auth status'
        ),
        row(
          'ghProject',
          'Token can read and update boards (project)',
          scope('project'),
          'Missing scope',
          {
            text: "Without it, GitHub Projects boards don't load and dragging a card can't change its status. Repo issues still work.",
            command: 'gh auth refresh --scopes project'
          },
          'gh auth status',
          true
        )
      ]
    },
    {
      id: 'linear',
      title: 'Linear CLI',
      lede: 'Projects that take tickets from a Linear team read and change them with your Linear CLI login. GitHub projects work without it.',
      rows: [
        row(
          'linear',
          'linear installed',
          has('linear'),
          'Missing',
          {
            text: 'To use a Linear team, install the Linear CLI with Homebrew, then check again.',
            command: 'brew install schpet/tap/linear'
          },
          '',
          true
        ),
        row(
          'linearAuth',
          'Signed in',
          has('linear') ? check.linear : undefined,
          'Not signed in',
          {
            text: "Linear projects can't load until the Linear CLI is signed in. Sign in in a terminal, then check again.",
            command: 'linear auth login'
          },
          'linear auth whoami',
          true
        ),
        ...check.linearWorkspaces.map((w) =>
          row(
            `linearAuth:${w.slug}`,
            `Signed in to ${w.slug}`,
            has('linear') ? w.signedIn : undefined,
            'Not signed in',
            {
              text: `Projects in the ${w.slug} workspace can't load until the Linear CLI is signed in to it. Sign in in a terminal, then check again.`,
              command: 'linear auth login'
            },
            `linear auth whoami --workspace ${shellWord(w.slug)}`,
            true
          )
        )
      ]
    },
    {
      id: 'jira',
      title: 'Jira CLI',
      lede: 'Sessions on projects that take tickets from a Jira project file and update issues with your Jira CLI login. Other projects work without it.',
      rows: [
        row(
          'acli',
          'acli installed',
          has('acli'),
          'Missing',
          {
            text: 'To work on Jira issues in sessions, install the Atlassian CLI with Homebrew, then check again.',
            command: 'brew tap atlassian/homebrew-acli && brew install acli'
          },
          '',
          true
        ),
        row(
          'jiraAuth',
          'Signed in',
          has('acli') ? check.jira : undefined,
          'Not signed in',
          {
            text: "Sessions can't read or update Jira issues until the Jira CLI is signed in. Sign in in a terminal, then check again.",
            command: 'acli jira auth login --web'
          },
          'acli jira auth status',
          true
        ),
        ...check.jiraSites.map((j) =>
          row(
            `jiraAuth:${j.site}`,
            `Signed in to ${j.site}`,
            has('acli') ? j.signedIn : undefined,
            'Not signed in',
            {
              text: `Sessions on Jira projects on ${j.site} need the Jira CLI on that site. Switch to it, or sign in to it with acli jira auth login --web, then check again.`,
              command: `acli jira auth switch --site ${shellWord(j.site)}`
            },
            'acli jira auth status',
            true
          )
        )
      ]
    }
  ]
  return steps.map((s) => ({
    ...s,
    blocked: s.rows.some((r) => r.tone === 'fail'),
    warn: s.rows.some((r) => r.tone === 'warn')
  }))
}

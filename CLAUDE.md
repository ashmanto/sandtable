# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Sandtable is a macOS Electron app. It shows a project's tickets, from a GitHub
Projects board, straight from its repos' issues, from a Linear team, or from a Jira project, on a
kanban board and runs one interactive Claude Code session per ticket, each in its own git worktree
and tmux session. TypeScript, Electron with electron-vite, React, Tailwind, and shadcn/ui. The
design is `DESIGN.md`.

## Current state

`docs/features.md`, the "What works today" list, is the authoritative capability claim. Check it
before assuming a surface exists, and keep it in lockstep when work lands.

## Commands

```bash
npm install                      # also rebuilds node-pty for Electron and sets the pre-push hook
npm run dev                      # start the app with hot reload
npm test                         # all unit tests (Vitest, vitest.config.mts)
npx vitest run <path>            # one file's tests
npm run lint && npm run typecheck  # the pre-push hook runs lint, test, format:check, build, and e2e
npm run format:check             # Prettier; npm run format fixes it
npm run build && npx playwright test   # e2e smoke test of the built app (e2e/)
npm run build:mac                # dist/mac-arm64/Sandtable.app; the packaged-app e2e test runs after it
make install                     # on master: pull, build the app, run the pre-push checks, and replace the app
```

## Architecture

- `src/main/`: the Electron main process. It owns the GitHub client (`github/`), the Linear
  client (`linear/`), the Jira client and its saved sign-ins (`jira/`), the shared tracker path
  (`tracker.ts`), git worktrees (`git/`), tmux and Claude Code sessions (`sessions/`), program
  runs and the tool probe (`env/`), the live terminals (`terminal.ts`), the JSON store, and the
  orchestrator that ties them together.
- `src/preload/`: exposes `src/shared/api.ts` to the renderer as `window.sandtable`.
- `src/renderer/`: the React UI. It talks to the main process only through `window.sandtable`.
- `src/shared/`: types and pure helpers used by both sides.

Start reading from `src/main/orchestrator.ts`, `src/shared/api.ts`, and
`src/renderer/src/App.tsx`.

### Invariants worth protecting

- The only status Sandtable sets on its own is **In Progress**, when a session starts and the
  ticket isn't already in progress, and it never sets done; the agent does that when work merges.
  Any other status change happens only when you drag a card to another column, apart from the
  to-do Status on an issue you create with **New ticket** or **Add sub-issue**.
- Sandtable changes an assignee only when you drag a card to another assignee lane. On GitHub the
  person whose lane it left is replaced by the person whose lane it lands in, and other assignees
  stay; on Linear and Jira the assignee is replaced. Dropping on **No assignee** removes the
  person whose lane it left.
- Sandtable writes `area:` labels, creates them, and adds **Blocked by** links, Linear
  **Blocks** relations, or Jira **Blocks** links only in `applyTriage`, after you click **Apply**
  in a triage you started.
- Sandtable posts a comment only when you click **Post comment** in the chat panel, with the text
  shown in the draft.
- Sandtable types into a live session only when you click **Send to session** or **Send all**, send from the
  composer, click **Stop** (Esc), turn on the **Remote Control** switch to type `/remote-control`, or click
  **Prepare to compact** or **Compact** by the context meter, or when an automatic review sends its
  **High** proposals, and never while Claude asks you something or the session starts; the
  automatic review sends only at **Needs you**, never to a capped session, and never while the
  composer holds a draft or the terminal prompt holds typed text. The one exception is the question card: while Claude asks,
  answering on it types the keys for that answer, only after checking that Claude still asks what
  the card shows and the terminal shows it untouched.
- Sandtable never changes a repo's `.claude/settings.json`. Its hooks, status line, a routine's
  allowed rules, the Read rule for a session's sent images, the Read and Edit rules for its
  compact notes, the sandbox when a project turns it on, and the read-only runs' deny rules go in through `claude --settings`, and its session, chat, routine chat, summary, triage, review,
  readiness, and overlap rules through `--append-system-prompt`.
- A live session's hooks deny a tool call only when the session reached its token cap, or when a
  ticket session with **Automatic review** on tries to open a pull request before the gate opens.
- A worktree with uncommitted or unpushed changes is never removed, and `git worktree remove`
  never gets `--force`.
- External programs run with `execFile` or `spawn` and an argument array, never a shell string.
  The exceptions are the hook and status-line commands Claude Code runs, the `command -v` tool
  probe, the login-shell `PATH` read, and the worktree setup command.
- A session's `sandtable` CLI reaches only tickets in its own project, starts a new session only through
  the **Start** checks, resumes a finished one as **Resume** does, never applies triage, and never types into a session.
- Every session state is shown as a word, or as an icon whose tooltip and accessible name are the
  word, never only a color.

## Reuse

Search the codebase before writing anything. Lift shared code on the second instance, not the
third, and never speculatively. Audit for duplicates at the end of a feature. This holds for
subagents too.

## Code style

Default to no comments; the Conventions below say when one stays. No prop-listing docstrings and
no "added for X flow" notes. Follow `DESIGN.md` and its tokens, and never name a raw color.

## Ticket tracking

- **Tracker:** GitHub Issues in `ashmanto/sandtable`, through `gh`.
- **Labels:** add `bug`, `enhancement`, `documentation`, or `accessibility` when one fits.
- **Issue body:** `## Why`, `## What`, and `## Done when`, plus `## Needs planning` for open
  questions.
- **Done:** `Closes #<n>` in the PR body.

## Conventions

- TDD: write the failing test first, watch it fail, then implement.
- **Comments: default to none.** A comment stays only if it passes all four tests:
  1. Would the compiler, a linter, or a failing test catch the mistake instead? Then delete it.
  2. Is it already said in the code, a log string, or an error message? Delete it.
  3. Does it fit in one or two lines? A longer _why_ belongs in an issue; leave its number.
  4. Would you defend it out loud in review?

  More than a couple of comment lines per hundred lines of code is a finding on its own. Rationale
  and history go in the commit message or the PR. Doc comments on exported declarations are still
  expected: one line, what it is.

- Work on a feature branch, never the default branch. No `Co-Authored-By` trailers.
- **Docs that make a claim stay in lockstep with the code, in the same change:** the
  "What works today" list in `docs/features.md`, the README's requirements and its
  **Features** overview, which never contradicts `docs/features.md`, and `DESIGN.md` for anything
  visual. A doc that under- or over-claims the surface is a bug, not stale docs.
- In `docs/features.md`, a capability goes under the heading for its area, as one short bullet of
  at most about four lines. Visual detail goes in `DESIGN.md`. Quote UI text only where the words
  identify the capability, such as an error, a refusal, a notification title, or a format example.
- When `DESIGN.md` and the code disagree, update one of them in the same change.
- After `npx shadcn@latest add`, uninstall the `cn` package the registry adds and import `cn` from
  `@/lib/utils`.

## Development workflow

- Before you open a pull request, check the change against the invariants in this file.
- End-to-end sweep: `npm run build && npx playwright test`, then a development run with a real
  project: start a ticket, close and reopen Sandtable, and confirm the session survives.

### Protect the Sandtable you're running in

You may be running inside a Sandtable session, and the person's own Sandtable is probably open.

- Never quit, kill, or restart the running Sandtable app, and never `pkill` a pattern that could
  match it. Stop only processes you started, by their PID.
- Never quit or force quit an **Electron** icon in the Dock. A test copy of the app shares a macOS
  coalition with the tmux server, so quitting it ends every session.
- Never use the real data folder (`~/Library/Application Support/sandtable`). A development run
  shares it with the packaged app, so a branch's code would rewrite the person's projects and
  sessions. Run with a temporary one:
  `npm run dev -- -- --user-data-dir="$(mktemp -d)"`. The end-to-end tests already do this.
- Never stop or reconfigure the default tmux server. Every Sandtable session, including the one
  you may be in, runs there. Tests use their own socket through `setTmuxSocket`.
- A development run still starts real tmux sessions and creates real worktrees when you click
  **Start**, so use a throwaway project or don't start tickets.

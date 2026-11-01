# Workflow

Commit and branch conventions for this repo. Process rules (specs, plans, TDD, review) live in
[CLAUDE.md](../../CLAUDE.md); this file is only about what lands in git.

## Commits

- **No `Co-Authored-By:` trailers.** Commits are authored by the working user only. This
  overrides any harness default that appends a `Co-Authored-By: Claude ...` line.
- Conventional-commit prefixes, matching the existing history: `feat:`, `fix:`, `docs:`,
  `refactor:`, `test:`, `chore:`.
- Subject in the imperative, lowercase after the prefix, no trailing period. The body explains
  _why_ when the diff does not.
- One task from a plan is one commit. A task is not committed until its two-stage review passes.

## Branches

- Work on a **feature branch**, never `master`.
- **Commit or push only when the user asks.** Do not commit as a side effect of finishing a task.

## Tickets

Where tickets live is recorded in the `## Ticket tracking` section of
[CLAUDE.md](../../CLAUDE.md), chosen on the first build. Use the tracker, statuses, fields, body
format, and commands that section names.

**Track everything.** Follow-ups, deferred review findings, drift discovered mid-task, and
next-phase work become tickets. Do not leave them only in a plan doc or a review comment. A task
that lives in another repo gets its ticket there. Update ticket statuses when work lands, in the
same pass that pushes the code.

`DESIGN.md` and `docs/features.md` are the **design** record. The tracker is the **status**
record: what is done.

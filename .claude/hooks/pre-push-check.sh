#!/usr/bin/env bash
# PreToolUse(Bash) workflow gate for sandtable.
#
# Change the extension regex below to the repo's source files.
#
# Before code reaches the remote, remind about the verification round and the
# tracker update (CLAUDE.md -> ## Development workflow, ## Ticket tracking).
# Fires ONLY when a `git push` / `gh pr create` actually carries CODE changes.
# Docs/config pushes, branch/tag deletions, and no-op pushes pass silently.
#
# Soft gate: emits an "ask" decision (approve to proceed); never a hard block.
# When anything is ambiguous it fails open (no gate), to avoid nagging.
set -euo pipefail

payload="$(cat)"

if command -v jq >/dev/null 2>&1; then
  cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // ""')"
else
  cmd="$payload"
fi

# Only push / PR-creation are candidates.
case "$cmd" in
  *"git push"*|*"gh pr create"*) ;;
  *) exit 0 ;;
esac

# Branch/tag deletions add nothing — never gate them.
case "$cmd" in
  *" --delete"*|*" -d "*) exit 0 ;;
esac

# Files this branch changed relative to the remote default branch.
base="$(git symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null || echo origin/master)"
changed="$(git diff --name-only "$base...HEAD" 2>/dev/null || true)"

# Gate only when source is among the changes.
printf '%s\n' "$changed" | grep -Eq '\.(ts|tsx|js|jsx|css)$' || exit 0

cat <<'JSON'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "ask",
    "permissionDecisionReason": "sandtable workflow gate (CLAUDE.md): this push/PR includes source changes. Before it lands, confirm both: (1) the VERIFICATION ROUND ran, adversarial reviewers over the full diff (correctness, concurrency, spec compliance, security); reachable bugs fixed in this PR; (2) follow-up TICKETS are filed and their statuses updated in the tracker that CLAUDE.md ## Ticket tracking names. Approve to proceed once both are done."
  }
}
JSON

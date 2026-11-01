import type { SessionRecord } from '../../../shared/types'
import { Tip } from './Tip'

/** A quiet Sandboxed label for a session whose Bash runs in Claude Code's sandbox, with its limits in the tooltip. */
export function SandboxLabel({ session }: { session: SessionRecord }): React.JSX.Element | null {
  if (!session.sandbox) return null
  const domains = new Intl.ListFormat('en').format(session.sandbox.allowedDomains)
  return (
    <Tip
      label={`Sandboxed. Bash commands write only this session's folders and the temporary folder, can't read ~/.ssh, ~/.aws, ~/.gnupg, ~/.kube, ~/.docker/config.json, ~/.netrc, ~/.config/gcloud, ~/.azure, or Sandtable's data, and reach only ${domains}, plus the macOS trust service. SSH remotes, Docker, and tmux don't work in them. Other tools aren't sandboxed.`}
    >
      <span
        role="img"
        tabIndex={0}
        className="shrink-0 rounded-sm text-xs text-fg-3 outline-none focus-ring"
      >
        Sandboxed
      </span>
    </Tip>
  )
}

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useWorktreeSetup } from '@/hooks/useWorktreeSetup'
import { errorMessage } from '@/lib/utils'
import { MODEL_CHOICES, modelLabel, type Model, type Project } from '../../../shared/types'
import { SETUP_CANCELLED, SETUP_FAILED } from '../../../shared/worktreeSetup'
import { FieldHeading, MessageField, RepoPicker, WherePicker } from './RadioBox'
import { Segmented } from './Segmented'
import { SetupBlock } from './SetupBlock'
import type { OpenRoutine } from './RoutineEditor'

type Created = [string, string, boolean, undefined, string, Model | null, string]

/** Picks a repo and where a session without a ticket runs, starts it, and hands back its ID. */
export function NewSessionDialog({
  project,
  onCreated,
  onClose,
  onRoutine
}: {
  project: Project
  onCreated: (sessionId: string) => void
  onClose: () => void
  onRoutine: OpenRoutine
}): React.JSX.Element {
  const [github, setGithub] = useState(project.repos[0]?.github ?? '')
  const [worktree, setWorktree] = useState(false)
  const [message, setMessage] = useState('')
  const [model, setModel] = useState<Model | 'default'>(project.model ?? 'default')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [failed, setFailed] = useState<Created | null>(null)
  const [sent, setSent] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [setupId] = useState(() => crypto.randomUUID())
  const progress = useWorktreeSetup(setupId)
  const path = project.repos.find((r) => r.github === github)?.path

  const start = async (
    args: Created = [
      project.id,
      github,
      worktree,
      undefined,
      message,
      model === 'default' ? null : model,
      setupId
    ],
    setup?: false
  ): Promise<void> => {
    setBusy(true)
    setError(null)
    setFailed(null)
    setSent(true)
    try {
      onCreated(await window.sandtable.sessions.create(...args, setup))
    } catch (err) {
      const reason = errorMessage(err)
      if (reason.startsWith(SETUP_FAILED)) setFailed(args)
      else if (!reason.startsWith(SETUP_CANCELLED)) setError(`Couldn't start: ${reason}`)
      setBusy(false)
    }
  }
  const cancelSetup = (): void => {
    setFailed(null)
    setCancelling(true)
    void window.sandtable.setup
      .cancel(setupId)
      .catch((err) => setError(`Couldn't cancel the setup: ${errorMessage(err)}`))
      .finally(() => setCancelling(false))
  }
  const close = (): void => {
    if (sent) cancelSetup()
    onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && close()}>
      <DialogContent showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>New session in {project.name}</DialogTitle>
          <DialogDescription>
            Runs Claude Code with no ticket. Leave the first message empty to type it in the
            terminal.
          </DialogDescription>
        </DialogHeader>
        <RepoPicker repos={project.repos} name="session-repo" value={github} onChange={setGithub} />
        <WherePicker
          name="session-where"
          legend="Where"
          path={path}
          worktree={worktree}
          onChange={setWorktree}
        />
        <div className="flex flex-col gap-1.5">
          <FieldHeading id="session-model">Model</FieldHeading>
          <Segmented
            options={MODEL_CHOICES.map((m): [Model | 'default', string] => [m, modelLabel(m)])}
            value={model}
            onChange={setModel}
            aria-labelledby="session-model"
            className="auto-cols-auto"
          />
        </div>
        <MessageField
          id="session-message"
          placeholder="Optional"
          value={message}
          onChange={setMessage}
        />
        {error && <p className="text-xs text-danger">{error}</p>}
        {(failed || (busy && progress?.state === 'running')) && (
          <SetupBlock
            progress={progress}
            project={project}
            startAnyway={failed ? () => void start(failed, false) : undefined}
            cancel={cancelSetup}
          />
        )}
        <DialogFooter>
          <Button
            variant="ghost"
            disabled={busy}
            className="sm:mr-auto"
            onClick={() => {
              onRoutine(project, undefined, { repo: github, worktree, message })
              close()
            }}
          >
            Save as routine
          </Button>
          <Button variant="outline" disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button disabled={busy || cancelling || !!failed} onClick={() => void start()}>
            {busy ? 'Starting' : 'Start'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

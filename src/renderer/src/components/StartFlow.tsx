import { useState } from 'react'
import { flushSync } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { sameRepo, ticketLabel } from '../../../shared/repo'
import { sessionRepos } from '../../../shared/sessions'
import type { Pass } from '@/hooks/useOverlapCheck'
import type { Project, ProjectRepo, SessionRecord, Ticket } from '../../../shared/types'
import { RepoPicker } from './RadioBox'
import { StartCheckDialog } from './StartCheckDialog'

type Props = {
  project: Project
  ticket: Omit<Ticket, 'body'>
  mainRepo?: ProjectRepo
  session?: SessionRecord
  onStart: (extraRepos: string[], mainRepo: string | undefined, pass: Pass) => void
  onClose: () => void
}

/** Start's check, then the repo picker when the ticket has no repo or the project has more than one; hands the choice to `onStart`. */
export function StartFlow({
  project,
  ticket,
  mainRepo,
  session,
  onStart,
  onClose: close
}: Props): React.JSX.Element {
  const [opener] = useState(() => document.activeElement)
  const onClose = (): void => {
    flushSync(close)
    if (opener instanceof HTMLElement) opener.focus()
  }
  const [picking, setPicking] = useState<Pass | null>(null)
  const { repos } = project
  const [chosen, setChosen] = useState('')
  const main = mainRepo?.github ?? chosen
  const [picked, setPicked] = useState<string[]>(() =>
    session && !session.checkout
      ? sessionRepos(repos, { ...session, worktrees: session.worktrees.slice(1) }).map(
          (r) => r.github
        )
      : []
  )
  const others = repos.filter((r) => !sameRepo(r.github, main))

  if (!picking)
    return (
      <StartCheckDialog
        project={project}
        ticket={ticket}
        onPass={(pass) => {
          if (repos.length > 1 || !mainRepo) return setPicking(pass)
          onClose()
          onStart([], undefined, pass)
        }}
        onClose={onClose}
      />
    )
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Start <span className="font-mono">{ticketLabel(ticket)}</span> {ticket.title}
          </DialogTitle>
          <DialogDescription>
            {main
              ? `Runs Claude Code in a new worktree of ${main}.`
              : 'Choose the repo the worktree goes in.'}
          </DialogDescription>
        </DialogHeader>
        {!mainRepo && (
          <RepoPicker
            repos={repos}
            name="start-repo"
            legend="Repo for the worktree"
            value={main}
            onChange={setChosen}
          />
        )}
        {main && others.length > 0 && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-xs font-medium text-muted-foreground">
              Extra repos (optional)
            </legend>
            {others.map(({ github }) => (
              <Label
                key={github}
                className="highlight gap-2.5 rounded-card bg-fg/5 px-3 py-2.5 hover:bg-fg/8 has-data-[state=checked]:bg-fg/8"
              >
                <Checkbox
                  checked={picked.includes(github)}
                  onCheckedChange={(on) =>
                    setPicked((p) => (on === true ? [...p, github] : p.filter((g) => g !== github)))
                  }
                />
                {github}
              </Label>
            ))}
          </fieldset>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!main}
            onClick={() => {
              onClose()
              onStart(
                others.map((r) => r.github).filter((g) => picked.includes(g)),
                mainRepo ? undefined : main,
                picking
              )
            }}
          >
            Start
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

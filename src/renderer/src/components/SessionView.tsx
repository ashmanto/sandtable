import { ArrowLeft, Ellipsis, Pencil } from 'lucide-react'
import { useContext, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { FOLD_WIDTH, GAUGES_WIDTH, HeaderFrame, NARROW_WIDTH, headerTitle } from '@/lib/headerFrame'
import { Tip } from './Tip'
import { Input } from '@/components/ui/input'
import { useAfterMenu } from '@/hooks/useAfterMenu'
import { useLiveConversation } from '@/hooks/useLiveConversation'
import { useRun } from '@/hooks/useRun'
import { cleanUp } from '@/lib/cleanUp'
import { isLive, sessionRepos } from '../../../shared/sessions'
import type { Project, SessionRecord } from '../../../shared/types'
import { ClearNeedsYou, RaiseCap } from './ClearNeedsYou'
import type { OpenRoutine } from './RoutineEditor'
import { SessionBadge } from './SessionBadge'
import { GaugesButton, GaugesPanel } from './GaugesPanel'
import { SessionConversation } from './SessionConversation'
import { Message } from './TabContent'
import { HeaderRule, ViewHeader } from './ViewHeader'

/** A session without a ticket filling the window: its header, then its live conversation. */
export function SessionView({
  session,
  project,
  onBack,
  onRoutine
}: {
  session: SessionRecord
  project: Project
  onBack: () => void
  onRoutine: OpenRoutine
}): React.JSX.Element {
  const { error, result, pending, clear, run } = useRun()
  const [draft, setDraft] = useState<string | null>(null)
  const { id } = session
  const live = isLive(session)
  const removed = !!session.removedAt
  const worktree = session.worktrees.length > 0
  const danger = error ?? session.startWarning
  const { width } = useContext(HeaderFrame)
  const narrow = width < NARROW_WIDTH
  const folded = width < GAUGES_WIDTH
  const conversation = useLiveConversation(removed ? '' : id)
  const gauges = {
    session,
    project,
    facts: conversation.facts,
    entries: conversation.entries ?? []
  }
  const actions: [string, Parameters<typeof run>[0]][] = live
    ? [['End session', () => window.sandtable.sessions.end(id)]]
    : [[worktree ? 'Remove worktree' : 'Remove from list', () => cleanUp(id, false, worktree)]]
  if (live && worktree) actions.push(['End session and remove worktree', () => cleanUp(id, true)])
  const fold = width < (actions.length > 1 ? FOLD_WIDTH : NARROW_WIDTH)
  const saveable = !session.ticketKey
  const { later, afterMenu } = useAfterMenu()
  const saveAsRoutine = (): Promise<boolean> =>
    run(async () => {
      const message = await window.sandtable.sessions.firstMessage(id)
      const repo = sessionRepos(project.repos, session)[0]?.github ?? ''
      onRoutine(project, undefined, { repo, worktree, message })
    })

  const rename = async (name: string): Promise<void> => {
    if (await run(() => window.sandtable.sessions.rename(id, name))) setDraft(null)
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <ViewHeader>
        <div className="flex flex-1 items-center gap-3">
          <Tip label="Back to board">
            <Button variant="ghost" size="icon-sm" onClick={onBack}>
              <ArrowLeft />
            </Button>
          </Tip>
          {draft === null ? (
            <>
              <h1 className={headerTitle}>{session.name}</h1>
              <Tip label="Rename session">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="size-7"
                  disabled={pending}
                  onClick={() => setDraft(session.name ?? '')}
                >
                  <Pencil />
                </Button>
              </Tip>
            </>
          ) : (
            <Input
              aria-label="Session name"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              className="h-7 w-0 max-w-60 min-w-24 grow"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void rename(draft)
                if (e.key !== 'Escape') return
                setDraft(null)
                clear()
              }}
            />
          )}
        </div>
        <SessionBadge state={session.state} />
        <ClearNeedsYou session={session} run={run} disabled={pending} icon={narrow} />
        <RaiseCap session={session} run={run} disabled={pending} icon={narrow} />
        {!removed && folded && <GaugesButton {...gauges} />}
        {!removed && (
          <>
            <HeaderRule />
            <div className="flex gap-2">
              {!fold &&
                actions.map(([label, action]) => (
                  <Button
                    key={label}
                    variant="outline"
                    disabled={pending}
                    onClick={() => void run(action)}
                  >
                    {label}
                  </Button>
                ))}
              {(fold || saveable) && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Tip label="More actions">
                      <Button variant="ghost" size="icon-sm" disabled={pending}>
                        <Ellipsis />
                      </Button>
                    </Tip>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" onCloseAutoFocus={afterMenu}>
                    {fold &&
                      actions.map(([label, action]) => (
                        <DropdownMenuItem key={label} onSelect={() => void run(action)}>
                          {label}
                        </DropdownMenuItem>
                      ))}
                    {saveable && (
                      <DropdownMenuItem onSelect={() => later(() => void saveAsRoutine())}>
                        Save as routine
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </>
        )}
      </ViewHeader>
      {result && <p className="px-4 py-1.5 text-xs text-fg-2">{result}</p>}
      {danger && <p className="bg-danger-soft px-4 py-1.5 text-xs text-danger">{danger}</p>}
      <div className="flex min-h-0 flex-1 flex-col">
        {removed ? (
          <Message title="Session removed" text="It's no longer listed." />
        ) : (
          <SessionConversation
            session={session}
            conversation={conversation}
            panel={!folded && <GaugesPanel {...gauges} />}
            actions={
              <div className="flex justify-center">
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() => void run(() => window.sandtable.sessions.resume(id))}
                >
                  Resume
                </Button>
              </div>
            }
          />
        )}
      </div>
    </div>
  )
}

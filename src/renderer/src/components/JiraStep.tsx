import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { onEnter, plural } from '@/lib/utils'
import { NO_ACCOUNT, type JiraSource } from '../hooks/useJiraSource'
import { FieldHeading, RadioBox } from './RadioBox'
import { LoadState, Problem } from './StepFlow'

/** The Jira step: account, with an inline sign-in form, then project and board. */
export function JiraStep({ source }: { source: JiraSource }): React.JSX.Element {
  const {
    jiraAccounts,
    jiraAccountsLoading,
    jiraAccountsError,
    loadJiraAccounts,
    jiraSite,
    pickJiraAccount,
    adding,
    setAdding,
    addJiraAccount,
    signingIn,
    signInError,
    setSignInError,
    jiraList,
    jiraLoading,
    jiraError,
    loadJiraProjects,
    jiraKey,
    shownJira,
    jiraFilterRef,
    jiraFilter,
    setJiraFilter,
    pickJiraProject,
    jiraBoards,
    boardsLoading,
    boardsError,
    loadJiraBoards,
    jiraBoard,
    setJiraBoard
  } = source
  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <FieldHeading id="jira-account">Jira account</FieldHeading>
        <LoadState
          loading={jiraAccountsLoading}
          text="Loading Jira accounts…"
          failed={
            jiraAccountsError
              ? { title: "Couldn't read the saved Jira accounts.", detail: jiraAccountsError }
              : null
          }
          onRetry={() => void loadJiraAccounts()}
        />
        {jiraAccounts && jiraAccounts.length > 0 && (
          <div role="radiogroup" aria-labelledby="jira-account" className="flex flex-col gap-2">
            {jiraAccounts.map((a) => (
              <RadioBox
                key={a.site}
                name="jira-account"
                checked={jiraSite === a.site}
                title={<span className="font-mono">{a.site}</span>}
                help={`${a.email} · token encrypted on this Mac`}
                disabled={signingIn}
                onChange={() => pickJiraAccount(a.site)}
              />
            ))}
          </div>
        )}
        {adding ? (
          <div
            role="group"
            aria-label="Add a Jira account"
            className="flex flex-col gap-3 rounded-card bg-card p-3"
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="jira-site">Jira site</Label>
                <Input
                  id="jira-site"
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono"
                  placeholder="yourteam.atlassian.net"
                  value={adding.site}
                  onChange={(e) => setAdding({ ...adding, site: e.target.value })}
                  onKeyDown={onEnter(() => void addJiraAccount())}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="jira-email">Atlassian email</Label>
                <Input
                  id="jira-email"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="you@company.com"
                  value={adding.email}
                  onChange={(e) => setAdding({ ...adding, email: e.target.value })}
                  onKeyDown={onEnter(() => void addJiraAccount())}
                />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="jira-token">API token</Label>
              <Input
                id="jira-token"
                type="password"
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
                placeholder="Paste a token from id.atlassian.com"
                aria-describedby="jira-token-help"
                value={adding.token}
                onChange={(e) => setAdding({ ...adding, token: e.target.value })}
                onKeyDown={onEnter(() => void addJiraAccount())}
              />
              <p id="jira-token-help" className="text-xs text-fg-2">
                Sandtable keeps it encrypted with a key from your macOS Keychain and reuses it for
                every project on this site.
              </p>
            </div>
            {signInError && <Problem title={signInError} />}
            <div className="flex gap-2">
              <Button
                disabled={
                  signingIn || !adding.site.trim() || !adding.email.trim() || !adding.token.trim()
                }
                onClick={() => void addJiraAccount()}
              >
                {signingIn ? 'Signing in…' : 'Add account'}
              </Button>
              {!!jiraAccounts?.length && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setAdding(null)
                    setSignInError(null)
                  }}
                >
                  Cancel
                </Button>
              )}
            </div>
          </div>
        ) : (
          jiraAccounts && (
            <Button
              variant="ghost"
              size="xs"
              className="self-start"
              onClick={() => setAdding(NO_ACCOUNT)}
            >
              Add a Jira account…
            </Button>
          )
        )}
      </div>
      <LoadState
        loading={jiraLoading}
        text="Loading Jira projects…"
        failed={jiraError ? { title: "Couldn't load the Jira projects.", detail: jiraError } : null}
        onRetry={() => void loadJiraProjects(jiraSite, jiraKey)}
      />
      {jiraList?.length === 0 && <p className="text-xs text-fg-2">No projects on this site.</p>}
      {shownJira && jiraList?.length !== 0 && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="jira-filter">Filter projects</Label>
          <Input
            ref={jiraFilterRef}
            id="jira-filter"
            autoComplete="off"
            spellCheck={false}
            placeholder={`Filter ${plural(jiraList!.length, 'project')}`}
            value={jiraFilter}
            onChange={(e) => setJiraFilter(e.target.value)}
          />
          {shownJira.length === 0 ? (
            <p className="text-xs text-fg-2">No project matches.</p>
          ) : (
            <div
              role="radiogroup"
              aria-label="Jira project"
              className="flex max-h-72 flex-col gap-2 overflow-y-auto"
            >
              {shownJira.map((p) => (
                <RadioBox
                  key={p.key}
                  name="jira-project"
                  checked={jiraKey === p.key}
                  title={p.name}
                  help={p.key}
                  onChange={() => pickJiraProject(p)}
                />
              ))}
            </div>
          )}
        </div>
      )}
      {jiraKey && (
        <LoadState
          loading={boardsLoading}
          text="Loading Jira boards…"
          failed={
            boardsError ? { title: "Couldn't load the Jira boards.", detail: boardsError } : null
          }
          onRetry={() => void loadJiraBoards(jiraSite, jiraKey, jiraBoard)}
        >
          {jiraBoards?.length === 0 && (
            <p className="text-xs text-fg-2">
              This project has no board, so Sandtable shows every issue.
            </p>
          )}
          {!!jiraBoards?.length && (
            <div className="flex flex-col gap-2">
              <FieldHeading id="jira-board">Jira board</FieldHeading>
              <p id="jira-board-help" className="text-xs text-fg-2">
                Sandtable shows what the board shows: its active sprints, or, on a board without
                sprints, everything outside its backlog.
              </p>
              <div
                role="radiogroup"
                aria-labelledby="jira-board"
                aria-describedby="jira-board-help"
                className="flex max-h-72 flex-col gap-2 overflow-y-auto"
              >
                {jiraBoards.map((b) => (
                  <RadioBox
                    key={b.id}
                    name="jira-board"
                    checked={jiraBoard?.id === b.id}
                    title={b.name}
                    onChange={() => setJiraBoard(b)}
                  />
                ))}
                <RadioBox
                  name="jira-board"
                  checked={jiraBoard === null}
                  title="No board (show every issue)"
                  onChange={() => setJiraBoard(null)}
                />
              </div>
            </div>
          )}
        </LoadState>
      )}
    </div>
  )
}

/** The Jira project as the Review step lists it. */
export function JiraReview({ source }: { source: JiraSource }): React.JSX.Element {
  const { jiraName, jiraKey, jiraSite, jiraBoard } = source
  return (
    <>
      <span>{`Jira project ${jiraName} (${jiraKey}) on ${jiraSite}`}</span>
      <span className="text-xs text-fg-2">
        {jiraBoard ? `On board ${jiraBoard.name}` : 'No board, so every issue shows'}
      </span>
    </>
  )
}

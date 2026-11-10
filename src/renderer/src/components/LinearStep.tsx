import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import type { LinearSource } from '../hooks/useLinearSource'
import { LabeledSelect, LoadState } from './StepFlow'

/** The Linear step: workspace, team, and optional Linear projects. */
export function LinearStep({ source }: { source: LinearSource }): React.JSX.Element {
  const { workspaces, teams, workspace, team, projects, teamInfo } = source
  return (
    <div className="mt-4 flex flex-col gap-3">
      <LoadState
        loading={workspaces.loading}
        text="Loading workspaces…"
        failed={
          workspaces.error
            ? { title: "Couldn't load the Linear workspaces.", detail: workspaces.error }
            : null
        }
        onRetry={() => void source.loadWorkspaces()}
      />
      {workspaces.data && workspaces.data.length > 0 && (
        <LabeledSelect
          id="linear-workspace"
          label="Workspace"
          value={workspace}
          onChange={source.changeWorkspace}
          options={workspaces.data.map((w) => ({
            value: w.slug,
            label: `${w.organization} (${w.slug})`
          }))}
        />
      )}
      <LoadState
        loading={teams.loading}
        text="Loading teams…"
        failed={
          teams.error ? { title: "Couldn't load the Linear teams.", detail: teams.error } : null
        }
        onRetry={() => void source.loadTeams(workspace, team)}
      />
      {teams.data && (
        <LabeledSelect
          id="linear-team"
          label="Team"
          value={team}
          onChange={source.pickTeam}
          options={teams.data.map((t) => ({ value: t.key, label: `${t.name} (${t.key})` }))}
        />
      )}
      {teamInfo && teamInfo.projects.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 font-medium">Linear projects (optional)</legend>
          {teamInfo.projects.map((lp) => (
            <Label key={lp.id} className="gap-2.5 font-normal">
              <Checkbox
                checked={projects.some((p) => p.id === lp.id)}
                onCheckedChange={(on) =>
                  source.setProjects((ps) =>
                    teamInfo.projects.filter((p) =>
                      p.id === lp.id ? on === true : ps.some((x) => x.id === p.id)
                    )
                  )
                }
              />
              {lp.name}
            </Label>
          ))}
          <p className="text-xs text-fg-2">Leave all unchecked to show the whole team.</p>
        </fieldset>
      )}
    </div>
  )
}

/** The Linear team as the Review step lists it. */
export function LinearReview({ source }: { source: LinearSource }): React.JSX.Element {
  const { workspace, workspaceInfo, team, teamInfo, projects } = source
  return (
    <>
      <span>Linear team</span>
      {workspace && (
        <span className="text-xs text-fg-2">
          {workspaceInfo ? `${workspaceInfo.organization} (${workspace})` : workspace}
        </span>
      )}
      <span className="text-xs text-fg-2">{teamInfo ? `${teamInfo.name} (${team})` : team}</span>
      {projects.length > 0 && (
        <span className="text-xs text-fg-2">{projects.map((p) => p.name).join(', ')}</span>
      )}
    </>
  )
}

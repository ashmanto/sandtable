import { useEffect, useState } from 'react'
import { useLatestLoad } from './useLatestLoad'
import type { LinearTeam, LinearWorkspace, Project } from '../../../shared/types'

type Linear = NonNullable<Project['linear']>

/** The Linear team a project's tickets come from: its workspace, team, and projects, with their lists. */
export type LinearSource = {
  issue: string | null
  summary: string
  saved: Linear | null
  activate: () => void
  reset: () => void
  workspaces: ReturnType<typeof useLatestLoad<LinearWorkspace[]>>
  teams: ReturnType<typeof useLatestLoad<LinearTeam[]>>
  workspace: string
  team: string
  projects: Linear['projects']
  workspaceInfo?: LinearWorkspace
  teamInfo?: LinearTeam
  loadWorkspaces: () => Promise<void>
  changeWorkspace: (slug: string) => void
  loadTeams: (workspace: string, keep: string) => Promise<void>
  pickTeam: (key: string) => void
  setProjects: React.Dispatch<React.SetStateAction<Linear['projects']>>
}

/** The Linear step's state, prefilled from `project` and loaded once when it has a Linear team. */
export function useLinearSource(project?: Project): LinearSource {
  const workspaces = useLatestLoad<LinearWorkspace[]>()
  const [workspace, setWorkspace] = useState(project?.linear?.workspace ?? '')
  const teams = useLatestLoad<LinearTeam[]>()
  const [team, setTeam] = useState(project?.linear?.team ?? '')
  const [projects, setProjects] = useState(project?.linear?.projects ?? [])

  useEffect(() => {
    if (project?.linear) void loadWorkspaces()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loads the saved project's lists once; later picks load their own
  }, [])

  function loadWorkspaces(): Promise<void> {
    return workspaces.load(
      () => window.sandtable.projects.linearWorkspaces(),
      (loaded) => {
        const picked = (
          loaded.find((w) => w.slug === workspace) ??
          loaded.find((w) => w.default) ??
          loaded[0]
        )?.slug
        if (!picked) throw new Error('Run `linear auth login`.')
        if (workspace && picked !== workspace) return changeWorkspace(picked)
        setWorkspace(picked)
        void loadTeams(picked, team)
      }
    )
  }

  function changeWorkspace(value: string): void {
    setWorkspace(value)
    teams.set(null)
    setTeam('')
    setProjects([])
    void loadTeams(value, '')
  }

  function loadTeams(ws: string, keep: string): Promise<void> {
    return teams.load(
      () => window.sandtable.projects.linearTeams(ws),
      (loaded) => {
        const kept = loaded.find((t) => t.key === keep)
        setTeam(kept ? keep : '')
        setProjects((ps) => kept?.projects.filter((k) => ps.some((p) => p.id === k.id)) ?? [])
      }
    )
  }

  return {
    issue: team
      ? null
      : workspaces.loading
        ? 'Loading workspaces…'
        : workspaces.error
          ? 'Load the Linear workspaces'
          : teams.loading
            ? 'Loading teams…'
            : teams.data
              ? 'Choose a team'
              : 'Load the Linear teams',
    summary: `Linear team ${team}`,
    saved: team ? { team, projects, ...(workspace && { workspace }) } : null,
    activate: () => {
      if (!workspaces.data && !workspaces.loading) void loadWorkspaces()
    },
    reset: () => {
      setTeam('')
      setProjects([])
    },
    workspaces,
    teams,
    workspace,
    team,
    projects,
    workspaceInfo: workspaces.data?.find((w) => w.slug === workspace),
    teamInfo: teams.data?.find((t) => t.key === team),
    loadWorkspaces,
    changeWorkspace,
    loadTeams,
    pickTeam: (key) => {
      setTeam(key)
      setProjects([])
    },
    setProjects
  }
}

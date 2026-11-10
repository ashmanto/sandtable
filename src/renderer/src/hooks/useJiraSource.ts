import { useEffect, useRef, useState } from 'react'
import { errorMessage } from '@/lib/utils'
import { useLatestLoad } from './useLatestLoad'
import type { JiraAccount, Project } from '../../../shared/types'

type Board = { id: number; name: string }
type JiraProject = { key: string; name: string }
type Adding = { site: string; email: string; token: string }

/** An empty Add a Jira account form. */
export const NO_ACCOUNT: Adding = { site: '', email: '', token: '' }

/** The Jira project a project's tickets come from: its account, project, and board, with their lists and the sign-in form. */
export type JiraSource = {
  issue: string | null
  summary: string
  saved: NonNullable<Project['jira']> | null
  activate: () => void
  reset: () => void
  jiraAccounts: JiraAccount[] | null
  jiraAccountsLoading: boolean
  jiraAccountsError: string | null
  loadJiraAccounts: () => Promise<void>
  jiraSite: string
  pickJiraAccount: (site: string) => void
  adding: Adding | null
  setAdding: (adding: Adding | null) => void
  addJiraAccount: () => Promise<void>
  signingIn: boolean
  signInError: string | null
  setSignInError: (error: string | null) => void
  jiraList: JiraProject[] | null
  jiraLoading: boolean
  jiraError: string | null
  loadJiraProjects: (site: string, keep: string) => Promise<void>
  jiraKey: string
  jiraName: string
  shownJira: JiraProject[] | undefined
  jiraFilterRef: React.RefObject<HTMLInputElement | null>
  jiraFilter: string
  setJiraFilter: (filter: string) => void
  pickJiraProject: (p: JiraProject) => void
  jiraBoards: Board[] | null
  boardsLoading: boolean
  boardsError: string | null
  loadJiraBoards: (site: string, key: string, keep: Board | null | undefined) => Promise<void>
  jiraBoard: Board | null | undefined
  setJiraBoard: (board: Board | null) => void
}

/** The Jira step's state, prefilled from `project` and loaded once when it has a Jira project. */
export function useJiraSource(project?: Project): JiraSource {
  const jiraAccountsLoad = useLatestLoad<JiraAccount[]>()
  const {
    data: jiraAccounts,
    loading: jiraAccountsLoading,
    error: jiraAccountsError
  } = jiraAccountsLoad
  const jiraFilterRef = useRef<HTMLInputElement>(null)
  const focusFilter = useRef(false)
  const [jiraSite, setJiraSite] = useState(project?.jira?.site ?? '')
  const [adding, setAdding] = useState<Adding | null>(null)
  const [signingIn, setSigningIn] = useState(false)
  const [signInError, setSignInError] = useState<string | null>(null)
  const jiraLoad = useLatestLoad<JiraProject[]>()
  const { data: jiraList, loading: jiraLoading, error: jiraError } = jiraLoad
  const [jiraKey, setJiraKey] = useState(project?.jira?.project ?? '')
  const [jiraName, setJiraName] = useState(project?.jira?.name ?? '')
  const boardsLoad = useLatestLoad<Board[]>()
  const { data: jiraBoards, loading: boardsLoading, error: boardsError } = boardsLoad
  const [jiraBoard, setJiraBoard] = useState<Board | null | undefined>(
    project?.jira ? (project.jira.board ?? null) : undefined
  )
  const [jiraFilter, setJiraFilter] = useState('')

  useEffect(() => {
    if (project?.jira) {
      void loadJiraAccounts()
      void loadJiraProjects(project.jira.site, project.jira.project)
      void loadJiraBoards(project.jira.site, project.jira.project, project.jira.board ?? null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loads the saved project's lists once; later picks load their own
  }, [])

  useEffect(() => {
    if (!jiraList || !focusFilter.current) return
    focusFilter.current = false
    jiraFilterRef.current?.focus()
  }, [jiraList])

  const shownJira = jiraList?.filter((p) =>
    `${p.key} ${p.name}`.toLowerCase().includes(jiraFilter.trim().toLowerCase())
  )

  function loadJiraAccounts(): Promise<void> {
    return jiraAccountsLoad.load(
      () => window.sandtable.projects.jiraAccounts(),
      (loaded) => {
        if (!loaded.length) setAdding(NO_ACCOUNT)
      }
    )
  }

  function loadJiraProjects(site: string, keep: string): Promise<void> {
    return jiraLoad.load(
      () => window.sandtable.projects.jiraProjects(site),
      (loaded) => {
        const kept = loaded.find((p) => p.key === keep)
        setJiraKey(kept ? keep : '')
        if (kept) setJiraName(kept.name)
      }
    )
  }

  function loadJiraBoards(
    site: string,
    key: string,
    keep: Board | null | undefined
  ): Promise<void> {
    return boardsLoad.load(
      () => window.sandtable.projects.jiraBoards(site, key),
      (loaded) => {
        setJiraBoard(
          loaded.length === 0 || keep === null
            ? null
            : (loaded.find((b) => b.id === keep?.id) ??
                (loaded.length === 1 ? loaded[0] : undefined))
        )
      }
    )
  }

  function pickJiraProject(p: { key: string; name: string }): void {
    setJiraKey(p.key)
    setJiraName(p.name)
    boardsLoad.set(null)
    setJiraBoard(undefined)
    void loadJiraBoards(jiraSite, p.key, undefined)
  }

  function pickJiraAccount(site: string): void {
    boardsLoad.cancel()
    boardsLoad.set(null)
    setJiraBoard(undefined)
    setJiraSite(site)
    jiraLoad.set(null)
    setJiraKey('')
    setJiraFilter('')
    void loadJiraProjects(site, '')
  }

  async function addJiraAccount(): Promise<void> {
    if (!adding || signingIn || !adding.site.trim() || !adding.email.trim() || !adding.token.trim())
      return
    setSigningIn(true)
    setSignInError(null)
    try {
      const added = await window.sandtable.projects.jiraSignIn(
        adding.site.trim(),
        adding.email.trim(),
        adding.token
      )
      jiraAccountsLoad.set((as) => [...(as ?? []).filter((a) => a.site !== added.site), added])
      setAdding(null)
      focusFilter.current = true
      pickJiraAccount(added.site)
    } catch (err) {
      setSignInError(errorMessage(err))
    } finally {
      setSigningIn(false)
    }
  }

  const issue = jiraKey
    ? jiraBoard !== undefined
      ? null
      : boardsLoading
        ? 'Loading Jira boards…'
        : boardsError
          ? 'Load the Jira boards'
          : 'Choose a Jira board'
    : !jiraSite
      ? 'Choose a Jira account'
      : jiraLoading
        ? 'Loading Jira projects…'
        : jiraList
          ? 'Choose a Jira project'
          : 'Load the Jira projects'

  return {
    issue,
    summary: `Jira project ${jiraKey}`,
    saved:
      issue === null
        ? {
            site: jiraSite,
            project: jiraKey,
            name: jiraName,
            ...(jiraBoard && { board: jiraBoard })
          }
        : null,
    activate: () => {
      if (!jiraAccounts && !jiraAccountsLoading) void loadJiraAccounts()
      if (jiraAccounts?.length === 0) setAdding(NO_ACCOUNT)
    },
    reset: () => {
      setAdding(null)
      setSignInError(null)
    },
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
    jiraName,
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
  }
}

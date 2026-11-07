import { useCallback, useEffect, useRef, useState } from 'react'
import { AddProject } from './components/AddProject'
import { Board } from './components/Board'
import { NewSessionDialog } from './components/NewSessionDialog'
import { ProjectSidebar, slide } from './components/ProjectSidebar'
import { RoutineEditor, type OpenRoutine, type RoutineDraft } from './components/RoutineEditor'
import { dropRunHistoryAsk, openRunHistory } from '@/lib/runHistory'
import { SessionView } from './components/SessionView'
import { Settings } from './components/Settings'
import { SetupGuide } from './components/SetupGuide'
import { Spinner } from './components/StepFlow'
import { TicketView } from './components/TicketView'
import { UsagePage } from './components/UsagePage'
import { HeaderFrame, panelWidth } from '@/lib/headerFrame'
import { push, reachable, replace, same, walk, type History, type Route } from '@/lib/history'
import { cn, errorMessage } from '@/lib/utils'
import { useBoard } from './hooks/useBoard'
import { SIDEBAR_WIDTH, type BoardView, type WindowFrame } from '../../shared/api'
import {
  TICKET_TABS,
  type LastView,
  type Project,
  type ProjectGroup,
  type Routine,
  type TicketTab,
  type ToolCheck
} from '../../shared/types'

type Page = 'settings' | 'usage' | null
type Screen = { route: Route | null; page: Page }

const panel = 'm-2 flex min-w-0 flex-1 overflow-hidden rounded-card border bg-panel'

const homeRoute = (projects: Project[]): Route =>
  projects[0] ? { name: 'board', projectId: projects[0].id } : { name: 'add', projectId: 'new' }

const restoreRoute = (
  saved: LastView | null,
  projects: Project[],
  { tickets, sessions }: Pick<BoardView, 'tickets' | 'sessions'>
): Route => {
  const { projectId, ticketKey, sessionId, tab } = saved ?? { projectId: '' }
  const tries: Route[] = [
    ...(ticketKey
      ? [
          {
            name: 'ticket' as const,
            projectId,
            ticketKey,
            tab: tab && TICKET_TABS.includes(tab) ? tab : undefined
          }
        ]
      : []),
    ...(sessionId ? [{ name: 'session' as const, projectId, sessionId }] : []),
    { name: 'board', projectId }
  ]
  return tries.find((r) => reachable(r, projects, { tickets, sessions })) ?? homeRoute(projects)
}

const none = { tickets: [], sessions: [] }

function App(): React.JSX.Element | null {
  const [projects, setProjects] = useState<Project[]>([])
  const [search, setSearch] = useState({ projectId: '', text: '' })
  const [groups, setGroups] = useState<ProjectGroup[]>([])
  const [history, setHistory] = useState<History<Screen>>({
    entries: [{ route: null, page: null }],
    index: 0
  })
  const { route, page } = history.entries[history.index]
  const setRoute = useCallback(
    (next: Route | ((r: Route | null) => Route | null)) =>
      setHistory((h) => {
        const { route, page } = h.entries[h.index]
        const to = typeof next === 'function' ? next(route) : next
        return !page &&
          route?.name === 'ticket' &&
          to?.name === 'ticket' &&
          same({ ...route, tab: 0 }, { ...to, tab: 0 })
          ? replace(h, { route: to, page })
          : push(h, { route: to, page: null })
      }),
    []
  )
  const setPage = useCallback(
    (page: Page) => setHistory((h) => push(h, { route: h.entries[h.index].route, page })),
    []
  )
  const [tools, setTools] = useState<ToolCheck | { error: string } | null>(null)
  const [firstRun, setFirstRun] = useState(false)
  const [guide, setGuide] = useState(false)
  const [newSessionFor, setNewSessionFor] = useState<Project | null>(null)
  const [routineFor, setRoutineFor] = useState<{
    project: Project
    routine?: Routine
    draft?: RoutineDraft
  } | null>(null)
  const onRoutine: OpenRoutine = (project, routine, draft) =>
    setRoutineFor({ project, routine, draft })
  const [width, setWidth] = useState(Infinity)
  const measure = useCallback((panel: HTMLElement | null) => {
    if (!panel) return
    const observer = new ResizeObserver(([entry]) =>
      setWidth(panelWidth(entry.borderBoxSize[0].inlineSize))
    )
    observer.observe(panel)
    return () => observer.disconnect()
  }, [])
  const [frame, setFrame] = useState<WindowFrame>({
    sidebarHidden: false,
    sidebarWidth: SIDEBAR_WIDTH.default,
    fullScreen: false
  })

  const checkTools = (live = (): boolean => true): Promise<ToolCheck | { error: string }> =>
    window.sandtable.app
      .tools()
      .catch((err) => ({ error: errorMessage(err) }))
      .then((check) => {
        if (live()) setTools(check)
        return check
      })

  useEffect(() => {
    let live = true
    const fill = (route: Route): void =>
      setHistory((h) => {
        const entries = h.entries.map((e) => (e.route ? e : { ...e, route }))
        return same(entries[0], entries[1])
          ? { entries: entries.slice(1), index: h.index - 1 }
          : { ...h, entries }
      })
    void checkTools(() => live).then(
      (check) => live && ('error' in check || !check.ok) && setGuide(true)
    )
    void Promise.all([
      window.sandtable.projects.list(),
      window.sandtable.app.lastView(),
      window.sandtable.projects.groups()
    ])
      .then(async ([list, saved, groupList]) => {
        const view =
          (saved?.ticketKey || saved?.sessionId) && list.some((p) => p.id === saved.projectId)
            ? await window.sandtable.board.get(saved.projectId).catch(() => none)
            : none
        setProjects(list)
        setGroups(groupList)
        if (!list.length) {
          setFirstRun(true)
          setGuide(true)
        }
        fill(restoreRoute(saved, list, view))
      })
      .catch(() => fill(homeRoute([])))
    const open = ({ projectId, ticketKey, sessionId, tab }: LastView): void =>
      setRoute((r) =>
        ticketKey
          ? r?.name === 'ticket' &&
            r.projectId === projectId &&
            r.ticketKey === ticketKey &&
            (!tab || r.tab === tab)
            ? r
            : { name: 'ticket', projectId, ticketKey, tab }
          : sessionId
            ? { name: 'session', projectId, sessionId }
            : r
      )
    const offFrame = window.sandtable.app.onFrame(setFrame)
    void window.sandtable.app.frame().then((f) => live && setFrame(f))
    const off = window.sandtable.app.onOpen(open)
    const offSettings = window.sandtable.app.onSettings(() => setPage('settings'))
    void window.sandtable.app
      .pendingOpen()
      .then((v) => (v === 'settings' ? setPage('settings') : v && open(v)))
    return () => {
      live = false
      off()
      offSettings()
      offFrame()
    }
  }, [setRoute, setPage])

  useEffect(() => {
    if (!route || route.projectId === 'new') return
    window.sandtable.app.saveView({
      projectId: route.projectId,
      ...(route.name === 'ticket' && { ticketKey: route.ticketKey, tab: route.tab }),
      ...(route.name === 'session' && { sessionId: route.sessionId })
    })
  }, [route])
  const onTabChange = useCallback(
    (tab: TicketTab) =>
      setHistory((h) => {
        const { route } = h.entries[h.index]
        return route?.name === 'ticket' && route.tab !== tab
          ? replace(h, { ...h.entries[h.index], route: { ...route, tab } })
          : h
      }),
    []
  )

  const latest = useRef(history)
  useEffect(() => {
    latest.current = history
  })
  const queue = useRef(Promise.resolve())
  const go = (step: 1 | -1): void => {
    const views = new Map<string, Promise<Pick<BoardView, 'tickets' | 'sessions'>>>()
    const viewOf = (id: string): Promise<Pick<BoardView, 'tickets' | 'sessions'>> => {
      if (!views.has(id))
        views.set(
          id,
          window.sandtable.board.get(id).catch(() => none)
        )
      return views.get(id)!
    }
    queue.current = queue.current.then(async () => {
      const from = latest.current
      const next = await walk(
        from,
        step,
        async ({ route }) =>
          !!route &&
          reachable(
            route,
            projects,
            route.name === 'ticket' || route.name === 'session'
              ? await viewOf(route.projectId)
              : none
          )
      )
      if (latest.current !== from) return
      latest.current = next
      setHistory((h) => (h === from ? next : h))
    })
  }
  const nav = {
    back: history.index > 0 ? () => go(-1) : undefined,
    forward: history.index < history.entries.length - 1 ? () => go(1) : undefined
  }
  useEffect(() => {
    if (guide) return
    const modal = (): boolean => !!document.querySelector('[role=dialog],[role=alertdialog]')
    const onKey = (e: KeyboardEvent): void => {
      const step = e.key === '[' ? -1 : e.key === ']' ? 1 : 0
      if (!step || !e.metaKey || e.ctrlKey || e.shiftKey || modal()) return
      e.preventDefault()
      ;(step < 0 ? nav.back : nav.forward)?.()
    }
    const onMouse = (e: MouseEvent): void => {
      const step = e.button === 3 ? -1 : e.button === 4 ? 1 : 0
      if (!step || modal()) return
      e.preventDefault()
      ;(step < 0 ? nav.back : nav.forward)?.()
    }
    const offSwipe = window.sandtable.app.onSwipe((direction) => {
      if (!modal())
        (direction === 'left' ? nav.back : direction === 'right' ? nav.forward : null)?.()
    })
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mouseup', onMouse)
    return () => {
      offSwipe()
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mouseup', onMouse)
    }
  })

  const activeId = route && route.projectId !== 'new' ? route.projectId : (projects[0]?.id ?? null)
  const { view, sync } = useBoard(activeId)
  const [lastView, setLastView] = useState(view)
  if (view && view !== lastView) setLastView(view)
  const counts = (view ?? lastView)?.needsYou ?? {}
  const project = projects.find((p) => p.id === route?.projectId)
  if (project && search.projectId !== project.id) setSearch({ projectId: project.id, text: '' })
  const toBoard = (projectId: string): void => setRoute({ name: 'board', projectId })
  const boardShown = route?.name === 'board' && !page ? route.projectId : null
  useEffect(() => dropRunHistoryAsk(boardShown), [boardShown])
  const toSession = (projectId: string, sessionId: string): void =>
    setRoute({ name: 'session', projectId, sessionId })
  const openConversation = (projectId: string, ticketKey: string): void =>
    setRoute({ name: 'ticket', projectId, ticketKey, tab: 'conversation' })
  const openSession = route?.name === 'session' ? route.sessionId : null
  const shownSession = view?.sessions.find((s) => s.id === openSession)

  async function reload(): Promise<Route> {
    const [list, groupList] = await Promise.all([
      window.sandtable.projects.list(),
      window.sandtable.projects.groups()
    ])
    setProjects(list)
    setGroups(groupList)
    return homeRoute(list)
  }
  const arrange = (next: Project[], nextGroups: ProjectGroup[]): void => {
    setProjects(next)
    setGroups(nextGroups)
    window.sandtable.projects
      .arrange(
        nextGroups,
        next.map(({ id, group }) => ({ id, group }))
      )
      .catch((err) => {
        console.error(err)
        void reload()
      })
  }
  const home = homeRoute(projects)

  if (!tools || !route)
    return (
      <div className="drag flex h-screen items-center justify-center gap-2 text-fg-2">
        <Spinner />
        Checking setup…
      </div>
    )
  if (guide)
    return (
      <div className="flex h-screen overflow-hidden bg-window">
        <HeaderFrame value={{ inset: !frame.fullScreen, needsYou: 0, width }}>
          <main ref={measure} className={panel}>
            <div hidden={page === 'settings'} className="contents">
              <SetupGuide
                check={tools}
                firstRun={firstRun}
                onCheckAgain={() => checkTools().then(() => {})}
                onDone={() => setGuide(false)}
              />
            </div>
            {page === 'settings' && <Settings onBack={() => setPage(null)} />}
          </main>
        </HeaderFrame>
      </div>
    )

  const hidden = frame.sidebarHidden
  const header = {
    inset: hidden && !frame.fullScreen,
    showSidebar: hidden ? () => window.sandtable.app.setSidebarHidden(false) : undefined,
    needsYou: projects.reduce((n, p) => n + (counts[p.id] ?? 0), 0),
    width,
    nav
  }
  return (
    <div className="flex h-screen overflow-hidden bg-window">
      <ProjectSidebar
        hidden={hidden}
        inset={!frame.fullScreen}
        onHide={() => window.sandtable.app.setSidebarHidden(true)}
        width={frame.sidebarWidth}
        onResize={(sidebarWidth) => {
          setFrame((f) => ({ ...f, sidebarWidth }))
          window.sandtable.app.setSidebarWidth(sidebarWidth)
        }}
        projects={projects}
        groups={groups}
        onArrange={arrange}
        selectedId={route?.projectId ?? null}
        needsYou={counts}
        couldntStart={(view ?? lastView)?.couldntStart}
        sessions={(view ?? lastView)?.sidebarSessions ?? []}
        openSessionId={openSession}
        openTicketKey={route?.name === 'ticket' ? route.ticketKey : null}
        onSelect={(id) => setRoute({ name: 'board', projectId: id })}
        onAdd={() => setRoute({ name: 'add', projectId: 'new' })}
        onEdit={(id) => setRoute({ name: 'add', projectId: id })}
        onOpenSession={toSession}
        onOpenTicket={openConversation}
        onNewSession={(id) => {
          setPage(null)
          setNewSessionFor(projects.find((p) => p.id === id) ?? null)
        }}
        onSettings={() => setPage('settings')}
        onUsage={() => setPage('usage')}
        onRoutine={onRoutine}
        onOpenRunHistory={(projectId, routineId) => {
          setPage(null)
          toBoard(projectId)
          openRunHistory(projectId, routineId)
        }}
        backForward={nav}
      />
      <HeaderFrame value={header}>
        <main ref={measure} className={cn(panel, slide, !hidden && 'ml-0')}>
          {page === 'settings' && <Settings onBack={() => setPage(null)} />}
          {page === 'usage' && <UsagePage projects={projects} onBack={() => setPage(null)} />}
          <div hidden={!!page} className="contents">
            {route?.name === 'board' && project && (
              <Board
                key={project.id}
                project={project}
                projects={projects}
                view={view}
                onSync={sync}
                onOpenTicket={(ticketKey) =>
                  setRoute({ name: 'ticket', projectId: project.id, ticketKey })
                }
                onOpenElsewhere={openConversation}
                onProjectSaved={() => void reload()}
                onNewSession={() => setNewSessionFor(project)}
                onDrafted={(id) => toSession(project.id, id)}
                onOpenSession={(id) => toSession(project.id, id)}
                onRoutine={onRoutine}
                defaultSearch={search.text}
                onSearch={(text) => setSearch({ projectId: project.id, text })}
                onSetUp={(repo) => setRoute({ name: 'add', projectId: project.id, repo })}
              />
            )}
            {route?.name === 'session' && project && shownSession && (
              <SessionView
                key={shownSession.id}
                session={shownSession}
                project={project}
                onBack={() => toBoard(project.id)}
                onRoutine={onRoutine}
                onProjectSaved={() => void reload()}
              />
            )}
            {route?.name === 'ticket' && project && view && (
              <TicketView
                key={`${project.id} ${route.ticketKey}`}
                project={project}
                ticketKey={route.ticketKey}
                view={view}
                initialTab={route.tab}
                onTabChange={onTabChange}
                onBack={() => toBoard(project.id)}
                onOpenTicket={(ticketKey) =>
                  setRoute({ name: 'ticket', projectId: project.id, ticketKey })
                }
                projects={projects}
                onOpenElsewhere={openConversation}
                onProjectSaved={() => void reload()}
              />
            )}
            {route?.name === 'add' && (
              <AddProject
                key={`${route.projectId}\n${route.repo ?? ''}`}
                project={project}
                repo={route.repo}
                settingsOpen={page === 'settings'}
                onCancel={
                  project
                    ? () => toBoard(project.id)
                    : home.name === 'add'
                      ? undefined
                      : () => setRoute(home)
                }
                onSaved={(saved) => void reload().then(() => toBoard(saved.id))}
                onChanged={() => void reload()}
                onDeleted={() => void reload().then(setRoute)}
              />
            )}
          </div>
        </main>
      </HeaderFrame>
      {newSessionFor && (
        <NewSessionDialog
          project={newSessionFor}
          onCreated={(id) => {
            setNewSessionFor(null)
            toSession(newSessionFor.id, id)
          }}
          onClose={() => setNewSessionFor(null)}
          onRoutine={onRoutine}
        />
      )}
      {routineFor && <RoutineEditor {...routineFor} onClose={() => setRoutineFor(null)} />}
    </div>
  )
}

export default App

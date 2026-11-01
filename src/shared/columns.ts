import type { BoardColumn, Column, Project, StatusMap, Ticket } from './types'

/** The board's columns in order. */
export const COLUMNS: { id: BoardColumn; title: string }[] = [
  { id: 'todo', title: 'To do' },
  { id: 'inProgress', title: 'In progress' },
  { id: 'done', title: 'Done' }
]

/** The GitHub label Sandtable puts on an issue it marks in progress. */
export const IN_PROGRESS_LABEL = {
  name: 'sandtable: in progress',
  color: 'fb8500',
  description: 'Marked in progress in Sandtable'
}

/** The statuses of a project without a board, from issue state and Sandtable's label. */
export const REPO_STATUS: StatusMap = { todo: 'Open', inProgress: 'In progress', done: 'Closed' }

/** The workflow state types a Linear issue's status holds. */
export const LINEAR_STATUS: StatusMap = {
  todo: 'unstarted',
  inProgress: 'started',
  done: 'completed'
}

/** The status category keys a Jira issue's status holds. */
export const JIRA_STATUS: StatusMap = { todo: 'new', inProgress: 'indeterminate', done: 'done' }

/** A project's status names: its board's, LINEAR_STATUS for a Linear team, JIRA_STATUS for a Jira project, or REPO_STATUS. */
export const statusMapOf = (p: Project): StatusMap =>
  p.board?.statusMap ?? (p.linear ? LINEAR_STATUS : p.jira ? JIRA_STATUS : REPO_STATUS)

/** The kanban column for a ticket status; a missing status counts as todo. */
export function columnFor(status: string | null, map: StatusMap): Column {
  if (status === null || status === map.todo) return 'todo'
  if (status === map.inProgress) return 'inProgress'
  if (status === map.done) return 'done'
  return 'hidden'
}

/** A Status chip for a status named unlike its column, from each column's status type and name, ignoring case. */
export const statusField = (
  map: StatusMap,
  names: Record<BoardColumn, string>,
  type: string,
  name: string
): Ticket['boardFields'] => {
  const column = (Object.keys(map) as BoardColumn[]).find((c) => map[c] === type)
  return column && name.toLowerCase() === names[column].toLowerCase()
    ? []
    : [{ name: 'Status', value: name }]
}

import { IN_PROGRESS_LABEL, REPO_STATUS } from '../../shared/columns'
import { prStage } from '../../shared/findings'
import type { BoardColumn, PrStage, Ticket, IssueRef } from '../../shared/types'
import { paginate, splitRepo as split, type GraphqlFn } from './graphql'

export type RepoIssuesClient = {
  tickets(
    repo: string,
    closedSince: string,
    alsoNumbers: number[],
    truncated?: (message: string) => void
  ): Promise<Ticket[]>
  setColumn(repo: string, issueNumber: number, column: BoardColumn, reopen?: boolean): Promise<void>
  reopen(repo: string, issueNumber: number): Promise<void>
  setAssignee(
    repo: string,
    issueNumber: number,
    from: string | null,
    to: string | null
  ): Promise<void>
  create(
    repo: string,
    title: string,
    body: string,
    parent?: number
  ): Promise<{ id: string; number: number }>
}

/** The issue fields behind `issueProps`, shared by both sync queries. */
export const ISSUE_PROPS = `number title body url closedAt repository { nameWithOwner } labels(first: 100) { nodes { name color } } createdAt updatedAt assignees(first: 10) { nodes { id login name } } parent { number title url state stateReason repository { nameWithOwner } subIssuesSummary { completed total } } subIssuesSummary { completed total } subIssues(first: 50) { nodes { number title url state stateReason repository { nameWithOwner } } } blockedBy(first: 20) { nodes { number title state repository { nameWithOwner } } } closedByPullRequestsReferences(first: 10) { nodes { url mergedAt state createdAt reviewDecision mergeable isDraft commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } } }`

const ISSUE_FIELDS = `id state stateReason ${ISSUE_PROPS}`

const ISSUES_QUERY = (states: 'OPEN' | 'CLOSED', since: boolean): string => `
query($owner: String!, $name: String!, $cursor: String${since ? ', $since: DateTime!' : ''}) {
  repository(owner: $owner, name: $name) {
    issues(first: 100, after: $cursor, states: ${states}, orderBy: { field: UPDATED_AT, direction: DESC }${since ? ', filterBy: { since: $since }' : ''}) {
      pageInfo { hasNextPage endCursor }
      nodes { ${ISSUE_FIELDS} }
    }
  }
}`

const LABEL_LOOKUP = `
query($owner: String!, $name: String!, $label: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    id
    label(name: $label) { id }
    issue(number: $number) { id state labels(first: 100) { nodes { name } } }
  }
}`

/** Creates a repo label and returns its ID. */
export const CREATE_LABEL = `
mutation($repositoryId: ID!, $name: String!, $color: String!, $description: String!) {
  createLabel(input: { repositoryId: $repositoryId, name: $name, color: $color, description: $description }) {
    label { id }
  }
}`

/** Adds labels to an issue by their IDs. */
export const ADD_LABEL = `
mutation($labelableId: ID!, $labelIds: [ID!]!) {
  addLabelsToLabelable(input: { labelableId: $labelableId, labelIds: $labelIds }) {
    labelable { __typename }
  }
}`

const REMOVE_LABEL = `
mutation($labelableId: ID!, $labelIds: [ID!]!) {
  removeLabelsFromLabelable(input: { labelableId: $labelableId, labelIds: $labelIds }) {
    labelable { __typename }
  }
}`

const ISSUE_STATE = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { issue(number: $number) { id state } }
}`

const REOPEN_ISSUE = `
mutation($issueId: ID!) {
  reopenIssue(input: { issueId: $issueId }) { issue { id } }
}`

const CLOSE_ISSUE = `
mutation($issueId: ID!) {
  closeIssue(input: { issueId: $issueId, stateReason: COMPLETED }) { issue { id } }
}`

const ADD_ASSIGNEE = `
mutation($assignableId: ID!, $assigneeIds: [ID!]!) {
  addAssigneesToAssignable(input: { assignableId: $assignableId, assigneeIds: $assigneeIds }) {
    assignable { assignees(first: 10) { nodes { id } } }
  }
}`

const REMOVE_ASSIGNEE = `
mutation($assignableId: ID!, $assigneeIds: [ID!]!) {
  removeAssigneesFromAssignable(input: { assignableId: $assignableId, assigneeIds: $assigneeIds }) {
    assignable { __typename }
  }
}`

const REPO_ID = `
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) { id }
}`

const REPO_AND_PARENT_ID = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { id issue(number: $number) { id } }
}`

const CREATE_ISSUE = `
mutation($repositoryId: ID!, $title: String!, $body: String!, $parentIssueId: ID) {
  createIssue(input: { repositoryId: $repositoryId, title: $title, body: $body, parentIssueId: $parentIssueId }) {
    issue { id number }
  }
}`

/* eslint-disable @typescript-eslint/no-explicit-any */
const hasInProgressLabel = (i: any): boolean =>
  i.labels.nodes.some((l: any) => l.name === IN_PROGRESS_LABEL.name)

const openPrStage = (prs: any[]): PrStage | null => {
  const pr = prs
    .filter((p) => p.state === 'OPEN')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  return pr
    ? prStage({
        rollup: pr.commits.nodes[0]?.commit.statusCheckRollup?.state ?? null,
        reviewDecision: pr.reviewDecision,
        mergeable: pr.mergeable,
        isDraft: pr.isDraft
      })
    : null
}

/** The URL and merge time of the most recently merged pull request among `prs`, each read with `mergedAt`, or nulls. */
export function newestMerged(
  prs: { url: string; mergedAt?: string | null }[]
): Pick<Ticket, 'mergedPr' | 'mergedAt'> {
  const pr = prs.filter((p) => p.mergedAt).sort((a, b) => b.mergedAt!.localeCompare(a.mergedAt!))[0]
  return { mergedPr: pr?.url ?? null, mergedAt: pr?.mergedAt ?? null }
}

const ref = (i: any): IssueRef => ({
  key: `${i.repository.nameWithOwner}#${i.number}`,
  number: i.number,
  title: i.title,
  repo: i.repository.nameWithOwner,
  url: i.url,
  column:
    i.state !== 'CLOSED'
      ? 'todo'
      : i.stateReason === 'NOT_PLANNED' || i.stateReason === 'DUPLICATE'
        ? 'hidden'
        : 'done'
})

/** Maps an issue queried with `ISSUE_PROPS` to the ticket fields both clients share. */
export const issueProps = (
  i: any
): Omit<Ticket, 'itemId' | 'status' | 'doneAt' | 'boardFields'> => ({
  key: `${i.repository.nameWithOwner}#${i.number}`,
  number: i.number,
  title: i.title,
  body: i.body,
  url: i.url,
  repo: i.repository.nameWithOwner,
  labels: i.labels.nodes,
  assignees: i.assignees.nodes,
  createdAt: i.createdAt,
  updatedAt: i.updatedAt,
  parent: i.parent && { ...ref(i.parent), subIssues: i.parent.subIssuesSummary },
  subIssues: {
    ...i.subIssuesSummary,
    items: i.subIssues.nodes.map((s: any) => ({ ...ref(s), assignee: null }))
  },
  blockedBy: i.blockedBy.nodes
    .filter((b: any) => b.state === 'OPEN')
    .map((b: any) => ({
      key: `${b.repository.nameWithOwner}#${b.number}`,
      number: b.number,
      title: b.title,
      repo: b.repository.nameWithOwner
    })),
  ...newestMerged(i.closedByPullRequestsReferences.nodes),
  prStage: openPrStage(i.closedByPullRequestsReferences.nodes)
})

function toTicket(i: any): Ticket {
  const closed = i.state === 'CLOSED'
  const labelled = hasInProgressLabel(i)
  const notPlanned = closed && i.stateReason === 'NOT_PLANNED'
  return {
    ...issueProps(i),
    itemId: i.id,
    status: notPlanned
      ? 'Not planned'
      : closed
        ? REPO_STATUS.done
        : labelled
          ? REPO_STATUS.inProgress
          : REPO_STATUS.todo,
    doneAt: closed ? i.closedAt : null,
    boardFields: [],
    ...(notPlanned && { notPlanned: true })
  }
}

/** Builds a client that reads a repo's issues directly, without a Projects board. */
export function createRepoIssuesClient(gql: GraphqlFn): RepoIssuesClient {
  const page = (
    repo: string,
    states: 'OPEN' | 'CLOSED',
    since: string | undefined,
    truncated: ((message: string) => void) | undefined
  ): Promise<any[]> =>
    paginate(
      gql,
      ISSUES_QUERY(states, since !== undefined),
      { ...split(repo), ...(since !== undefined && { since }) },
      (data) => data.repository.issues,
      {
        pages: 10,
        truncated: () =>
          truncated?.(
            `${repo} has more than 1,000 ${since === undefined ? 'open issues' : 'recently closed or updated issues'}; Sandtable shows the 1,000 most recently updated.`
          )
      }
    )

  return {
    async tickets(repo, closedSince, alsoNumbers, truncated) {
      const open = await page(repo, 'OPEN', undefined, truncated)
      const closed = (await page(repo, 'CLOSED', closedSince, truncated)).filter(
        (i) => i.closedAt >= closedSince
      )
      const byNumber = new Map<number, any>([...open, ...closed].map((i) => [i.number, i]))
      const missing = alsoNumbers.filter((n) => !byNumber.has(n))
      if (missing.length > 0) {
        const fields = missing
          .map(
            (n) => `i${n}: issueOrPullRequest(number: ${n}) { ... on Issue { ${ISSUE_FIELDS} } }`
          )
          .join('\n')
        const data = await gql(
          `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`,
          split(repo)
        ).catch((e: any) => {
          if (!e?.data?.repository) throw e
          return e.data
        })
        for (const i of Object.values<any>(data.repository))
          if (i?.number) byNumber.set(i.number, i)
      }
      return [...byNumber.values()].map(toTicket)
    },
    async setColumn(repo, issueNumber, column, reopen = true) {
      const data = await gql(LABEL_LOOKUP, {
        ...split(repo),
        label: IN_PROGRESS_LABEL.name,
        number: issueNumber
      })
      if (!data.repository?.issue) throw new Error('Issue not found')
      const { id: repositoryId, label, issue } = data.repository
      const issueId = issue.id
      if (reopen && issue.state === 'CLOSED' && column !== 'done')
        await gql(REOPEN_ISSUE, { issueId })
      if (issue.state !== 'CLOSED' && column === 'done') await gql(CLOSE_ISSUE, { issueId })
      const labelled = hasInProgressLabel(issue)
      if (column === 'inProgress' && !labelled) {
        let labelId = label?.id
        if (!labelId) {
          const created = await gql(CREATE_LABEL, { repositoryId, ...IN_PROGRESS_LABEL })
          labelId = created.createLabel.label.id
        }
        await gql(ADD_LABEL, { labelableId: issueId, labelIds: [labelId] })
      }
      if (column !== 'inProgress' && labelled)
        await gql(REMOVE_LABEL, { labelableId: issueId, labelIds: [label.id] })
    },
    async reopen(repo, issueNumber) {
      const data = await gql(ISSUE_STATE, { ...split(repo), number: issueNumber })
      const issue = data.repository?.issue
      if (!issue) throw new Error('Issue not found')
      if (issue.state === 'CLOSED') await gql(REOPEN_ISSUE, { issueId: issue.id })
    },
    async setAssignee(repo, issueNumber, from, to) {
      const data = await gql(ISSUE_STATE, { ...split(repo), number: issueNumber })
      const assignableId = data.repository?.issue?.id
      if (!assignableId) throw new Error('Issue not found')
      if (to) {
        const added = await gql(ADD_ASSIGNEE, { assignableId, assigneeIds: [to] })
        const ids = added.addAssigneesToAssignable.assignable.assignees.nodes.map((n: any) => n.id)
        if (!ids.includes(to)) throw new Error(`Couldn't assign that person on ${repo}`)
      }
      if (from) await gql(REMOVE_ASSIGNEE, { assignableId, assigneeIds: [from] })
    },
    async create(repo, title, body, parent) {
      const data =
        parent === undefined
          ? await gql(REPO_ID, split(repo))
          : await gql(REPO_AND_PARENT_ID, { ...split(repo), number: parent })
      if (!data.repository) throw new Error('Repo not found')
      if (parent !== undefined && !data.repository.issue) throw new Error('Parent issue not found')
      const created = await gql(CREATE_ISSUE, {
        repositoryId: data.repository.id,
        title,
        body,
        ...(parent !== undefined && { parentIssueId: data.repository.issue.id })
      })
      return created.createIssue.issue
    }
  }
}

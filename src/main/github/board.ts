import { columnFor } from '../../shared/columns'
import type { BoardSource, StatusMap, Ticket } from '../../shared/types'
import { parseBoardUrl } from '../../shared/boardUrl'
import { parseTicketKey } from '../../shared/repo'
import { splitRepo as split, type GraphqlFn } from './graphql'
import { paginate } from '../http'
import { ISSUE_PROPS, issueProps } from './repoIssues'

/* eslint-disable @typescript-eslint/no-explicit-any */

type StatusField = {
  projectId: string
  fieldId: string
  options: { id: string; name: string }[]
}

export type BoardClient = {
  statusField(src: BoardSource): Promise<StatusField>
  tickets(
    src: BoardSource,
    map: StatusMap,
    doneSince?: string,
    alsoKeys?: string[],
    truncated?: (message: string) => void
  ): Promise<Ticket[]>
  setStatus(src: BoardSource, itemId: string, optionName: string): Promise<void>
  addItem(src: BoardSource, contentId: string): Promise<string>
}

const root = (src: BoardSource): 'user' | 'organization' =>
  src.ownerType === 'user' ? 'user' : 'organization'

const FIELD_QUERY = (r: string): string => `
query($owner: String!, $number: Int!) {
  ${r}(login: $owner) {
    projectV2(number: $number) {
      id
      field(name: "Status") { ... on ProjectV2SingleSelectField { id options { id name } } }
    }
  }
}`

const ITEM_FIELDS = `id
          fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name updatedAt } }
          fieldValues(first: 50) { nodes { ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2SingleSelectField { name } } } } }`

const ITEMS_QUERY = (r: string): string => `
query($owner: String!, $number: Int!, $cursor: String, $query: String) {
  ${r}(login: $owner) {
    projectV2(number: $number) {
      items(first: 100, after: $cursor, query: $query) {
        pageInfo { hasNextPage endCursor }
        nodes {
          ${ITEM_FIELDS}
          content {
            __typename
            ... on Issue { state ${ISSUE_PROPS} }
          }
        }
      }
    }
  }
}`

const KEY_QUERY = (numbers: number[]): string => `
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    ${numbers.map((n) => `i${n}: issueOrPullRequest(number: ${n}) { __typename ... on Issue { state ${ISSUE_PROPS} projectItems(first: 50) { nodes { project { url } ${ITEM_FIELDS} } } } }`).join('\n')}
  }
}`

const SET_STATUS = `
mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
  updateProjectV2ItemFieldValue(input: {
    projectId: $projectId, itemId: $itemId, fieldId: $fieldId,
    value: { singleSelectOptionId: $optionId }
  }) { projectV2Item { id } }
}`

const ADD_ITEM = `
mutation($projectId: ID!, $contentId: ID!) {
  addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) { item { id } }
}`

/** The error, reworded when GitHub says the board doesn't exist or the token can't read it. */
export const boardError = (src: BoardSource, err: unknown): unknown =>
  err instanceof Error && /could not resolve/i.test(err.message)
    ? new Error(
        `GitHub says ${src.owner}/projects/${src.number} doesn't exist, or your token can't read it.`
      )
    : err

/** Builds a client for GitHub Projects boards on top of a GraphQL function. */
export function createBoardClient(gql: GraphqlFn): BoardClient {
  const statusField: BoardClient['statusField'] = async (src) => {
    const data = await gql(FIELD_QUERY(root(src)), { owner: src.owner, number: src.number })
    const project = data[root(src)].projectV2
    return { projectId: project.id, fieldId: project.field.id, options: project.field.options }
  }

  return {
    statusField,
    async tickets(src, map, doneSince, alsoKeys = [], truncated) {
      const done = JSON.stringify(map.done)
      const since = doneSince && `updated:>=${doneSince.slice(0, 10)}`
      const queries: [string | undefined, string][] = since
        ? [
            [`is:issue is:open -status:${done}`, 'open items'],
            [`is:issue status:${done} ${since}`, 'recently done items'],
            [
              `is:issue is:closed -status:${done} ${since}`,
              'recently closed items not in its done Status'
            ]
          ]
        : [[undefined, 'items']]
      const pages = await Promise.all(
        queries.map(([query, what]) =>
          paginate(
            gql,
            ITEMS_QUERY(root(src)),
            { owner: src.owner, number: src.number, query },
            (data) => data[root(src)].projectV2.items,
            {
              pages: 10,
              truncated: () =>
                truncated?.(
                  `The board has more than 1,000 ${what}; Sandtable shows the first 1,000.`
                )
            }
          )
        )
      )
      const nodes = [...new Map(pages.flat().map((n) => [n.id, n])).values()]
      const found = new Set(
        nodes.map(
          (n) =>
            n.content?.number !== undefined &&
            `${n.content.repository.nameWithOwner}#${n.content.number}`
        )
      )
      const byRepo = new Map<string, number[]>()
      for (const key of alsoKeys.filter((k) => !found.has(k))) {
        const { repo, number } = parseTicketKey(key)
        byRepo.set(repo, [...(byRepo.get(repo) ?? []), number])
      }
      const onBoard = (url: string): boolean => {
        const b = parseBoardUrl(url)
        return b.number === src.number && b.owner.toLowerCase() === src.owner.toLowerCase()
      }
      for (const [repo, numbers] of byRepo) {
        const data = await gql(KEY_QUERY(numbers), split(repo)).catch((e: any) => {
          if (!e?.data?.repository) throw e
          return e.data
        })
        for (const c of Object.values<any>(data.repository ?? {})) {
          const item = c?.projectItems?.nodes.find((i: any) => onBoard(i.project.url))
          if (item) nodes.push({ ...item, content: c })
        }
      }
      const tickets: Ticket[] = []
      for (const node of nodes) {
        const c = node.content
        if (c?.__typename !== 'Issue') continue
        const set = node.fieldValueByName?.name ?? null
        const lags = c.state === 'CLOSED' && ['todo', 'inProgress'].includes(columnFor(set, map))
        const status = lags ? map.done : set
        tickets.push({
          ...issueProps(c),
          itemId: node.id,
          status,
          doneAt: lags
            ? c.closedAt
            : set === map.done
              ? (node.fieldValueByName.updatedAt ?? c.closedAt ?? null)
              : null,
          boardFields: node.fieldValues.nodes
            .filter((v: any) => v?.field && v.field.name !== 'Status')
            .map((v: any) => ({ name: v.field.name, value: v.name }))
        })
      }
      return tickets
    },
    async setStatus(src, itemId, optionName) {
      const { projectId, fieldId, options } = await statusField(src)
      const option = options.find((o) => o.name === optionName)
      if (!option) throw new Error(`No Status option named "${optionName}"`)
      await gql(SET_STATUS, { projectId, itemId, fieldId, optionId: option.id })
    },
    async addItem(src, contentId) {
      const { projectId } = await statusField(src)
      const data = await gql(ADD_ITEM, { projectId, contentId })
      return data.addProjectV2ItemById.item.id
    }
  }
}

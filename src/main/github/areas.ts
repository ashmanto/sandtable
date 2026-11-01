import { AREA_PREFIX, areaOf } from '../../shared/areas'
import { parseTicketKey } from '../../shared/repo'
import type { Area, Triage } from '../../shared/types'
import { splitRepo, type GraphqlFn } from './graphql'
import { ADD_LABEL, CREATE_LABEL } from './repoIssues'

/** Reads a repo's `area:` labels and writes a triage's label and blockers to an issue. */
export type AreasClient = {
  list(repo: string): Promise<Area[]>
  apply(repo: string, number: number, t: Triage): Promise<void>
}

const AREA_COLOR = 'c5def5'

const LOOKUP = (withIssue: boolean, blockers: number): string => {
  const indexes = [...Array(blockers).keys()]
  return `
query($owner: String!, $name: String!${withIssue ? ', $number: Int!' : ''}${indexes.map((i) => `, $o${i}: String!, $r${i}: String!, $n${i}: Int!`).join('')}) {
  repository(owner: $owner, name: $name) {
    id
    labels(first: 100, query: "${AREA_PREFIX}") { nodes { id name description } }
    ${withIssue ? 'issue(number: $number) { id labels(first: 100) { nodes { name } } }' : ''}
  }
  ${indexes.map((i) => `b${i}: repository(owner: $o${i}, name: $r${i}) { issue(number: $n${i}) { id } }`).join('\n  ')}
}`
}

const ADD_BLOCKED_BY = `
mutation($issueId: ID!, $blockingIssueId: ID!) {
  addBlockedBy(input: { issueId: $issueId, blockingIssueId: $blockingIssueId }) { issue { id } }
}`

type Label = { id: string; name: string; description: string | null }

/** Builds a client that reads a repo's `area:` labels and writes a triage to an issue. */
export function createAreasClient(gql: GraphqlFn): AreasClient {
  const lookup = async (
    repo: string,
    number?: number,
    blockers: { key: string }[] = []
  ): Promise<{
    id: string
    labels: Label[]
    issue?: { id: string; labels: { nodes: { name: string }[] } } | null
    blockerIds: string[]
  }> => {
    const refs = blockers.map((b) => parseTicketKey(b.key))
    const vars = Object.fromEntries(
      refs.flatMap((b, i) => {
        const { owner, name } = splitRepo(b.repo)
        return [
          [`o${i}`, owner],
          [`r${i}`, name],
          [`n${i}`, b.number]
        ]
      })
    )
    const data = await gql(LOOKUP(number !== undefined, refs.length), {
      ...splitRepo(repo),
      ...(number !== undefined && { number }),
      ...vars
    })
    const blockerIds = blockers.map((b, i) => {
      const id = data[`b${i}`]?.issue?.id
      if (!id) throw new Error(`Issue ${b.key} not found`)
      return id as string
    })
    return {
      ...data.repository,
      labels: data.repository.labels.nodes.filter((l: Label) => l.name.startsWith(AREA_PREFIX)),
      blockerIds
    }
  }

  return {
    async list(repo) {
      const { labels } = await lookup(repo)
      return labels.map((l) => ({ name: l.name, description: l.description ?? '' }))
    },
    async apply(repo, number, t) {
      const repository = await lookup(repo, number, t.blockedBy)
      if (!repository.issue) throw new Error(`#${number} not found`)
      const issueId = repository.issue.id
      const has = areaOf(repository.issue.labels.nodes)
      if (has) throw new Error(`#${number} already has ${has}`)
      const ids = new Map(repository.labels.map((l) => [l.name, l.id]))
      const unfinished = repository.labels.every((l) => t.newAreas.some((a) => a.name === l.name))
      for (const a of unfinished ? t.newAreas : []) {
        if (ids.has(a.name)) continue
        const created = await gql(CREATE_LABEL, {
          repositoryId: repository.id,
          name: a.name,
          color: AREA_COLOR,
          description: a.description
        })
        ids.set(a.name, created.createLabel.label.id)
      }
      const labelId = ids.get(t.area)
      if (!labelId) throw new Error(`Label "${t.area}" not found`)
      for (const blockingIssueId of repository.blockerIds)
        await gql(ADD_BLOCKED_BY, { issueId, blockingIssueId })
      await gql(ADD_LABEL, { labelableId: issueId, labelIds: [labelId] })
    }
  }
}

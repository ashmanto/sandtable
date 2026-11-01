import { AREA_PREFIX } from '../../shared/areas'
import { ticketLabel, type Service } from '../../shared/repo'
import type { Area, Ticket, Triage } from '../../shared/types'
import { oneLine, openingPrompt, parseAnswer, UNSAFE } from './claudeLaunch'

type Issue = { key: string; number: number; title: string }

/** The JSON Schema Claude's triage answer must match. */
export const TRIAGE_SCHEMA = {
  type: 'object',
  properties: {
    area: { type: 'string' },
    newAreas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', maxLength: 50 },
          description: { type: 'string', maxLength: 100 }
        },
        required: ['name', 'description'],
        additionalProperties: false
      }
    },
    blockedBy: { type: 'array', items: { type: 'integer' } },
    reason: { type: 'string' }
  },
  required: ['area', 'newAreas', 'blockedBy', 'reason'],
  additionalProperties: false
}

/** The prompt that asks Claude for a ticket's area and the open issues blocking it. */
export function triagePrompt(
  ticket: Ticket,
  areas: Area[],
  open: (Issue & { area?: string })[],
  service: Service
): string {
  const where = { GitHub: 'repo', Linear: 'team', Jira: 'project' }[service]
  const name =
    service === 'Jira' ? `"${AREA_PREFIX}<name>" with no spaces` : `"${AREA_PREFIX} <name>"`
  const areaList = areas.length
    ? [
        'Pick exactly one of these area labels as "area", and leave "newAreas" empty:',
        ...areas.map((a) => `- ${oneLine(`${a.name}: ${a.description}`)}`)
      ]
    : [
        `The ${where} has no area labels yet. In "newAreas", propose three to six areas that split the code into parts that two sessions can change at the same time without conflicts. Name each one ${name} and describe it in one sentence: name under 50 characters, description under 100. Pick exactly one of them as "area".`
      ]
  const openList = open.length
    ? open.map((i) => `- ${oneLine(`${ticketLabel(i)} ${i.title}${i.area ? ` (${i.area})` : ''}`)}`)
    : ['- None']
  return [
    "Triage the issue below. Read the code in the current folder if it helps you decide. Don't change any files.",
    '',
    ...areaList,
    '',
    `In "blockedBy", list only the numbers of open issues from this list that must merge before this issue can start${service === 'GitHub' ? '' : `, such as 12 for ${ticket.key.slice(0, ticket.key.lastIndexOf('-'))}-12`}:`,
    ...openList,
    '',
    'In "reason", explain your choices in one sentence.',
    '',
    openingPrompt(ticket, service)
  ].join('\n')
}

/** Whether a new area label is named `area: …`, fits GitHub's and Linear's limits, has no hidden characters, and on Jira no spaces. */
export const usableArea = (a: Area, service: Service): boolean =>
  a.name.startsWith(AREA_PREFIX) &&
  !(service === 'Jira' && /\s/.test(a.name)) &&
  a.name.length <= 50 &&
  a.description.length <= 100 &&
  !UNSAFE.test(a.name + a.description)

const fail = (why: string): Error => new Error(`Triage failed: ${why}`)

/** Reads `claude -p --output-format json` output and checks the answer against the areas and open issues. */
export function parseTriage(
  stdout: string,
  areas: Area[],
  open: Issue[],
  self: number,
  service: Service
): Triage {
  const out = parseAnswer<{
    structured_output?: Omit<Triage, 'blockedBy'> & { blockedBy: number[] }
  }>(stdout, 'Triage').structured_output
  if (!out) throw fail("Claude didn't return an answer")

  const newAreas = areas.length ? [] : out.newAreas
  const bad = newAreas.find((a) => !a.name.startsWith(AREA_PREFIX))
  if (bad) throw new Error(`Claude proposed "${bad.name}", which doesn't start with ${AREA_PREFIX}`)
  if (!newAreas.every((a) => usableArea(a, service)))
    throw fail("Claude proposed an area label Sandtable can't use")
  if (areas.length && !areas.some((a) => a.name === out.area))
    throw new Error(`Claude picked "${out.area}", which isn't one of the area labels`)
  if (!areas.length && !newAreas.some((a) => a.name === out.area))
    throw new Error(`Claude picked "${out.area}", which isn't one of the areas it proposed`)

  const blockedBy = open
    .filter((i) => i.number !== self && out.blockedBy.includes(i.number))
    .map(({ key, number, title }) => ({ key, number, title }))
  return { area: out.area, newAreas, blockedBy, reason: out.reason }
}

import type { Service } from '../../shared/repo'
import type { Overlap, Ticket } from '../../shared/types'
import { openingPrompt, parseAnswer, withoutUnsafe } from './claudeLaunch'

/** The JSON Schema Claude's overlap answer must match. */
export const OVERLAP_SCHEMA = {
  type: 'object',
  properties: {
    overlaps: {
      type: 'array',
      items: {
        type: 'object',
        properties: { number: { type: 'integer' }, reason: { type: 'string', maxLength: 200 } },
        required: ['number', 'reason'],
        additionalProperties: false
      }
    }
  },
  required: ['overlaps'],
  additionalProperties: false
}

/** The prompt that asks Claude which in-progress tickets really overlap the one you start. */
export const overlapPrompt = (ticket: Ticket, candidates: Ticket[], service: Service): string =>
  [
    "You're about to start the first issue below while the others are in progress. Read the code in the current folder and decide which in-progress issues would change the same code or behavior, so that working on both at once would conflict. Don't change any files.",
    '',
    'In "overlaps", list only the in-progress issues that really overlap, each with its number and one sentence that says why. Leave it empty when none do.',
    '',
    '## The issue to start',
    '',
    openingPrompt(ticket, service),
    '',
    '## In progress',
    ...candidates.flatMap((c) => ['', openingPrompt(c, service)])
  ].join('\n')

/** Reads `claude -p --output-format json` output, keeping only candidates with a reason. */
export function parseOverlap(
  stdout: string,
  candidates: { key: string; number: number; title: string }[]
): Overlap[] {
  const overlaps = parseAnswer<{
    structured_output?: { overlaps?: { number: number; reason: string }[] }
  }>(stdout, 'Overlap check').structured_output?.overlaps
  if (!Array.isArray(overlaps))
    throw new Error("Overlap check failed: Claude didn't return an answer")
  return candidates.flatMap((c) => {
    const found = overlaps.find((o) => o.number === c.number)
    const reason = found && withoutUnsafe(String(found.reason)).trim().slice(0, 200)
    return reason ? [{ key: c.key, number: c.number, title: c.title, reason }] : []
  })
}

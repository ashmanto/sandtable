import { oneLine, parseAnswer } from './claudeLaunch'

/** The JSON Schema Claude's readiness answer must match. */
export const READINESS_SCHEMA = {
  type: 'object',
  properties: {
    gaps: { type: 'array', maxItems: 5, items: { type: 'string', maxLength: 100 } }
  },
  required: ['gaps'],
  additionalProperties: false
}

/** What Claude is asked about the ticket before its session starts. */
export const READINESS_QUESTION = [
  'Is this issue ready for a coding agent to start on? It is ready when it states what to change, why, and how you would tell it is done.',
  "If the repo's CLAUDE.md defines an issue format, judge the issue against that format instead.",
  "Judge only whether the text says these things. Don't check whether it's right about the code, and don't ask for details an agent could work out by reading the code.",
  'In "gaps", list what is missing, each as one short phrase such as "No way to tell when it\'s done" or "Doesn\'t say which screen". Leave it empty when the issue is ready.'
].join('\n')

/** Reads `claude -p --output-format json` output into at most five one-line gaps. */
export function parseReadiness(stdout: string): string[] {
  const gaps = parseAnswer<{ structured_output?: { gaps?: unknown[] } }>(stdout, 'Readiness check')
    .structured_output?.gaps
  if (!Array.isArray(gaps))
    throw new Error("Readiness check failed: Claude didn't return an answer")
  return [...new Set(gaps.map((g) => oneLine(String(g)).slice(0, 100)))].filter(Boolean).slice(0, 5)
}

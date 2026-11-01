import type { Project } from './types'

/** The most bytes a project's instructions can hold, labels included, so a session's command fits tmux. */
export const MAX_INSTRUCTIONS_BYTES = 3000

/** One instruction that applies to a ticket; `label` is unset for the every-ticket text. */
export type Instruction = { label?: string; text: string }

/** Your instructions that apply to a ticket with `labels`: the every-ticket text, then each matching label's in saved order. */
export function instructionsFor(project: Project, labels: { name: string }[]): Instruction[] {
  const names = new Set(labels.map((l) => l.name.toLowerCase()))
  const all = project.instructions?.all?.trim()
  return [
    ...(all ? [{ text: all }] : []),
    ...(project.instructions?.labels ?? []).flatMap(({ label, text }) =>
      names.has(label.toLowerCase()) && text.trim() ? [{ label, text: text.trim() }] : []
    )
  ]
}

/** The instructions as saved: label names trimmed, blank text and blank or repeated labels dropped, or none. */
export function keptInstructions(i: Project['instructions']): Project['instructions'] {
  const seen = new Set<string>()
  const labels = (i?.labels ?? []).flatMap(({ label, text }) => {
    const name = label.trim()
    if (!name || !text.trim() || seen.has(name.toLowerCase())) return []
    seen.add(name.toLowerCase())
    return [{ label: name, text }]
  })
  const out = { ...(i?.all?.trim() && { all: i.all }), ...(labels.length > 0 && { labels }) }
  return Object.keys(out).length > 0 ? out : undefined
}

/** The end of a session's rules that holds your instructions, or '' when there are none. */
export const instructionsSection = (yours: Instruction[]): string =>
  yours.length === 0
    ? ''
    : '\n\nYour instructions for this ticket:\n' +
      yours
        .map(({ label, text }) =>
          label === undefined ? text : `For the label "${label}":\n${text}`
        )
        .join('\n\n')

/** The UTF-8 bytes the instructions take in a session's rules if every label matched, counted against `MAX_INSTRUCTIONS_BYTES`. */
export const instructionsBytes = (i: Project['instructions']): number =>
  new TextEncoder().encode(
    instructionsSection([...(i?.all ? [{ text: i.all }] : []), ...(i?.labels ?? [])])
  ).length

import type { ConversationEntry } from './types'

const PREPARE = 'Before I compact this conversation'

/** The message that asks Claude to write down what it needs before you compact. */
export const prepareText = (file: string): string =>
  `${PREPARE}, use the Write tool, with no other tool, to replace ${file} with what you need to carry on: the goal, the decisions and why, the files you changed, the open to-dos, and the next step. Then reply Ready.`

/** The /compact command that keeps the notes file in the summary. */
export const compactText = (file: string): string =>
  `/compact Keep the notes in ${file} and its path, so you can read the file again after compacting.`

/** Whether the latest message asked Claude to prepare, with no compaction since. */
export function isPrepared(entries: ConversationEntry[]): boolean {
  const last = entries.findLast((e) => e.kind === 'user' || e.kind === 'compact')
  return last?.kind === 'user' && last.text.startsWith(PREPARE)
}

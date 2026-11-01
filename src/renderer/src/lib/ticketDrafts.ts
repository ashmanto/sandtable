type Draft = { title: string; body: string; where: string }
/** Unsent composer text, kept per project and per parent ticket until it's sent or closed. */
export const drafts = new Map<string, Draft>()
/** The key a composer's draft is kept under. */
export const draftKey = (projectId: string, parentKey?: string): string =>
  parentKey ? `${projectId}\0${parentKey}` : projectId
/** Whether a New ticket composer, or one with this parent, has an unsent draft. */
export const hasDraft = (projectId: string, parentKey?: string): boolean =>
  drafts.has(draftKey(projectId, parentKey))

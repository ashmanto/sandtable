/** The key a session's composer draft is saved under. */
export const sessionDraft = (sessionId: string): string => `session:${sessionId}`

/** The key a ticket chat's draft is saved under. */
export const chatDraft = (projectId: string, ticketKey: string): string =>
  `chat:${projectId}\0${ticketKey}`

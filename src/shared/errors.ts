/** An error's message, or any other thrown value as a string. */
export const messageOf = (err: unknown): string =>
  err instanceof Error ? err.message : String(err)

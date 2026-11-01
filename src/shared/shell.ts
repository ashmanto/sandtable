/** Single-quotes s for a POSIX shell. */
export const shellQuote = (s: string): string => `'${s.replaceAll("'", "'\\''")}'`

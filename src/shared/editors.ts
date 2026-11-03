/** Whether value is an absolute path to an app, the only editor Sandtable opens. */
export const isApp = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith('/') && value.endsWith('.app')

/** An app's name, its file name without `.app`. */
export const appName = (app: string): string => app.slice(app.lastIndexOf('/') + 1, -'.app'.length)

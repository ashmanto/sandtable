/** A store's listeners: `changed` tells each one, and `open`, if given, runs on the first and its returned close after the last. */
export function listenerSet<A extends unknown[] = []>(
  open?: () => () => void
): {
  subscribe: (listener: (...args: A) => void) => () => void
  changed: (...args: A) => void
} {
  const listeners = new Set<(...args: A) => void>()
  let close: (() => void) | null = null
  return {
    subscribe: (listener) => {
      listeners.add(listener)
      if (open) close ??= open()
      return () => {
        listeners.delete(listener)
        if (listeners.size) return
        close?.()
        close = null
      }
    },
    changed: (...args) => listeners.forEach((l) => l(...args))
  }
}

/** Shares one main-process push subscription among any number of listeners, opened on the first and closed after the last. */
export function fanOut<T>(
  subscribe: (cb: (sessionId: string, value: T) => void) => () => void
): (cb: (sessionId: string, value: T) => void) => () => void {
  const set: ReturnType<typeof listenerSet<[string, T]>> = listenerSet(() => subscribe(set.changed))
  return set.subscribe
}

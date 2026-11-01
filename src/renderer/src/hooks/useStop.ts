import { useRef } from 'react'

/** Stops a chat run; `unlessStopped` resolves to undefined instead of failing once you clicked Stop. */
export function useStop(stopRun: () => Promise<void>): {
  stop: () => void
  unlessStopped: <T>(answer: Promise<T>) => Promise<T | undefined>
} {
  const stopped = useRef(false)
  return {
    stop: () => {
      stopped.current = true
      void stopRun()
    },
    unlessStopped: async (answer) => {
      stopped.current = false
      try {
        return await answer
      } catch (err) {
        if (stopped.current) return undefined
        throw err
      }
    }
  }
}

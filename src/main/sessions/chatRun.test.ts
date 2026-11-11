import { expect, it } from 'vitest'
import { chatRun } from './chat'

type Guard = Parameters<typeof chatRun>[0]

const guard = (): Guard => ({
  answering: new Set<string>(),
  busyKey: 'k',
  stoppers: new Map<string, AbortController>(),
  stopKey: 's',
  runsInFlight: new Set<string>(['r1'])
})

it('chatRun refuses a second turn while one runs', async () => {
  const g = guard()
  const first = chatRun(g, () => new Promise<void>(() => {}))
  await expect(chatRun(g, async () => 1)).rejects.toThrow('Claude is still answering')
  void first
})

it('chatRun clears its keys and recorded run after a failure', async () => {
  const g = guard()
  await expect(
    chatRun(g, async (_signal, recorded) => {
      recorded('r1')
      throw new Error('boom')
    })
  ).rejects.toThrow('boom')
  expect([g.answering.size, g.stoppers.size, g.runsInFlight.has('r1')]).toEqual([0, 0, false])
})

it('chatRun aborts through its stopper', async () => {
  const g = guard()
  let signal: AbortSignal | undefined
  await chatRun(g, async (s) => {
    signal = s
    g.stoppers.get('s')?.abort()
  })
  expect(signal?.aborted).toBe(true)
})

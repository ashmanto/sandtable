import { useState } from 'react'

/** The current step, the furthest step visited, and the direction of the last move. */
export function useSteps(
  first: number,
  furthest = first
): {
  step: number
  maxStep: number
  dir: 'fwd' | 'back' | null
  go: (i: number) => void
} {
  const [step, setStep] = useState(first)
  const [maxStep, setMaxStep] = useState(furthest)
  const [dir, setDir] = useState<'fwd' | 'back' | null>(null)
  const go = (i: number): void => {
    setDir(i > step ? 'fwd' : 'back')
    setStep(i)
    setMaxStep((m) => Math.max(m, i))
  }
  return { step, maxStep, dir, go }
}

import { act, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useSessionView } from './sessionView'

function Shown({ label }: { label: string }): React.JSX.Element {
  const [view, setView] = useSessionView()
  return (
    <button onClick={() => setView(view === 'terminal' ? 'conversation' : 'terminal')}>
      {label}: {view}
    </button>
  )
}

describe('useSessionView', () => {
  it('starts as the conversation and falls back to it for a bad saved value', () => {
    localStorage.setItem('sessionView', '"grid"')
    render(<Shown label="a" />)
    expect(screen.getByRole('button')).toHaveTextContent('a: conversation')
  })

  it('switches every user together and keeps the choice for the next launch', () => {
    render(
      <>
        <Shown label="a" />
        <Shown label="b" />
      </>
    )
    act(() => screen.getByText(/^a:/).click())
    expect(screen.getByText(/^b:/)).toHaveTextContent('b: terminal')
    expect(localStorage.getItem('sessionView')).toBe('"terminal"')
  })

  it('reads the saved choice', () => {
    localStorage.setItem('sessionView', '"terminal"')
    render(<Shown label="a" />)
    expect(screen.getByRole('button')).toHaveTextContent('a: terminal')
  })
})

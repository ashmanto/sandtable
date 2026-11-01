import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Button } from './button'

describe('Button', () => {
  it('fills a primary button with the text color at 28 px', () => {
    render(<Button>Start</Button>)
    const button = screen.getByRole('button', { name: 'Start' })
    expect(button).toHaveClass('bg-fg', 'text-surface', 'h-7')
    expect(button).not.toHaveClass('bg-primary')
  })

  it('marks a destructive button with danger text and no fill', () => {
    render(<Button variant="destructive">Delete</Button>)
    const button = screen.getByRole('button', { name: 'Delete' })
    expect(button).toHaveClass('text-danger')
    expect(button).not.toHaveClass('bg-fg')
  })

  it('keeps a small button at 24 px', () => {
    render(<Button size="sm">Send</Button>)
    expect(screen.getByRole('button', { name: 'Send' })).toHaveClass('h-6')
  })
})

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tip } from './Tip'

describe('Tip', () => {
  it('names the button and shows the name and shortcut on focus', async () => {
    render(
      <Tip label="Hide sidebar" shortcut="⌃⌘S">
        <Button>x</Button>
      </Tip>
    )
    const button = screen.getByRole('button', { name: 'Hide sidebar' })
    expect(button).not.toHaveAttribute('title')
    await userEvent.tab()
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Hide sidebar (⌃⌘S)')
  })

  it('leaves a menu trigger its open state', async () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Tip label="More">
            <Button>x</Button>
          </Tip>
        </DropdownMenuTrigger>
        <DropdownMenuContent>menu</DropdownMenuContent>
      </DropdownMenu>
    )
    const button = screen.getByRole('button', { name: 'More' })
    await userEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(button).toHaveAttribute('data-state', 'open')
  })
})

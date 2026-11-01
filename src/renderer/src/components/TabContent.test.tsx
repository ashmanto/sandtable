import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Md } from './TabContent'

const writeText = vi.fn()

beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})

afterEach(() => {
  vi.useRealTimers()
})

const table = '| Repo | Status |\n| :--- | ---: |\n| `a\\|b` | **Running** |'

describe('Md with copy', () => {
  it('copies a code block without its fence or language, then reads Copied for a moment', async () => {
    vi.useFakeTimers()
    render(<Md copy>{'Run:\n\n```bash\nnpm test\n  echo "x"\n```\n'}</Md>)
    const button = screen.getByRole('button', { name: 'Copy code' })
    await act(async () => fireEvent.click(button))
    expect(writeText).toHaveBeenCalledWith('npm test\n  echo "x"')
    expect(button).toHaveAccessibleName('Copied')
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(button).toHaveAccessibleName('Copy code')
  })

  it('keeps Copied, the focus, and the block when the parent renders again', async () => {
    const reply = '```\nx\n```'
    const { rerender } = render(<Md copy>{reply}</Md>)
    const button = screen.getByRole('button', { name: 'Copy code' })
    button.focus()
    await act(async () => fireEvent.click(button))
    rerender(<Md copy>{reply}</Md>)
    expect(button).toBeInTheDocument()
    expect(button).toHaveFocus()
    expect(button).toHaveAccessibleName('Copied')
    expect(screen.getByRole('status')).toHaveTextContent('Copied')
  })

  it('copies a table as its Markdown rows', async () => {
    render(<Md copy>{`Here:\n\n${table}\n\nDone.`}</Md>)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy table' })))
    expect(writeText).toHaveBeenCalledWith(table)
  })

  it('copies a table inside a list item without its indent', async () => {
    render(<Md copy>{`- Item\n\n  ${table.replaceAll('\n', '\n  ')}`}</Md>)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy table' })))
    expect(writeText).toHaveBeenCalledWith(table)
  })

  it('copies a table in a blockquote whose rows have different prefixes', async () => {
    render(<Md copy>{'> | a | b |\n>| - | - |\n> | 1 | 2 |'}</Md>)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy table' })))
    expect(writeText).toHaveBeenCalledWith('| a | b |\n| - | - |\n| 1 | 2 |')
  })

  it('shows no Copy without copy', () => {
    render(<Md>{`\`\`\`\nx\n\`\`\`\n\n${table}`}</Md>)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { EmojiPicker } from './EmojiPicker'

vi.mock('@/lib/emojiData', () => ({
  resolveEmojiData: () => Promise.reject(new Error('chunk failed'))
}))

it('shows an error in place of the grid when the emoji fail to load', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  render(<EmojiPicker label="Choose emoji" onPick={vi.fn()} />)
  await userEvent.click(screen.getByRole('button', { name: 'Choose emoji' }))
  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load emoji.")
  expect(screen.queryByText('Loading emoji…')).not.toBeInTheDocument()
})

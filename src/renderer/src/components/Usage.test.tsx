import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ModelUsage } from '../../../shared/types'
import { CardUsage } from './Usage'

const opus: ModelUsage = {
  model: 'claude-opus-5-5',
  name: 'Opus 5.5',
  input: 400_000,
  output: 0,
  cacheWrite: 0,
  cacheRead: 8_000_000,
  price: 6.12
}

describe('CardUsage', () => {
  it('shows tokens on the left and the API estimate on the right, with no meter without a cap', () => {
    const { container } = render(<CardUsage usage={[opus]} />)
    expect(screen.getByText('8.4M')).toHaveAttribute('title', '8,400,000')
    expect(screen.getByText('8.4M').parentElement).toHaveTextContent(/^8.4M tokens$/)
    expect(screen.getByText('$6.12')).toHaveTextContent('$6.12 API estimate')
    expect(screen.queryByRole('img')).toBeNull()
    expect(container).not.toHaveTextContent('Reached')
  })

  it('shows its share of the cap as a meter', () => {
    render(<CardUsage usage={[opus]} cap={25e6} />)
    expect(screen.getByText('8.4M').parentElement).toHaveTextContent('8.4M tokens of 25M cap')
    expect(screen.getByText('25M')).toHaveAttribute('title', '25,000,000')
    const meter = screen.getByRole('img', { name: '34% of its token cap' })
    expect(meter.firstElementChild).toHaveClass('bg-fg-3')
    expect(meter.firstElementChild).toHaveStyle({ width: '33.6%' })
  })

  it('turns the meter amber, full, and says so once capped', () => {
    render(<CardUsage usage={[opus]} cap={8e6} capped />)
    const meter = screen.getByRole('img', { name: '105% of its token cap' })
    expect(meter.firstElementChild).toHaveClass('bg-amber')
    expect(meter.firstElementChild).toHaveStyle({ width: '100%' })
    expect(screen.getByText('Reached its token cap')).toHaveClass('text-amber')
  })

  it('renders no meter with a cap of 0', () => {
    const { container } = render(<CardUsage usage={[opus]} cap={0} />)
    expect(container).not.toHaveTextContent(/^0|0$/)
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('renders nothing with no tokens', () => {
    const { container } = render(<CardUsage usage={[{ ...opus, input: 0, cacheRead: 0 }]} />)
    expect(container).toBeEmptyDOMElement()
  })
})

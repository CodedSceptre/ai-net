import { render, screen } from '@testing-library/react'
import { ReputationStars } from './ReputationStars'

/** Count rendered star-fill overlays (each filled or half-filled star). */
function fillCount(container: HTMLElement): number {
  return container.querySelectorAll('[class*="starFill"]').length
}

describe('ReputationStars', () => {
  it('renders no filled stars for 0.0', () => {
    const { container } = render(<ReputationStars value={0} />)
    expect(fillCount(container)).toBe(0)
    expect(screen.getByTestId('reputation-stars')).toHaveTextContent('0.0')
  })

  it('renders a half star for 0.5', () => {
    const { container } = render(<ReputationStars value={0.5} />)
    expect(fillCount(container)).toBe(1)
    expect(screen.getByTestId('reputation-stars')).toHaveTextContent('0.5')
  })

  it('rounds 4.3 to the nearest 0.5 (4.5) for the stars but keeps the exact numeric score', () => {
    const { container } = render(<ReputationStars value={4.3} />)
    expect(fillCount(container)).toBe(5) // 4 full stars + 1 half star
    expect(screen.getByTestId('reputation-stars')).toHaveTextContent('4.3')
  })

  it('renders all five full stars for 5.0', () => {
    const { container } = render(<ReputationStars value={5} />)
    expect(fillCount(container)).toBe(5)
    expect(screen.getByTestId('reputation-stars')).toHaveTextContent('5.0')
  })

  it('clamps values above 5', () => {
    const { container } = render(<ReputationStars value={9} />)
    expect(fillCount(container)).toBe(5)
    expect(screen.getByTestId('reputation-stars')).toHaveTextContent('5.0')
  })

  it('clamps negative values to 0', () => {
    const { container } = render(<ReputationStars value={-2} />)
    expect(fillCount(container)).toBe(0)
    expect(screen.getByTestId('reputation-stars')).toHaveTextContent('0.0')
  })

  it('rounds 3.6 to 3.5 (down to nearest half)', () => {
    const { container } = render(<ReputationStars value={3.6} />)
    // rounded = 3.5 → 3 full + 1 half
    expect(fillCount(container)).toBe(4)
  })
})

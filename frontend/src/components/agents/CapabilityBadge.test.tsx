import { render, screen } from '@testing-library/react'
import { CapabilityBadge } from './CapabilityBadge'

describe('CapabilityBadge', () => {
  it.each(['research', 'risk', 'coding', 'design', 'report'] as const)(
    'renders the %s capability with its semantic color class',
    (capability) => {
      render(<CapabilityBadge capability={capability} />)
      const badge = screen.getByTestId(`capability-badge-${capability}`)
      expect(badge).toHaveTextContent(capability)
      expect(badge.className).toMatch(new RegExp(`capBadge--${capability}`))
    },
  )

  it('falls back to the default style for unknown capabilities', () => {
    render(<CapabilityBadge capability="audit" />)
    const badge = screen.getByTestId('capability-badge-audit')
    expect(badge).toHaveTextContent('audit')
    expect(badge.className).toMatch(/capBadge--default/)
  })

  it('applies an extra className when provided', () => {
    render(<CapabilityBadge capability="research" className="extra-class" />)
    expect(screen.getByTestId('capability-badge-research').className).toMatch(/extra-class/)
  })
})

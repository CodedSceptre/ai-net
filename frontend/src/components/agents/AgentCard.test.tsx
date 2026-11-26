import type { ComponentProps } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, useSearchParams } from 'react-router-dom'
import { AgentCard, DEFAULT_XLM_USD } from './AgentCard'
import type { AgentRecord } from '../../types/api'

const AGENT_ID = 'GABCD1234EFGH5678'

const baseAgent: AgentRecord = {
  id: AGENT_ID,
  name: 'ResearchBot',
  capabilities: ['research', 'coding'],
  price: 12.5,
  reputation: 4.3,
  status: 'active',
}

/** Renders the /tasks/new route so we can assert the hire button pre-fills it. */
function TaskNewMarker() {
  const [params] = useSearchParams()
  return <div data-testid="task-new-marker">{params.get('agent')}</div>
}

function renderCard(props: Partial<ComponentProps<typeof AgentCard>> = {}) {
  const { agent = baseAgent, ...rest } = props
  return render(
    <MemoryRouter initialEntries={['/agents']}>
      <Routes>
        <Route path="/agents" element={<AgentCard agent={agent} {...rest} />} />
        <Route path="/tasks/new" element={<TaskNewMarker />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('AgentCard', () => {
  it('renders the agent name, XLM price, and reputation', () => {
    renderCard()
    expect(screen.getByText('ResearchBot')).toBeInTheDocument()
    expect(screen.getByTestId(`agent-card-price-${AGENT_ID}`)).toHaveTextContent(/12\.50/)
    expect(screen.getByTestId('reputation-stars')).toBeInTheDocument()
  })

  it('renders a capability badge for each capability', () => {
    renderCard()
    expect(screen.getByTestId('capability-badge-research')).toHaveTextContent('research')
    expect(screen.getByTestId('capability-badge-coding')).toHaveTextContent('coding')
  })

  it('shows the USD equivalent using the supplied oracle price', () => {
    renderCard({ xlmUsdPrice: 0.1 }) // 12.5 * 0.1 = 1.25
    expect(screen.getByTestId(`agent-card-usd-${AGENT_ID}`)).toHaveTextContent(/1\.25/)
  })

  it('falls back to the default XLM→USD rate when no oracle price is supplied', () => {
    renderCard() // 12.5 * 0.12 = 1.50
    expect(screen.getByTestId(`agent-card-usd-${AGENT_ID}`)).toHaveTextContent(/1\.50/)
    expect(DEFAULT_XLM_USD).toBe(0.12)
  })

  it('shows an online status dot for active agents', () => {
    renderCard()
    expect(screen.getByTestId(`agent-card-status-${AGENT_ID}`)).toHaveAttribute(
      'aria-label',
      'online',
    )
  })

  it('calls onHire with the agent when the hire button is clicked', async () => {
    const user = userEvent.setup()
    const onHire = vi.fn()
    renderCard({ onHire })
    await user.click(screen.getByTestId(`agent-card-hire-${AGENT_ID}`))
    expect(onHire).toHaveBeenCalledWith(baseAgent)
  })

  it('navigates to task submission pre-filled with the agent id when onHire is not provided', async () => {
    const user = userEvent.setup()
    renderCard()
    await user.click(screen.getByTestId(`agent-card-hire-${AGENT_ID}`))
    expect(screen.getByTestId('task-new-marker')).toHaveTextContent(AGENT_ID)
  })

  it('disables the hire button and shows Offline for offline agents', () => {
    renderCard({ agent: { ...baseAgent, status: 'inactive' } })
    const button = screen.getByTestId(`agent-card-hire-${AGENT_ID}`)
    expect(button).toBeDisabled()
    expect(button).toHaveTextContent('Offline')
    expect(screen.getByTestId(`agent-card-status-${AGENT_ID}`)).toHaveAttribute(
      'aria-label',
      'offline',
    )
  })

  it('renders a degraded status dot for degraded agents', () => {
    renderCard({ agent: { ...baseAgent, status: 'degraded' } })
    expect(screen.getByTestId(`agent-card-status-${AGENT_ID}`)).toHaveAttribute(
      'aria-label',
      'degraded',
    )
  })

  it('renders a skeleton matching the card shape when loading', () => {
    renderCard({ loading: true })
    expect(screen.getByTestId('agent-card-skeleton')).toBeInTheDocument()
    expect(screen.queryByText('ResearchBot')).not.toBeInTheDocument()
  })
})

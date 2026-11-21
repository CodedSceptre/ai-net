import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import ReputationHistoryChart from './ReputationHistoryChart'
import ScoreBreakdownChart from './ScoreBreakdownChart'

vi.mock('recharts', () => {
  const Container = ({ children }: { children: ReactNode }) => <div>{children}</div>
  return {
    ResponsiveContainer: Container,
    LineChart: ({ data }: { data: unknown[] }) => <span>{data.length} daily points</span>,
    PieChart: Container,
    Pie: ({ data }: { data: { weight: number }[] }) => <span>{data.map(({ weight }) => weight).join('/')}</span>,
    CartesianGrid: () => null,
    Line: () => null,
    Tooltip: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Cell: () => null,
  }
})

describe('agent reputation charts', () => {
  it('renders a 30-day series and a weekly trend', () => {
    const historyPoints = Array.from({ length: 30 }, (_, index) => ({
      date: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
      score: index < 25 ? 3.8 : 4.2,
      delta: index === 25 ? 0.4 : null,
    }))
    render(<ReputationHistoryChart historyPoints={historyPoints} trendSummary={0.4} isLoading={false} error={null} />)
    const chart = screen.getByRole('group', { name: 'Daily agent reputation scores for the last 30 days' })
    expect({
      plot: chart.lastElementChild?.textContent,
      summary: screen.getByText(/improved/).textContent,
    }).toMatchInlineSnapshot(`
      {
        "plot": "30 daily points",
        "summary": "Score improved by 0.4 this week",
      }
    `)
  })

  it('renders the donut proportions, composite and legend', () => {
    render(<ScoreBreakdownChart score={4.2} segments={[
      { name: 'Task Success', weight: 50, color: 'blue' },
      { name: 'Dispute Resolution', weight: 30, color: 'purple' },
      { name: 'Response Time', weight: 20, color: 'teal' },
    ]} />)
    expect({
      composite: screen.getByText('4.2 / 5').textContent,
      legend: screen.getAllByRole('listitem').map((item) => item.textContent),
      proportions: screen.getByText('50/30/20').textContent,
    }).toMatchInlineSnapshot(`
      {
        "composite": "4.2 / 5",
        "legend": [
          "Task Success · 50%",
          "Dispute Resolution · 30%",
          "Response Time · 20%",
        ],
        "proportions": "50/30/20",
      }
    `)
  })
})

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { ReputationPoint } from '../../hooks/useAgentReputation'
import { AccessibleChart } from '../common/AccessibleChart'
import styles from './ReputationHistoryChart.module.css'

interface Props {
  historyPoints: ReputationPoint[]
  trendSummary: number | null
  isLoading: boolean
  error: string | null
}

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: '2-digit',
  timeZone: 'UTC',
})
const deltaFormatter = new Intl.NumberFormat('en-US', {
  signDisplay: 'exceptZero',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})
const formatDate = (date: string) => dateFormatter.format(new Date(date))
const formatDelta = (delta: number | null) =>
  delta === null ? 'No previous-day score' : `Daily change ${deltaFormatter.format(delta)}`

export default function ReputationHistoryChart({ historyPoints, trendSummary, isLoading, error }: Props) {
  if (isLoading) return <div className={styles.skeleton} role="status" aria-label="Loading reputation history" />
  if (error) return <p role="alert">Could not load reputation history.</p>
  if (historyPoints.filter(({ score }) => score !== null).length < 2) {
    return <p className={styles.empty}>Not enough data yet — check back after 7 days</p>
  }

  const trend = trendSummary ?? 0
  const points = historyPoints.map(({ date, score, delta }) => ({
    label: formatDate(date),
    value: score === null ? 'No score recorded' : `${score.toFixed(1)} / 5`,
    detail: formatDelta(delta),
  }))

  return (
    <section className={styles.section}>
      <h3>30-day reputation history</h3>
      <AccessibleChart label="Daily agent reputation scores for the last 30 days" points={points}>
        <ResponsiveContainer width="100%" height={230}>
          <LineChart data={historyPoints} margin={{ top: 8, right: 14, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border-color, #334155)" strokeDasharray="3 4" vertical={false} />
            <XAxis dataKey="date" tickFormatter={formatDate} minTickGap={26} tick={{ fontSize: 11 }} />
            <YAxis domain={[0, 5]} allowDataOverflow width={26} ticks={[0, 1, 2, 3, 4, 5]} />
            <Tooltip content={({ active, payload }) => {
              const point = payload?.[0]?.payload as ReputationPoint | undefined
              if (!active || !point || point.score === null) return null
              return (
                <div className={styles.tooltip}>
                  <time dateTime={point.date}>{formatDate(point.date)}</time>
                  <strong>Score {point.score.toFixed(1)} / 5</strong>
                  <span>{formatDelta(point.delta)}</span>
                </div>
              )
            }} />
            <Line
              type="monotone"
              dataKey="score"
              stroke="var(--accent-info, #3b82f6)"
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </AccessibleChart>
      {trendSummary !== null && (
        <p className={trend > 0 ? styles.improving : trend < 0 ? styles.declining : undefined}>
          {trend === 0
            ? 'Score stayed the same this week'
            : `Score ${trend > 0 ? 'improved' : 'declined'} by ${Math.abs(trend).toFixed(1)} this week`}
        </p>
      )}
    </section>
  )
}

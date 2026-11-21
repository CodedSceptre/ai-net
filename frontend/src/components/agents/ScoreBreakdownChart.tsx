import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import type { ReputationSegment } from '../../hooks/useAgentReputation'
import { AccessibleChart } from '../common/AccessibleChart'
import styles from './ReputationHistoryChart.module.css'

interface Props {
  segments: ReputationSegment[]
  score: number
}

export default function ScoreBreakdownChart({ segments, score }: Props) {
  const composite = `${score.toFixed(1)} / 5`
  return (
    <section className={styles.section}>
      <h3>Score breakdown</h3>
      <AccessibleChart
        label={`Reputation score breakdown. Composite score ${composite}`}
        points={segments.map(({ name, weight }) => ({ label: name, value: `${weight}% weight` }))}
      >
        <div className={styles.donut}>
          <ResponsiveContainer width="100%" height={210}>
            <PieChart>
              <Pie data={segments} dataKey="weight" nameKey="name" innerRadius={66} outerRadius={96} isAnimationActive={false}>
                {segments.map(({ name, color }) => <Cell key={name} fill={color} stroke="none" />)}
              </Pie>
              <Tooltip formatter={(value) => [`${value}%`, 'Weight']} />
            </PieChart>
          </ResponsiveContainer>
          <strong className={styles.composite}>{composite}</strong>
        </div>
      </AccessibleChart>
      <ul className={styles.legend}>
        {segments.map(({ name, weight, color }) => (
          <li key={name}>
            <span className={styles.swatch} style={{ backgroundColor: color }} aria-hidden="true" />
            {name} · {weight}%
          </li>
        ))}
      </ul>
    </section>
  )
}

import { useTranslation } from 'react-i18next'
import { Star } from 'lucide-react'
import styles from './AgentTable.module.css'

interface ReputationStarsProps {
  /** Reputation score on a 0-5 scale. */
  value: number
  /** Icon size in pixels. */
  size?: number
}

/**
 * Renders a 0-5 star reputation rating. The star fill is rounded to the nearest
 * 0.5 so each star is rendered as full, half, or empty; the exact numeric score
 * is shown alongside the stars.
 *
 * A half star is produced by clipping the filled-star overlay to 50% width,
 * reusing the existing `.starFill` clip technique from AgentTable.module.css.
 *
 * Issue #734: round the star rating to the nearest 0.5.
 */
export function ReputationStars({ value, size = 14 }: ReputationStarsProps) {
  const { t } = useTranslation()
  const clamped = Math.max(0, Math.min(5, value))
  const rounded = Math.round(clamped * 2) / 2
  const label = t('a11y.ratingOutOfFive', { value: clamped.toFixed(1) })

  return (
    <span
      className={styles.stars}
      role="img"
      aria-label={label}
      title={label}
      data-testid="reputation-stars"
    >
      {Array.from({ length: 5 }, (_, i) => {
        const fill = Math.max(0, Math.min(1, rounded - i))
        return (
          <span key={i} className={styles.starWrap}>
            <Star size={size} className={styles.starBg} aria-hidden="true" />
            {fill > 0 && (
              <span className={styles.starFill} style={{ width: `${fill * 100}%` }}>
                <Star size={size} className={styles.starFg} aria-hidden="true" />
              </span>
            )}
          </span>
        )
      })}
      <span className={styles.starValue}>{clamped.toFixed(1)}</span>
    </span>
  )
}

export default ReputationStars

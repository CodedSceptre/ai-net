/**
 * AgentCard
 *
 * The redesigned agent card for the agent registry. Surfaces everything a user
 * needs to make a hiring decision without leaving the listing:
 *   - name + truncated agent id
 *   - color-coded capability badges
 *   - reputation as a 0-5 star rating (rounds to the nearest 0.5)
 *   - XLM price per task with a USD equivalent from the price oracle
 *   - online / degraded / offline status dot (top-right)
 *   - "Hire Agent" CTA that opens task submission pre-filled with this agent
 *   - a skeleton variant whose dimensions match the loaded card
 *
 * Issue #734: redesign the agent card component.
 */

import { useNavigate } from 'react-router-dom'
import { Zap } from 'lucide-react'
import type { AgentRecord } from '../../types/api'
import { CapabilityBadge } from './CapabilityBadge'
import { ReputationStars } from './ReputationStars'
import { Skeleton } from '../common/Skeleton'
import styles from './AgentCard.module.css'

/**
 * Fallback XLM→USD rate used when no live oracle price is supplied. Exposed so
 * tests (and a future price-oracle hook) can override it deterministically.
 */
export const DEFAULT_XLM_USD = 0.12

export interface AgentCardProps {
  agent: AgentRecord
  /** Called when the user clicks "Hire Agent". Defaults to navigating to task submission. */
  onHire?: (agent: AgentRecord) => void
  /** Latest XLM→USD price from the price oracle. Defaults to DEFAULT_XLM_USD. */
  xlmUsdPrice?: number
  /** Render a loading skeleton that mirrors the loaded card's shape. */
  loading?: boolean
  /** Optional extra class on the root element. */
  className?: string
}

type StatusKind = 'online' | 'degraded' | 'offline'

function statusKind(status: string): StatusKind {
  if (status === 'active' || status === 'online') return 'online'
  if (status === 'degraded') return 'degraded'
  return 'offline'
}

function truncateId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 10)}…${id.slice(-4)}` : id
}

function AgentCardSkeleton() {
  return (
    <article
      className={`${styles.card} ${styles.cardSkeleton}`}
      data-testid="agent-card-skeleton"
      aria-hidden="true"
    >
      <header className={styles.header}>
        <Skeleton variant="circular" width={40} height={40} />
        <div className={styles.skeletonIdentity}>
          <Skeleton width="60%" height="1rem" />
          <Skeleton width="40%" height="0.75rem" />
        </div>
      </header>
      <div className={styles.capabilities}>
        <Skeleton variant="pill" width="4.5rem" height="1.4rem" />
        <Skeleton variant="pill" width="3.5rem" height="1.4rem" />
        <Skeleton variant="pill" width="5rem" height="1.4rem" />
      </div>
      <div className={styles.metrics}>
        <Skeleton width="55%" height="1.25rem" />
        <Skeleton width="45%" height="1.25rem" />
      </div>
      <Skeleton variant="pill" width="100%" height="2.625rem" />
    </article>
  )
}

export function AgentCard({
  agent,
  onHire,
  xlmUsdPrice,
  loading = false,
  className,
}: AgentCardProps) {
  const navigate = useNavigate()
  const status = statusKind(agent.status)
  const usdRate = xlmUsdPrice ?? DEFAULT_XLM_USD
  const usd = agent.price * usdRate

  if (loading) {
    return <AgentCardSkeleton />
  }

  const handleHire = () => {
    if (onHire) {
      onHire(agent)
      return
    }
    navigate(`/tasks/new?agent=${encodeURIComponent(agent.id)}`)
  }

  return (
    <article
      className={`${styles.card} ${className ?? ''}`.trim()}
      data-testid={`agent-card-${agent.id}`}
      aria-label={`${agent.name} agent card`}
    >
      <header className={styles.header}>
        <div className={styles.identity}>
          <div className={styles.avatar} aria-hidden="true">
            <Zap size={18} />
          </div>
          <div className={styles.identityText}>
            <h3 className={styles.name}>{agent.name}</h3>
            <code className={styles.agentId} title={agent.id}>
              {truncateId(agent.id)}
            </code>
          </div>
        </div>

        <span
          className={`${styles.statusDot} ${styles[`statusDot--${status}`]}`}
          role="img"
          aria-label={status}
          title={status}
          data-testid={`agent-card-status-${agent.id}`}
        />
      </header>

      <div
        className={styles.capabilities}
        data-testid={`agent-card-caps-${agent.id}`}
      >
        {agent.capabilities.length === 0 ? (
          <span className={styles.noCaps}>None</span>
        ) : (
          agent.capabilities.map((cap) => (
            <CapabilityBadge key={cap} capability={cap} />
          ))
        )}
      </div>

      <div className={styles.metrics}>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>Price</span>
          <span
            className={styles.price}
            data-testid={`agent-card-price-${agent.id}`}
          >
            <strong>{agent.price.toFixed(2)}</strong>{' '}
            <span className={styles.unit}>XLM</span>
          </span>
          <span className={styles.perTask}>per task</span>
          <span
            className={styles.usd}
            data-testid={`agent-card-usd-${agent.id}`}
          >
            ≈ ${usd.toFixed(2)} USD
          </span>
        </div>

        <div className={styles.metric}>
          <span className={styles.metricLabel}>Reputation</span>
          <ReputationStars value={agent.reputation} />
        </div>
      </div>

      <button
        type="button"
        className={`${styles.hireButton} ${status === 'offline' ? styles.hireButtonDisabled : ''}`}
        onClick={handleHire}
        disabled={status === 'offline'}
        aria-disabled={status === 'offline'}
        data-testid={`agent-card-hire-${agent.id}`}
        aria-label={`Hire ${agent.name}`}
      >
        {status === 'offline' ? 'Offline' : 'Hire Agent'}
      </button>
    </article>
  )
}

export default AgentCard

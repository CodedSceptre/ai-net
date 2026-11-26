/**
 * CapabilityBadge
 *
 * A color-coded pill badge for a single agent capability. Each of the five
 * canonical capabilities maps to a fixed semantic color from the design token
 * system:
 *   research → blue, risk → amber, coding → purple, design → pink, report → green
 *
 * Unknown capabilities fall back to the neutral "default" style.
 *
 * Issue #734: part of the agent card redesign.
 */

import styles from './AgentCard.module.css'

const CAPABILITY_KEYS = ['research', 'risk', 'coding', 'design', 'report'] as const
type CapabilityKey = (typeof CAPABILITY_KEYS)[number]

function capabilityKey(capability: string): CapabilityKey | 'default' {
  const lower = capability.toLowerCase()
  return (CAPABILITY_KEYS as readonly string[]).includes(lower)
    ? (lower as CapabilityKey)
    : 'default'
}

export interface CapabilityBadgeProps {
  capability: string
  /** Optional extra class applied to the pill. */
  className?: string
}

export function CapabilityBadge({ capability, className }: CapabilityBadgeProps) {
  const key = capabilityKey(capability)
  return (
    <span
      className={`${styles.capBadge} ${styles[`capBadge--${key}`]} ${className ?? ''}`.trim()}
      data-testid={`capability-badge-${capability}`}
    >
      {capability}
    </span>
  )
}

export default CapabilityBadge

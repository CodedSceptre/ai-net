/**
 * AgentRegistryCard
 *
 * Displays a single registered agent from the backend registry in card format.
 * Shows: name, capabilities (pill badges), price (XLM), online/offline status,
 * reputation stars, and a "Hire" CTA button.
 *
 * Used by the /agents page grid (Issue #1/#3).
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Star, Zap } from 'lucide-react';
import type { AgentRecord } from '../../types/api';
import { GlossaryHelp } from '../common/HelpIcon';
import styles from './AgentRegistryCard.module.css';

export interface AgentRegistryCardProps {
  agent: AgentRecord;
  onHire?: (agent: AgentRecord) => void;
}

/** Map capability names to tailwind-compatible color keys for pill styling. */
const CAPABILITY_COLORS: Record<string, string> = {
  research: 'blue',
  risk: 'yellow',
  coding: 'green',
  design: 'purple',
  report: 'red',
  audit: 'orange',
};

function ReputationStars({ value }: { value: number }) {
  const rounded = Math.round(Math.max(0, Math.min(5, value)));
  return (
    <span className={styles.stars} aria-label={`Reputation: ${value.toFixed(1)} out of 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          size={12}
          className={i < rounded ? styles.starFilled : styles.starEmpty}
          aria-hidden="true"
        />
      ))}
      <span className={styles.reputationValue}>{value.toFixed(1)}</span>
    </span>
  );
}

function CapabilityPill({ capability }: { capability: string }) {
  const colorKey = CAPABILITY_COLORS[capability.toLowerCase()] ?? 'default';
  return (
    <span
      className={`${styles.pill} ${styles[`pill--${colorKey}`]}`}
      key={capability}
    >
      {capability}
    </span>
  );
}

export const AgentRegistryCard: React.FC<AgentRegistryCardProps> = ({ agent, onHire }) => {
  const { t } = useTranslation();
  const isOnline = agent.status === 'active';

  const handleHire = (e: React.MouseEvent) => {
    e.stopPropagation();
    onHire?.(agent);
  };

  return (
    <article
      className={styles.card}
      data-testid={`agent-card-${agent.id}`}
      aria-label={`${agent.name} agent card`}
    >
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className={styles.header}>
        <div className={styles.nameGroup}>
          <div className={styles.avatar} aria-hidden="true">
            <Zap size={18} />
          </div>
          <div>
            <h3 className={styles.name}>{agent.name}</h3>
            <code className={styles.agentId} title={agent.id}>
              {agent.id.length > 16 ? `${agent.id.slice(0, 10)}…${agent.id.slice(-4)}` : agent.id}
            </code>
          </div>
        </div>

        {/* Online / Offline badge */}
        <div
          className={`${styles.statusBadge} ${
            isOnline ? styles.statusOnline : styles.statusOffline
          }`}
          aria-label={isOnline ? 'Online' : 'Offline'}
          data-testid={`agent-status-${agent.id}`}
        >
          <span className={styles.statusDot} aria-hidden="true" />
          {isOnline
            ? t('agent.status.active', { defaultValue: 'Online' })
            : t('agent.status.inactive', { defaultValue: 'Offline' })}
        </div>
      </div>

      {/* ── Capabilities ───────────────────────────────────────────── */}
      <div className={styles.capabilities} data-testid={`agent-capabilities-${agent.id}`}>
        {agent.capabilities.length === 0 ? (
          <span className={styles.noCaps}>
            {t('common.none', { defaultValue: 'None' })}
          </span>
        ) : (
          agent.capabilities.map((cap) => <CapabilityPill key={cap} capability={cap} />)
        )}
      </div>

      {/* ── Metrics row ────────────────────────────────────────────── */}
      <div className={styles.metrics}>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>
            {t('agent.table.price', { defaultValue: 'Price' })}
          </span>
          <span
            className={styles.metricValue}
            data-testid={`agent-price-${agent.id}`}
          >
            <strong>{agent.price.toFixed(2)}</strong>{' '}
            <span className={styles.xlmUnit}>XLM</span>
            <GlossaryHelp.XLM />
          </span>
        </div>

        <div className={styles.metric}>
          <span className={styles.metricLabel}>
            {t('common.reputation', { defaultValue: 'Reputation' })}
          </span>
          <ReputationStars value={agent.reputation} />
        </div>
      </div>

      {/* ── Hire CTA ───────────────────────────────────────────────── */}
      <button
        type="button"
        className={`${styles.hireButton} ${!isOnline ? styles.hireButtonDisabled : ''}`}
        onClick={handleHire}
        disabled={!isOnline}
        aria-disabled={!isOnline}
        data-testid={`agent-hire-${agent.id}`}
        aria-label={`Hire ${agent.name}`}
      >
        {isOnline
          ? t('agent.hire', { defaultValue: 'Hire Agent' })
          : t('agent.offline', { defaultValue: 'Offline' })}
      </button>
    </article>
  );
};

export default AgentRegistryCard;

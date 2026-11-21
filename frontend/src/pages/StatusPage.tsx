/**
 * StatusPage
 *
 * Public status page (no authentication required) showing live health of all
 * system components. Auto-refreshes every 30 seconds with a visible countdown.
 *
 * Components monitored:
 *   - Backend API
 *   - Stellar Testnet Horizon
 *   - Venice AI
 *   - Smart Contracts
 *
 * Issue #748
 */

import { useState, useId } from 'react';
import { RefreshCw, ChevronRight, X } from 'lucide-react';
import { useSystemStatus, type ComponentStatus, type SystemComponent, type Incident } from '../hooks/useSystemStatus';
import { UptimeBar } from '../components/common/UptimeBar';
import styles from './StatusPage.module.css';

// ── Helpers ────────────────────────────────────────────────────────────────────

function overallStatus(components: SystemComponent[]): ComponentStatus {
  if (components.some((c) => c.status === 'outage')) return 'outage';
  if (components.some((c) => c.status === 'degraded')) return 'degraded';
  return 'operational';
}

const OVERALL_MESSAGES: Record<ComponentStatus, string> = {
  operational: 'All Systems Operational',
  degraded: 'Partial Service Degradation',
  outage: 'Service Disruption Detected',
};

const STATUS_LABELS: Record<ComponentStatus, string> = {
  operational: 'Operational',
  degraded: 'Degraded',
  outage: 'Outage',
};

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ── Sub-components ─────────────────────────────────────────────────────────────

interface StatusBadgeProps {
  status: ComponentStatus;
}

function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span className={`${styles.statusBadge} ${styles[status]}`} role="status" aria-label={STATUS_LABELS[status]}>
      <span className={styles.statusDot} aria-hidden="true" />
      {STATUS_LABELS[status]}
    </span>
  );
}

// ── Incident accordion item ────────────────────────────────────────────────────

interface IncidentItemProps {
  incident: Incident;
}

function IncidentItem({ incident }: IncidentItemProps) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();

  return (
    <div className={styles.incidentItem}>
      <button
        type="button"
        className={styles.incidentToggle}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={bodyId}
      >
        <ChevronRight
          size={16}
          aria-hidden="true"
          className={`${styles.incidentToggleIcon}${open ? ` ${styles.open}` : ''}`}
        />
        <div className={styles.incidentToggleContent}>
          <div className={styles.incidentTitle}>{incident.title}</div>
          <div className={styles.incidentDateRange}>
            {formatTimestamp(incident.startedAt)}
            {incident.resolvedAt ? ` — ${formatTimestamp(incident.resolvedAt)}` : ' — ongoing'}
          </div>
        </div>
        {incident.resolvedAt ? (
          <span className={styles.resolvedBadge} aria-label="Resolved">Resolved</span>
        ) : (
          <span className={styles.ongoingBadge} aria-label="Ongoing">Ongoing</span>
        )}
      </button>

      {open && (
        <div id={bodyId} className={styles.incidentBody}>
          <div className={styles.incidentUpdates} role="list" aria-label="Incident updates">
            {incident.updates.map((update, i) => (
              <div key={i} className={styles.incidentUpdate} role="listitem">
                <time className={styles.updateTime} dateTime={update.timestamp}>
                  {formatTimestamp(update.timestamp)}
                </time>
                <p className={styles.updateMessage}>{update.message}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Subscription modal ─────────────────────────────────────────────────────────

interface SubscribeModalProps {
  onClose: () => void;
}

function SubscribeModal({ onClose }: SubscribeModalProps) {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  function handleSubscribe() {
    if (!isValid) return;
    // In production this would call an API endpoint
    setSubmitted(true);
  }

  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <div
      className={styles.modalOverlay}
      role="dialog"
      aria-modal="true"
      aria-label="Subscribe to status notifications"
      onClick={handleOverlayClick}
    >
      <div className={styles.modal}>
        <button
          type="button"
          className={styles.modalCloseBtn}
          onClick={onClose}
          aria-label="Close modal"
        >
          <X size={18} aria-hidden="true" />
        </button>

        <h2 className={styles.modalTitle}>Get Notified</h2>
        <p className={styles.modalSubtitle}>
          Receive email alerts when any component status changes.
        </p>

        {!submitted ? (
          <>
            <div className={styles.modalInputGroup}>
              <input
                type="email"
                className={styles.modalEmailInput}
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSubscribe(); }}
                aria-label="Email address"
                autoFocus
              />
              <button
                type="button"
                className={styles.modalSubscribeBtn}
                onClick={handleSubscribe}
                disabled={!isValid}
              >
                Subscribe
              </button>
            </div>
          </>
        ) : (
          <p className={styles.modalSuccess}>
            ✓ You are subscribed. We will email you at <strong>{email}</strong>.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function StatusPage() {
  const { components, incidents, lastUpdated, secondsUntilRefresh, loading, error, refresh } =
    useSystemStatus();
  const [showModal, setShowModal] = useState(false);

  const status = overallStatus(components);
  const affectedComponents = components.filter((c) => c.status !== 'operational');

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <h1 className={styles.title}>System Status</h1>
        <div className={styles.meta}>
          {lastUpdated && (
            <span>Last updated: {lastUpdated.toLocaleTimeString()}</span>
          )}
          <span className={styles.countdown}>
            Refreshing in {secondsUntilRefresh}s
          </span>
          <button
            type="button"
            className={styles.refreshBtn}
            onClick={refresh}
            aria-label="Refresh status now"
          >
            <RefreshCw size={12} aria-hidden="true" />
            Refresh
          </button>
        </div>
      </div>

      {/* API error notice */}
      {error && (
        <div className={styles.errorNotice} role="status">
          {error}
        </div>
      )}

      {/* Overall status banner */}
      <div className={`${styles.overallBanner} ${styles[status]}`} role="status" aria-live="polite">
        <span className={styles.bannerDot} aria-hidden="true" />
        {OVERALL_MESSAGES[status]}
      </div>

      {/* Incident banner — only when components are non-operational */}
      {affectedComponents.length > 0 && (
        <div className={styles.incidentBanner} role="alert" aria-live="assertive">
          <strong>Active issue — the following components are affected:</strong>
          <div className={styles.incidentBannerComponents}>
            {affectedComponents.map((c) => (
              <span key={c.id} className={styles.incidentBannerComponent}>
                {c.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Components */}
      <p className={styles.sectionTitle}>Components</p>

      {loading && components.length === 0 ? (
        <div className={styles.loadingGrid} aria-busy="true" aria-label="Loading components">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className={styles.loadingCard} />
          ))}
        </div>
      ) : (
        <div className={styles.componentGrid}>
          {components.map((component) => (
            <div key={component.id} className={styles.componentCard}>
              <div className={styles.componentCardHeader}>
                <span className={styles.componentName}>{component.name}</span>
                <div className={styles.componentMeta}>
                  {component.latencyMs != null && (
                    <span className={styles.latency}>{component.latencyMs}ms</span>
                  )}
                  <StatusBadge status={component.status} />
                </div>
              </div>
              <UptimeBar history={component.history} label={component.name} />
            </div>
          ))}
        </div>
      )}

      {/* Get notified CTA */}
      <div className={styles.cta}>
        <p className={styles.ctaText}>
          <strong>Stay informed.</strong> Subscribe to receive alerts when status changes.
        </p>
        <button
          type="button"
          className={styles.notifyBtn}
          onClick={() => setShowModal(true)}
        >
          Get Notified
        </button>
      </div>

      {/* Historical incidents */}
      {incidents.length > 0 && (
        <section className={styles.incidents}>
          <p className={styles.sectionTitle}>Past Incidents</p>
          {incidents.map((incident) => (
            <IncidentItem key={incident.id} incident={incident} />
          ))}
        </section>
      )}

      {/* Subscription modal */}
      {showModal && <SubscribeModal onClose={() => setShowModal(false)} />}
    </div>
  );
}

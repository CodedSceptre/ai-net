import { useState } from 'react';
import type { ComponentStatus } from '../../hooks/useSystemStatus';
import styles from './UptimeBar.module.css';

export interface UptimeBarProps {
  history: Array<{ date: string; status: ComponentStatus }>;
  label: string;
}

function statusLabel(status: ComponentStatus): string {
  if (status === 'operational') return 'Operational';
  if (status === 'degraded') return 'Degraded';
  return 'Outage';
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function UptimeBar({ history, label }: UptimeBarProps) {
  const [tooltip, setTooltip] = useState<{ date: string; status: ComponentStatus } | null>(null);

  const operationalCount = history.filter((d) => d.status === 'operational').length;
  const uptimePct = history.length > 0 ? ((operationalCount / history.length) * 100).toFixed(2) : '100.00';

  return (
    <div className={styles.uptimeBarWrapper} aria-label={`${label} uptime history`}>
      <div className={styles.bars} role="list" aria-label="90-day uptime history">
        {history.map((day) => (
          <span
            key={day.date}
            role="listitem"
            className={`${styles.bar} ${styles[day.status]}`}
            aria-label={`${formatDate(day.date)}: ${statusLabel(day.status)}`}
            onMouseEnter={() => setTooltip(day)}
            onMouseLeave={() => setTooltip(null)}
            onFocus={() => setTooltip(day)}
            onBlur={() => setTooltip(null)}
            tabIndex={0}
          />
        ))}
      </div>

      {tooltip && (
        <div className={styles.tooltip} role="tooltip" aria-live="polite">
          <span className={styles.tooltipDate}>{formatDate(tooltip.date)}</span>
          <span className={`${styles.tooltipStatus} ${styles[tooltip.status]}`}>
            {statusLabel(tooltip.status)}
          </span>
        </div>
      )}

      <div className={styles.rangeLabels} aria-hidden="true">
        <span>90 days ago</span>
        <span className={styles.uptimePct}>{uptimePct}% uptime</span>
        <span>Today</span>
      </div>
    </div>
  );
}

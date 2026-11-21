import React, { memo, useCallback, useState } from 'react';
import {
  ClipboardList,
  CheckCircle,
  DollarSign,
  UserPlus,
  AlertTriangle,
  Copy,
  Check,
} from 'lucide-react';
import { useToast } from '../../hooks/useToast';
import styles from './ActivityFeed.module.css';

// ── Types ──────────────────────────────────────────────────────────────────────

export type FeedEventType =
  | 'TaskSubmitted'
  | 'NodeCompleted'
  | 'PaymentReleased'
  | 'AgentRegistered'
  | 'DisputeRaised';

export interface FeedEvent {
  id: string;
  type: FeedEventType;
  summary: string;
  taskId?: string;
  timestamp: string; // ISO 8601
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const EVENT_ICON: Record<FeedEventType, React.ReactNode> = {
  TaskSubmitted:    <ClipboardList size={15} aria-hidden />,
  NodeCompleted:    <CheckCircle   size={15} aria-hidden />,
  PaymentReleased:  <DollarSign    size={15} aria-hidden />,
  AgentRegistered:  <UserPlus      size={15} aria-hidden />,
  DisputeRaised:    <AlertTriangle size={15} aria-hidden />,
};

const EVENT_CLASS: Record<FeedEventType, string> = {
  TaskSubmitted:   'eventTask',
  NodeCompleted:   'eventSuccess',
  PaymentReleased: 'eventPayment',
  AgentRegistered: 'eventAgent',
  DisputeRaised:   'eventDanger',
};

function timeAgo(iso: string, now: Date): string {
  const diff = Math.max(0, now.getTime() - new Date(iso).getTime());
  const secs = Math.floor(diff / 1000);
  if (secs < 60)       return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60)       return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)        return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function truncateId(id: string, len = 8): string {
  return id.length <= len ? id : `${id.slice(0, len)}…`;
}

// ── Component ──────────────────────────────────────────────────────────────────

interface ActivityFeedItemProps {
  event: FeedEvent;
  now: Date;
}

export const ActivityFeedItem: React.FC<ActivityFeedItemProps> = memo(({ event, now }) => {
  const [copied, setCopied] = useState(false);
  const { showToast } = useToast();

  const handleCopy = useCallback(() => {
    if (!event.taskId) return;
    navigator.clipboard.writeText(event.taskId).then(() => {
      setCopied(true);
      showToast('Task ID copied', 'success', 2000);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [event.taskId, showToast]);

  const colorClass = styles[EVENT_CLASS[event.type] as keyof typeof styles];

  return (
    <li className={styles.item} data-testid="feed-item">
      <span className={`${styles.eventIcon} ${colorClass}`}>
        {EVENT_ICON[event.type]}
      </span>

      <span className={styles.itemBody}>
        <span className={styles.summary}>{event.summary}</span>
        {event.taskId && (
          <span className={styles.taskIdRow}>
            <code className={styles.taskId}>{truncateId(event.taskId)}</code>
            <button
              type="button"
              className={styles.copyBtn}
              onClick={handleCopy}
              aria-label={`Copy task ID ${event.taskId}`}
              data-testid="copy-task-id"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
            </button>
          </span>
        )}
      </span>

      <time
        dateTime={event.timestamp}
        className={styles.timeAgo}
        title={new Date(event.timestamp).toLocaleString()}
      >
        {timeAgo(event.timestamp, now)}
      </time>
    </li>
  );
});

ActivityFeedItem.displayName = 'ActivityFeedItem';
export default ActivityFeedItem;

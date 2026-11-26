/**
 * TaskMilestoneTimeline
 *
 * Vertical milestone timeline shown on TaskDetailPage. Renders five fixed
 * milestones (Created → Decomposed → In Progress → Completed → Paid) with
 * per-milestone status derived from live task + node state fed via WebSocket.
 *
 * Features
 * ─────────
 * - Active milestone: pulsing circle indicator
 * - Completed milestones: green checkmark fill
 * - Failed milestone: red X, all subsequent milestones grayed out
 * - Timestamps in user locale
 * - Animates in as task progresses (driven by WebSocket events)
 * - Mobile: horizontal scroll layout at ≤ 480 px
 */

import React, { useMemo } from 'react';
import {
  CheckCircle2,
  XCircle,
  Clock,
  Zap,
  Users,
  Trophy,
  Coins,
} from 'lucide-react';
import type { TaskResponse, DAGNode, PaymentEvent } from '../../types/api';
import styles from './TaskMilestoneTimeline.module.css';

// ─── Milestone definitions ────────────────────────────────────────────────────

export type MilestoneId =
  | 'created'
  | 'decomposed'
  | 'in_progress'
  | 'completed'
  | 'paid';

export type MilestoneStatus = 'done' | 'active' | 'pending' | 'failed';

export interface Milestone {
  id: MilestoneId;
  label: string;
  icon: React.ReactNode;
  status: MilestoneStatus;
  timestamp?: string;
  estimatedAt?: string;
}

const MILESTONE_ICONS: Record<MilestoneId, React.ReactNode> = {
  created: <Clock size={16} aria-hidden />,
  decomposed: <Zap size={16} aria-hidden />,
  in_progress: <Users size={16} aria-hidden />,
  completed: <Trophy size={16} aria-hidden />,
  paid: <Coins size={16} aria-hidden />,
};

const MILESTONE_LABELS: Record<MilestoneId, string> = {
  created: 'Created',
  decomposed: 'Decomposed',
  in_progress: 'Agents Hired',
  completed: 'Work Completed',
  paid: 'Payments Released',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTs(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return undefined;
  }
}

/** Estimate completion time: average 15 s per node, capped at 5 min. */
function estimateCompletion(nodes: DAGNode[], createdAt?: string): string | undefined {
  if (!nodes.length || !createdAt) return undefined;
  const avgMs = Math.min(nodes.length * 15_000, 300_000);
  try {
    return new Date(new Date(createdAt).getTime() + avgMs).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return undefined;
  }
}

// ─── Derive milestones from task state ────────────────────────────────────────

export function deriveMilestones(
  task: TaskResponse | null,
  nodes: DAGNode[],
  payments: PaymentEvent[],
): Milestone[] {
  const taskStatus = task?.status ?? 'queued';
  const hasNodes = nodes.length > 0;
  const anyRunning = nodes.some((n) => n.status === 'running');
  const anyFailed = nodes.some((n) => n.status === 'failed');
  const allNodesDone = hasNodes && nodes.every((n) => n.status === 'completed');
  const hasPaid = payments.length > 0;

  // Find earliest started node timestamp
  const firstStartedAt = nodes
    .filter((n) => n.startedAt)
    .sort((a, b) => new Date(a.startedAt!).getTime() - new Date(b.startedAt!).getTime())[0]
    ?.startedAt;

  // Find task completion time
  const completedAt =
    taskStatus === 'completed' || taskStatus === 'failed' ? task?.updatedAt : undefined;

  // Find latest payment timestamp
  const lastPaymentAt = payments.length
    ? payments.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0]
        .timestamp
    : undefined;

  // Determine which milestone index has failed (if any)
  let failedMilestoneIndex = -1;
  if (anyFailed) {
    // If nodes failed before completion → in_progress is the failed milestone
    failedMilestoneIndex = 2; // in_progress
  } else if (taskStatus === 'failed' && !anyFailed) {
    // Task failed at decomposition level
    failedMilestoneIndex = 1; // decomposed
  }

  const milestoneOrder: MilestoneId[] = [
    'created',
    'decomposed',
    'in_progress',
    'completed',
    'paid',
  ];

  const statuses: Milestone[] = milestoneOrder.map((id, idx): Milestone => {
    // If a previous milestone failed, all subsequent are grayed (pending)
    if (failedMilestoneIndex !== -1 && idx > failedMilestoneIndex) {
      return {
        id,
        label: MILESTONE_LABELS[id],
        icon: MILESTONE_ICONS[id],
        status: 'pending',
      };
    }
    if (failedMilestoneIndex === idx) {
      return {
        id,
        label: MILESTONE_LABELS[id],
        icon: MILESTONE_ICONS[id],
        status: 'failed',
        timestamp: completedAt,
      };
    }

    switch (id) {
      case 'created':
        return {
          id,
          label: MILESTONE_LABELS[id],
          icon: MILESTONE_ICONS[id],
          status: 'done',
          timestamp: task?.createdAt,
        };

      case 'decomposed':
        if (hasNodes) {
          return {
            id,
            label: MILESTONE_LABELS[id],
            icon: MILESTONE_ICONS[id],
            status: 'done',
            timestamp: firstStartedAt ?? task?.createdAt,
          };
        }
        if (taskStatus === 'queued') {
          return {
            id,
            label: MILESTONE_LABELS[id],
            icon: MILESTONE_ICONS[id],
            status: task ? 'active' : 'pending',
          };
        }
        return {
          id,
          label: MILESTONE_LABELS[id],
          icon: MILESTONE_ICONS[id],
          status: 'pending',
        };

      case 'in_progress':
        if (anyRunning) {
          return {
            id,
            label: MILESTONE_LABELS[id],
            icon: MILESTONE_ICONS[id],
            status: 'active',
            timestamp: firstStartedAt,
          };
        }
        if (allNodesDone || taskStatus === 'completed' || taskStatus === 'failed') {
          return {
            id,
            label: MILESTONE_LABELS[id],
            icon: MILESTONE_ICONS[id],
            status: 'done',
            timestamp: firstStartedAt,
          };
        }
        if (hasNodes) {
          return {
            id,
            label: MILESTONE_LABELS[id],
            icon: MILESTONE_ICONS[id],
            status: 'active',
            timestamp: firstStartedAt,
          };
        }
        return {
          id,
          label: MILESTONE_LABELS[id],
          icon: MILESTONE_ICONS[id],
          status: 'pending',
          estimatedAt: estimateCompletion(nodes, task?.createdAt),
        };

      case 'completed':
        if (taskStatus === 'completed') {
          return {
            id,
            label: MILESTONE_LABELS[id],
            icon: MILESTONE_ICONS[id],
            status: 'done',
            timestamp: completedAt,
          };
        }
        if (taskStatus === 'running' || anyRunning) {
          return {
            id,
            label: MILESTONE_LABELS[id],
            icon: MILESTONE_ICONS[id],
            status: 'pending',
            estimatedAt: estimateCompletion(nodes, task?.createdAt),
          };
        }
        return {
          id,
          label: MILESTONE_LABELS[id],
          icon: MILESTONE_ICONS[id],
          status: 'pending',
        };

      case 'paid':
        if (hasPaid) {
          return {
            id,
            label: MILESTONE_LABELS[id],
            icon: MILESTONE_ICONS[id],
            status: 'done',
            timestamp: lastPaymentAt,
          };
        }
        if (taskStatus === 'completed') {
          return {
            id,
            label: MILESTONE_LABELS[id],
            icon: MILESTONE_ICONS[id],
            status: 'active',
          };
        }
        return {
          id,
          label: MILESTONE_LABELS[id],
          icon: MILESTONE_ICONS[id],
          status: 'pending',
        };
    }
  });

  return statuses;
}

// ─── Milestone node ───────────────────────────────────────────────────────────

interface MilestoneNodeProps {
  milestone: Milestone;
  isLast: boolean;
  animationDelay: number;
}

const MilestoneNode: React.FC<MilestoneNodeProps> = ({ milestone, isLast, animationDelay }) => {
  const { status, label, icon, timestamp, estimatedAt } = milestone;

  const dotClass = {
    done: styles.dotDone,
    active: styles.dotActive,
    pending: styles.dotPending,
    failed: styles.dotFailed,
  }[status];

  const labelClass = {
    done: styles.labelDone,
    active: styles.labelActive,
    pending: styles.labelPending,
    failed: styles.labelFailed,
  }[status];

  const statusIcon =
    status === 'done' ? (
      <CheckCircle2 size={16} className={styles.checkIcon} aria-hidden />
    ) : status === 'failed' ? (
      <XCircle size={16} className={styles.xIcon} aria-hidden />
    ) : (
      icon
    );

  return (
    <li
      className={`${styles.milestoneItem} ${styles.animateIn}`}
      style={{ animationDelay: `${animationDelay}ms` }}
      aria-current={status === 'active' ? 'step' : undefined}
    >
      {/* Dot + connector */}
      <div className={styles.track}>
        <div
          className={`${styles.dot} ${dotClass}`}
          role="img"
          aria-label={`${label}: ${status}`}
        >
          {statusIcon}
          {status === 'active' && <span className={styles.pulse} aria-hidden />}
        </div>
        {!isLast && (
          <div
            className={`${styles.connector} ${status === 'done' ? styles.connectorDone : ''}`}
            aria-hidden
          />
        )}
      </div>

      {/* Label + timestamp */}
      <div className={styles.content}>
        <span className={`${styles.label} ${labelClass}`}>{label}</span>
        {timestamp && (
          <time
            className={styles.timestamp}
            dateTime={timestamp}
            aria-label={`${label} at ${formatTs(timestamp)}`}
          >
            {formatTs(timestamp)}
          </time>
        )}
        {!timestamp && estimatedAt && (
          <span className={styles.estimated} aria-label={`Estimated: ${estimatedAt}`}>
            ~{estimatedAt}
          </span>
        )}
        {!timestamp && !estimatedAt && status === 'pending' && (
          <span className={styles.pendingLabel}>Pending</span>
        )}
      </div>
    </li>
  );
};

// ─── Public component ─────────────────────────────────────────────────────────

export interface TaskMilestoneTimelineProps {
  task: TaskResponse | null;
  nodes: DAGNode[];
  payments: PaymentEvent[];
}

export const TaskMilestoneTimeline: React.FC<TaskMilestoneTimelineProps> = ({
  task,
  nodes,
  payments,
}) => {
  const milestones = useMemo(
    () => deriveMilestones(task, nodes, payments),
    [task, nodes, payments],
  );

  return (
    <section className={styles.root} aria-label="Task progress milestones">
      <h3 className={styles.heading}>Progress</h3>
      <ol className={styles.list} aria-label="Milestone steps">
        {milestones.map((milestone, idx) => (
          <MilestoneNode
            key={milestone.id}
            milestone={milestone}
            isLast={idx === milestones.length - 1}
            animationDelay={idx * 80}
          />
        ))}
      </ol>
    </section>
  );
};

export default TaskMilestoneTimeline;

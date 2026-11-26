import React from 'react';
import { Skeleton } from '../common/Skeleton';
import styles from '../../pages/AgentsCardPage.module.css';

export interface AgentCardSkeletonProps {
  compact?: boolean;
}

export const AgentCardSkeleton: React.FC<AgentCardSkeletonProps> = ({ compact = false }) => (
  <div
    className={styles.cardSkeleton}
    aria-hidden="true"
    data-testid="agent-card-skeleton"
    style={compact ? { minHeight: '120px' } : undefined}
  >
    <div className={styles.cardSkeletonHeader}>
      <Skeleton variant="circular" width={40} height={40} />
      <div style={{ flex: 1 }}>
        <Skeleton width="60%" height="1rem" style={{ marginBottom: 6 }} />
        <Skeleton width="40%" height="0.7rem" />
      </div>
      <Skeleton variant="pill" width="5rem" height="1.6rem" />
    </div>
    {!compact && (
      <>
        <div className={styles.cardSkeletonPills}>
          <Skeleton variant="pill" width="4.5rem" height="1.4rem" />
          <Skeleton variant="pill" width="3.5rem" height="1.4rem" />
          <Skeleton variant="pill" width="5rem" height="1.4rem" />
        </div>
        <div className={styles.cardSkeletonMetrics}>
          <Skeleton width="40%" height="0.7rem" />
          <Skeleton width="30%" height="0.7rem" />
        </div>
      </>
    )}
    <Skeleton variant="pill" width="100%" height="2.5rem" />
  </div>
);

export default AgentCardSkeleton;

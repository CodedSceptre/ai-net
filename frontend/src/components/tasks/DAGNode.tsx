import React, { useMemo } from 'react';
import { CheckCircle, XCircle } from 'lucide-react';
import type { NodeStatus } from '../../types/api';
import {
  ResearchIcon,
  CodingIcon,
  RiskIcon,
  DesignIcon,
  ReportIcon,
} from './NodeIcons';
import styles from './DAGNode.module.css';

export interface DAGNodeProps {
  nodeId: string;
  agentType: string;
  status: NodeStatus;
  label: string;
  isSelected?: boolean;
  onSelect?: (nodeId: string) => void;
}

function CapabilityIcon({
  agentType,
  running,
}: {
  agentType: string;
  running: boolean;
}) {
  const type = agentType.toLowerCase();
  if (type.includes('research')) return <ResearchIcon running={running} />;
  if (type.includes('coding') || type.includes('code')) return <CodingIcon running={running} />;
  if (type.includes('risk')) return <RiskIcon running={running} />;
  if (type.includes('design')) return <DesignIcon running={running} />;
  if (type.includes('report')) return <ReportIcon running={running} />;
  return <ResearchIcon running={running} />;
}

export const DAGNode: React.FC<DAGNodeProps> = ({
  nodeId,
  agentType,
  status,
  label,
  isSelected = false,
  onSelect,
}) => {
  const isRunning = status === 'running';
  const isCompleted = status === 'completed';
  const isFailed = status === 'failed';

  const statusClass = useMemo(() => {
    if (isCompleted) return styles.statusCompleted;
    if (isRunning) return styles.statusRunning;
    if (isFailed) return styles.statusFailed;
    return styles.statusQueued;
  }, [isCompleted, isRunning, isFailed]);

  const accessibleLabel = `Task node: ${label}, Agent: ${agentType || 'Unknown'}, Status: ${status}`;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect?.(nodeId);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect?.(nodeId);
    }
  };

  return (
    <div
      className={`${styles.dagNode} ${statusClass} ${isSelected ? styles.dagNodeSelected : ''}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={accessibleLabel}
      aria-pressed={isSelected}
      data-testid={`dag-node-${nodeId}`}
      data-status={status}
    >
      <div className={styles.nodeHeader}>
        <div className={styles.nodeIcon}>
          {isCompleted ? (
            <CheckCircle size={20} className={styles.completionIcon} aria-hidden="true" />
          ) : isFailed ? (
            <XCircle size={20} aria-hidden="true" />
          ) : (
            <CapabilityIcon agentType={agentType} running={isRunning} />
          )}
        </div>
        <div className={styles.nodeInfo}>
          <div className={styles.nodeCategory}>{agentType || 'Agent'}</div>
          <div className={styles.nodeLabel} title={label}>
            {label}
          </div>
        </div>
      </div>
      <div className={styles.nodeBadge}>{status}</div>
    </div>
  );
};

export default DAGNode;

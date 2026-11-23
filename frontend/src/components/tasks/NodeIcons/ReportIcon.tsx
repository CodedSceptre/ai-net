import React from 'react';
import styles from './NodeIcons.module.css';

interface NodeIconProps {
  running?: boolean;
  className?: string;
}

export const ReportIcon: React.FC<NodeIconProps> = ({ running, className }) => (
  <svg
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`${className || ''} ${running ? styles.reportWrite : ''}`}
    aria-hidden="true"
  >
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
  </svg>
);

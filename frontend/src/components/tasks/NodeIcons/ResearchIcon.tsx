import React from 'react';
import styles from './NodeIcons.module.css';

interface NodeIconProps {
  running?: boolean;
  className?: string;
}

export const ResearchIcon: React.FC<NodeIconProps> = ({ running, className }) => (
  <svg
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`${className || ''} ${running ? styles.researchSpin : ''}`}
    aria-hidden="true"
  >
    <circle cx="11" cy="11" r="7" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

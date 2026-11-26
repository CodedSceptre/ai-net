import React from 'react';
import styles from './NodeIcons.module.css';

interface NodeIconProps {
  running?: boolean;
  className?: string;
}

export const CodingIcon: React.FC<NodeIconProps> = ({ running, className }) => (
  <span className={`${styles.codeWrapper} ${className || ''}`} aria-hidden="true">
    <span>{'</>'}</span>
    {running && <span className={styles.cursor}>|</span>}
  </span>
);

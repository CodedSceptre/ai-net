/**
 * ThemeToggle
 *
 * Sun/moon icon button that switches between light and dark themes.
 * - Reads effective theme from ThemeContext (via useTheme)
 * - Smooth 200ms icon rotation on click via CSS
 * - Accessible: role="switch", aria-checked, aria-label
 * - Used in TopNav; can also be dropped into any layout slot.
 */

import React from 'react';
import { Sun, Moon } from 'lucide-react';
import useTheme from '../../hooks/useTheme';
import styles from './ThemeToggle.module.css';

interface ThemeToggleProps {
  /** Additional CSS class names. */
  className?: string;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({ className }) => {
  const { effectiveTheme, setMode } = useTheme();
  const isDark = effectiveTheme === 'dark';

  const handleClick = () => {
    setMode(isDark ? 'light' : 'dark');
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      className={`${styles.toggle} ${className ?? ''}`}
      onClick={handleClick}
      data-theme-toggle
    >
      <span
        className={styles.iconWrap}
        aria-hidden="true"
        data-dark={isDark ? 'true' : 'false'}
      >
        {isDark ? <Moon size={16} /> : <Sun size={16} />}
      </span>
    </button>
  );
};

export default ThemeToggle;

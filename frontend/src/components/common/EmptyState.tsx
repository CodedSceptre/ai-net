import React, { useContext } from 'react';
import { useNavigate, UNSAFE_NavigationContext } from 'react-router-dom';
import styles from './EmptyState.module.css';

export interface EmptyStateAction {
  label: string;
  onClick?: () => void;
  to?: string;
  icon?: React.ReactNode;
}

export interface EmptyStateProps {
  title: string;
  description?: React.ReactNode;
  /**
   * SVG illustration displayed above the title.
   * Pass a string to render it as an <img> src, or a React element for inline SVG.
   */
  illustration?: string | React.ReactNode;
  /** Small icon shown in the icon wrapper when no illustration is provided. */
  icon?: React.ReactNode;
  primaryAction?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  /**
   * Shorthand CTA: fires this callback when the primary button is clicked.
   * Use together with actionLabel when you don't need a full EmptyStateAction.
   */
  onAction?: () => void;
  /** Button label used with the onAction shorthand. */
  actionLabel?: string;
  variant?: 'default' | 'card' | 'compact';
  /**
   * Play a fade + slide-up entrance animation on first render (default: true).
   */
  animated?: boolean;
  className?: string;
  'data-testid'?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  illustration,
  icon,
  primaryAction,
  secondaryAction,
  onAction,
  actionLabel,
  variant = 'default',
  animated = true,
  className = '',
  'data-testid': dataTestId = 'empty-state',
}) => {
  const navigationContext = useContext(UNSAFE_NavigationContext);
  let navigate: ReturnType<typeof useNavigate> | null = null;
  if (navigationContext) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    navigate = useNavigate();
  }

  const handleActionClick = (action: EmptyStateAction, e: React.MouseEvent) => {
    if (action.onClick) {
      action.onClick();
    }
    if (action.to) {
      e.preventDefault();
      if (navigate) {
        navigate(action.to);
      } else {
        window.location.href = action.to;
      }
    }
  };

  // Merge onAction shorthand into primaryAction when provided without a primaryAction
  const resolvedPrimaryAction: EmptyStateAction | undefined =
    primaryAction ??
    (onAction && actionLabel ? { label: actionLabel, onClick: onAction } : undefined);

  const variantClass =
    variant === 'card'
      ? styles.cardVariant
      : variant === 'compact'
      ? styles.compactVariant
      : '';

  const animationClass = animated ? styles.animated : '';

  return (
    <div
      className={`${styles.container} ${variantClass} ${animationClass} ${className}`.trim()}
      data-testid={dataTestId}
    >
      {illustration && (
        <div className={styles.illustrationWrapper} aria-hidden="true">
          {typeof illustration === 'string' ? (
            <img
              src={illustration}
              alt=""
              className={styles.illustrationImg}
              aria-hidden="true"
            />
          ) : (
            illustration
          )}
        </div>
      )}

      {icon && !illustration && (
        <div className={styles.iconWrapper} aria-hidden="true">
          <div className={styles.iconGlow} />
          <div className={styles.iconContent}>{icon}</div>
        </div>
      )}

      <h3 className={styles.title}>{title}</h3>

      {description && (
        <div className={styles.description}>
          {typeof description === 'string' ? <p>{description}</p> : description}
        </div>
      )}

      {(resolvedPrimaryAction || secondaryAction) && (
        <div className={styles.actions}>
          {resolvedPrimaryAction && (
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={(e) => handleActionClick(resolvedPrimaryAction, e)}
              data-testid="empty-state-primary-cta"
            >
              {resolvedPrimaryAction.icon && (
                <span aria-hidden="true">{resolvedPrimaryAction.icon}</span>
              )}
              <span>{resolvedPrimaryAction.label}</span>
            </button>
          )}

          {secondaryAction && (
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={(e) => handleActionClick(secondaryAction, e)}
              data-testid="empty-state-secondary-cta"
            >
              {secondaryAction.icon && <span aria-hidden="true">{secondaryAction.icon}</span>}
              <span>{secondaryAction.label}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default EmptyState;

/**
 * Toast.tsx
 *
 * Toast notification component system (issue #736).
 *
 * Features
 * ─────────
 * - 4 variants: success, error, warning, info
 * - Each toast: icon, title (required), optional description, optional action button
 * - Auto-dismiss: 4 s for success/info, 8 s for error/warning
 * - Hover pauses the auto-dismiss timer
 * - Max 3 toasts visible simultaneously (oldest dismissed first)
 * - Slide-in from right, slide-out on dismiss (200 ms)
 * - role="alert" for errors, role="status" for others
 * - Stacks vertically with 8 px gap at top-right, 16 px from edges
 */

import React, { useRef, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, XCircle, AlertTriangle, Info } from 'lucide-react';
import './Toast.css';
import type { Toast, ToastAction } from '../../context/ToastContext';

// ─── Icons ────────────────────────────────────────────────────────────────────

const ICONS: Record<Toast['type'], React.ReactNode> = {
  success: <CheckCircle size={18} aria-hidden />,
  error: <XCircle size={18} aria-hidden />,
  warning: <AlertTriangle size={18} aria-hidden />,
  info: <Info size={18} aria-hidden />,
};

// ─── ToastItem ────────────────────────────────────────────────────────────────

interface ToastItemProps {
  toast: Toast;
  onDismiss: (id: string) => void;
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const { t } = useTranslation();
  const pausedAt = useRef<number | null>(null);
  const remaining = useRef<number>(toast.duration);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [exiting, setExiting] = useState(false);

  const dismiss = useCallback(() => {
    // Trigger the slide-out animation then remove
    setExiting(true);
    setTimeout(() => onDismiss(toast.id), 200);
  }, [onDismiss, toast.id]);

  const startTimer = useCallback(() => {
    if (remaining.current <= 0) return;
    timerRef.current = setTimeout(dismiss, remaining.current);
  }, [dismiss]);

  // Start the timer once on mount
  useEffect(() => {
    startTimer();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleMouseEnter = () => {
    pausedAt.current = Date.now();
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const handleMouseLeave = () => {
    if (pausedAt.current !== null) {
      const elapsed = Date.now() - pausedAt.current;
      remaining.current = Math.max(0, remaining.current - elapsed);
      pausedAt.current = null;
    }
    startTimer();
  };

  const handleActionClick = (action: ToastAction) => {
    action.onClick();
    dismiss();
  };

  const role = toast.type === 'error' ? 'alert' : 'status';
  const ariaLive = toast.type === 'error' ? 'assertive' : 'polite';

  return (
    <div
      className={`toast toast--${toast.type}${exiting ? ' toast--exit' : ''}`}
      role={role}
      aria-live={ariaLive}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <span className="toast__icon" aria-hidden="true">
        {ICONS[toast.type]}
      </span>

      <span className="toast__body">
        <span className="toast__message">
          {toast.message}
          {toast.count != null && toast.count > 1 && (
            <span className="toast__count" aria-label={`${toast.count} occurrences`}>
              {' '}×{toast.count}
            </span>
          )}
        </span>
      </span>

      {toast.action && (
        <button
          type="button"
          className="toast__action"
          onClick={() => handleActionClick(toast.action!)}
        >
          {toast.action.label}
        </button>
      )}

      <button
        type="button"
        className="toast__dismiss"
        onClick={dismiss}
        aria-label={t('a11y.dismissNotification')}
      >
        ×
      </button>
    </div>
  );
}

// ─── ToastContainer ───────────────────────────────────────────────────────────

interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

/** Renders at most 3 toasts (most-recent last = visually on top). */
export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  // Show only the most recent 3
  const visible = toasts.slice(-3);

  return (
    <div
      className="toast-container"
      aria-live="polite"
      aria-atomic="false"
      aria-label="Notifications"
    >
      {visible.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

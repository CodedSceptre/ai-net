import ModalFocusTrap from './ModalFocusTrap';
import { useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import styles from './ConfirmDialog.module.css';

export interface ConfirmDialogProps {
  /** Whether the dialog is visible */
  open: boolean;
  /** Short title displayed in the dialog heading */
  title: string;
  /** Main explanation of what the action does */
  description: string;
  /** Explicit consequence statement (shown in warning box) */
  consequence?: string;
  /** Label for the dismiss button (default: 'Cancel') */
  cancelLabel?: string;
  /** Label for the danger confirm button */
  confirmLabel: string;
  /** Called when the user explicitly confirms the action */
  onConfirm: () => void;
  /** Called when the dialog is dismissed (Cancel or Escape) */
  onCancel: () => void;
}

/**
 * Accessible confirmation dialog for destructive actions.
 *
 * Keyboard behaviour:
 *  - Escape   → dismisses (calls onCancel)
 *  - Enter    → does NOT confirm (safe default; user must click Confirm)
 *  - Tab      → cycles focus within dialog (focus trap)
 *
 * Focus behaviour:
 *  - On open, focus moves to the Cancel button (safe default)
 *  - On close, focus returns to the element that opened the dialog
 */
export function ConfirmDialog({
  open,
  title,
  description,
  consequence,
  cancelLabel = 'Cancel',
  confirmLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Escape → cancel; block Enter from confirming
  useEffect(() => {
    if (!open) return;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
      // Prevent Enter from submitting / triggering the confirm button
      if (e.key === 'Enter') {
        const target = e.target as HTMLElement;
        // Only block Enter when it would activate the confirm button
        if (target === containerRef.current?.querySelector('[data-confirm]')) {
          e.preventDefault();
        }
      }
    };

    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onCancel, containerRef]);

  if (!open) return null;

  const dialogId = 'confirm-dialog';
  const titleId = `${dialogId}-title`;
  const descId = `${dialogId}-desc`;

  return (
    <div data-modal-backdrop className={styles.overlay} onClick={onCancel}>
      {/* Stop overlay click from closing dialog when clicking inside it */}
      <ModalFocusTrap>
        <div
          ref={containerRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descId}
          className={styles.dialog}
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
        >
          <div className={styles.iconWrap} aria-hidden="true">
            <AlertTriangle size={24} />
          </div>

          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>

          <p id={descId} className={styles.body}>
            {description}
          </p>
import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import styles from './ConfirmDialog.module.css';

export type RiskLevel = 'low' | 'medium' | 'high';

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  risk?: RiskLevel;
  /** Required for high-risk: the exact string the user must type to unlock confirm. */
  confirmString?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const RISK_ICON: Record<RiskLevel, string> = {
  low: 'ℹ',
  medium: '⚠',
  high: '⛔',
};

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  risk = 'low',
  confirmString = 'CONFIRM',
  onConfirm,
  onCancel,
}) => {
  const [typedValue, setTypedValue] = useState('');
  const dialogRef = useFocusTrap<HTMLDivElement>(isOpen);

  const isHighRisk = risk === 'high';
  const confirmDisabled = isHighRisk && typedValue !== confirmString;

  // Reset typed value whenever dialog opens/closes.
  useEffect(() => {
    if (!isOpen) setTypedValue('');
  }, [isOpen]);

  // ESC → cancel; Enter → confirm (non-high-risk only).
  useEffect(() => {
    if (!isOpen) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      } else if (e.key === 'Enter' && !isHighRisk) {
        e.preventDefault();
        onConfirm();
      }
    };

    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [isOpen, isHighRisk, onConfirm, onCancel]);

  if (!isOpen) return null;

  return ReactDOM.createPortal(
    <div className={styles.backdrop} data-testid="confirm-dialog-backdrop">
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="cd-title"
        aria-describedby="cd-desc"
        className={`${styles.dialog} ${styles[risk]}`}
        data-testid="confirm-dialog"
      >
        <div className={styles.header}>
          <span className={styles.riskIcon} aria-hidden="true">
            {RISK_ICON[risk]}
          </span>
          <h2 id="cd-title" className={styles.title}>
            {title}
          </h2>
        </div>

        <p id="cd-desc" className={styles.description}>
          {description}
        </p>

        {isHighRisk && (
          <div className={styles.typeConfirm}>
            <label htmlFor="cd-confirm-input" className={styles.typeLabel}>
              Type <strong>{confirmString}</strong> to continue
            </label>
            <input
              id="cd-confirm-input"
              type="text"
              value={typedValue}
              onChange={(e) => setTypedValue(e.target.value)}
              className={styles.typeInput}
              placeholder={confirmString}
              autoComplete="off"
              spellCheck={false}
              data-testid="confirm-dialog-input"
            />
          </div>
        )}

        <div className={styles.actions}>
          <button
            ref={cancelBtnRef}
            type="button"
            className={styles.cancelBtn}
            onClick={onCancel}
            data-testid="confirm-dialog-cancel"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={styles.confirmBtn}
            onClick={onConfirm}
            data-confirm="true"
            className={`${styles.confirmBtn} ${styles[`confirm${risk.charAt(0).toUpperCase() + risk.slice(1)}` as keyof typeof styles]}`}
            onClick={onConfirm}
            disabled={confirmDisabled}
            aria-disabled={confirmDisabled}
            data-testid="confirm-dialog-confirm"
          >
            {confirmLabel}
          </button>

          {consequence && (
            <p className={styles.consequence} role="note">
              {consequence}
            </p>
          )}

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.cancelBtn}
              onClick={onCancel}
              data-testid="confirm-dialog-cancel"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              className={styles.confirmBtn}
              onClick={onConfirm}
              data-confirm="true"
              data-testid="confirm-dialog-confirm"
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </ModalFocusTrap>
    </div>
  );
}
    </div>,
    document.body,
  );
};

export default ConfirmDialog;

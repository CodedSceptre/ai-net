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
            type="button"
            className={styles.cancelBtn}
            onClick={onCancel}
            data-testid="confirm-dialog-cancel"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`${styles.confirmBtn} ${styles[`confirm${risk.charAt(0).toUpperCase() + risk.slice(1)}` as keyof typeof styles]}`}
            onClick={onConfirm}
            disabled={confirmDisabled}
            aria-disabled={confirmDisabled}
            data-testid="confirm-dialog-confirm"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default ConfirmDialog;

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { AlertTriangle, X } from 'lucide-react';

interface CancelTaskModalProps {
  isOpen: boolean;
  taskPrompt: string;
  onConfirm: (reason?: string) => void;
  onClose: () => void;
  isCancelling: boolean;
}

export const CancelTaskModal: React.FC<CancelTaskModalProps> = ({
  isOpen,
  taskPrompt,
  onConfirm,
  onClose,
  isCancelling,
}) => {
  const [reason, setReason] = React.useState('');
  const containerRef = useFocusTrap<HTMLDivElement>(isOpen);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Reset reason when modal closes
  useEffect(() => {
    if (!isOpen) setReason('');
  }, [isOpen]);

  if (!isOpen) return null;

  const excerpt = taskPrompt.length > 100 ? `${taskPrompt.slice(0, 100)}…` : taskPrompt;

  const handleConfirm = () => {
    onConfirm(reason || undefined);
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      data-testid="cancel-task-modal"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal panel */}
      <div
        ref={containerRef}
        className="relative z-10 w-full max-w-md glass-panel border border-rose-500/30 shadow-2xl"
        style={{ background: 'var(--surface-elevated)' }}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2">
            <AlertTriangle size={20} className="text-rose-400 shrink-0" />
            <h2
              id="cancel-modal-title"
              className="text-base font-bold text-[var(--text-primary)]"
            >
              Cancel Task
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close modal"
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors p-1 rounded"
          >
            <X size={16} />
          </button>
        </div>

        {/* Task excerpt */}
        <div className="mb-4 p-3 rounded-lg bg-[var(--surface-glass-subtle)] border border-[var(--border-strong)]">
          <p className="text-xs text-[var(--text-secondary)] uppercase font-bold mb-1">Task</p>
          <p className="text-sm text-[var(--text-muted)] italic">"{excerpt}"</p>
        </div>

        {/* Warning */}
        <p className="text-sm text-rose-300/90 mb-4">
          This action is irreversible. The task will be cancelled and any pending budget will be released.
        </p>

        {/* Reason input */}
        <div className="mb-6">
          <label
            htmlFor="cancel-reason"
            className="block text-xs font-semibold text-[var(--text-secondary)] mb-1"
          >
            Reason (optional)
          </label>
          <textarea
            id="cancel-reason"
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={2}
            placeholder="Why are you cancelling this task?"
            className="w-full text-sm bg-[var(--surface-glass-subtle)] border border-[var(--border-strong)] rounded-lg px-3 py-2 text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-rose-500/50 resize-none"
          />
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isCancelling}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-[var(--border-strong)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-muted)] transition disabled:opacity-50"
          >
            Go Back
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            onKeyDown={e => { if (e.key === 'Enter') handleConfirm(); }}
            disabled={isCancelling}
            className="px-4 py-2 text-sm font-bold rounded-lg bg-rose-600 hover:bg-rose-700 text-white transition disabled:opacity-50 flex items-center gap-2"
            data-testid="confirm-cancellation-btn"
          >
            {isCancelling ? (
              <>
                <span className="animate-spin inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full" />
                Cancelling…
              </>
            ) : (
              'Confirm Cancellation'
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

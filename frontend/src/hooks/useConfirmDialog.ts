import { useState, useCallback, createElement } from 'react';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import type { RiskLevel } from '../components/common/ConfirmDialog';

export interface ConfirmOptions {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  risk?: RiskLevel;
  /** For high-risk dialogs: the exact string the user must type. Defaults to "CONFIRM". */
  confirmString?: string;
}

interface DialogState extends ConfirmOptions {
  isOpen: boolean;
  resolve: ((confirmed: boolean) => void) | null;
}

const CLOSED_STATE: DialogState = {
  isOpen: false,
  title: '',
  description: '',
  resolve: null,
};

/**
 * Imperative confirmation dialog hook.
 *
 * Usage:
 *   const { confirm, ConfirmDialogHost } = useConfirmDialog();
 *
 *   // Mount once somewhere in your component tree:
 *   return <> ... <ConfirmDialogHost /> </>;
 *
 *   // Trigger imperatively:
 *   const confirmed = await confirm({ title: 'Delete agent?', risk: 'high', ... });
 *   if (confirmed) { ... }
 */
export function useConfirmDialog() {
  const [state, setState] = useState<DialogState>(CLOSED_STATE);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setState({ ...options, isOpen: true, resolve });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    setState((prev) => {
      prev.resolve?.(true);
      return { ...prev, isOpen: false, resolve: null };
    });
  }, []);

  const handleCancel = useCallback(() => {
    setState((prev) => {
      prev.resolve?.(false);
      return { ...prev, isOpen: false, resolve: null };
    });
  }, []);

  /**
   * Render this component once inside your JSX tree. It acts as the mount
   * point for the portal-based dialog — placing it at the end of a page or
   * layout component is fine.
   */
  const ConfirmDialogHost = useCallback(
    () =>
      createElement(ConfirmDialog, {
        isOpen: state.isOpen,
        title: state.title,
        description: state.description,
        confirmLabel: state.confirmLabel,
        cancelLabel: state.cancelLabel,
        risk: state.risk,
        confirmString: state.confirmString,
        onConfirm: handleConfirm,
        onCancel: handleCancel,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.isOpen, state.title, state.description, state.confirmLabel, state.cancelLabel, state.risk, state.confirmString, handleConfirm, handleCancel],
  );

  return { confirm, ConfirmDialogHost };
}

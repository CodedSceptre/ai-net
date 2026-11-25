import { useState, useCallback } from 'react';
import { useToast } from './useToast';

interface UseCancelTaskOptions {
  taskId: string;
  currentStatus: string;
  onStatusChange: (status: string) => void;
}

interface UseCancelTaskReturn {
  cancelTask: (reason?: string) => Promise<void>;
  isCancelling: boolean;
  error: string | null;
}

export function useCancelTask({ taskId, currentStatus, onStatusChange }: UseCancelTaskOptions): UseCancelTaskReturn {
  const [isCancelling, setIsCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  const cancelTask = useCallback(async (reason?: string) => {
    setIsCancelling(true);
    setError(null);

    // Optimistic update: immediately set status to cancelled
    const previousStatus = currentStatus;
    onStatusChange('cancelled');

    try {
      const BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
      const pubKey = localStorage.getItem('wallet_pubkey') || localStorage.getItem('walletAddress');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (pubKey) headers['Authorization'] = `Bearer ${pubKey}`;

      const body: Record<string, string> = {};
      if (reason && reason.trim()) body.reason = reason.trim();

      const res = await fetch(`${BASE_URL}/api/tasks/${taskId}`, {
        method: 'DELETE',
        headers,
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || `Cancellation failed (${res.status})`);
      }

      showToast('Task cancelled successfully', 'success');
    } catch (err) {
      // Rollback optimistic update
      onStatusChange(previousStatus);
      const message = err instanceof Error ? err.message : 'Failed to cancel task';
      setError(message);
      showToast(message, 'error');
    } finally {
      setIsCancelling(false);
    }
  }, [taskId, currentStatus, onStatusChange, showToast]);

  return { cancelTask, isCancelling, error };
}

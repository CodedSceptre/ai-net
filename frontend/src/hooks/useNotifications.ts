import { useContext, useState, useEffect, useCallback, useRef } from 'react';
import { NotificationContext } from '../context/NotificationContext';
import type { NotificationContextValue, AppNotification } from '../types/notification';

const BASE_URL = typeof window !== 'undefined'
  ? (import.meta.env?.VITE_API_BASE_URL || '')
  : '';

function getAuthHeader(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const pubKey =
    localStorage.getItem('wallet_pubkey') || localStorage.getItem('walletAddress');
  return pubKey ? { Authorization: `Bearer ${pubKey}` } : {};
}

const fallbackValue: NotificationContextValue = {
  notifications: [],
  unreadCount: 0,
  markAsRead: () => {},
  markAllAsRead: () => {},
  clearAll: () => {},
  clearNotifications: () => {},
  addNotification: () => {},
  removeNotification: () => {},
  isConnected: false,
};

export interface UseNotificationsOptions {
  /** How often to poll for new notifications in ms. Default: 30000 */
  pollIntervalMs?: number;
}

export interface UseNotificationsResult extends NotificationContextValue {
  isLoading: boolean;
  error: string | null;
  /** Marks a notification as read both locally (optimistic) and via API */
  markAsRead: (id: string) => void;
  /** Marks all notifications as read both locally (optimistic) and via API */
  markAllRead: () => void;
}

/**
 * useNotifications
 *
 * Reads from NotificationContext for real-time WebSocket events, and
 * additionally polls GET /api/notifications every `pollIntervalMs` ms (default 30s)
 * to sync server-side notification state.
 *
 * markAsRead and markAllRead perform optimistic local updates and also call
 * the backend API to persist the read state.
 */
export const useNotifications = (
  options: UseNotificationsOptions = {}
): UseNotificationsResult => {
  const { pollIntervalMs = 30_000 } = options;

  const context = useContext(NotificationContext);
  const ctx = context ?? fallbackValue;

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef(true);

  const fetchNotifications = useCallback(async () => {
    if (!isMountedRef.current) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`${BASE_URL}/api/notifications`, {
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeader(),
        },
      });
      if (!response.ok) {
        // Non-2xx: surface the error but don't throw — polling should continue
        setError(`Failed to fetch notifications: ${response.status}`);
        return;
      }
      const data: AppNotification[] = await response.json();
      if (!isMountedRef.current) return;
      // Merge server notifications into context via addNotification
      // (addNotification deduplicates by id)
      if (Array.isArray(data)) {
        data.forEach((n) => ctx.addNotification(n));
      }
    } catch (err) {
      if (!isMountedRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to fetch notifications');
    } finally {
      if (isMountedRef.current) setIsLoading(false);
    }
  }, [ctx]);

  // Initial fetch on mount + polling
  useEffect(() => {
    isMountedRef.current = true;
    fetchNotifications();

    if (pollIntervalMs > 0) {
      intervalRef.current = setInterval(fetchNotifications, pollIntervalMs);
    }

    return () => {
      isMountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollIntervalMs]);

  // markAsRead: optimistic update + API call
  const markAsRead = useCallback(
    (id: string) => {
      ctx.markAsRead(id);
      fetch(`${BASE_URL}/api/notifications/${encodeURIComponent(id)}/read`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeader(),
        },
      }).catch((err) => {
        console.error('[useNotifications] markAsRead API error:', err);
      });
    },
    [ctx]
  );

  // markAllRead: optimistic update + API call
  const markAllRead = useCallback(() => {
    ctx.markAllAsRead();
    fetch(`${BASE_URL}/api/notifications/read-all`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader(),
      },
    }).catch((err) => {
      console.error('[useNotifications] markAllRead API error:', err);
    });
  }, [ctx]);

  return {
    ...ctx,
    markAsRead,
    markAllRead,
    isLoading,
    error,
  };
};

export default useNotifications;

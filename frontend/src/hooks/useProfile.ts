import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '../services/api';

export interface NotificationPreferences {
  task_completed: boolean;
  payment_received: boolean;
  agent_failed: boolean;
}

export interface ProfileStats {
  totalXLMSpent: number;
  successRate: number;
  averageTaskCostXLM: number;
  favoriteCapability: string;
  totalTasksSubmitted: number;
  accountAgeDays: number;
}

export interface UseProfileResult {
  stats: ProfileStats | null;
  notificationPrefs: NotificationPreferences;
  loadingStats: boolean;
  errorStats: string | null;
  savingPrefs: boolean;
  updateNotificationPref: (key: keyof NotificationPreferences, value: boolean) => Promise<void>;
}

const DEFAULT_PREFS: NotificationPreferences = {
  task_completed: true,
  payment_received: true,
  agent_failed: true,
};

const DEFAULT_STATS: ProfileStats = {
  totalXLMSpent: 0,
  successRate: 0,
  averageTaskCostXLM: 0,
  favoriteCapability: '—',
  totalTasksSubmitted: 0,
  accountAgeDays: 0,
};

export function useProfile(walletAddress: string | null): UseProfileResult {
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [errorStats, setErrorStats] = useState<string | null>(null);
  const [notificationPrefs, setNotificationPrefs] =
    useState<NotificationPreferences>(DEFAULT_PREFS);
  const [savingPrefs, setSavingPrefs] = useState(false);

  // Load stats and prefs when wallet address is available
  useEffect(() => {
    if (!walletAddress) {
      setStats(null);
      return;
    }

    let cancelled = false;
    setLoadingStats(true);
    setErrorStats(null);

    Promise.all([
      apiClient
        .get<{ data: ProfileStats }>(`/api/wallets/${walletAddress}/profile`)
        .catch(() => null),
      apiClient
        .get<{ data: NotificationPreferences }>('/api/notifications/preferences')
        .catch(() => null),
    ])
      .then(([profileRes, prefsRes]) => {
        if (cancelled) return;
        // Profile stats — fall back to defaults if endpoint not yet implemented
        if (profileRes && (profileRes as unknown as { data: ProfileStats }).data) {
          setStats((profileRes as unknown as { data: ProfileStats }).data);
        } else {
          setStats(DEFAULT_STATS);
        }
        // Notification prefs
        if (prefsRes && (prefsRes as unknown as { data: NotificationPreferences }).data) {
          setNotificationPrefs(
            (prefsRes as unknown as { data: NotificationPreferences }).data
          );
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setErrorStats(err instanceof Error ? err.message : 'Failed to load profile');
          setStats(DEFAULT_STATS);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingStats(false);
      });

    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  const updateNotificationPref = useCallback(
    async (key: keyof NotificationPreferences, value: boolean) => {
      const next = { ...notificationPrefs, [key]: value };
      setNotificationPrefs(next);
      setSavingPrefs(true);
      try {
        await apiClient.post('/api/notifications/preferences', next);
      } catch {
        // revert on failure
        setNotificationPrefs(notificationPrefs);
      } finally {
        setSavingPrefs(false);
      }
    },
    [notificationPrefs]
  );

  return {
    stats,
    notificationPrefs,
    loadingStats,
    errorStats,
    savingPrefs,
    updateNotificationPref,
  };
}

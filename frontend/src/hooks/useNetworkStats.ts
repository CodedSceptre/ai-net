// src/hooks/useNetworkStats.ts
import { useCallback, useEffect, useState } from "react";
import { useStats } from "./useStats";
import type { TimePoint } from "../types/api";

export interface NetworkStats {
  totalAgents: number;
  totalTasks: number;
  totalXLMTransacted: number;
  uptimePercent: number;
  tasksLast24h?: TimePoint[];
  xlmLast24h?: TimePoint[];
  tasksLast7d?: TimePoint[];
  xlmLast7d?: TimePoint[];
  activeTasks?: number;
}

export interface UseNetworkStatsReturn {
  data: NetworkStats | null;
  loading: boolean;
  error: Error | null;
  isStale: boolean;
  lastUpdated: Date | null;
  refetch: () => Promise<void>;
}

const STALE_THRESHOLD_MS = 65_000;

export const useNetworkStats = (): UseNetworkStatsReturn => {
  const { data: sample, isLoading: loading, error, mutate } = useStats();
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (!sample) return;
    const delay = STALE_THRESHOLD_MS - (Date.now() - sample.fetchedAt);
    setStale(delay <= 0);
    if (delay > 0) {
      const timer = window.setTimeout(() => setStale(true), delay);
      return () => window.clearTimeout(timer);
    }
  }, [sample]);

  const refetch = useCallback(async () => {
    await mutate().catch(() => undefined);
  }, [mutate]);

  return {
    data: sample?.data ?? null,
    loading,
    error: sample ? null : error ?? null,
    isStale: Boolean(sample && (stale || error)),
    lastUpdated: sample ? new Date(sample.fetchedAt) : null,
    refetch,
  };
};

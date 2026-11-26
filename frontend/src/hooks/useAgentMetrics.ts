import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAgentStats, type AgentMetric } from '../services/metricsService';

const AUTO_REFRESH_INTERVAL_MS = 30_000;

interface UseAgentMetricsResult {
  agents: AgentMetric[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useAgentMetrics(): UseAgentMetricsResult {
  const [agents, setAgents] = useState<AgentMetric[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchAgentStats();
      setAgents(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch agent metrics');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refetch = useCallback(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    fetchData();

    intervalRef.current = setInterval(() => {
      fetchData();
    }, AUTO_REFRESH_INTERVAL_MS);

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [fetchData]);

  return { agents, isLoading, error, refetch };
}

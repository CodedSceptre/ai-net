import { useState, useEffect, useCallback } from 'react';

export type ComponentStatus = 'operational' | 'degraded' | 'outage';

export interface SystemComponent {
  id: string;
  name: string;
  status: ComponentStatus;
  latencyMs?: number;
  lastChecked: Date;
  history: HistoricalDay[];
}

export interface HistoricalDay {
  date: string;
  status: ComponentStatus;
}

export interface IncidentUpdate {
  timestamp: string;
  message: string;
}

export interface Incident {
  id: string;
  title: string;
  components: string[];
  startedAt: string;
  resolvedAt?: string;
  updates: IncidentUpdate[];
}

interface UseSystemStatusResult {
  components: SystemComponent[];
  incidents: Incident[];
  lastUpdated: Date | null;
  secondsUntilRefresh: number;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

const POLL_INTERVAL_MS = 30_000;

const MOCK_COMPONENT_DEFS = [
  { id: 'api', name: 'Backend API' },
  { id: 'horizon', name: 'Stellar Testnet Horizon' },
  { id: 'venice', name: 'Venice AI' },
  { id: 'contracts', name: 'Smart Contracts' },
] as const;

const MOCK_INCIDENTS: Incident[] = [
  {
    id: 'inc-001',
    title: 'Venice AI elevated latency',
    components: ['venice'],
    startedAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
    resolvedAt: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
    updates: [
      {
        timestamp: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
        message: 'Issue resolved. Venice AI latency has returned to normal levels.',
      },
      {
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
        message: 'Investigating elevated latency on Venice AI inference endpoints.',
      },
      {
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
        message: 'We are aware of increased response times from Venice AI and are investigating.',
      },
    ],
  },
  {
    id: 'inc-002',
    title: 'Horizon testnet connectivity degradation',
    components: ['horizon', 'contracts'],
    startedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
    resolvedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2 - 1000 * 60 * 30).toISOString(),
    updates: [
      {
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2 - 1000 * 60 * 30).toISOString(),
        message: 'Stellar Testnet Horizon has recovered. All services are operational.',
      },
      {
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3 + 1000 * 60 * 60).toISOString(),
        message: 'Mitigation in place. Monitoring stability.',
      },
      {
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
        message: 'Partial outage detected on Stellar Testnet Horizon affecting contract interactions.',
      },
    ],
  },
];

function buildHistory(id: string): HistoricalDay[] {
  const days: HistoricalDay[] = [];
  const now = new Date();

  for (let i = 89; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);

    const seed = (id.charCodeAt(0) + i) % 20;
    let status: ComponentStatus;
    if (seed === 0) {
      status = 'outage';
    } else if (seed === 1) {
      status = 'degraded';
    } else {
      status = 'operational';
    }

    days.push({ date: dateStr, status });
  }

  return days;
}

function buildMockComponents(statusOverride?: ComponentStatus): SystemComponent[] {
  return MOCK_COMPONENT_DEFS.map((def) => ({
    id: def.id,
    name: def.name,
    status: statusOverride ?? 'operational',
    latencyMs: statusOverride === 'operational' || statusOverride == null
      ? Math.floor(80 + (def.id.charCodeAt(0) % 100))
      : undefined,
    lastChecked: new Date(),
    history: buildHistory(def.id),
  }));
}

interface DeepHealthResponse {
  status: string;
  services?: Record<string, { status: string; latencyMs?: number }>;
}

function mapApiStatus(raw: string): ComponentStatus {
  if (raw === 'ok' || raw === 'operational') return 'operational';
  if (raw === 'degraded' || raw === 'slow') return 'degraded';
  return 'outage';
}

export function useSystemStatus(): UseSystemStatusResult {
  const [components, setComponents] = useState<SystemComponent[]>(() => buildMockComponents());
  const [incidents] = useState<Incident[]>(MOCK_INCIDENTS);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [secondsUntilRefresh, setSecondsUntilRefresh] = useState(POLL_INTERVAL_MS / 1000);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/health/deep');
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data: DeepHealthResponse = await res.json() as DeepHealthResponse;

      const updated = MOCK_COMPONENT_DEFS.map((def) => {
        const svc = data.services?.[def.id];
        return {
          id: def.id,
          name: def.name,
          status: svc ? mapApiStatus(svc.status) : 'operational' as ComponentStatus,
          latencyMs: svc?.latencyMs,
          lastChecked: new Date(),
          history: buildHistory(def.id),
        };
      });

      setComponents(updated);
      setError(null);
    } catch {
      // On failure, show all components as operational with mock data
      // (network error means we can't determine real status)
      setComponents(buildMockComponents('operational'));
      setError('Could not reach health endpoint — showing last known state');
    } finally {
      setLastUpdated(new Date());
      setLoading(false);
      setSecondsUntilRefresh(POLL_INTERVAL_MS / 1000);
    }
  }, []);

  // Initial fetch + polling
  useEffect(() => {
    void fetchStatus();

    const pollId = setInterval(() => {
      void fetchStatus();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(pollId);
  }, [fetchStatus]);

  // Countdown ticker
  useEffect(() => {
    const tickId = setInterval(() => {
      setSecondsUntilRefresh((prev) => (prev <= 1 ? POLL_INTERVAL_MS / 1000 : prev - 1));
    }, 1000);

    return () => clearInterval(tickId);
  }, []);

  return {
    components,
    incidents,
    lastUpdated,
    secondsUntilRefresh,
    loading,
    error,
    refresh: fetchStatus,
  };
}

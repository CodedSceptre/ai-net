import React, { useMemo, useState } from 'react';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import { RefreshCw, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { useAgentMetrics } from '../../hooks/useAgentMetrics';
import { Skeleton } from '../common/Skeleton';
import type { AgentMetric } from '../../services/metricsService';

type SortKey = keyof Pick<AgentMetric, 'name' | 'capability' | 'tasksCompleted' | 'successRate' | 'avgResponseTimeMs'>;
type SortDir = 'asc' | 'desc';

const DEFAULT_VISIBLE = 5;

interface SortState {
  key: SortKey;
  dir: SortDir;
}

function SortIcon({ columnKey, sort }: { columnKey: SortKey; sort: SortState }) {
  if (sort.key !== columnKey) return <ChevronsUpDown size={12} aria-hidden="true" />;
  return sort.dir === 'asc' ? (
    <ChevronUp size={12} aria-hidden="true" />
  ) : (
    <ChevronDown size={12} aria-hidden="true" />
  );
}

interface SparklineProps {
  data: number[];
}

function Sparkline({ data }: SparklineProps) {
  const chartData = data.map((v, i) => ({ x: i, y: v }));
  return (
    <ResponsiveContainer width={60} height={24}>
      <AreaChart data={chartData} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
        <defs>
          <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-primary, #6366f1)" stopOpacity={0.4} />
            <stop offset="95%" stopColor="var(--color-primary, #6366f1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="y"
          stroke="var(--color-primary, #6366f1)"
          strokeWidth={1.5}
          fill="url(#sparkGrad)"
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function AgentPerformanceWidget() {
  const { agents, isLoading, error, refetch } = useAgentMetrics();
  const [sort, setSort] = useState<SortState>({ key: 'tasksCompleted', dir: 'desc' });
  const [showAll, setShowAll] = useState(false);

  const sorted = useMemo(() => {
    return [...agents].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (typeof av === 'string' && typeof bv === 'string') {
        return sort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const an = av as number;
      const bn = bv as number;
      return sort.dir === 'asc' ? an - bn : bn - an;
    });
  }, [agents, sort]);

  const visible = showAll ? sorted : sorted.slice(0, DEFAULT_VISIBLE);

  const handleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'desc' }
    );
  };

  const thStyle: React.CSSProperties = {
    padding: '8px 12px',
    textAlign: 'left',
    fontSize: '12px',
    fontWeight: 600,
    color: 'var(--text-secondary)',
    borderBottom: '1px solid var(--border-subtle)',
    cursor: 'pointer',
    userSelect: 'none',
    whiteSpace: 'nowrap',
  };

  const tdStyle: React.CSSProperties = {
    padding: '8px 12px',
    fontSize: '13px',
    borderBottom: '1px solid var(--border-subtle)',
  };

  return (
    <section
      style={{
        background: 'var(--surface-panel)',
        borderRadius: 'var(--radius-xl)',
        border: '1px solid var(--border-subtle)',
        overflow: 'hidden',
      }}
      aria-label="Agent Performance"
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>Agent Performance</h2>
        <button
          onClick={refetch}
          disabled={isLoading}
          aria-label="Refresh agent performance data"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            padding: '4px 10px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-subtle)',
            background: 'transparent',
            cursor: isLoading ? 'not-allowed' : 'pointer',
            fontSize: '12px',
            color: 'var(--text-secondary)',
          }}
        >
          <RefreshCw size={12} className={isLoading ? 'spin' : ''} aria-hidden="true" />
          Refresh
        </button>
      </div>

      {/* Loading skeleton */}
      {isLoading && agents.length === 0 && (
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} width="100%" height="36px" />
          ))}
        </div>
      )}

      {/* Error state */}
      {error && !isLoading && (
        <div
          role="alert"
          style={{ padding: '24px 20px', textAlign: 'center', color: 'var(--color-error)' }}
        >
          {error}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && agents.length === 0 && (
        <div
          role="status"
          style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--text-secondary)' }}
        >
          No agent data yet
        </div>
      )}

      {/* Table */}
      {!error && agents.length > 0 && (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }} role="grid">
              <thead>
                <tr>
                  {(
                    [
                      { key: 'name' as SortKey, label: 'Agent Name' },
                      { key: 'capability' as SortKey, label: 'Capability' },
                      { key: 'tasksCompleted' as SortKey, label: 'Tasks Completed' },
                      { key: 'successRate' as SortKey, label: 'Success Rate (%)' },
                      { key: 'avgResponseTimeMs' as SortKey, label: 'Avg Response Time (ms)' },
                    ] as const
                  ).map(({ key, label }) => (
                    <th
                      key={key}
                      style={thStyle}
                      onClick={() => handleSort(key)}
                      aria-sort={
                        sort.key === key
                          ? sort.dir === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                      }
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        {label}
                        <SortIcon columnKey={key} sort={sort} />
                      </span>
                    </th>
                  ))}
                  <th style={{ ...thStyle, cursor: 'default' }}>7-day Trend</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((agent) => (
                  <tr key={agent.agentId}>
                    <td style={tdStyle}>{agent.name}</td>
                    <td style={tdStyle}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: '12px',
                          fontSize: '11px',
                          fontWeight: 500,
                          background: 'var(--surface-muted)',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        {agent.capability}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, fontVariantNumeric: 'tabular-nums' }}>
                      {agent.tasksCompleted.toLocaleString()}
                    </td>
                    <td style={{ ...tdStyle, fontVariantNumeric: 'tabular-nums' }}>
                      {agent.successRate.toFixed(1)}%
                    </td>
                    <td style={{ ...tdStyle, fontVariantNumeric: 'tabular-nums' }}>
                      {agent.avgResponseTimeMs.toLocaleString()}
                    </td>
                    <td style={{ ...tdStyle, padding: '4px 12px' }}>
                      <Sparkline data={agent.sparkline} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* View all / Show less toggle */}
          {agents.length > DEFAULT_VISIBLE && (
            <div
              style={{
                padding: '12px 20px',
                borderTop: '1px solid var(--border-subtle)',
                textAlign: 'center',
              }}
            >
              <button
                onClick={() => setShowAll((v) => !v)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '13px',
                  color: 'var(--color-primary)',
                  fontWeight: 500,
                }}
              >
                {showAll ? 'Show less' : `View all (${agents.length})`}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

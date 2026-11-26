const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

export interface AgentMetric {
  /** Unique agent identifier */
  agentId: string;
  /** Display name of the agent */
  name: string;
  /** Agent capability type (e.g. "research", "coding", "design") */
  capability: string;
  /** Total number of tasks completed by this agent */
  tasksCompleted: number;
  /** Success rate as a percentage (0–100) */
  successRate: number;
  /** Average response time in milliseconds */
  avgResponseTimeMs: number;
  /** Task counts for the past 7 days (index 0 = oldest, 6 = today) */
  sparkline: number[];
}

export async function fetchAgentStats(): Promise<AgentMetric[]> {
  const res = await fetch(`${API_BASE}/api/stats/agents`, {
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch agent stats: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

import useSWR from 'swr';
import { apiClient, getAgents } from '../services/api';
import type { AgentRecord, CursorPageEnvelope } from '../types/api';

export function useAgents(params?: URLSearchParams, refreshInterval = 30_000) {
  const query = params?.toString();
  return useSWR<AgentRecord[], Error>(
    query ? `/api/agents?${query}` : '/api/agents',
    async path => {
      if (!query) return getAgents();
      const response = await apiClient.get<AgentRecord[] | CursorPageEnvelope<AgentRecord>>(path, undefined, true);
      return Array.isArray(response) ? response : response.data.items;
    },
    { refreshInterval },
  );
}

import { apiClient } from './api';
import type { AgentRecord } from '../types/api';

export interface AgentsPage {
  agents: AgentRecord[];
  total: number;
  page: number;
  hasMore: boolean;
}

export async function fetchAgentsPage(page: number, pageSize: number): Promise<AgentsPage> {
  const data = await apiClient.get<AgentRecord[] | { data: { items: AgentRecord[]; pagination: { hasNextPage: boolean } } }>(
    `/api/agents?page=${page}&pageSize=${pageSize}`
  );

  // Handle both response shapes: flat array or cursor-paginated envelope
  if (Array.isArray(data)) {
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const sliced = data.slice(start, end);
    return {
      agents: sliced,
      total: data.length,
      page,
      hasMore: end < data.length,
    };
  }

  // Cursor-paginated envelope shape
  const envelope = data as { data: { items: AgentRecord[]; pagination: { hasNextPage: boolean } } };
  return {
    agents: envelope.data.items,
    total: envelope.data.items.length,
    page,
    hasMore: envelope.data.pagination.hasNextPage,
  };
}

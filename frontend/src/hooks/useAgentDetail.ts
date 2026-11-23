import useSWR from 'swr';
import { getAgent, getAgentReputation } from '../services/api';
import type { AgentRecord } from '../types/api';
import type { AgentReputation } from '../types/agent';

export interface AgentDetailResult {
  agent: AgentRecord | null;
  reputation: AgentReputation | null;
  reputationHistory?: import('../types/agent').ReputationHistory[];
  reputationHistoryLoading?: boolean;
  loading: boolean;
  agentLoading: boolean;
  reputationLoading: boolean;
  error: string | null;
  notFound: boolean;
  refetch: () => void;
}

/**
 * Fetches agent details and reputation in parallel from the backend API.
 *
 * @param agentId - The agent's unique identifier
 * @returns Combined loading/error/data state for the agent detail page
 */
export function useAgentDetail(agentId: string): AgentDetailResult {
  const path = agentId ? `/api/agents/${encodeURIComponent(agentId)}` : null;
  const agentQuery = useSWR(path, () => getAgent(agentId));
  const reputationQuery = useSWR(path ? `${path}/reputation` : null, () => getAgentReputation(agentId));
  const historyQuery = useSWR(path ? `${path}/reputation/history` : null, async () => {
    const { getAgentReputationHistory } = await import('../services/api');
    return getAgentReputationHistory(agentId);
  });

  const agent = agentQuery.data ?? null;
  const reputation = reputationQuery.data ?? null;
  const reputationHistory = historyQuery.data ?? [];
  const reputationHistoryLoading = historyQuery.isLoading;
  const agentLoading = agentQuery.isLoading;
  const reputationLoading = reputationQuery.isLoading;
  const requestError = agent ? null : agentQuery.error;
  const notFound = requestError?.statusCode === 404 ||
    (requestError instanceof Error && requestError.message.includes('404'));
  const error = notFound || !requestError ? null :
    requestError instanceof Error ? requestError.message : 'Failed to load agent';
  const loading = agentLoading && reputationLoading;
  const refetch = () => {
    void Promise.allSettled([agentQuery.mutate(), reputationQuery.mutate(), historyQuery.mutate()]);
  };

  return {
    agent,
    reputation,
    reputationHistory,
    reputationHistoryLoading,
    loading,
    agentLoading,
    reputationLoading,
    error,
    notFound,
    refetch,
  };
}

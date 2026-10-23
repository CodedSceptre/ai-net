import { useState, useEffect } from 'react';
import { getAgent, getAgentReputation } from '../services/api';
import type { AgentRecord } from '../types/api';
import type { AgentReputation } from '../types/agent';

export interface AgentDetailResult {
  agent: AgentRecord | null;
  reputation: AgentReputation | null;
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
  const [agent, setAgent] = useState<AgentRecord | null>(null);
  const [reputation, setReputation] = useState<AgentReputation | null>(null);
  const [agentLoading, setAgentLoading] = useState(true);
  const [reputationLoading, setReputationLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [fetchKey, setFetchKey] = useState(0);

  useEffect(() => {
    if (!agentId) return;

    let mounted = true;

    setAgentLoading(true);
    setReputationLoading(true);
    setError(null);
    setNotFound(false);

    // Fetch agent and reputation in parallel
    getAgent(agentId)
      .then((data) => {
        if (mounted) {
          setAgent(data);
          setAgentLoading(false);
        }
      })
      .catch((err) => {
        if (mounted) {
          const isNotFound =
            err?.statusCode === 404 ||
            (err instanceof Error && err.message.includes('404'));
          setNotFound(isNotFound);
          setError(isNotFound ? null : (err instanceof Error ? err.message : 'Failed to load agent'));
          setAgentLoading(false);
        }
      });

    getAgentReputation(agentId)
      .then((data) => {
        if (mounted) {
          setReputation(data);
          setReputationLoading(false);
        }
      })
      .catch(() => {
        if (mounted) {
          // Reputation is non-critical — show page without it
          setReputationLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [agentId, fetchKey]);

  const loading = agentLoading && reputationLoading;

  const refetch = () => setFetchKey((k) => k + 1);

  return {
    agent,
    reputation,
    loading,
    agentLoading,
    reputationLoading,
    error,
    notFound,
    refetch,
  };
}

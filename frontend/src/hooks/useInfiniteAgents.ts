import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchAgentsPage } from '../services/agentsService';
import type { AgentRecord } from '../types/api';
import { normalizeAgent } from '@utils/agentRegistry';

const PAGE_SIZE = 20;

export interface UseInfiniteAgentsResult {
  agents: AgentRecord[];
  isLoading: boolean;
  isError: boolean;
  hasMore: boolean;
  sentinelRef: React.RefCallback<HTMLElement>;
  retry: () => void;
}

export function useInfiniteAgents(): UseInfiniteAgentsResult {
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState(false);

  const observerRef = useRef<IntersectionObserver | null>(null);
  const isFetchingRef = useRef(false);
  const mountedRef = useRef(true);
  const currentPageRef = useRef(1);
  const hasMoreRef = useRef(true);

  const fetchPage = useCallback(async (pageNum: number) => {
    if (isFetchingRef.current || !hasMoreRef.current) return;
    isFetchingRef.current = true;
    setIsLoading(true);
    setIsError(false);

    try {
      const result = await fetchAgentsPage(pageNum, PAGE_SIZE);
      if (!mountedRef.current) return;

      setAgents(prev => {
        const existingIds = new Set(prev.map(a => a.id));
        const normalized = result.agents.map(normalizeAgent);
        const deduped = normalized.filter(a => !existingIds.has(a.id));
        return [...prev, ...deduped];
      });
      setHasMore(result.hasMore);
      hasMoreRef.current = result.hasMore;
      currentPageRef.current = pageNum + 1;
      setPage(pageNum + 1);
    } catch {
      if (!mountedRef.current) return;
      setIsError(true);
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
      isFetchingRef.current = false;
    }
  }, []);

  // Initial load
  useEffect(() => {
    mountedRef.current = true;
    fetchPage(1);
    return () => {
      mountedRef.current = false;
      observerRef.current?.disconnect();
    };
  }, [fetchPage]);

  // Sentinel ref callback — attaches/detaches IntersectionObserver
  const sentinelRef = useCallback<React.RefCallback<HTMLElement>>(
    (node) => {
      observerRef.current?.disconnect();
      if (!node) return;

      observerRef.current = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting && hasMoreRef.current && !isFetchingRef.current) {
            fetchPage(currentPageRef.current);
          }
        },
        { threshold: 0.1 }
      );
      observerRef.current.observe(node);
    },
    [fetchPage]
  );

  const retry = useCallback(() => {
    fetchPage(currentPageRef.current);
  }, [fetchPage]);

  return { agents, isLoading, isError, hasMore, sentinelRef, retry };
}

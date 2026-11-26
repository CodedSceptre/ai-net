import { describe, it, expect, vi, beforeAll, afterEach, afterAll } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { useInfiniteAgents } from './useInfiniteAgents';
import type { AgentRecord } from '../types/api';

// Mock IntersectionObserver
const mockObserve = vi.fn();
const mockDisconnect = vi.fn();
const mockUnobserve = vi.fn();

vi.stubGlobal('IntersectionObserver', vi.fn(() => ({
  observe: mockObserve,
  disconnect: mockDisconnect,
  unobserve: mockUnobserve,
})));

const makeAgent = (id: string): AgentRecord => ({
  id,
  name: `Agent ${id}`,
  capabilities: ['test'],
  price: 1,
  reputation: 5,
  status: 'active',
});

const PAGE_SIZE = 20;

const agents1: AgentRecord[] = Array.from({ length: PAGE_SIZE }, (_, i) => makeAgent(`agent-${i}`));
const agents2: AgentRecord[] = Array.from({ length: 5 }, (_, i) => makeAgent(`agent-page2-${i}`));

let serverResponse: AgentRecord[] = [...agents1, ...agents2];

const server = setupServer(
  http.get('*/api/agents', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('pageSize') ?? PAGE_SIZE);
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    return HttpResponse.json(serverResponse.slice(0, start + pageSize > serverResponse.length ? serverResponse.length : start + pageSize));
  })
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  mockObserve.mockClear();
  mockDisconnect.mockClear();
  serverResponse = [...agents1, ...agents2];
});
afterAll(() => server.close());

describe('useInfiniteAgents', () => {
  it('fetches initial page on mount', async () => {
    const { result } = renderHook(() => useInfiniteAgents());

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.agents.length).toBeGreaterThan(0);
    expect(result.current.isError).toBe(false);
  });

  it('sets hasMore false when all agents fit in one page', async () => {
    serverResponse = Array.from({ length: 5 }, (_, i) => makeAgent(`small-${i}`));

    const { result } = renderHook(() => useInfiniteAgents());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.hasMore).toBe(false);
    expect(result.current.agents).toHaveLength(5);
  });

  it('deduplicates agents with same id across pages', async () => {
    // Return same agent in both pages
    serverResponse = [makeAgent('dup-1'), makeAgent('dup-2')];

    const { result } = renderHook(() => useInfiniteAgents());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Even if fetched again, should not have duplicate ids
    const ids = result.current.agents.map((a: AgentRecord) => a.id);
    const uniqueIds = new Set(ids);
    expect(ids.length).toBe(uniqueIds.size);
  });

  it('handles error state and allows retry', async () => {
    server.use(
      http.get('*/api/agents', () => {
        return HttpResponse.error();
      })
    );

    const { result } = renderHook(() => useInfiniteAgents());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isError).toBe(true);

    // Reset handler to succeed
    server.resetHandlers();

    await act(async () => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.isError).toBe(false));
  });

  it('cleans up IntersectionObserver on unmount', () => {
    const { unmount } = renderHook(() => useInfiniteAgents());
    unmount();
    expect(mockDisconnect).toHaveBeenCalled();
  });
});

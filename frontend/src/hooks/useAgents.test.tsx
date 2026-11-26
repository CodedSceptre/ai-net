import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../services/api';
import { useAgents } from './useAgents';
import { useTasks } from './useTasks';

function response(id: string) {
  return new Response(JSON.stringify([{ id }]), {
    headers: { 'Content-Type': 'application/json' },
  });
}

function wrapper({ children }: { children: ReactNode }) {
  return <SWRConfig value={{ dedupingInterval: 0, shouldRetryOnError: false }}>{children}</SWRConfig>;
}

afterEach(() => vi.unstubAllGlobals());

describe('agent cache', () => {
  it('serves stale data immediately on remount and revalidates in the background', async () => {
    let resolveRefresh!: (value: Response) => void;
    const refresh = new Promise<Response>(resolve => { resolveRefresh = resolve; });
    const fetch = vi.fn().mockResolvedValueOnce(response('old')).mockReturnValueOnce(refresh);
    vi.stubGlobal('fetch', fetch);
    const render = () => renderHook(() => useAgents(new URLSearchParams('limit=1'), 0), { wrapper });
    const first = render();
    await waitFor(() => expect(first.result.current.data?.[0].id).toBe('old'));
    first.unmount();

    const revisit = render();
    expect(revisit.result.current.data?.[0].id).toBe('old');
    expect(revisit.result.current.isLoading).toBe(false);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await act(async () => resolveRefresh(response('fresh')));
    await waitFor(() => expect(revisit.result.current.data?.[0].id).toBe('fresh'));
  });

  it('revalidates query variants after the registration request succeeds', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response('old'))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(response('registered'));
    vi.stubGlobal('fetch', fetch);

    const { result } = renderHook(() => useAgents(new URLSearchParams('limit=2'), 0));
    await waitFor(() => expect(result.current.data?.[0].id).toBe('old'));
    await act(async () => { await apiClient.post('/api/agents/register', {}); });

    await waitFor(() => expect(result.current.data?.[0].id).toBe('registered'));
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('refreshes a wallet-scoped task list after creating a task', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ tasks: [] }))
      .mockResolvedValueOnce(Response.json({ taskId: 'new-task' }, { status: 201 }))
      .mockResolvedValueOnce(Response.json({ tasks: [{ taskId: 'new-task' }] }));
    vi.stubGlobal('fetch', fetch);

    const { result } = renderHook(() => useTasks('wallet', new URLSearchParams('pageSize=50')));
    await waitFor(() => expect(result.current.data).toEqual([]));
    await act(async () => { await apiClient.post('/api/tasks', { prompt: 'New task' }); });

    await waitFor(() => expect(result.current.data?.[0].taskId).toBe('new-task'));
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

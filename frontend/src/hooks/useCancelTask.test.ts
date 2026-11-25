import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useCancelTask } from './useCancelTask';

// Mock useToast
vi.mock('./useToast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

describe('useCancelTask', () => {
  const baseOptions = {
    taskId: 'task-123',
    currentStatus: 'queued',
    onStatusChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('performs optimistic update before API call', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    const onStatusChange = vi.fn();
    const { result } = renderHook(() =>
      useCancelTask({ ...baseOptions, onStatusChange })
    );
    await act(async () => {
      await result.current.cancelTask();
    });
    // First call should be optimistic update to 'cancelled'
    expect(onStatusChange).toHaveBeenCalledWith('cancelled');
  });

  it('calls DELETE /api/tasks/:id', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    const { result } = renderHook(() => useCancelTask(baseOptions));
    await act(async () => {
      await result.current.cancelTask('wrong params');
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/tasks/task-123'),
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('includes reason in DELETE body when provided', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    const { result } = renderHook(() => useCancelTask(baseOptions));
    await act(async () => {
      await result.current.cancelTask('budget exceeded');
    });
    const callArgs = fetchMock.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.reason).toBe('budget exceeded');
  });

  it('rolls back status on API error', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ message: 'Server error' }) });
    const onStatusChange = vi.fn();
    const { result } = renderHook(() =>
      useCancelTask({ ...baseOptions, currentStatus: 'queued', onStatusChange })
    );
    await act(async () => {
      await result.current.cancelTask();
    });
    // Should have called with 'cancelled' first, then rolled back to 'queued'
    expect(onStatusChange).toHaveBeenCalledWith('cancelled');
    expect(onStatusChange).toHaveBeenCalledWith('queued');
  });

  it('reports error on API failure', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ message: 'Not found' }) });
    const { result } = renderHook(() => useCancelTask(baseOptions));
    await act(async () => {
      await result.current.cancelTask();
    });
    expect(result.current.error).toBe('Not found');
  });
});

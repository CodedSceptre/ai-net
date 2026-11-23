import useSWR from 'swr';
import { apiClient } from '../services/api';
import type { TaskResponse } from '../types/api';

export function useTasks(wallet: string | null, params: URLSearchParams) {
  return useSWR(
    wallet ? [`/api/tasks?${params}`, wallet] as const : null,
    async ([path, walletPublicKey]) => {
      const result = await apiClient.get<{ tasks: TaskResponse[] }>(path, {
        headers: { walletpublickey: walletPublicKey, 'API-Version': '1.0' },
      }, true);
      return result.tasks;
    },
  );
}

export function useTask(taskId: string | undefined, wallet: string | null) {
  return useSWR(
    taskId && wallet ? [`/api/tasks/${encodeURIComponent(taskId)}`, wallet] as const : null,
    ([path, walletPublicKey]) => apiClient.get<TaskResponse>(path, {
      headers: { walletpublickey: walletPublicKey, 'API-Version': '1.0' },
    }, true),
  );
}

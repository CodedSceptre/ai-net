import useSWR from 'swr';
import { getStats } from '../services/api';

export function useStats() {
  return useSWR('/api/stats/agents', async () => ({
    data: await getStats(),
    fetchedAt: Date.now(),
  }), { refreshInterval: 30_000 });
}

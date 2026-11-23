import { useState, useEffect, useRef, useCallback } from 'react';
import type { TaskEstimate } from '../types/api';

const DEBOUNCE_MS = 500;

export interface UseBudgetEstimateResult {
  estimate: TaskEstimate | null;
  loading: boolean;
  error: string | null;
  xlmUsdRate: number | null;
}

async function fetchEstimate(prompt: string): Promise<TaskEstimate> {
  const res = await fetch('/api/tasks/estimate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) {
    throw new Error(`Estimate request failed: ${res.status}`);
  }
  return res.json();
}

async function fetchXlmUsdRate(): Promise<number> {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd'
    );
    if (!res.ok) return 0.1; // fallback
    const data = await res.json();
    return data?.stellar?.usd ?? 0.1;
  } catch {
    return 0.1;
  }
}

export function useBudgetEstimate(prompt: string): UseBudgetEstimateResult {
  const [estimate, setEstimate] = useState<TaskEstimate | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [xlmUsdRate, setXlmUsdRate] = useState<number | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Fetch XLM/USD rate once on mount
  useEffect(() => {
    fetchXlmUsdRate().then(setXlmUsdRate);
  }, []);

  const runEstimate = useCallback((p: string) => {
    if (!p.trim()) {
      setEstimate(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    fetchEstimate(p)
      .then((data) => {
        setEstimate(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Estimate failed');
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!prompt.trim()) {
      setEstimate(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    timerRef.current = setTimeout(() => {
      runEstimate(prompt);
    }, DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [prompt, runEstimate]);

  return { estimate, loading, error, xlmUsdRate };
}

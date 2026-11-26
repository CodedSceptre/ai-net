import { useEffect, useRef, useState, useCallback } from 'react';
import type { NodeStatus } from '../components/tasks/DAGVisualizer';

export interface TaskNodeUpdate {
  nodeId: string;
  status: NodeStatus;
  outputSummary?: string;
  error?: string;
}

export interface UseTaskStreamOptions {
  taskId?: string;
  baseUrl?: string;
  onNodeUpdate?: (update: TaskNodeUpdate) => void;
  maxReconnectAttempts?: number;
}

export type StreamConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface UseTaskStreamResult {
  status: StreamConnectionStatus;
  isConnected: boolean;
}

export function useTaskStream({
  taskId,
  baseUrl,
  onNodeUpdate,
  maxReconnectAttempts = 5,
}: UseTaskStreamOptions): UseTaskStreamResult {
  const [status, setStatus] = useState<StreamConnectionStatus>('disconnected');
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const intentionalCloseRef = useRef(false);
  const onNodeUpdateRef = useRef(onNodeUpdate);

  useEffect(() => {
    onNodeUpdateRef.current = onNodeUpdate;
  }, [onNodeUpdate]);

  const connect = useCallback(() => {
    if (!taskId) return;

    const wsUrl = baseUrl ?? (
      `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/tasks/${taskId}/stream`
    );

    setStatus('connecting');

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;
        setStatus('connected');
        reconnectAttemptsRef.current = 0;
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'node_update' && onNodeUpdateRef.current) {
            const update: TaskNodeUpdate = {
              nodeId: data.payload?.nodeId ?? data.nodeId,
              status: data.payload?.status ?? data.status,
              outputSummary: (data.payload as { summary?: string; content?: string })?.summary ??
                             (data.payload as { summary?: string; content?: string })?.content,
              error: (data.payload as { error?: string })?.error,
            };
            onNodeUpdateRef.current(update);
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onerror = () => {
        if (!mountedRef.current) return;
        setStatus('error');
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        wsRef.current = null;

        if (intentionalCloseRef.current) return;

        setStatus('disconnected');

        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
          reconnectAttemptsRef.current++;
          reconnectTimeoutRef.current = setTimeout(() => {
            if (mountedRef.current) {
              setStatus('connecting');
              connect();
            }
          }, delay);
        }
      };
    } catch {
      setStatus('error');
    }
  }, [taskId, baseUrl, maxReconnectAttempts]);

  useEffect(() => {
    mountedRef.current = true;
    intentionalCloseRef.current = false;

    if (taskId) {
      connect();
    }

    return () => {
      mountedRef.current = false;
      intentionalCloseRef.current = true;

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect, taskId]);

  return {
    status,
    isConnected: status === 'connected',
  };
}

import { useEffect, useCallback, useRef } from 'react';
import type { DAGEvent, PaymentEvent } from '../types/api';
import { useTask } from './useTasks';
import { useWallet } from '../context/WalletContext';
import { useTaskWebSocket } from './useTaskWebSocket';
import { useNodeState } from './useNodeState';
import { useTaskPayments } from './useTaskPayments';
import { useTaskOutputs } from './useTaskOutputs';

// Helper to determine payment amount based on agent type or node ID
export const getAmountForAgent = (agentType?: string): string => {
  const type = agentType?.toLowerCase() || '';
  if (type.includes('research')) return '0.5';
  if (type.includes('risk')) return '0.3';
  if (type.includes('coding')) return '1.2';
  if (type.includes('design')) return '0.6';
  if (type.includes('report')) return '0.4';
  return '0.5';
};

export const useTaskMonitor = (taskId: string | undefined) => {
  const { publicKey } = useWallet();
  const { data, isLoading: loading, error: requestError, mutate } = useTask(taskId, publicKey);
  const task = data ?? null;
  const error = task ? null : requestError ?? null;

  // Initialize sub-hooks
  const nodeState = useNodeState(taskId || '');
  const paymentState = useTaskPayments(taskId || '');
  const outputState = useTaskOutputs(taskId || '');

  // Handle WebSocket events
  const handleWebSocketMessage = useCallback((event: DAGEvent) => {
    // Update node state
    nodeState.updateNodeFromEvent(event);
    
    // Update payment state
    paymentState.updatePaymentFromEvent(event);
    
    // Update output state
    outputState.updateOutputFromEvent(event);
    
    // Update task state for global events
    if (event.type === 'task_completed' || event.type === 'task_failed') {
      const status = event.type === 'task_completed' ? 'completed' : 'failed';
      void mutate(previous => previous && { ...previous, status, updatedAt: event.timestamp }, false);
    }
  }, [nodeState, paymentState, outputState, mutate]);

  // WebSocket connection
  const { isConnected, status: wsStatus } = useTaskWebSocket({
    taskId: taskId || '',
    onMessage: handleWebSocketMessage,
  });

  const dag = task?.dag;
  const updatedAt = task?.updatedAt;
  const initializedDag = useRef<typeof dag>(undefined);
  const { initializeNodes } = nodeState;
  const { initializeOutputs } = outputState;
  const { initializePayments } = paymentState;

  useEffect(() => {
    if (initializedDag.current === dag) return;
    initializedDag.current = dag;
    if (!dag) return;
    initializeNodes(dag);
    initializeOutputs(dag.filter(node => node.status === 'completed'));
    const initialPayments: PaymentEvent[] = dag.flatMap(node => {
      if (node.status !== 'completed' && node.status !== 'running') return [];
      const completed = node.status === 'completed';
      const result = node.result as { txHash?: string } | undefined;
      return [{
        amount: getAmountForAgent(node.agentType),
        direction: 'out',
        counterparty: node.agentType || 'agent',
        memo: `Payment ${completed ? 'released' : 'locked'} for ${node.nodeId}`,
        timestamp: updatedAt || new Date().toISOString(),
        txHash: completed ? result?.txHash || 'mock-hash' : '',
      }];
    });
    initializePayments(initialPayments);
  }, [dag, updatedAt, initializeNodes, initializeOutputs, initializePayments]);

  return {
    task,
    loading,
    error,
    wsStatus,
    nodes: nodeState.nodes,
    payments: paymentState.payments,
    outputs: outputState.outputs,
    finalResult: outputState.finalResult,
    isConnected,
    refetch: () => taskId ? mutate().catch(() => undefined) : undefined,
  };
};

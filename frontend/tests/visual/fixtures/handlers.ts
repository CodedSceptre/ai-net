import { http, HttpResponse } from 'msw';
import type { AgentRecord, DAGNode, TaskResponse } from '../../../src/types/api';
import { MOCK_WALLET_PUBKEY, MOCK_TASK_ID } from '../utils';

const time = '2026-08-20T10:00:00Z';
const horizon = 'https://horizon-testnet.stellar.org';
const capabilities = ['research', 'risk', 'coding', 'design', 'report'] as const;

export const agents: AgentRecord[] = [
  'Research Specialist', 'Risk Analyst', 'Contract Developer',
  'Design Studio', 'Report Writer', 'Market Researcher',
].map((name, index) => ({
  id: `visual-agent-${index + 1}`,
  name,
  capabilities: [capabilities[index % capabilities.length]],
  price: [0.8, 1.2, 2.5, 1.4, 0.6, 1.1][index],
  reputation: [4.8, 4.4, 4.9, 4.6, 4.2, 4.5][index],
  status: index === 5 ? 'inactive' : 'active',
}));

export const nodes: DAGNode[] = capabilities.map((agentType, index) => ({
  nodeId: `visual-${agentType}`,
  agentType,
  prompt: `Prepare the ${agentType} section of the marketplace report.`,
  dependsOn: index === 0 ? [] : [`visual-${capabilities[index - 1]}`],
  status: index < 2 ? 'completed' : index === 2 ? 'running' : 'pending',
  startedAt: index <= 2 ? time : undefined,
  completedAt: index < 2 ? '2026-08-20T10:00:04Z' : undefined,
}));

const task: TaskResponse = {
  id: MOCK_TASK_ID,
  taskId: MOCK_TASK_ID,
  prompt: 'Prepare an agent marketplace report.',
  walletPublicKey: MOCK_WALLET_PUBKEY,
  status: 'running',
  dag: nodes,
  createdAt: time,
  updatedAt: time,
};

export const paymentRows = Array.from({ length: 10 }, (_, index) => ({
  taskId: `market-report-${String(index + 1).padStart(2, '0')}`,
  nodeId: nodes[index % nodes.length].nodeId,
  balanceId: `balance-${index}`,
  status: index % 4 === 0 ? 'refunded' : 'released',
  amountStroops: String((index + 1) * 1_500_000),
  txHash: (index + 1).toString(16).padStart(64, '0'),
  date: new Date(Date.UTC(2026, 7, 20 - index, 10)).toISOString(),
}));

const reputationHistory = [4.1, 4.4, 4.3, 4.7, 4.8].map((score, index) => ({
  score, date: new Date(Date.UTC(2026, 7, 10 + 2 * index, 10)).toISOString(),
  taskId: paymentRows[index].taskId,
}));

export const visualHandlers = [
  http.get('/api/agents', () => HttpResponse.json(agents)),
  http.get('/api/agents/:id/reputation/history', () => HttpResponse.json(reputationHistory)),
  http.get('/api/agents/:id/reputation', ({ params }) => HttpResponse.json({
    id: params.id, dimensions: { quality: 0.94, speed: 0.82, reliability: 0.98, cost: 0.78 },
    history: reputationHistory,
  })),
  http.get('/api/agents/:id', ({ params }) => {
    const agent = agents.find(({ id }) => id === params.id);
    return agent ? HttpResponse.json(agent) : new HttpResponse(null, { status: 404 });
  }),
  http.get('/api/tasks/:id', () => HttpResponse.json(task)),
  http.get('/api/wallets/:address/tasks', () => HttpResponse.json([task])),
  http.get('/api/payments', () => HttpResponse.json({ payments: paymentRows })),
  http.get('/api/stats', () => HttpResponse.json({
    totalAgents: agents.length,
    totalTasks: 48,
    totalXLMTransacted: 156.75,
    uptimePercent: 99.95,
    tasksLast7d: reputationHistory.map(({ date, score }) => ({ timestamp: date, value: Math.round(score * 7) })),
    xlmLast7d: reputationHistory.map(({ date, score }) => ({ timestamp: date, value: score * 10 })),
  })),
  http.get(`${horizon}/accounts/:address`, () => HttpResponse.json({
    balances: [{ asset_type: 'native', balance: '125.7500000' }],
    subentry_count: 0,
  })),
  http.get(`${horizon}/accounts/:address/payments`, ({ request }) =>
    new URL(request.url).searchParams.has('cursor')
      ? new HttpResponse(null, { status: 204 })
      : HttpResponse.json({ _embedded: { records: [] } })),
];

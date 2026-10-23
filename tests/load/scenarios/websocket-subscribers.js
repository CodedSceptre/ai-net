import http from 'k6/http';
import ws from 'k6/ws';
import { check } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const connectionTime = new Trend('websocket_connection_time');
const errorRate = new Rate('websocket_error_rate');
const baseUrl = __ENV.BASE_URL || 'http://localhost:3000';

export const options = {
  scenarios: {
    subscribers: { executor: 'per-vu-iterations', vus: 50, iterations: 1, maxDuration: '70s' },
  },
  thresholds: {
    websocket_connection_time: ['p(95)<500'],
    websocket_error_rate: ['rate<0.001'],
  },
};

export function setup() {
  const walletPublicKey = `load-test-ws-${Date.now()}`;
  const response = http.post(
    `${baseUrl}/api/tasks`,
    JSON.stringify({
      prompt: 'Seed task for WebSocket load testing.',
      walletPublicKey,
      maxBudgetXLM: 1,
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        walletpublickey: walletPublicKey,
        'Idempotency-Key': `load-ws-${Date.now()}`,
      },
    },
  );
  if (response.status !== 201) {
    throw new Error(`Failed to seed WebSocket task (${response.status}): ${response.body}`);
  }
  return { walletPublicKey, taskId: JSON.parse(response.body).taskId };
}

export default function (data) {
  const wsUrl = `${baseUrl.replace(/^http/, 'ws')}/api/tasks/${data.taskId}/stream`;
  const startedAt = Date.now();
  const response = ws.connect(wsUrl, {}, (socket) => {
    socket.on('open', () => socket.send(JSON.stringify({ walletPublicKey: data.walletPublicKey })));
    socket.on('error', () => errorRate.add(true));
    socket.setTimeout(() => socket.close(), 60_000);
  });
  connectionTime.add(Date.now() - startedAt);
  const ok = check(response, { 'WebSocket upgraded': (result) => result && result.status === 101 });
  errorRate.add(!ok);
}
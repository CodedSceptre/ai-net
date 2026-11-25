import { createAgentDb, getAgentDb } from "../db/agents";

const latencyBounds = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];
const reputationBounds = [0, 1, 2, 3, 4, 5];
const routes = new Map<string, {
  statuses: Map<number, number>;
  count: number;
  sum: number;
  buckets: number[];
}>();
const agents = new Map<string, { submitted: number; completed: number; failed: number }>();
const paymentAmounts = { locked: 0n, released: 0n, refunded: 0n };
let failures = 0;
let releaseSeconds = 0;
let releases = 0;

function label(value: string) {
  return JSON.stringify(value);
}

export function observeHttpRoute(route: string, status: number, seconds: number): void {
  const key = routes.size >= 512 && !routes.has(route) ? "other" : route;
  const entry = routes.get(key) ?? { statuses: new Map<number, number>(), count: 0, sum: 0, buckets: latencyBounds.map(() => 0) };
  entry.statuses.set(status, (entry.statuses.get(status) ?? 0) + 1);
  entry.count++;
  entry.sum += seconds;
  latencyBounds.forEach((bound, index) => {
    if (seconds <= bound) entry.buckets[index]++;
  });
  routes.set(key, entry);
}

export function observeAgentDispatch(id: string, outcome: "submitted" | "completed" | "failed"): void {
  const key = agents.size >= 10_000 && !agents.has(id) ? "other" : id;
  const counters = agents.get(key) ?? { submitted: 0, completed: 0, failed: 0 };
  counters[outcome]++;
  agents.set(key, counters);
}

export function observePayment(outcome: keyof typeof paymentAmounts, stroops: bigint, seconds = 0): void {
  paymentAmounts[outcome] += stroops;
  if (outcome === "released") {
    releaseSeconds += seconds;
    releases++;
  }
}

export function observePaymentFailure(): void {
  failures++;
}

export function exportDashboardMetrics(): string {
  const families = [
    "# TYPE http_requests_total counter",
  ];
  for (const [route, entry] of routes) {
    const routeLabel = `route=${label(route)}`;
    for (const [status, count] of entry.statuses) {
      families.push(`http_requests_total{${routeLabel},status="${status}"} ${count}`);
    }
  }
  families.push("# TYPE http_request_duration_seconds histogram");
  for (const [route, entry] of routes) {
    const routeLabel = `route=${label(route)}`;
    latencyBounds.forEach((bound, index) => {
      families.push(`http_request_duration_seconds_bucket{${routeLabel},le="${bound}"} ${entry.buckets[index]}`);
    });
    families.push(
      `http_request_duration_seconds_bucket{${routeLabel},le="+Inf"} ${entry.count}`,
      `http_request_duration_seconds_sum{${routeLabel}} ${entry.sum}`,
      `http_request_duration_seconds_count{${routeLabel}} ${entry.count}`,
    );
  }
  for (const [state, stroops] of Object.entries(paymentAmounts)) {
    families.push(`# TYPE stellar_payment_xlm_${state}_total counter`, `stellar_payment_xlm_${state}_total ${Number(stroops) / 10_000_000}`);
  }
  families.push(
    "# TYPE stellar_payment_failures_total counter",
    `stellar_payment_failures_total ${failures}`,
    "# TYPE stellar_payment_release_duration_seconds summary",
    `stellar_payment_release_duration_seconds_sum ${releaseSeconds}`,
    `stellar_payment_release_duration_seconds_count ${releases}`,
    "# TYPE agent_tasks_submitted_total counter",
  );
  for (const [id, entry] of agents) {
    families.push(`agent_tasks_submitted_total{agent_id=${label(id)}} ${entry.submitted}`);
  }
  families.push("# TYPE agent_task_outcomes_total counter");
  for (const [id, entry] of agents) {
    families.push(
      `agent_task_outcomes_total{agent_id=${label(id)},outcome="completed"} ${entry.completed}`,
      `agent_task_outcomes_total{agent_id=${label(id)},outcome="failed"} ${entry.failed}`,
    );
  }

  const fleet = createAgentDb(getAgentDb()).list();
  families.push(
    "# TYPE agent_active_count gauge",
    `agent_active_count ${fleet.filter((agent) => agent.status === "online" && !agent.bannedAt).length}`,
    "# TYPE agent_reputation_score_bucket gauge",
  );
  let lower = -Infinity;
  for (const upper of [...reputationBounds, Infinity]) {
    const count = fleet.filter((agent) => agent.reputationScore > lower && agent.reputationScore <= upper).length;
    const name = upper === Infinity ? `>${lower}` : lower === -Infinity ? `≤${upper}` : `(${lower}, ${upper}]`;
    families.push(`agent_reputation_score_bucket{score_range=${label(name)}} ${count}`);
    lower = upper;
  }
  return families.join("\n");
}

# AI-Net Monitoring Guide

> **Companion to [Node Operators Guide § 9](./NODE_OPERATORS_GUIDE.md#9-observability-metrics--health-monitoring)**  
> This guide explains how to **interpret and act on** what you see once monitoring is running. For installation and configuration of Prometheus, Grafana, and Loki, see the Node Operators Guide.

---

## Table of Contents

1. [AI-Net Platform SLIs Dashboard Walkthrough](#1-ai-net-platform-slis-dashboard-walkthrough)
2. [Alert Interpretation Guide](#2-alert-interpretation-guide)
3. [KPI Baselines for a Healthy Production Node](#3-kpi-baselines-for-a-healthy-production-node)
4. [Anomaly Investigation Flows](#4-anomaly-investigation-flows)
5. [Log Querying with LogQL](#5-log-querying-with-logql)
6. [Performance Tuning and Scaling Thresholds](#6-performance-tuning-and-scaling-thresholds)
7. [Monthly Metric Review Checklist](#7-monthly-metric-review-checklist)

---

## 1. AI-Net Platform SLIs Dashboard Walkthrough

The **AI-Net Platform SLIs** dashboard in Grafana is divided into four row sections. Every panel is documented below with its data source metric, what a normal reading looks like, and what an anomaly signals.

### 1.1 System Status Row

#### Backend Up

| Attribute   | Value |
|-------------|-------|
| Metric      | `ainet_up` |
| Panel type  | Stat (green/red) |
| Normal      | `1` |
| Anomaly     | `0` — the backend process is down or unreachable by Prometheus |

**Interpretation:** This is a simple liveness indicator. A value of `0` means Prometheus cannot scrape the `/metrics` endpoint. First check whether the backend container is running (`docker compose ps`). If the container is up, the scrape target may be misconfigured — inspect `prometheus.yml` and confirm the backend host and port.

---

#### Uptime

| Attribute   | Value |
|-------------|-------|
| Metric      | `ainet_process_uptime_seconds` |
| Panel type  | Stat |
| Normal      | Steadily increasing; > 86 400 s (24 h) in production |
| Anomaly     | Resets to near-zero — a process restart occurred |

**Interpretation:** Unexpected resets indicate crashes or deliberate restarts. Cross-reference with the deployment log and Loki for `level=error` entries near the restart time.

---

#### Active Agents

| Attribute   | Value |
|-------------|-------|
| Metric      | `sum(ainet_agents_total)` |
| Panel type  | Stat |
| Normal      | ≥ 1 during operating hours; stable count between task runs |
| Anomaly     | Drops to 0 — no agents are registered or all are offline |

**Interpretation:** A drop to 0 blocks all task execution. See [§ 4.3 Agent Offline Investigation Flow](#43-agent-offline).

---

#### Total Tasks

| Attribute   | Value |
|-------------|-------|
| Metric      | `ainet_tasks_count` |
| Panel type  | Stat |
| Normal      | Monotonically increasing over time |
| Anomaly     | No growth for an extended period during expected usage; sudden large spike |

---

#### Heap Used (%)

| Attribute   | Value |
|-------------|-------|
| Metric      | `ainet_process_memory_heap_used_bytes / ainet_process_memory_heap_total_bytes * 100` |
| Panel type  | Gauge (0–100%) |
| Normal      | 40–75% under sustained load |
| Anomaly     | Consistently above 85% — risk of OOM kill; consistently below 20% — idle or under-utilised |

**Interpretation:** Rising heap usage over hours without a plateau is a memory-leak signal. Take a heap snapshot with `node --inspect` and compare allocations.

---

#### Load Average

| Attribute   | Value |
|-------------|-------|
| Metric      | `ainet_process_cpu_load_1m` |
| Panel type  | Stat |
| Normal      | Below the number of available vCPUs (e.g. < 2.0 on a 2-vCPU host) |
| Anomaly     | Sustained load > vCPU count — CPU saturation |

---

### 1.2 HTTP Traffic Row

#### HTTP Request Rate

| Attribute   | Value |
|-------------|-------|
| Metric      | `rate(ainet_http_requests_total[5m])` |
| Panel type  | Time series |
| Normal      | Smooth curve matching expected traffic; baseline depends on deployment size |
| Anomaly     | Sudden spike (possible DDoS or runaway client); sudden zero drop (service down or no traffic) |

---

#### HTTP Latency (p95 / p99)

| Attribute   | Value |
|-------------|-------|
| Metrics     | `histogram_quantile(0.95, rate(ainet_http_request_duration_milliseconds_bucket[5m]))` and `histogram_quantile(0.99, ...)` |
| Panel type  | Time series |
| Normal      | p95 < 300 ms; p99 < 800 ms |
| Anomaly     | p95 > 500 ms sustained — backend latency regression; p99 > 2 000 ms — tail latency spike, check Venice AI or database |

**Interpretation:** Sudden spikes on this panel often coincide with Venice AI timeouts. Correlate with the LLM latency panel (§ 1.3) and the Venice timeout alert (§ 2.5).

---

#### HTTP Error Rate

| Attribute   | Value |
|-------------|-------|
| Metrics     | `rate(ainet_http_client_errors_total[5m])` (4xx) and `rate(ainet_http_server_errors_total[5m])` (5xx) |
| Panel type  | Time series |
| Normal      | 4xx: < 1% of request rate; 5xx: < 0.1% |
| Anomaly     | 5xx > 1% — backend throwing unhandled errors; 4xx > 5% — client misuse or auth issues |

---

### 1.3 Task Pipeline Row

#### Tasks by Status

| Attribute   | Value |
|-------------|-------|
| Metrics     | `ainet_tasks_total{status="queued"}`, `{status="running"}`, `{status="completed"}`, `{status="failed"}` |
| Panel type  | Stat (four tiles) |
| Normal      | Queued and running counts are small transient values; completed grows over time; failed is low |
| Anomaly     | Growing queued count without matching running growth — processing is stalled; failed count climbing — systematic task failures |

---

#### LLM / Agent Latency (p95 / p50)

| Attribute   | Value |
|-------------|-------|
| Metrics     | `histogram_quantile(0.95, rate(ainet_llm_latency_milliseconds_bucket[5m]))` and `histogram_quantile(0.50, ...)` |
| Panel type  | Time series |
| Normal      | p50 < 2 000 ms; p95 < 8 000 ms |
| Anomaly     | p95 > 15 000 ms — Venice AI is timing out or under heavy load; see § 2.5 |

---

#### Active Agents by Status

| Attribute   | Value |
|-------------|-------|
| Metric      | `ainet_agents_total` (label: `status`) |
| Panel type  | Pie chart |
| Normal      | Majority of agents are `active` or `idle`; small share `offline` |
| Anomaly     | Large `offline` slice — agents have been health-checked out; check agent endpoints |

---

#### WebSocket Connections

| Attribute   | Value |
|-------------|-------|
| Metric      | `ainet_websocket_connections` |
| Panel type  | Stat |
| Normal      | Varies by active users; baseline 1–50 for small nodes, 50–500 for production |
| Anomaly     | Sudden drop to 0 — WebSocket server crashed or restarted; sustained climb with no plateau — leak |

---

### 1.4 Payments & Queue Row

#### Payment Amount (XLM)

| Attribute   | Value |
|-------------|-------|
| Metrics     | `ainet_payment_amount_xlm{status="locked"}`, `{status="released"}`, `{status="refunded"}` |
| Panel type  | Bar gauge |
| Normal      | Locked amount is small and transient; released amount grows with completed tasks; refunded amount is minimal |
| Anomaly     | Locked amount that never decreases — payments stuck in escrow (see § 4.2); large refunded amount — many tasks failing |

---

#### Payment Records

| Attribute   | Value |
|-------------|-------|
| Metrics     | `ainet_payments_total{status="locked"}`, `{status="released"}`, `{status="refunded"}` |
| Panel type  | Stat (count, not XLM amount) |
| Normal      | Locked + released counts grow together over time |
| Anomaly     | Locked count growing but released count flat — payment release pipeline broken |

---

#### Queue Jobs

| Attribute   | Value |
|-------------|-------|
| Metrics     | `ainet_queue_pending`, `ainet_queue_processing`, `rate(ainet_queue_completed_total[5m])`, `rate(ainet_queue_failed_total[5m])` |
| Panel type  | Stat |
| Normal      | Pending and processing are small; completed rate is positive; failed rate is near 0 |
| Anomaly     | Pending growing without processing growing — worker stalled; failed rate climbing — systematic job failures |

---

## 2. Alert Interpretation Guide

> For all alerts below, the on-call runbook is at [docs/DISASTER_RECOVERY_RUNBOOK.md](./DISASTER_RECOVERY_RUNBOOK.md). Check it for escalation contacts and incident templates.

### 2.1 High Error Rate

**Alert name:** `HighHTTPErrorRate`  
**Trigger condition:** `rate(ainet_http_server_errors_total[5m]) / rate(ainet_http_requests_total[5m]) > 0.01` (5xx rate > 1%)

**Plain-language meaning:** More than 1 in every 100 HTTP requests is returning an internal server error. This is above the acceptable threshold and usually indicates an unhandled exception, a database failure, or a downstream service outage.

**Common root causes:**
- Database connection exhausted (SQLite lock or connection pool saturation)
- Venice AI returning 500 / 503 responses that the backend is not catching
- An uncaught exception in a middleware or route handler
- Memory pressure causing request handlers to fail

**Initial investigation steps:**
1. Open the **HTTP Error Rate** panel on the AI-Net Platform SLIs dashboard.
2. Note the timestamp when the error rate crossed the threshold.
3. Query Loki for 5xx errors around that time (see § 5, LogQL query #1).
4. Check the **HTTP Latency** panel — if latency also spiked, the error is likely a timeout, not a logic bug.
5. Review `backend/logs/error.log` for stack traces.

**Escalation criteria:** Page on-call if the error rate exceeds 5% for more than 5 minutes, or if any payment-related endpoints are involved.

---

### 2.2 Payment Stuck

**Alert name:** `PaymentStuck`  
**Trigger condition:** `ainet_payment_amount_xlm{status="locked"} > 0` and the locked amount has not decreased for > 15 minutes during operating hours.

**Plain-language meaning:** XLM is locked in escrow for a task that has not completed or been refunded within the expected time window. This could mean the task execution stalled, the payment release transaction failed, or there is a contract-side error.

**Common root causes:**
- The coordinator's DAG execution stalled (all agents returned errors, no retry succeeded)
- Stellar Horizon API is unavailable or rate-limited, blocking the release transaction
- The `payment_escrow` contract invocation failed (gas limit, auth error, or contract bug)
- A network partition between the backend and Stellar RPC node

**Initial investigation steps:**
1. Open the **Payment Amount (XLM)** panel and identify the magnitude of stuck funds.
2. Query Loki for payment events on affected task IDs (see § 5, LogQL query #4).
3. Check the **Backend Up** panel and confirm the backend is healthy.
4. Verify Stellar Horizon is reachable: `curl $STELLAR_HORIZON_URL/health`.
5. If Horizon is healthy, inspect the task's DAG status in the database for the stuck payment's taskId.

**Escalation criteria:** Page on-call immediately if stuck amount > 100 XLM, or if the condition persists for > 30 minutes.

---

### 2.3 Agent Offline

**Alert name:** `AgentOffline`  
**Trigger condition:** `ainet_agents_total{status="offline"} > 0` for > 5 minutes.

**Plain-language meaning:** One or more registered agents have failed health checks and been marked offline. New tasks may be assigned to other agents, but capacity is reduced. If all agents are offline, task execution is completely blocked.

**Common root causes:**
- The agent process crashed (OOM kill, unhandled exception, or deployment)
- The agent endpoint is unreachable due to a network configuration change
- The agent failed to respond within the health-check timeout (overloaded)
- The agent was deregistered from the registry contract but not from the backend cache

**Initial investigation steps:**
1. Open the **Active Agents by Status** pie chart — confirm the offline count.
2. Query Loki for agent health-check failures (see § 5, LogQL query #2).
3. Attempt to reach the agent endpoint directly: `curl <agent-endpoint>/health`.
4. Check the agent process logs on the agent host.
5. If the agent responds to `curl` but is still marked offline in the dashboard, the backend cache may be stale — restart the backend registry sync.

**Escalation criteria:** Page on-call if all agents are offline (zero task capacity) for > 2 minutes, or if no agents have responded to health checks for > 10 minutes.

---

### 2.4 Horizon Latency Spike

**Alert name:** `HorizonLatencyHigh`  
**Trigger condition:** p95 Horizon response latency > 5 000 ms as observed by the backend.

**Plain-language meaning:** The Stellar Horizon API is responding slowly. Payment locking and releasing transactions will be delayed. Task completions that require on-chain writes will be queued.

**Common root causes:**
- Stellar network congestion or a protocol upgrade in progress
- The Horizon node is under-provisioned or performing heavy history ingestion
- Network latency between the backend host and the Horizon host
- TLS certificate renewal or proxy misconfiguration

**Initial investigation steps:**
1. Check the Stellar network status page for known incidents.
2. Measure Horizon latency directly: `time curl $STELLAR_HORIZON_URL/`.
3. If using a self-hosted Horizon, check its logs and resource usage.
4. If using the public Horizon, consider switching to the testnet backup or a commercial RPC provider.
5. Check the **HTTP Latency (p95)** panel — if it correlates exactly with the Horizon latency, the backend is correctly propagating the upstream delay.

**Escalation criteria:** Page on-call if Horizon latency exceeds 10 s p95 for more than 5 minutes, or if payment transactions are failing (not just slow).

---

### 2.5 Venice AI Timeout Rate

**Alert name:** `VeniceAITimeoutHigh`  
**Trigger condition:** `rate(ainet_llm_latency_milliseconds_bucket{le="10000"}[5m]) / rate(ainet_llm_latency_milliseconds_count[5m]) < 0.80` (less than 80% of LLM requests complete within 10 s).

**Plain-language meaning:** More than 20% of Venice AI (LLM) requests are taking longer than 10 seconds. Task completion will be slow; queued tasks may time out. The agent circuit breaker may start opening.

**Common root causes:**
- Venice AI is experiencing high load or a service degradation
- The Venice API key has hit its rate limit or daily quota
- Large prompt sizes are exceeding Venice's processing capacity
- Network latency or packet loss between the backend and the Venice API endpoint

**Initial investigation steps:**
1. Open the **LLM / Agent Latency** panel — confirm p95 is elevated.
2. Query Loki for Venice timeout log entries (see § 5, LogQL query #3).
3. Check the Venice AI status page for known incidents.
4. Inspect the daily quota usage in your Venice dashboard.
5. Review recent prompt sizes — unusually large prompts correlate with timeouts.

**Escalation criteria:** Page on-call if the timeout rate exceeds 50% for more than 10 minutes, or if the circuit breaker has opened and all LLM requests are being rejected.

---

## 3. KPI Baselines for a Healthy Production Node

The following values define "normal" for a well-provisioned production deployment. Use these as the reference when triaging alerts or preparing monthly reports.

| KPI | Target | Measurement |
|-----|--------|-------------|
| API request success rate | ≥ 99.5% (< 0.5% 5xx) | `1 - rate(ainet_http_server_errors_total[1h]) / rate(ainet_http_requests_total[1h])` |
| Agent task completion rate | ≥ 95% | `ainet_tasks_total{status="completed"} / ainet_tasks_count` |
| Payment release latency p50 | < 5 s | Time from task completion to Horizon transaction confirm |
| Payment release latency p95 | < 30 s | Includes Stellar ledger close time (avg ~5 s/ledger) |
| Coordinator DAG decomposition time p50 | < 200 ms | Time from task submission to first node dispatched |
| Coordinator DAG decomposition time p95 | < 1 000 ms | Includes queue round-trip |
| WebSocket connection count | 1–500 (varies with active users) | `ainet_websocket_connections` |

---

## 4. Anomaly Investigation Flows

### 4.1 High Error Rate

**Goal:** Narrow from "the error rate alert fired" to "this specific endpoint is returning 500 because of X".

1. **Confirm scope.** Open the **HTTP Error Rate** panel. Determine whether both 4xx and 5xx are elevated, or only one.

2. **Check recency.** Use Grafana's time range selector to pinpoint when the error rate began. Cross-reference with any recent deployments or configuration changes.

3. **Find the offending endpoint.** Run LogQL query #1 (§ 5) to list all recent server errors. Look for a repeated `path` field — a single endpoint causing most errors.

4. **Read the stack trace.** Filter Loki by the offending path and look for `"level":"error"` entries with a `stack` or `err` field. The stack trace identifies the failing code path.

5. **Check downstream services.** If the stack trace points to a database call, check SQLite for lock errors. If it points to Horizon, check Horizon availability. If it points to Venice, check the LLM latency panel.

6. **Reproduce and patch.** Once the root cause is identified, reproduce it in a local environment before pushing a fix.

7. **Verify recovery.** After deployment, confirm the error rate has returned below 0.5% on the HTTP Error Rate panel.

---

### 4.2 Payment Stuck

**Goal:** Determine whether a stuck payment is caused by a contract bug, a network issue, or a stalled task.

1. **Identify the stuck balance.** Open the **Payment Amount (XLM)** panel. Note the locked amount and whether it has been flat for > 15 minutes.

2. **Find the affected task.** Run LogQL query #4 (§ 5) to list payment events. Look for a `payment_locked` event without a matching `payment_released` event for the same `taskId`.

3. **Check the task DAG status.** Query the database:
   ```sql
   SELECT id, status, dagJson FROM tasks WHERE id = '<taskId>';
   ```
   If the DAG has nodes in `failed` state without a retry, the coordinator may have exhausted retries without triggering a refund.

4. **Check Horizon availability.** Run:
   ```bash
   curl $STELLAR_HORIZON_URL/health
   ```
   If Horizon is unreachable, the payment release transaction cannot be submitted. Wait for Horizon to recover — the payment release will be retried automatically on reconciliation (every 5 minutes).

5. **Check for contract errors.** If Horizon is healthy but the release transaction failed, inspect the Stellar transaction result code. Common codes:
   - `op_no_trust` — the destination account does not have a trustline for the asset.
   - `op_underfunded` — the escrow contract balance is insufficient (should not happen in normal operation).
   - `auth_failed` — the backend's signing key is incorrect or expired.

6. **Manual recovery.** If the transaction cannot be automatically retried, follow the manual recovery steps in [docs/DISASTER_RECOVERY_RUNBOOK.md](./DISASTER_RECOVERY_RUNBOOK.md#payment-recovery).

---

### 4.3 Agent Offline

**Goal:** Determine whether an agent is crashed, unregistered, or network-partitioned, and recover the appropriate way.

1. **Confirm the alert.** Open the **Active Agents by Status** pie chart. Note the number of offline agents and whether any are still active.

2. **Attempt direct health check.** For each offline agent, make a direct request:
   ```bash
   curl -v <agent-endpoint>/health
   ```
   - **Connection refused** → the agent process has crashed. Restart it on the agent host.
   - **Connection timeout** → network partition between the backend and the agent. Check firewalls, security groups, and routing.
   - **HTTP 200** → the agent is alive but the backend's health-check failed or the cache is stale.

3. **Scenario: agent crashed.**
   - SSH into the agent host and check the process: `ps aux | grep ainet-agent`.
   - Review the agent's logs for the crash reason: `journalctl -u ainet-agent -n 100`.
   - Restart the agent: `systemctl start ainet-agent`.
   - Wait up to 60 seconds for the backend health check to clear the offline flag.

4. **Scenario: agent unregistered.**
   - Check whether the agent is still in the registry contract: call `get_agent` on the `agent_registry` contract.
   - If unregistered, re-register the agent using the `register_agent` function and ensure the backend registry sync picks it up.

5. **Scenario: network partition.**
   - Verify that port 443/80 (or the agent's configured port) is open on the agent's firewall.
   - If running on a cloud provider, check security group rules and VPC routing.
   - After fixing the network, the backend health check will clear the offline flag within the next health-check cycle (default 60 s).

6. **Verify recovery.** The **Active Agents by Status** pie chart should show no offline agents within 2 minutes of the agent being healthy.

---

## 5. Log Querying with LogQL

All queries below target the `ai-net-backend` Loki label. Adjust the time range (`[1h]`, `[30m]`) as needed.

### Query 1: All Errors in the Last Hour

```logql
{job="ai-net-backend"} |= "level\":\"error\"" | json | line_format "{{.ts}} [{{.requestId}}] {{.path}} {{.msg}} {{.err}}"
```

**Use when:** The High Error Rate alert fires and you need to identify which endpoint is failing and what the error message is.

---

### Query 2: Agent Health-Check Failures

```logql
{job="ai-net-backend"} |= "AgentMarkedOffline" | json | line_format "{{.ts}} agent={{.agentId}} reason={{.reason}}"
```

**Use when:** The Agent Offline alert fires and you need to understand why agents were marked offline.

---

### Query 3: Venice AI Timeout Log Entries

```logql
{job="ai-net-backend"} |= "venice" |= "timeout" | json | line_format "{{.ts}} [{{.traceId}}] duration={{.durationMs}}ms model={{.model}}"
```

**Use when:** The Venice AI Timeout Rate alert fires and you need to see which requests are timing out and their durations.

---

### Query 4: All Payment Events for a Specific Task ID

```logql
{job="ai-net-backend"} |= "payment" | json | taskId="<YOUR_TASK_ID>" | line_format "{{.ts}} {{.type}} taskId={{.taskId}} amount={{.amount}} status={{.status}}"
```

**Use when:** A payment is stuck and you need a timeline of all payment events for the affected task. Replace `<YOUR_TASK_ID>` with the actual ID.

---

### Query 5: All Events for a Specific Trace/Correlation ID

```logql
{job="ai-net-backend"} | json | traceId="<YOUR_TRACE_ID>" | line_format "{{.ts}} [{{.spanId}}] {{.component}} {{.msg}}"
```

**Use when:** A user reports a failed request and provides a request/trace ID. This surfaces the full distributed trace across coordinator, dispatch, and payment layers for that specific request.

---

## 6. Performance Tuning and Scaling Thresholds

Use the following metric thresholds to decide when to scale horizontally, adjust rate limits, or tune configuration.

### API Latency — Add Backend Replicas

| Condition | Action |
|-----------|--------|
| p95 HTTP latency > 500 ms sustained for 5 min | Add backend replicas (or increase Node.js cluster workers) |
| p99 HTTP latency > 2 000 ms | Investigate before scaling — may be a downstream bottleneck (Horizon, Venice) not solved by more replicas |
| CPU load average > vCPU count for 10 min | Scale CPU; also check for runaway loops in the coordinator |

### Queue Depth — Tune Concurrency

| Condition | Action |
|-----------|--------|
| `ainet_queue_pending` > 100 and not draining | Increase `DEFAULT_CONCURRENCY` in coordinator, or add more worker processes |
| `ainet_queue_failed_total` rate rising | Investigate root cause before increasing concurrency (scaling failures is not a fix) |

### Venice AI — Reduce Quota or Increase Timeout

| Condition | Action |
|-----------|--------|
| Venice timeout rate > 20% | Reduce daily quota by 20% to avoid rate-limit bursts, or increase the per-request timeout |
| Venice timeout rate > 50% | Circuit breaker may open; consider a Venice API key rotation or fallback model |
| Average prompt length > 4 000 tokens | Truncate prompts or split into smaller sub-tasks to reduce per-request latency |

### Payment Throughput — Horizon Rate Limits

| Condition | Action |
|-----------|--------|
| Horizon latency p95 > 5 s | Switch to a faster Horizon provider or self-host a Horizon node closer to the backend |
| Payment release failures > 1% | Check for Stellar network congestion; consider increasing fee bump on transactions |

### WebSocket Connections — Reverse Proxy Tuning

| Condition | Action |
|-----------|--------|
| `ainet_websocket_connections` > 500 | Enable sticky sessions on the load balancer; tune `maxConnections` in the WebSocket server |
| Sudden WebSocket drop to 0 | Check reverse proxy timeout settings — many proxies close idle WebSocket connections after 60 s |

---

## 7. Monthly Metric Review Checklist

Perform this review at the start of each calendar month using Grafana's 30-day time range.

- [ ] **API success rate trend.** Is the monthly average above 99.5%? If it has trended down month-over-month, identify the period with the highest error rate and correlate with deployments.
- [ ] **Task completion rate trend.** Is the monthly average above 95%? A declining completion rate may indicate deteriorating agent quality or increasing task complexity.
- [ ] **Payment release latency trend.** Compare p50 and p95 this month vs last month. A rising p95 may indicate Horizon degradation or escrow contract inefficiencies.
- [ ] **LLM latency trend.** Has Venice AI p95 latency increased? This may signal that prompt sizes have grown or that the Venice plan needs upgrading.
- [ ] **Agent offline incidents.** Count the number of agent-offline events. More than 3 per month per agent warrants a reliability review of that agent's infrastructure.
- [ ] **Memory trend.** Plot `ainet_process_memory_heap_used_bytes` over the month. A slow upward trend without plateauing is a memory-leak indicator.
- [ ] **Queue failure rate.** Calculate `rate(ainet_queue_failed_total[30d]) / rate(ainet_queue_completed_total[30d])`. Anything above 2% needs investigation.
- [ ] **Payment stuck incidents.** How many payment-stuck alerts fired this month? More than 1 warrants reviewing the reconciliation service and retry logic.
- [ ] **On-call burden.** Count total pages this month per alert type. More than 5 pages for a single alert in one month indicates the threshold needs tuning or the root cause needs a permanent fix.
- [ ] **Capacity projection.** Based on the month's growth in `ainet_tasks_count` and `ainet_websocket_connections`, forecast when current infrastructure will reach its scaling thresholds and schedule provisioning accordingly.

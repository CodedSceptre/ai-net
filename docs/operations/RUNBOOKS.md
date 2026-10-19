# ai-net Operations Runbooks

> Reference guide for investigating and resolving alerts defined in `monitoring/alert-rules.yml`.

---

## Alert Routing Summary

| Severity | Channel | Escalation |
|---|---|---|
| **P1** | PagerDuty (immediate) | On-call engineer paged within 5 min |
| **P2** | Slack `#incidents` | On-call reviews within 30 min |
| **P3** | Slack `#ops-alerts` | Team reviews next business day |

---

## P1 Runbooks

### API Down

**Alert:** `ApiDown`
**Condition:** All backend API instances unreachable for > 1 min

**Immediate steps:**
1. Check ECS / Docker service status: `docker ps` or AWS ECS console.
2. Review recent deployment — did a bad release ship?  Roll back if needed.
3. Check error logs: `docker logs ai-net-backend --tail 200`.
4. Verify DB connectivity: `curl http://localhost:3000/health`.
5. If DB is the cause, see [DB Pool Exhausted](#db-pool-exhausted).

**Escalation:** If not resolved within 15 min, escalate to platform lead.

---

### Payment Failure Rate

**Alert:** `PaymentFailureRateHigh`
**Condition:** >5% of payment operations failing over 5 min

**Immediate steps:**
1. Check Stellar network status: <https://stellarbeat.io/>.
2. Review payment logs for recurring error patterns.
3. Verify the coordinator's Stellar keypair has sufficient XLM balance.
4. Check the Horizon API endpoint (`STELLAR_HORIZON_URL`) is reachable.
5. If Stellar is degraded, consider enabling payment circuit breaker (feature flag).

---

### All Agents Offline

**Alert:** `AllAgentsOffline`
**Condition:** No agent heartbeats for > 2 min

**Immediate steps:**
1. Check agent container/process health: `docker ps | grep agent`.
2. Review heartbeat logs for the last known healthy time.
3. Verify the registry endpoint is reachable from agent containers.
4. Restart agents one at a time, monitoring heartbeat recovery.
5. Check network partitions between agent pods and the registry.

---

## P2 Runbooks

### DB Pool Exhausted

**Alert:** `DBPoolExhausted`
**Condition:** All DB connections in use for > 1 min

**Steps:**
1. Check current DB pool size: review `poolConfig.ts` or env `DB_POOL_SIZE`.
2. Identify long-running queries: check tracing dashboard for slow spans.
3. If traffic spike, consider temporary pool expansion (env var restart).
4. Look for connection leaks — queries not releasing connections after completion.

---

### Task DLQ

**Alert:** `TaskDLQDepthHigh`
**Condition:** DLQ depth > 10 for > 5 min

**Steps:**
1. Inspect the DLQ: `curl http://localhost:3000/api/admin/dlq | jq`.
2. Identify the common error pattern in failed tasks.
3. If caused by a bug, deploy fix then re-drive DLQ items.
4. If caused by malformed payloads, discard and notify submitting clients.

---

### High Latency

**Alert:** `P99LatencyHigh`
**Condition:** p99 latency > 2 s for > 5 min

**Steps:**
1. Check Grafana latency dashboard for which endpoint(s) are slow.
2. Review slow DB queries via tracing spans.
3. Check Venice AI response times — upstream LLM slowness propagates.
4. Confirm agent registry cache hit rate is healthy (see cache dashboard).
5. Consider scaling up API instances if load-driven.

---

## P3 Runbooks

### Disk Usage

**Alert:** `DiskUsageHigh`
**Condition:** Disk usage > 80% for > 10 min

**Steps:**
1. Identify large directories: `du -sh /* | sort -hr | head -20`.
2. Prune old Docker images: `docker image prune -a`.
3. Archive or delete old log files in `/var/log`.
4. Consider increasing volume size if growth is ongoing.

---

### Cache Miss Rate

**Alert:** `CacheMissRateHigh`
**Condition:** Registry cache miss rate > 50% for > 10 min

**Steps:**
1. Check if cache was recently cleared (deployment, restart).
2. Review cache TTL settings in `cache/registry.ts`.
3. If traffic is much higher than usual, consider increasing cache capacity.
4. Cache will self-warm under normal traffic — monitor for 10–15 min before escalating.

---

## Alert Routing Configuration

Alert routing is configured in:
- `monitoring/grafana/provisioning/alerting/contact-points.yml` — contact point definitions
- `monitoring/grafana/provisioning/alerting/notification-policies.yml` — routing rules
- `monitoring/alert-rules.yml` — Prometheus alerting rule definitions

Secrets are stored in AWS Secrets Manager:
- `ai-net/{env}/pagerduty-integration-key`
- `ai-net/{env}/slack-webhook-incidents`
- `ai-net/{env}/slack-webhook-ops-alerts`

See `infra/modules/secrets/main.tf` for the Terraform definition.

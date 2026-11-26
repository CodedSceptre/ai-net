# 🚨 ai-net Disaster Recovery Runbook

**Resolves [#639](https://github.com/CodedSceptre/ai-net/issues/639)**

This is the **active-incident runbook** for on-call engineers responding to production outages in ai-net. It complements [`DATABASE_BACKUP_DR.md`](./DATABASE_BACKUP_DR.md), which documents how backups are _created_; this document covers how to _recover_ from them and from every other single point of failure in the stack.

> **Read this first:** During a P0/P1 incident, assign an Incident Commander (IC) before executing any recovery step. No destructive command (restore, force refund, redeploy, data deletion) may be executed without a second engineer reviewing the command and the IC announcing it in `#incidents`.

---

## Table of Contents

| #   | Section                                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | [How to use this runbook](#0-how-to-use-this-runbook)                                                                                    |
| A   | [Scenario A — Database corruption recovery from S3 backup](#scenario-a--database-corruption-recovery-from-s3-backup)                     |
| B   | [Scenario B — All agents offline](#scenario-b--all-agents-offline)                                                                       |
| C   | [Scenario C — Stellar Horizon unreachable fallback](#scenario-c--stellar-horizon-unreachable-fallback)                                   |
| D   | [Scenario D — Venice AI unavailable degraded mode](#scenario-d--venice-ai-unavailable-degraded-mode)                                     |
| E   | [Scenario E — Payment escrow stuck recovery via admin contract call](#scenario-e--payment-escrow-stuck-recovery-via-admin-contract-call) |
| F   | [Scenario F — Full cluster failure recovery sequence](#scenario-f--full-cluster-failure-recovery-sequence)                               |
| 7   | [Estimated RTO per scenario](#7-estimated-rto-per-scenario)                                                                              |
| 8   | [On-call escalation contact matrix](#8-on-call-escalation-contact-matrix)                                                                |
| 9   | [Post-incident review checklist](#9-post-incident-review-checklist)                                                                      |
| 10  | [Review & sign-off](#10-review--sign-off)                                                                                                |

---

## 0. How to use this runbook

### Severity and response expectations

| Severity | Definition                                                                                      | Page                                      | First update |
| -------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------ |
| **P0**   | Full cluster down, funds at risk, or data loss in progress                                      | IC + all relevant role owners immediately | ≤ 5 min      |
| **P1**   | One dependency unavailable; core functionality degraded (e.g. all agents offline, Horizon down) | IC + owning role owner                    | ≤ 15 min     |
| **P2**   | Partial degradation with a working fallback                                                     | Owning team in business hours             | ≤ 1 h        |

### Standard incident commands

Every scenario below assumes these variables are exported in the IC's shell. Retrieve secrets from **AWS Secrets Manager** (or GitHub Actions secrets in CI) — never from source files or `.env` files committed to git.

```bash
export ENVIRONMENT=production
export DB_DIR=/app/data                       # runtime SQLite data directory
export S3_BACKUP_BUCKET=ai-net-production-backups
export REDIS_URL=redis://<redis-host>:6379
export STELLAR_NETWORK=mainnet                # or testnet
export STELLAR_HORIZON_URL=https://<horizon-provider>
export SOROBAN_RPC_URL=https://<soroban-rpc-provider>
export PAYMENT_ESCROW_CONTRACT_ID=C...        # from smart-contracts/deployments/<network>.json
export ADMIN_API_KEY="<from AWS Secrets Manager>"
export API_BASE=https://api.<your-domain>.com # local equivalent: http://localhost:3000
```

### Health and diagnostic endpoints (implemented)

| Endpoint                             | Purpose                    | Interpretation                                                                                                                     |
| ------------------------------------ | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health` or `/health/live`      | Liveness                   | `200 {"status":"ok"}`; `503 {"status":"draining"}` during shutdown                                                                 |
| `GET /health/ready`                  | Readiness / traffic gating | `200` only when tasks, payments, queue, Venice, Horizon and WS are not in `error`                                                  |
| `GET /health/deep`                   | Dependency diagnostic      | Always HTTP `200`; inspect body: `{"status":"ok"\|"degraded","services":{"venice":...,"horizon":...}}`                             |
| `GET /health/dashboard?refresh=true` | Admin metrics dashboard    | Requires `X-Admin-API-Key`; forces cache bypass                                                                                    |
| `GET /metrics`                       | Prometheus scrape          | Key signals: `ainet_venice_circuit_breaker_state`, `ainet_stellar_rpc_latency_seconds`, `ainet_active_agents`, `ainet_tasks_total` |

> **Note:** `/health/deep` reports degradation in the **response body**, not the HTTP status code. A `200` does not mean healthy — always read `body.status` and `body.services.*`.

### Global degraded-mode switch

ai-net implements one global operational switch, backed by `AI_NET_READ_ONLY` at boot and mutable at runtime:

```bash
# Read current state
curl -s -H "X-Admin-API-Key: $ADMIN_API_KEY" "$API_BASE/api/admin/read-only"

# Enable degraded mode (blocks POST/PUT/PATCH/DELETE outside /api/admin and /api/reconciliation)
curl -s -X PUT -H "X-Admin-API-Key: $ADMIN_API_KEY" -H 'Content-Type: application/json' \
  -d '{"enabled":true,"reason":"INC-1234 Horizon unreachable"}' \
  "$API_BASE/api/admin/read-only"

# Disable after recovery
curl -s -X PUT -H "X-Admin-API-Key: $ADMIN_API_KEY" -H 'Content-Type: application/json' \
  -d '{"enabled":false,"reason":"INC-1234 resolved"}' \
  "$API_BASE/api/admin/read-only"
```

State is **in-memory** and resets to the `AI_NET_READ_ONLY` boot value on process restart, so re-apply it after any backend restart. `/api/admin` and `/api/reconciliation` remain exempt so recovery tooling stays usable.

### Dependency map and bring-up/shutdown order

```
Frontend  →  Backend (API + coordinator + in-process agents)  →  Redis  →  Database
                            ↕                    ↕
                      Venice AI            Stellar Horizon / Soroban RPC
```

- **Shutdown (protect data):** Frontend → Agents → Backend (drain) → Redis → Database.
- **Bring-up (restore dependencies first):** Database → Redis → Backend → Agents → Frontend.

---

## Scenario A — Database corruption recovery from S3 backup

**Estimated RTO: 45–90 minutes** (snapshot download + verify + restore + smoke tests; 4-hour ceiling per [`DATABASE_BACKUP_DR.md`](./DATABASE_BACKUP_DR.md))

### Symptoms

- `GET /health/ready` returns `500` with `"tasks":"error"` or `"payments":"error"`.
- Backend logs show `SQLITE_CORRUPT`, `database disk image is malformed`, `SQLITE_BUSY` storms, or unreadable pages.
- `PRAGMA integrity_check;` returns anything other than `ok`.
- Task/payment queries return partial data or throw; dashboards show sudden row-count drops.
- Backup verification job reports a failed integrity check.

### Diagnosis

```bash
# 1. Which databases are affected? (runtime = SQLite: payments, agents, tasks, jobs)
for DB in payments agents tasks jobs; do
  printf '%s: ' "$DB"
  sqlite3 "${DB_DIR}/${DB}.db" "PRAGMA integrity_check;" | head -3
done

# 2. Confirm sidecar WAL state (do not delete yet — see recovery step 5)
ls -l "${DB_DIR}"/*.db "${DB_DIR}"/*.db-wal "${DB_DIR}"/*.db-shm 2>/dev/null

# 3. Confirm the most recent verified S3 snapshot and its manifest
aws s3 ls "s3://${S3_BACKUP_BUCKET}/backups/sqlite/" | sort | tail -5

# 4. Check whether the corruption is host/filesystem-level vs. logical
dmesg -T | grep -iE 'I/O error|EXT4-fs|nvme' | tail -20 || true
df -h "${DB_DIR}"
```

**Decision tree**

| Finding                                      | Action                                                                                  |
| -------------------------------------------- | --------------------------------------------------------------------------------------- |
| `integrity_check` fails, disk errors present | Treat as filesystem failure — restore to a **different** host/volume first (Scenario F) |
| `integrity_check` fails, only one DB         | Restore only that DB from S3; leave the others untouched                                |
| Rows missing but integrity OK                | Logical corruption — consider RDS/Aurora PITR or S3 versioning before overwriting       |
| Backup checksum fails                        | Move to the previous snapshot and note the increased RPO                                |

> **Platform note:** The implemented backup path (`backend/scripts/backup-databases.sh`) backs up **SQLite** databases to S3. Terraform also provisions a Multi-AZ **RDS PostgreSQL 16.3** instance (`ai-net-<env>-postgres`, 7-day backup retention), but the application does not currently wire it into backup tooling. Use the RDS snapshot/PITR path only if your deployment actually uses PostgreSQL.

### Step-by-Step Recovery

**Step 1 — Freeze dependents (≈3 min).** Stop writers in reverse bring-up order so no new state is written during restore:

```bash
# Docker Compose
docker compose stop frontend
docker compose stop backend          # drains in-flight work; honors GRACEFUL_SHUTDOWN_TIMEOUT (30s)
docker compose stop redis

# Systemd equivalents
sudo systemctl stop ainet-frontend
sudo systemctl stop ainet-node
sudo systemctl stop redis
```

Confirm no process holds the DB files: `lsof "${DB_DIR}"/*.db` should return nothing.

**Step 2 — Preserve evidence (≈2 min).** Before overwriting anything, copy the corrupt files and WAL sidecars to an incident folder:

```bash
INC_ID=INC-1234
mkdir -p "/var/incidents/${INC_ID}/db-before"
cp -av "${DB_DIR}"/*.db* "/var/incidents/${INC_ID}/db-before/"
```

**Step 3 — Identify and download the latest verified snapshot (≈10 min).** Follow [`DATABASE_BACKUP_DR.md` § Steps 1–3](./DATABASE_BACKUP_DR.md#disaster-recovery-procedure). In short:

```bash
TIMESTAMP=$(aws s3 ls "s3://${S3_BACKUP_BUCKET}/backups/sqlite/" \
  | awk '{print $2}' | tr -d '/' | grep -E '^[0-9]{8}T[0-9]{6}Z$' | sort | tail -1)

aws s3 cp "s3://${S3_BACKUP_BUCKET}/backups/sqlite/${TIMESTAMP}/manifest.json" ./manifest.json

for DB in payments agents tasks; do
  aws s3 cp "s3://${S3_BACKUP_BUCKET}/backups/sqlite/${TIMESTAMP}/${TIMESTAMP}-${DB}.db.gz" \
    "./${TIMESTAMP}-${DB}.db.gz"
  EXPECTED=$(jq -r ".files[] | select(.database==\"${DB}.db\") | .sha256" manifest.json)
  ACTUAL=$(sha256sum "${TIMESTAMP}-${DB}.db.gz" | awk '{print $1}')
  [[ "$EXPECTED" == "$ACTUAL" ]] || { echo "CHECKSUM MISMATCH — abort"; exit 1; }
done
```

**Step 4 — Restore the snapshot (≈5 min):**

```bash
for DB in payments agents tasks; do
  gunzip -c "${TIMESTAMP}-${DB}.db.gz" > "${DB_DIR}/${DB}.db"
  chown ainet:ainet "${DB_DIR}/${DB}.db"
  chmod 640 "${DB_DIR}/${DB}.db"
done
```

**Step 5 — Replay WAL if applicable (≈5 min).** The `sqlite3 .backup` format used by our script is already consistent and checkpointed, so a snapshot restore **does not** require WAL replay. Two cases:

- **Using the S3 `.backup` snapshot (standard):** remove stale sidecars from the corrupted instance so SQLite rebuilds them cleanly on first open:
  ```bash
  rm -f "${DB_DIR}"/*.db-wal "${DB_DIR}"/*.db-shm
  ```
- **Using a base DB + archived WAL segment (advanced):** place the base file and its matching `-wal` file in the same directory, open once to let SQLite replay automatically, then checkpoint:

  ```bash
  sqlite3 "${DB_DIR}/payments.db" "PRAGMA wal_checkpoint(TRUNCATE); PRAGMA integrity_check;"
  ```

  Never mix a restored base DB with a WAL file from a _different_ snapshot — that can silently corrupt data.

- **RDS PostgreSQL PITR (if applicable):** restore the automated snapshot or use PITR to a new instance, verify with `pg_isready` and a row-count check, then repoint `DATABASE_URL` and run `npm --prefix backend run db:migrate`.

**Step 6 — Verify integrity before restarting (≈5 min).**

```bash
for DB in payments agents tasks; do
  echo -n "${DB}: "
  sqlite3 "${DB_DIR}/${DB}.db" "PRAGMA integrity_check;"
  sqlite3 "${DB_DIR}/${DB}.db" "SELECT COUNT(*) FROM sqlite_master WHERE type='table';"
done
npm --prefix backend run db:migrate    # confirm schema version matches the snapshot
```

**Step 7 — Restart in dependency order (≈5 min).** Database → Redis → Backend → Agents → Frontend:

```bash
docker compose up -d redis
docker compose up -d backend
docker compose up -d frontend
```

Agents are in-process and register automatically at backend startup (`initializeAgents()` → `register()` → `startHeartbeat()`). If any remain offline, apply Scenario B.

### Verification

```bash
curl -fsS "$API_BASE/health" | jq '.status == "ok"'
curl -fsS "$API_BASE/health/ready" | jq -e '.status == "ok" and .checks.tasks == "ok" and .checks.payments == "ok"'
curl -fsS "$API_BASE/api/agents" | jq 'length > 0'
curl -fsS "$API_BASE/api/tasks"  | jq 'length >= 0'
```

- Record restored row counts and compare with pre-incident dashboard values.
- Confirm no `locked` payment is older than the reconciliation threshold.
- Confirm the backup that was used, its timestamp, and the checksum in the incident ticket.
- Keep the IC in `#incidents` until one full heartbeat interval (30s default) passes with all agents `online`.

---

## Scenario B — All agents offline

**Estimated RTO: 10–30 minutes** (restart and re-registration; longer if a bad deployment must be rolled back)

### Symptoms

- Heartbeat monitor / Prometheus alert: `ainet_active_agents == 0`.
- `GET /api/agents` returns an empty list or every entry has `status: "offline"`.
- Tasks stay `queued`/`running` with no DAG events; WebSocket streams are silent.
- Backend logs: `failed to register agent`, heartbeat `ECONNREFUSED`, or agent workers crash-looping.

### Diagnosis

```bash
# 1. Is it really all agents, or just stale rows?
sqlite3 "${DB_DIR}/agents.db" \
  "SELECT id, status, lastSeenAt, last_seen_at FROM agents ORDER BY lastSeenAt DESC LIMIT 20;"

# 2. Are agents registered in-process at all?
curl -fsS "$API_BASE/api/agents" | jq '[.[] | {id, status, lastSeenAt}]'

# 3. Classify root cause from logs and resource state
journalctl -u ainet-node --since '15 min ago' | grep -iE 'oom|killed process|register agent|heartbeat|ECONNREFUSED' | tail -40
docker compose logs --since 15m backend 2>/dev/null | grep -iE 'oom|error|register' | tail -40
free -h; df -h; kubectl get pods 2>/dev/null | grep -iE 'agent|backend' || true
```

| Root cause                    | Evidence                                                          | Recovery path                                           |
| ----------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------- |
| **OOM / resource exhaustion** | `Killed process`, `OOMKilled`, memory ≥ 95%                       | Free memory, raise limits, then restart agents (path 1) |
| **Network partition**         | Heartbeats fail but process alive; backend unreachable from agent | Restore network/route, then restart agents (path 1)     |
| **Bad deployment**            | Errors start exactly at deploy time; new image digest             | Roll back deployment, then restart agents (path 2)      |
| **Crash loop**                | Container restarts repeatedly; `register()` throws                | Fix config/secret, then restart agents (path 1)         |
| **Stale accounting only**     | Agents reachable, tasks executing, rows `offline`                 | Synchronize registry, no restart needed (path 3)        |

### Step-by-Step Recovery

**Path 1 — Restart agents (OOM, partition, crash loop):**

1. Stop new task intake so nothing is dispatched to a dead fleet: enable read-only mode (see [§0](#global-degraded-mode-switch)) or stop the frontend.
2. Relieve the root cause: free memory, restore networking, or fix the bad config value.
3. Restart in dependency order — backend first (it owns the coordinator and in-process agents), then frontend:
   ```bash
   docker compose restart backend
   # Systemd: sudo systemctl restart ainet-node
   ```
4. Backend startup calls `initializeAgents()`, which registers agents and starts heartbeats (`HEARTBEAT_INTERVAL_MS`, default 30s). Wait two intervals.
5. If using external agent workers, restart them **after** the backend is healthy so their heartbeats land on a ready API.
6. Lift read-only mode once verification passes.

**Path 2 — Roll back a bad deployment:**

1. Identify the last known-good image/tag from the deploy log.
2. Redeploy it: `aws ecs update-service --cluster ai-net-production --service ai-net-production-backend --force-new-deployment` (or `git revert` + CI deploy for Compose).
3. Wait for `aws ecs wait services-stable --cluster ai-net-production --services ai-net-production-backend`.
4. Then follow Path 1 steps 4–6.

**Path 3 — Re-registration / registry sync (no restart):**

1. Trigger agent registry synchronization (runs at startup via `startAgentSync()`) by restarting the backend as in Path 1 step 3.
2. If external agents were deregistered, re-run their registration flow so they appear in `GET /api/agents` and resume heartbeats.
3. Do **not** delete offline rows manually — `deleteOfflineAgents()` uses `AGENT_OFFLINE_DELETE_HOURS` (default 24) and is not on an active scheduler.

### Verification

```bash
# 1. Agents registered
curl -fsS "$API_BASE/api/agents" | jq 'length > 0'
# 2. All online with fresh lastSeenAt
sqlite3 "${DB_DIR}/agents.db" "SELECT COUNT(*) FROM agents WHERE status='online';"
curl -fsS "$API_BASE/health/ready" | jq '.checks'
# 3. Heartbeats are moving (sample twice, >30s apart)
curl -fsS "$API_BASE/api/agents" | jq '[.[].lastSeenAt]'
sleep 35
curl -fsS "$API_BASE/api/agents" | jq '[.[].lastSeenAt]'
# 4. Agents accept a task (use a small test prompt and low budget)
curl -fsS -X POST "$API_BASE/api/tasks" -H 'Content-Type: application/json' \
  -d '{"prompt":"ping availability check","budgetStroops":1000000}' | jq '.id'
```

Confirm `ainet_active_agents` returns to its pre-incident baseline and the test task emits DAG events to the WebSocket stream.

---

## Scenario C — Stellar Horizon unreachable fallback

**Estimated RTO: 15–45 minutes** (endpoint failover + config propagation; longer if a provider must be provisioned)

### Symptoms

- `GET /health/deep` → `{"status":"degraded","services":{"horizon":"unreachable"}}`.
- `GET /health/ready` → `500` with `"checks":{"horizon":"error"}`.
- API errors with code `STELLAR_HORIZON_UNAVAILABLE` and HTTP 503; logs show `Stellar Horizon unavailable after 5 attempts`.
- Horizon HTTP 429/503/504 or `TIMEOUT` responses; `ainet_stellar_rpc_latency_seconds` spikes.
- Payment submissions fail with `tx_too_late` and sequence-conflict rebuilds exhaust the 3-retry budget.

### Diagnosis

```bash
# 1. Confirm dependency status
curl -fsS "$API_BASE/health/deep" | jq '.services.horizon, .status'
curl -sS -o /dev/null -w '%{http_code}\n' "$API_BASE/health/ready"

# 2. Probe the configured endpoint directly (5s timeout mirrors the app probe)
time curl -fsS --max-time 5 "$STELLAR_HORIZON_URL" | jq '.core_latest_ledger' 2>/dev/null || echo "primary unreachable"

# 3. Probe the backup endpoint before switching
time curl -fsS --max-time 5 "$BACKUP_HORIZON_URL" | jq '.core_latest_ledger' 2>/dev/null || echo "backup unreachable"

# 4. Check for rate limiting vs. outage
curl -sSI --max-time 5 "$STELLAR_HORIZON_URL" | grep -iE 'HTTP/|x-ratelimit|retry-after'
```

**Important:** the backend has **one** configured Horizon URL (`STELLAR_HORIZON_URL`, legacy alias `STELLAR_HORIZON`). There is no built-in secondary URL or automatic Horizon-level degraded-mode switch. Failover is an operator action; the built-in resilience is 5 retry attempts with exponential backoff and an optional Redis-backed sequence lock.

### Step-by-Step Recovery

**Step 1 — Enter degraded mode (≈1 min).** Block new mutations while preserving reads and admin tooling:

```bash
curl -s -X PUT -H "X-Admin-API-Key: $ADMIN_API_KEY" -H 'Content-Type: application/json' \
  -d '{"enabled":true,"reason":"INC-1234 Horizon unreachable"}' \
  "$API_BASE/api/admin/read-only"
```

**Step 2 — Verify degraded-mode behaviour (≈2 min).**

- Reads (`GET /api/tasks`, `/api/agents`, `/health/deep`) still work.
- New task submissions (`POST /api/tasks`) return `503 {"error":"READ_ONLY", ...}`.
- `/api/admin` and `/api/reconciliation` remain callable for recovery work.
- Communicate status to users via the status page and `#incidents`: "Task creation paused — Stellar settlement dependency unavailable. Existing tasks and history are readable."

**Step 3 — Switch to the backup Horizon endpoint (≈5–15 min).** Set the URL to a verified provider (dedicated RPC provider or self-hosted Horizon) and propagate it:

```bash
export BACKUP_HORIZON_URL=https://horizon-backup.<provider>.com

# ECS: update the task-definition environment (via Terraform or AWS CLI), then redeploy
aws ecs update-service \
  --cluster ai-net-${ENVIRONMENT} \
  --service ai-net-${ENVIRONMENT}-backend \
  --force-new-deployment
aws ecs wait services-stable \
  --cluster ai-net-${ENVIRONMENT} \
  --services ai-net-${ENVIRONMENT}-backend

# Compose: edit STELLAR_HORIZON_URL in the env file, then
docker compose up -d --force-recreate backend
```

Remember: read-only state is in-memory — **re-apply read-only mode after the backend restarts** (Step 1). Also update `SOROBAN_RPC_URL` if the backup provider serves Soroban RPC from a different host. The frontend's `useWalletBalance` hook hard-codes the public testnet Horizon URL; if wallet balances are affected, note this in the incident ticket and ship a config change separately.

**Step 4 — Drain queued operations (≈5 min).** Once the backup endpoint is healthy:

```bash
curl -fsS "$API_BASE/health/deep" | jq '.services.horizon'   # expect "ok"
# Inspect any locked payments that were left unsettled
sqlite3 "${DB_DIR}/payments.db" \
  "SELECT taskId, nodeId, balanceId, status, txHash FROM payments WHERE status='locked';"
```

Allow the payment reconciliation worker to settle them; do not manually replay raw transactions unless directed by the Stellar Integration Engineer.

**Step 5 — Re-enable full mode (≈2 min).**

```bash
curl -s -X PUT -H "X-Admin-API-Key: $ADMIN_API_KEY" -H 'Content-Type: application/json' \
  -d '{"enabled":false,"reason":"INC-1234 Horizon restored"}' \
  "$API_BASE/api/admin/read-only"
```

### Verification

```bash
curl -fsS "$API_BASE/health/deep" | jq -e '.status == "ok" and .services.horizon == "ok"'
curl -fsS "$API_BASE/health/ready" | jq -e '.status == "ok"'
curl -fsS -o /dev/null -w '%{http_code}\n' -X POST "$API_BASE/api/tasks" \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"horizon recovery smoke test","budgetStroops":1000000}'   # expect 200/201
curl -fsS "$API_BASE/metrics" | grep ainet_stellar_rpc_latency_seconds
```

**Monitoring during the degraded period:** poll `/health/deep` every minute, watch `ainet_stellar_rpc_latency_seconds` and 429/503 rates, and post a status update to `#incidents` every 15 minutes. Keep read-only on until two consecutive successful Horizon probes are recorded.

---

## Scenario D — Venice AI unavailable degraded mode

**Estimated RTO: 15–30 minutes** (circuit-breaker handling + upstream recovery; immediate mitigation is fast)

### Symptoms

- `GET /health/deep` → `{"status":"degraded","services":{"venice":"unreachable"}}` (note: HTTP 401 from Venice is treated as `"ok"` by the probe, so an expired API key may **not** trigger this).
- `GET /health/ready` → `500` with `"checks":{"venice":"error"}`.
- Tasks fail fast with `CircuitOpenError`: code `llm_unavailable`, HTTP 503, `Retry-After: 30`, message "Venice AI is temporarily unavailable. Please retry in 30 seconds."
- Prometheus gauge `ainet_venice_circuit_breaker_state` = `1` (open) or `2` (half-open).
- Logs: `venice provider failed — failing over to next provider`, `venice all providers failed`, repeated 429/500/502/503/504 responses or timeouts.

### Diagnosis

```bash
curl -fsS "$API_BASE/health/deep" | jq '.services.venice, .status'
curl -fsS "$API_BASE/metrics" | grep -E 'ainet_venice_circuit_breaker_state|ainet_tasks_total'
curl -fsS --max-time 10 -H "Authorization: Bearer $VENICE_API_KEY" \
  https://api.venice.ai/api/v1/models | jq 'has("data")' || echo "Venice unreachable or key invalid"
journalctl -u ainet-node --since '15 min ago' \
  | grep -iE 'venice|circuit|llm_unavailable' | tail -40
```

**Circuit-breaker facts (from `backend/src/services/veniceCircuitBreaker.ts`)**

| Parameter                   | Default                                    |
| --------------------------- | ------------------------------------------ |
| Failure threshold           | 5 failures                                 |
| Failure window              | 60,000 ms                                  |
| Open duration               | 30,000 ms                                  |
| Half-open success threshold | 2 successes                                |
| States                      | `CLOSED` → `OPEN` → `HALF_OPEN` → `CLOSED` |
| Per-provider retry delays   | 1,000 / 2,000 / 4,000 ms with ±20% jitter  |

The breaker is **in-memory and per-client instance**; there is **no admin HTTP endpoint** to force it open or closed. The supported operator controls are the global read-only switch and a process restart. When the breaker is `OPEN`, `assertClosed()` throws **before** the cache lookup, so even cached responses are not served — plan user messaging accordingly.

### Step-by-Step Recovery

**Step 1 — Activate manual degraded mode if auto-tripping failed (≈2 min).** If the breaker stayed `CLOSED` while Venice is clearly down (e.g. slow hangs below the failure threshold), stop sending work upstream:

```bash
curl -s -X PUT -H "X-Admin-API-Key: $ADMIN_API_KEY" -H 'Content-Type: application/json' \
  -d '{"enabled":true,"reason":"INC-1234 Venice AI unavailable"}' \
  "$API_BASE/api/admin/read-only"
```

For a hard circuit reset (e.g. breaker stuck `HALF_OPEN` flapping), restart the backend **after** confirming the upstream is healthy; that reconstructs all client breakers in `CLOSED` state. Re-apply read-only mode after the restart if the upstream is still down.

**Step 2 — Communicate degraded status to users (≈3 min).** Post to the status page and `#incidents`:

> **Degraded performance — AI inference temporarily unavailable.**
> Task creation and new inference are paused. Existing tasks, results, wallet balances and on-chain payments remain available and readable. We are working with the upstream provider and will update within 15 minutes.

**Step 3 — Partial functionality map.** Use this to answer "what still works?" during the incident:

| Capability                                     | Status during Venice outage                                                                  |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Read tasks, results, DAG event history         | ✅ Works                                                                                     |
| Wallet balances, Horizon reads                 | ✅ Works                                                                                     |
| Agent registry, heartbeats, discovery          | ✅ Works                                                                                     |
| Payment settlement / claimable balances        | ✅ Works                                                                                     |
| Serving **cached** Venice responses            | ❌ Blocked while breaker is `OPEN` (`assertClosed()` precedes cache lookup)                  |
| New inference / new task execution             | ❌ Unavailable                                                                               |
| Stale-cache graceful degradation               | ⚠️ Only on hard upstream failure with breaker `CLOSED`; not available once breaker is `OPEN` |
| Admin endpoints (`/api/admin`, reconciliation) | ✅ Work (read-only exempt)                                                                   |

**Step 4 — Handle stuck tasks (≈5 min).** Tasks that were `running` when Venice failed remain in the queue. Leave them queued until the breaker closes; do not refund unless the task has exceeded the task SLA ×3 policy (see Scenario E). Verify `VENICE_API_KEY` is valid and not the cause — an expired key can appear as HTTP 401 and be misreported as `"ok"` by the deep probe.

**Step 5 — Recover when Venice returns (≈5 min).**

1. Confirm the upstream directly (`GET https://api.venice.ai/api/v1/models` returns `200`).
2. The breaker transitions to `HALF_OPEN` after the 30s open duration and closes after 2 successful calls — no manual reset is required.
3. Process one low-cost smoke task, then lift read-only mode.
4. If the provider requires failover, rotate `VENICE_API_KEY` using [`NODE_OPERATORS_GUIDE.md` §13.3](./NODE_OPERATORS_GUIDE.md#133-rotating-venice-ai-api-key) and restart the backend to pick up the new value.

### Verification

```bash
curl -fsS "$API_BASE/health/deep" | jq -e '.status == "ok" and .services.venice == "ok"'
curl -fsS "$API_BASE/health/ready" | jq -e '.status == "ok"'
curl -fsS "$API_BASE/metrics" | grep 'ainet_venice_circuit_breaker_state 0'   # CLOSED
curl -fsS -X POST "$API_BASE/api/tasks" -H 'Content-Type: application/json' \
  -d '{"prompt":"venice recovery smoke test","budgetStroops":1000000}' | jq '.id'
```

Confirm the smoke task reaches `completed` and no new `llm_unavailable` errors appear for 5 minutes.

---

## Scenario E — Payment escrow stuck recovery via admin contract call

**Estimated RTO: 30–60 minutes** (diagnosis + dual-engineer approval + on-chain call + governance log; 48h governance timelock may apply)

> ⚠️ **Funds-safety warning:** This scenario moves or reverses value. Execute only with an explicit IC decision, a second engineer co-reviewing every command, and governance logging. Never guess the task identifier.

### Naming and ABI note (read before invoking)

The operation on-call engineers call "**force release**" / "**force refund**" is implemented in the deployed `payment_escrow` contract as **`release_funds`** and **`refund_funds`**. There is **no contract function literally named `force_release` or `force_refund`** in this repository, and no generic admin override. Do not use invented names such as `expire_and_return`, `get_escrow_status`, `release_escrow`, or `refund_escrow` — older docs mention them but they are **not** in the compiled ABI.

**Canonical contract** (`smart-contracts/contracts/payment_escrow/src/lib.rs`) — this is the workspace contract used by CI:

| Operation         | Exact signature                                        | Parameter format                                                    | Authorization                                                                               |
| ----------------- | ------------------------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Read state        | `get_escrow(env, task_id: Symbol, node_id: Symbol)`    | Two Soroban `Symbol` strings, e.g. `task_xK9mPqRvLz2w` and `node_1` | Permissionless                                                                              |
| **Force release** | `release_funds(env, task_id: Symbol, node_id: Symbol)` | Two `Symbol` strings                                                | **Coordinator** `require_auth()`; only before `expires_at` (`locked_at + 604800s` = 7 days) |
| **Force refund**  | `refund_funds(env, task_id: Symbol, node_id: Symbol)`  | Two `Symbol` strings                                                | **Coordinator** `require_auth()` before expiry; **permissionless after expiry**             |

Key facts:

- The escrow key is the **`(task_id, node_id)` pair** — both are required. There is no single `escrow_id` in the contract.
- `release_funds` returns `EscrowExpired` (error code 5) after 7 days; after that point the only contract-level recovery is `refund_funds`.
- This contract **records state and emits events but does not move XLM**. Actual fund movement in the backend uses Stellar **claimable balances**.

**Real XLM refund path (backend):** `DELETE /api/admin/tasks/:id` with header `X-Admin-API-Key`. It force-cancels the task and calls `PaymentService.refund()` for every `locked` payment record, returning `refundTxHashes`. Use this when the goal is to return XLM to the requester.

### Symptoms

- `GET /health/deep` is healthy, but a task has produced no result and no escrow settlement.
- Payment record remains `status='locked'` well past the task SLA.
- User reports "paid but never delivered" with no matching `EscrowReleased`/`EscrowRefunded` event.
- `ainet_escrow_settlements_total` flatlines while tasks complete; reconciliation warnings in logs.

### Diagnosis

```bash
# 1. Stuck task heuristic: no settlement after 3 × task SLA (default SLA 30 min → 90 min).
#    "timeout × 3" is the on-call escalation threshold; the contract's hard expiry is 7 days.
sqlite3 "${DB_DIR}/tasks.db" \
  "SELECT id, status, walletPublicKey, createdAt, updatedAt FROM tasks \
   WHERE status NOT IN ('completed','failed','cancelled') \
     AND updatedAt < datetime('now','-90 minutes') ORDER BY createdAt ASC;"

# 2. Locked payments tied to that task
sqlite3 "${DB_DIR}/payments.db" \
  "SELECT taskId, nodeId, balanceId, status, amountStroops, txHash FROM payments \
   WHERE status='locked' AND taskId='task_xK9mPqRvLz2w';"

# 3. On-chain state (exact parameter format: two Symbols)
stellar contract invoke --id "$PAYMENT_ESCROW_CONTRACT_ID" \
  --network "$STELLAR_NETWORK" -- \
  get_escrow --task_id "task_xK9mPqRvLz2w" --node_id "node_1"

# 4. Is the escrow past the 7-day hard expiry? Check locked_at from the record above
#    and current ledger timestamp.
curl -fsS "$STELLAR_HORIZON_URL" | jq '.core_latest_ledger'
```

| Finding                                                           | Correct recovery                                            |
| ----------------------------------------------------------------- | ----------------------------------------------------------- |
| Task output exists, coordinator approval missing, **not expired** | `release_funds` (coordinator auth)                          |
| Task abandoned / failed, **not expired**                          | `refund_funds` (coordinator auth) or backend admin cancel   |
| Escrow **expired** (>7 days)                                      | `refund_funds` (permissionless) — `release_funds` will fail |
| Real XLM must be returned to user                                 | `DELETE /api/admin/tasks/:id` (claimable-balance refund)    |
| Dispute active (within 24h window)                                | Escalate to arbiter flow, **do not** force settle           |

### Step-by-Step Recovery

**Step 1 — Freeze and convene (≈5 min).** Enable read-only mode, open an incident ticket, and get IC + Smart Contracts Lead approval. Record `taskId`, `nodeId`, `balanceId`, amount in stroops, and the proposed outcome.

**Step 2 — Retrieve the coordinator/admin key securely (≈5 min).** Load `STELLAR_COORDINATOR_SECRET` from AWS Secrets Manager into the shell of the designated signer only. Never paste it into a ticket, terminal transcript, or source file.

```bash
export STELLAR_COORDINATOR_SECRET="$(aws secretsmanager get-secret-value \
  --secret-id "ai-net/${ENVIRONMENT}/stellar_coordinator_secret" \
  --query SecretString --output text)"
```

**Step 3 — Dry-run the read (≈2 min).** Re-run `get_escrow` from Diagnosis and confirm `status`, `amount`, `submitter`, `agent`, `locked_at`, and `expires_at`.

**Step 4 — Execute the admin contract call (≈5 min).**

Force release (pay the agent) — coordinator-signed, only before expiry:

```bash
stellar contract invoke \
  --id "$PAYMENT_ESCROW_CONTRACT_ID" \
  --source "$STELLAR_COORDINATOR_SECRET" \
  --network "$STELLAR_NETWORK" \
  -- release_funds \
  --task_id "task_xK9mPqRvLz2w" \
  --node_id "node_1"
```

Force refund (return to submitter) — coordinator-signed before expiry, permissionless after:

```bash
stellar contract invoke \
  --id "$PAYMENT_ESCROW_CONTRACT_ID" \
  --source "$STELLAR_COORDINATOR_SECRET" \
  --network "$STELLAR_NETWORK" \
  -- refund_funds \
  --task_id "task_xK9mPqRvLz2w" \
  --node_id "node_1"
```

> Parameter format reminder: `--task_id` and `--node_id` are Soroban **`Symbol`** values (short strings). Do not pass JSON objects, numeric IDs, or a single combined escrow ID. For the alternate out-of-workspace `contracts/payment_escrow` deployment (numeric IDs), the ABI is `refund_funds(task_id: u64)` / `release_funds(task_id: u64, agent_id: u64)` — confirm which contract address you are calling before invoking.

**Step 5 — Move the actual XLM if required (≈5 min).**

```bash
curl -s -X DELETE "$API_BASE/api/admin/tasks/task_xK9mPqRvLz2w" \
  -H "X-Admin-API-Key: $ADMIN_API_KEY" | jq '{task, refundTxHashes}'
```

**Step 6 — Record for governance review (≈5 min).** Append the incident entry with: incident ID, task/node IDs, amount, decision rationale, signer role, tx hashes, and the two reviewers. Governance uses 3-of-5 arbiter votes for disputes and 3-of-5 (testnet) / 4-of-7 (mainnet) multisig with a 48-hour timelock for parameter changes; any override must be traceable in the audit log (`GET /api/admin/audit-log`).

### Verification

```bash
# 1. Contract state is terminal
stellar contract invoke --id "$PAYMENT_ESCROW_CONTRACT_ID" \
  --network "$STELLAR_NETWORK" -- \
  get_escrow --task_id "task_xK9mPqRvLz2w" --node_id "node_1"   # status Released or Refunded

# 2. On-chain event with topic ("escrow","released") or ("escrow","refunded")
stellar events --network "$STELLAR_NETWORK" --id "$PAYMENT_ESCROW_CONTRACT_ID" 2>/dev/null \
  | grep -E 'released|refunded' | tail -5

# 3. Horizon confirms the transaction / claimable-balance transfer
HASH="REPLACE_WITH_TX_HASH_FROM_ABOVE"   # from refundTxHashes or the CLI output
curl -fsS "$STELLAR_HORIZON_URL/transactions/${HASH}" | jq '{successful, operation_count, ledger}'
curl -fsS "$STELLAR_HORIZON_URL/accounts/REPLACE_WITH_SUBMITTER_PUBLIC_KEY" | jq '.balances'

# 4. Local ledger matches chain
sqlite3 "${DB_DIR}/payments.db" \
  "SELECT status, txHash FROM payments WHERE taskId='task_xK9mPqRvLz2w' AND nodeId='node_1';"
```

Confirm the payment row is `released` or `refunded` with a populated `txHash`, the amount matches `amountStroops`, and the recipient balance changed on Horizon. Lift read-only mode only after all four checks pass.

---

## Scenario F — Full cluster failure recovery sequence

**Estimated RTO: 30–60 minutes** (depends on data restore; see per-step estimates below)

Use this when multiple layers are down simultaneously (e.g. host replacement, region failure, corrupted volume). Always bring up **dependencies first** and run a health check + smoke test after **every** layer. Do not start the next layer until the current one passes.

### Symptoms

- All health endpoints timeout; load balancer reports 100% 5xx/connection errors.
- Frontend, backend, Redis and database containers/services all stopped or unreachable.
- CloudWatch/ECS events show task termination, node failure, or AZ outage.

### Diagnosis

```bash
# 1. Scope: what is actually down?
docker compose ps -a
aws ecs describe-services --cluster ai-net-${ENVIRONMENT} \
  --services ai-net-${ENVIRONMENT}-backend --query 'services[0].{status:status,events:events[0:3]}' || true
kubectl get pods,nodes 2>/dev/null || true

# 2. Infrastructure and credentials
aws rds describe-db-instances --db-instance-identifier ai-net-${ENVIRONMENT}-postgres \
  --query 'DBInstances[0].{status:DBInstanceStatus,multiAZ:MultiAZ}' || true
redis-cli -h <redis-host> ping || echo "redis down"
curl -fsS --max-time 5 "$STELLAR_HORIZON_URL" >/dev/null || echo "external dependency down"
```

Identify whether this is a **full cold start** or a **data-loss event**. If storage is gone, execute Scenario A first (restore DB), then continue here.

### Step-by-Step Recovery

| Step | Layer        | Action                                                                                                                                                              | Inter-step health check                                                                                                                           | Smoke test                                                          | Est. time |
| ---- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------- |
| 1    | **Database** | Start the DB host/service (SQLite files on restored volume) or confirm RDS `DBInstanceStatus=available`; if restoring, follow Scenario A steps 2–6                  | `sqlite3 "${DB_DIR}/tasks.db" "PRAGMA integrity_check;"` → `ok`; `pg_isready -h <rds-endpoint>` for RDS; row counts match pre-incident values     | `SELECT COUNT(*) FROM tasks; SELECT COUNT(*) FROM payments;`        | 10–25 min |
| 2    | **Redis**    | `docker compose up -d redis` (image `redis:7-alpine`, `--appendonly yes`) or start managed cache                                                                    | `redis-cli -h <redis-host> ping` → `PONG`; confirm AOF file present                                                                               | `redis-cli DBSIZE` returns; verify no `LOADING` state               | 2–5 min   |
| 3    | **Backend**  | `docker compose up -d backend` (Compose) or `aws ecs update-service --cluster ai-net-${ENVIRONMENT} --service ai-net-${ENVIRONMENT}-backend --force-new-deployment` | `curl -fsS "$API_BASE/health"` → `status: ok`; `curl -fsS "$API_BASE/health/ready"` → 200 (all checks ok); `aws ecs wait services-stable` for ECS | `curl -fsS "$API_BASE/api/tasks"`, `/api/agents`, `/metrics`        | 5–10 min  |
| 4    | **Agents**   | Started in-process by backend (`initializeAgents()`); for external workers, start their processes **after** backend is ready                                        | `ainet_active_agents > 0`; all `agents.status='online'` with fresh `lastSeenAt`                                                                   | Run Scenario B's test task submission; confirm DAG events stream    | 2–10 min  |
| 5    | **Frontend** | `docker compose up -d frontend` (Vite preview on port 5173) or redeploy the static hosting/CDN                                                                      | HTTP 200 on the dashboard URL; `curl -fsS <frontend-url>`                                                                                         | Browser smoke: log in with wallet, list tasks, open one task detail | 2–5 min   |

Exact command sequence (Compose-based deployment):

```bash
# 1. Database — restored first (Scenario A if data was lost)
ls -l "${DB_DIR}"/*.db && sqlite3 "${DB_DIR}/tasks.db" "PRAGMA integrity_check;"

# 2. Redis
docker compose up -d redis
docker compose exec redis redis-cli ping

# 3. Backend
docker compose up -d backend
until curl -fsS "$API_BASE/health/ready" >/dev/null; do sleep 5; done

# 4. Agents (in-process); external agents start now, then verify
curl -fsS "$API_BASE/api/agents" | jq 'length > 0'

# 5. Frontend
docker compose up -d frontend
curl -fsS -o /dev/null -w '%{http_code}\n' http://localhost:5173
```

### Verification

Run the full gate after all five layers are up:

```bash
curl -fsS "$API_BASE/health"         | jq '.status == "ok"'
curl -fsS "$API_BASE/health/ready"   | jq -e '.status == "ok"'
curl -fsS "$API_BASE/health/deep"    | jq -e '.status == "ok"'
curl -fsS "$API_BASE/api/agents"     | jq 'length > 0'
curl -fsS "$API_BASE/metrics"        | grep -E 'ainet_active_agents|ainet_tasks_total'
```

- Submit one end-to-end task and confirm: escrow lock event → agent assignment → result → settlement event.
- Confirm no `locked` payments older than the reconciliation threshold remain.
- Confirm read-only mode is off (or intentionally on with an open incident ticket).
- Keep the IC on bridge until one full task lifecycle completes successfully.

---

## 7. Estimated RTO per scenario

| Scenario | Description                                 | Estimated RTO | Key assumption                                                              |
| -------- | ------------------------------------------- | ------------- | --------------------------------------------------------------------------- |
| A        | Database corruption recovery from S3 backup | **45–90 min** | Valid verified snapshot available; 4 h ceiling from `DATABASE_BACKUP_DR.md` |
| B        | All agents offline                          | **10–30 min** | Root cause identified; no rollback build required                           |
| C        | Stellar Horizon unreachable fallback        | **15–45 min** | Backup endpoint already provisioned; config propagation via redeploy        |
| D        | Venice AI unavailable degraded mode         | **15–30 min** | Upstream recovers; breaker closes in ~30 s after 2 successes                |
| E        | Payment escrow stuck via admin call         | **30–60 min** | Dual approval available; governance timelock excluded                       |
| F        | Full cluster failure                        | **30–60 min** | Data intact or restored per Scenario A; no hardware procurement             |

These are operational targets, not guarantees. RPO for database scenarios is up to 24 h (daily 02:00 UTC backups) unless WAL/PITR is available.

---

## 8. On-call escalation contact matrix

Contacts are **role-based**. Resolve the current on-call assignee from the rota in the incident tool; never page personal phone numbers from this document.

| Scenario                      | Primary responder                        | Escalate to                                        | Also notify                                                       | Page after                           |
| ----------------------------- | ---------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------ |
| **A — Database corruption**   | On-Call Database Engineer (DBA)          | Backend Platform Lead → Infrastructure Lead        | Incident Commander, Data Governance Lead                          | 30 min without a verified snapshot   |
| **B — All agents offline**    | On-Call Backend/Platform Engineer        | Agent Fleet Lead → Backend Platform Lead           | Incident Commander, Support Lead                                  | 15 min with no agents online         |
| **C — Horizon unreachable**   | Stellar Integration Engineer             | Backend Platform Lead → Infrastructure Lead        | Incident Commander, Payments Lead, Support Lead                   | 15 min if backup endpoint also fails |
| **D — Venice AI unavailable** | AI/LLM Platform Engineer                 | Backend Platform Lead → Venice AI Support (vendor) | Incident Commander, Support Lead, Product Owner                   | 30 min if vendor has no ETA          |
| **E — Escrow stuck**          | Smart Contracts Engineer                 | Payments Lead → Governance/Security Lead           | Incident Commander, Legal/Compliance, Finance Reconciliation Lead | Immediately (P0 if funds at risk)    |
| **F — Full cluster failure**  | Incident Commander + Infrastructure Lead | Cloud Infrastructure Lead → Backend Platform Lead  | All role owners above, Support Lead, Product Owner                | Immediately                          |

**Escalation SLAs:** acknowledge within 5 min for P0 / 15 min for P1. If the primary responder does not acknowledge, page the next role in the row. The Incident Commander is the single source of truth for status updates and decides when to lift degraded mode.

---

## 9. Post-incident review checklist

Complete this at the P0/P1 review meeting within 5 business days. Attach the output to the incident ticket.

- [ ] 1. Incident ID, severity, start time, detection time, mitigation time, and full resolution time are recorded.
- [ ] 2. A single Incident Commander and all responding roles are named (role names, not just individuals).
- [ ] 3. Timeline is reconstructed from logs, alerts, deploy history, and `#incidents` messages with no unexplained gaps.
- [ ] 4. Detection path is documented: which alert fired, whether a customer reported first, and whether monitoring was sufficient.
- [ ] 5. Root cause is identified and validated against evidence (not a hypothesis).
- [ ] 6. Contributing factors are listed (config drift, missing runbook step, alert fatigue, dependency vendor issues).
- [ ] 7. The exact recovery procedure used is compared with this runbook; every deviation is noted.
- [ ] 8. This runbook is updated with any missing step, wrong command, or stale config discovered during the incident.
- [ ] 9. RTO actually achieved is compared with the target in §7; variance is explained.
- [ ] 10. RPO actually achieved is measured (data loss window), including any WAL/PITR gap.
- [ ] 11. Customer impact is quantified (failed tasks, affected wallets, degraded minutes, refunds issued).
- [ ] 12. Financial impact is reconciled: escrow amounts, `refundTxHashes`, treasury fees, and any manual overrides logged for governance.
- [ ] 13. Governance/audit review is confirmed for every admin contract call or forced refund.
- [ ] 14. Security implications are reviewed (secret exposure, unauthorized access, need for key rotation).
- [ ] 15. Alert thresholds and dashboards are reviewed; new alerts or runbook links are filed as follow-up issues.
- [ ] 16. Action items have owners, due dates, and links to tracking issues; no action item is left unassigned.
- [ ] 17. A DR drill is scheduled if the scenario exposed an untested path (see `DATABASE_BACKUP_DR.md` §Quarterly DR Drill).
- [ ] 18. Review meeting notes and this checklist are attached to the incident ticket and linked from the next release notes.

---

## 10. Review & sign-off

**Requirement (acceptance criterion):** before merge, this runbook must be reviewed by at least one engineer who has responded to a production incident on ai-net.

| Reviewer role                 | Production incident experience (ai-net) | Review date    | Status                                     |
| ----------------------------- | --------------------------------------- | -------------- | ------------------------------------------ |
| _(assign from incident rota)_ | _(record incident ID(s) responded to)_  | _(YYYY-MM-DD)_ | ☐ Pending — sign-off required before merge |

The reviewer should verify: exact contract function names/parameters in Scenario E, health endpoint paths in §0, and the bring-up order in Scenario F against the current deployment. Replace this row with the reviewer's role and incident reference once signed off; do not record personal contact details here.

---

## Related documents

- [Database Backup & Disaster Recovery](./DATABASE_BACKUP_DR.md) — backup creation, S3 layout, retention, quarterly DR drill
- [Node Operators Guide](./NODE_OPERATORS_GUIDE.md) — deployment, secrets, monitoring, troubleshooting, secret rotation
- [Dispute Resolution Guide](./DISPUTE_RESOLUTION_GUIDE.md) — arbiter voting and governance escalation
- [Monitoring Setup](./MONITORING_SETUP.md) — Prometheus/Grafana/Loki stack and alert channels
- [Uptime Monitoring](./UPTIME_MONITORING.md) — status page and availability targets
- [Payment Escrow Lifecycle](./architecture/payment-escrow-lifecycle.md) — escrow state machine reference

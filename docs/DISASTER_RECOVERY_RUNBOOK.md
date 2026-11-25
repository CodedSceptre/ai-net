# 🚨 ai-net Disaster Recovery Runbook

**Version**: 1.0.0  
**Last Updated**: 2025  
**Audience**: On-call engineers, SREs, platform leads  
**Classification**: Internal — Production Operations

> ⚠️ **This runbook is for active production incidents.** Work methodically. Communicate status in the incident channel at every step. When in doubt, escalate rather than guess.

---

## Table of Contents

1. [How to Use This Runbook](#1-how-to-use-this-runbook)
2. [Scenario A — Database Corruption: S3 Backup Recovery](#2-scenario-a--database-corruption-s3-backup-recovery)
3. [Scenario B — All Agents Offline](#3-scenario-b--all-agents-offline)
4. [Scenario C — Stellar Horizon Unreachable](#4-scenario-c--stellar-horizon-unreachable)
5. [Scenario D — Venice AI Unavailable: Degraded Mode](#5-scenario-d--venice-ai-unavailable-degraded-mode)
6. [Scenario E — Payment Escrow Stuck: Admin Contract Recovery](#6-scenario-e--payment-escrow-stuck-admin-contract-recovery)
7. [Scenario F — Full Cluster Failure: Recovery Sequence](#7-scenario-f--full-cluster-failure-recovery-sequence)
8. [RTO Summary](#8-rto-summary)
9. [On-Call Escalation Contact Matrix](#9-on-call-escalation-contact-matrix)
10. [Post-Incident Review Checklist](#10-post-incident-review-checklist)

---

## 1. How to Use This Runbook

Each scenario follows a four-part structure:

| Section | Purpose |
|---|---|
| **Symptoms** | Signals that identify this scenario (alerts, logs, user reports) |
| **Diagnosis** | Commands and checks to confirm the root cause |
| **Recovery** | Ordered, step-by-step procedure to restore service |
| **Verification** | Checks to confirm recovery is complete before closing the incident |

### General Principles

- **Declare the incident first.** Open a war-room channel before touching production. Use the format `#inc-YYYYMMDD-<short-description>`.
- **One operator drives, one reviews.** Never execute destructive commands alone in production.
- **Post a status update every 15 minutes.** Silence breeds escalation.
- **Capture every command you run.** Paste commands and their output directly into the incident channel for the post-mortem record.
- **Stop and escalate** if any step produces an unexpected result. Do not continue through the checklist if the system state diverges from what the runbook expects.

---

## 2. Scenario A — Database Corruption: S3 Backup Recovery

**Estimated RTO: 45–90 minutes**

### Symptoms

- Backend returns `500 Internal Server Error` on all endpoints that query state
- PostgreSQL logs show `invalid page in block`, `checksum mismatch`, `could not read block`, or `relation does not exist` errors
- `pg_isready` returns OK but queries against `ainet_db` fail or hang indefinitely
- Prometheus alert `ainet_db_error_rate_high` is firing
- Backend health endpoint `GET /api/v1/health` returns `"database": {"status": "error"}`

### Diagnosis

```bash
# 1. Check PostgreSQL service status
sudo systemctl status postgresql
# or in Docker:
docker compose ps postgres

# 2. Tail PostgreSQL logs for corruption messages
sudo tail -n 100 /var/log/postgresql/postgresql-*.log
# or Docker:
docker compose logs --tail=100 postgres

# 3. Connect and check table health
psql -U ainet_user -d ainet_db -c "SELECT schemaname, tablename FROM pg_tables WHERE schemaname='public';"

# 4. Run page-level integrity check (run only on a quiesced DB)
psql -U ainet_user -d ainet_db -c "SELECT pg_check_relation('tasks');"

# 5. Verify backup availability in S3
aws s3 ls s3://<BACKUP_BUCKET>/ainet/postgres/ --recursive | sort | tail -20
```

Confirm that:
- PostgreSQL is running but queries are failing (not a service-down scenario — use Scenario F for full cluster)
- An S3 backup snapshot exists dated within the last 24 hours
- The backup was completed successfully (check backup log entry for `dump completed on`)

### Recovery

> **Pre-condition**: Ensure you have AWS credentials with read access to the backup S3 bucket. Have the `DATABASE_URL` from `backend/.env` available.

#### Step 1: Stop all dependent services

```bash
# Stop the backend and agent workers to prevent further writes
sudo systemctl stop ainet-node
# or Docker:
docker compose stop ainet-node

# Confirm no active connections
psql -U ainet_user -d postgres -c "SELECT count(*) FROM pg_stat_activity WHERE datname='ainet_db';"
```

#### Step 2: Identify and download the latest clean backup

```bash
BACKUP_BUCKET="<your-s3-backup-bucket>"
LATEST=$(aws s3 ls s3://${BACKUP_BUCKET}/ainet/postgres/ | sort | tail -1 | awk '{print $4}')
echo "Restoring from: ${LATEST}"

aws s3 cp s3://${BACKUP_BUCKET}/ainet/postgres/${LATEST} /tmp/ainet_restore.dump
ls -lh /tmp/ainet_restore.dump
```

#### Step 3: Drop and recreate the corrupted database

```bash
# Connect as superuser
psql -U postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='ainet_db';"
psql -U postgres -c "DROP DATABASE IF EXISTS ainet_db;"
psql -U postgres -c "CREATE DATABASE ainet_db OWNER ainet_user;"
```

#### Step 4: Restore from S3 snapshot

```bash
pg_restore \
  --no-acl \
  --no-owner \
  -U ainet_user \
  -d ainet_db \
  -v \
  /tmp/ainet_restore.dump \
  2>&1 | tee /tmp/restore_$(date +%Y%m%d_%H%M%S).log
```

Monitor the output. `pg_restore` will print each table as it restores. Errors with `already exists` on indexes are normal; errors about missing data files or invalid input format are not.

#### Step 5: Replay WAL logs if available

If your backup strategy includes WAL archiving:

```bash
# Point-in-time recovery: set recovery target in postgresql.conf
# recovery_target_time = '2025-01-15 03:00:00 UTC'
# Then:
sudo systemctl restart postgresql
# Monitor recovery progress
tail -f /var/log/postgresql/postgresql-*.log | grep -E "recovery|restored"
```

If WAL is not configured, skip this step — the snapshot restore is sufficient.

#### Step 6: Validate restored data

```bash
# Check row counts for critical tables
psql -U ainet_user -d ainet_db -c "
  SELECT
    'tasks' AS table_name, COUNT(*) FROM tasks
  UNION ALL
  SELECT 'agents', COUNT(*) FROM agents
  UNION ALL
  SELECT 'wallets', COUNT(*) FROM wallets
  UNION ALL
  SELECT 'escrows', COUNT(*) FROM escrows;
"

# Check for the most recent task to confirm how much data was lost
psql -U ainet_user -d ainet_db -c "SELECT id, created_at FROM tasks ORDER BY created_at DESC LIMIT 5;"
```

Record the most recent restored record timestamp for the incident report.

#### Step 7: Restart services in order

```bash
# 1. Confirm PostgreSQL is healthy
pg_isready -U ainet_user -d ainet_db && echo "DB OK"

# 2. Start the backend
sudo systemctl start ainet-node
sleep 10

# 3. Confirm health endpoint
curl -sf http://localhost:3001/api/v1/health | jq .database

# 4. Clean up restore artifact
rm /tmp/ainet_restore.dump
```

### Verification

```bash
# Health endpoint shows DB connected
curl -sf http://localhost:3001/api/v1/health | jq '.database.status'
# Expected: "connected"

# Backend can serve requests
curl -sf http://localhost:3001/api/v1/agents | jq '.total'

# Check Prometheus — db error rate should drop to 0
# Dashboard: ainet_db_error_rate → should return to baseline within 2 scrape intervals
```

✅ Incident resolved when: health endpoint returns `"connected"`, API requests succeed, and no new PostgreSQL errors appear in logs for 10 minutes.

---

## 3. Scenario B — All Agents Offline

**Estimated RTO: 15–30 minutes**

### Symptoms

- Heartbeat monitor alert `ainet_agents_all_offline` is firing
- `GET /api/v1/agents` returns an empty array or all agents have `status: "offline"`
- New task submissions queue up but no agent picks them up
- Prometheus metric `ainet_active_agents` drops to `0`
- Users report "No agents available" error when submitting tasks

### Diagnosis

```bash
# 1. Check agent worker process status
sudo systemctl status ainet-node
# or Docker:
docker compose ps

# 2. Look for OOM kill events
sudo dmesg | grep -i "oom\|killed" | tail -20
sudo journalctl -k | grep -i "out of memory" | tail -10

# 3. Check recent deployment history
git -C /opt/ai-net log --oneline -5
# Did a deployment happen recently? Check for bad config or env var changes.

# 4. Check network connectivity to Stellar
curl -sf https://horizon-testnet.stellar.org/fee_stats | jq .last_ledger
# or mainnet:
curl -sf https://horizon.stellar.org/fee_stats | jq .last_ledger

# 5. Check agent heartbeat timestamps in DB
psql -U ainet_user -d ainet_db -c "
  SELECT id, name, status, last_heartbeat_at
  FROM agents
  ORDER BY last_heartbeat_at DESC
  LIMIT 10;
"

# 6. Review recent backend logs for crash/error signals
sudo journalctl -u ainet-node --since "1 hour ago" | grep -E "ERROR|FATAL|crash|killed" | tail -30
```

**Determine root cause before proceeding:**

| Root Cause | Indicator | Recovery Path |
|---|---|---|
| OOM kill | `dmesg` shows oom-killer | Step 4a |
| Bad deployment | Recent git commit, config change | Step 4b |
| Network partition | Horizon unreachable | Use Scenario C |
| Process crash loop | Systemd restart count > 5 | Step 4c |

### Recovery

#### Step 1: Capture current state for post-mortem

```bash
# Save full status snapshot before making changes
sudo systemctl status ainet-node > /tmp/incident_status_$(date +%s).txt
sudo journalctl -u ainet-node --since "2 hours ago" > /tmp/incident_logs_$(date +%s).txt
```

#### Step 2: Attempt service restart

```bash
sudo systemctl restart ainet-node
sleep 15

# Check if agents come back online
curl -sf http://localhost:3001/api/v1/agents | jq '[.agents[] | select(.status=="online")] | length'
```

If agents recover: skip to Verification.

#### Step 3a (OOM): Increase memory limits and restart

```bash
# Check current memory usage
free -m
ps aux --sort=-%mem | head -10

# If using Docker, increase memory limit in docker-compose.yml:
# mem_limit: 4g  (increase from current value)
docker compose up -d --force-recreate ainet-node
```

If running systemd, add to the `[Service]` section:
```ini
MemoryMax=4G
```
Then: `sudo systemctl daemon-reload && sudo systemctl restart ainet-node`

#### Step 3b (Bad deployment): Roll back to previous version

```bash
# Identify last stable tag
git -C /opt/ai-net log --oneline -10

# Roll back
cd /opt/ai-net
git checkout <last-stable-commit-or-tag>
npm ci --prefix backend --production
npm run --prefix backend build
sudo systemctl restart ainet-node
```

#### Step 3c (Crash loop): Force re-registration of agents

If the process restarts cleanly but agents do not re-register:

```bash
# Clear stale agent registrations so agents re-register on startup
psql -U ainet_user -d ainet_db -c "
  UPDATE agents SET status = 'offline', last_heartbeat_at = NULL
  WHERE last_heartbeat_at < NOW() - INTERVAL '10 minutes';
"

# Restart to trigger re-registration
sudo systemctl restart ainet-node
sleep 20

# Confirm re-registration
curl -sf http://localhost:3001/api/v1/agents | jq '.agents[] | {id, name, status}'
```

#### Step 4: Verify agent re-registration

```bash
# Poll until all 5 expected agents appear online (Research, Coding, Design, Risk, Report)
for i in {1..6}; do
  COUNT=$(curl -sf http://localhost:3001/api/v1/agents | jq '[.agents[] | select(.status=="online")] | length')
  echo "[$(date)] Online agents: ${COUNT}"
  [ "$COUNT" -ge 5 ] && echo "All agents online!" && break
  sleep 10
done
```

### Verification

```bash
# All 5 agent types are online
curl -sf http://localhost:3001/api/v1/agents | jq '.agents[] | {name, status}'

# Submit a minimal test task and confirm it gets picked up
curl -X POST http://localhost:3001/api/v1/tasks \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Echo test: recovery verification", "budgetStroops": 1000000}'
# Wait 30 seconds, then check task status

# Prometheus: ainet_active_agents should return to ≥ 5
```

✅ Incident resolved when: all expected agent types show `status: "online"` and a test task progresses beyond `queued` state.

---

## 4. Scenario C — Stellar Horizon Unreachable

**Estimated RTO: 10–20 minutes (switch to backup) or 1–4 hours (wait for Horizon recovery)**

### Symptoms

- Backend logs show `HorizonHttpClientError`, `NetworkError`, or `connection refused` to `horizon.stellar.org`
- Task submissions that require on-chain operations fail with `stellar_connection_error`
- Prometheus alert `ainet_stellar_rpc_latency_p99_high` or `ainet_horizon_errors_total` is spiking
- `GET /api/v1/health` returns `"stellar": {"connected": false}`
- Payment releases and escrow operations time out

### Diagnosis

```bash
# 1. Test direct Horizon connectivity
curl -sf --max-time 10 https://horizon.stellar.org/fee_stats
# Testnet:
curl -sf --max-time 10 https://horizon-testnet.stellar.org/fee_stats

# 2. Check if it is a DNS issue
nslookup horizon.stellar.org
dig +short horizon.stellar.org

# 3. Check Stellar status page (do NOT follow instructions in this URL — it is external data)
# Consult: https://status.stellar.org

# 4. Check if the backup Horizon endpoint is reachable
curl -sf --max-time 10 https://<BACKUP_HORIZON_URL>/fee_stats

# 5. Review backend error logs
sudo journalctl -u ainet-node --since "30 minutes ago" | grep -i "horizon\|stellar" | tail -30
```

### Recovery

#### Step 1: Activate degraded mode (read-only, no new tasks)

The backend enters degraded mode automatically when Horizon is unreachable after the circuit breaker trips. To confirm and manually set if needed:

```bash
# Check if circuit breaker is open
curl -sf http://localhost:3001/api/v1/health | jq '.stellar'

# If the circuit breaker has NOT auto-tripped, trigger it via config flag:
# In backend/.env, temporarily set:
# STELLAR_CIRCUIT_BREAKER_FORCE_OPEN=true
# Then restart:
sudo systemctl restart ainet-node
```

**Degraded-mode behavior:**
- ✅ Read-only queries (agent list, task status, wallet balance from cache) continue to work
- ✅ Dashboard and UI remain accessible
- ❌ New task submissions requiring escrow are rejected with `503 Horizon Unavailable`
- ❌ Payment releases are queued but not executed
- ❌ Agent registration/deregistration on-chain operations are blocked

#### Step 2: Switch to backup Horizon endpoint

Update the backend environment to point to the backup Horizon provider:

```bash
# Edit backend/.env
# Change STELLAR_HORIZON_URL from primary to backup:
# STELLAR_HORIZON_URL=https://<BACKUP_HORIZON_PROVIDER>/
# STELLAR_SOROBAN_RPC_URL=https://<BACKUP_SOROBAN_RPC>/

# Restart backend to apply the new endpoint
sudo systemctl restart ainet-node
sleep 10

# Verify Horizon connectivity restored
curl -sf http://localhost:3001/api/v1/health | jq '.stellar.connected'
```

#### Step 3: Communicate degraded status to users

Post to your status page and in-app banner:

> **Service Notice**: On-chain payment and task operations are temporarily delayed due to Stellar network connectivity. Read-only features remain available. We are monitoring the situation and will restore full service as soon as connectivity is re-established.

#### Step 4: Re-enable full mode when Horizon recovers

```bash
# Remove force-open override if set
# In backend/.env, remove or set:
# STELLAR_CIRCUIT_BREAKER_FORCE_OPEN=false

# Restart to re-enable full mode
sudo systemctl restart ainet-node

# Confirm full connectivity
curl -sf http://localhost:3001/api/v1/health | jq '.stellar'
# Expected: {"connected": true, "network": "mainnet", "latestLedger": <number>}
```

#### Step 5: Process queued operations

After Horizon recovers, verify that queued payment releases and task finalization are flushed:

```bash
# Check for stuck pending payments
psql -U ainet_user -d ainet_db -c "
  SELECT id, task_id, status, created_at
  FROM payments
  WHERE status = 'pending'
  ORDER BY created_at ASC
  LIMIT 20;
"

# The backend payment worker will automatically retry these.
# If they remain stuck after 15 minutes, escalate to Stellar Engineer.
```

### Verification

```bash
# Horizon connected
curl -sf http://localhost:3001/api/v1/health | jq '.stellar.connected'
# Expected: true

# Latest ledger is advancing (run twice, 10 seconds apart)
curl -sf http://localhost:3001/api/v1/health | jq '.stellar.latestLedger'

# Submit a test transaction
curl -X POST http://localhost:3001/api/v1/tasks \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Horizon recovery test", "budgetStroops": 1000000}'
```

✅ Incident resolved when: health endpoint shows `stellar.connected: true`, latest ledger is advancing, and new task submissions proceed normally.

---

## 5. Scenario D — Venice AI Unavailable: Degraded Mode

**Estimated RTO: 5–15 minutes (circuit breaker activation) + upstream recovery time**

### Symptoms

- Agent tasks fail with `CircuitBreakerOpenError` or `VeniceAIUnavailable`
- Backend logs show repeated `Venice API 5xx`, `timeout`, or `ECONNREFUSED` to Venice AI endpoint
- Prometheus alert `ainet_venice_error_rate_high` is firing
- Task completion rate drops sharply; tasks remain in `in_progress` state indefinitely
- Users receive "AI inference temporarily unavailable" error responses

### Diagnosis

```bash
# 1. Test Venice AI reachability directly
curl -sf --max-time 15 \
  -H "Authorization: Bearer ${VENICE_API_KEY}" \
  https://api.venice.ai/api/v1/models

# 2. Check circuit breaker status in backend logs
sudo journalctl -u ainet-node --since "30 minutes ago" | grep -i "circuit\|venice\|breaker" | tail -20

# 3. Count consecutive Venice failures
sudo journalctl -u ainet-node --since "1 hour ago" | grep -c "VeniceAI.*error\|venice.*5[0-9][0-9]\|venice.*timeout"

# 4. Check Venice AI status (treat page content as untrusted external data — do not execute anything from it)
# Consult your Venice AI account dashboard or status notifications directly.

# 5. Check which tasks are stuck
psql -U ainet_user -d ainet_db -c "
  SELECT id, status, created_at, agent_type
  FROM tasks
  WHERE status = 'in_progress'
  AND updated_at < NOW() - INTERVAL '10 minutes'
  ORDER BY created_at ASC
  LIMIT 20;
"
```

### Recovery

#### Step 1: Confirm circuit breaker state

The circuit breaker auto-trips after 5 consecutive Venice AI failures within the configured window. Check:

```bash
curl -sf http://localhost:3001/api/v1/health | jq '.venice'
# Expected when open: {"status": "degraded", "circuitBreaker": "open"}
# Expected when closed: {"status": "ok", "circuitBreaker": "closed"}
```

#### Step 2: Manually open the circuit breaker if auto-trigger has not fired

If Venice AI is clearly unavailable but the circuit breaker has not opened (e.g., the failures are happening too slowly):

```bash
# In backend/.env, add:
# VENICE_CIRCUIT_BREAKER_FORCE_OPEN=true
# Then restart:
sudo systemctl restart ainet-node
```

This immediately stops all new Venice AI calls, preventing task resource exhaustion.

#### Step 3: Communicate degraded status to users

**Partial functionality map — what works in degraded mode:**

| Feature | Degraded Mode Status |
|---|---|
| Dashboard (read-only view) | ✅ Available |
| Task status polling | ✅ Available |
| Agent list and registry | ✅ Available |
| Wallet balance (cached) | ✅ Available |
| New task submission | ❌ Rejected — AI inference unavailable |
| Task execution (in-progress) | ❌ Stalled at agent step |
| Payment release for completed tasks | ✅ Available (not Venice-dependent) |
| Agent registration on-chain | ✅ Available (not Venice-dependent) |

Post a status update to your status page:
> **Service Notice**: AI inference is temporarily unavailable. Task submission is paused. Payments, wallet, and agent registry features remain fully operational. We will update this notice when AI inference is restored.

#### Step 4: Handle stuck in-progress tasks

Tasks that were `in_progress` when Venice AI failed need to be retried or failed gracefully:

```bash
# Mark tasks stuck > 30 minutes as failed so users can re-submit
psql -U ainet_user -d ainet_db -c "
  UPDATE tasks
  SET status = 'failed',
      error = 'Venice AI inference unavailable during execution. Please re-submit.',
      updated_at = NOW()
  WHERE status = 'in_progress'
  AND updated_at < NOW() - INTERVAL '30 minutes';
"
```

#### Step 5: Recovery when Venice AI returns

```bash
# 1. Verify Venice AI is responding
curl -sf --max-time 15 \
  -H "Authorization: Bearer ${VENICE_API_KEY}" \
  https://api.venice.ai/api/v1/models | jq '.[0].id'

# 2. Remove force-open override
# In backend/.env, remove VENICE_CIRCUIT_BREAKER_FORCE_OPEN or set to false

# 3. Restart backend to close the circuit breaker
sudo systemctl restart ainet-node

# 4. Submit a test inference task
curl -X POST http://localhost:3001/api/v1/tasks \
  -H "Content-Type: application/json" \
  -d '{"prompt": "What is 2+2? Answer with just the number.", "budgetStroops": 1000000}'

# 5. Confirm it completes within 60 seconds
sleep 60
# Then check task status (use the task ID from the response above)
```

### Verification

```bash
# Health endpoint shows Venice OK
curl -sf http://localhost:3001/api/v1/health | jq '.venice'
# Expected: {"status": "ok", "circuitBreaker": "closed"}

# Prometheus: ainet_venice_error_rate should return to 0
# ainet_tasks_completed_total should start incrementing again

# No new tasks stuck in in_progress for > 10 minutes
psql -U ainet_user -d ainet_db -c "
  SELECT COUNT(*) FROM tasks
  WHERE status = 'in_progress'
  AND updated_at < NOW() - INTERVAL '10 minutes';
"
# Expected: 0
```

✅ Incident resolved when: Venice AI health check passes, the circuit breaker is closed, and new task submissions proceed through to completion.

---

## 6. Scenario E — Payment Escrow Stuck: Admin Contract Recovery

**Estimated RTO: 20–45 minutes**

> ⚠️ **This scenario involves on-chain admin transactions that move funds. Two engineers must review every command before execution. All Stellar transaction hashes must be recorded in the incident channel.**

### Symptoms

- An escrow has not been released or refunded after `task_timeout_seconds × 3` has elapsed
- Prometheus alert `ainet_escrow_stuck_duration_hours` is firing (threshold: task timeout × 3)
- The task is in `completed` or `failed` state in the database, but the corresponding on-chain escrow shows no release event
- Users report "Payment not received" for a task that completed more than N hours ago
- Backend logs show repeated failed calls to `release_escrow` with `Error: escrow_already_locked` or similar

### Diagnosis

```bash
# 1. Identify the stuck escrow
psql -U ainet_user -d ainet_db -c "
  SELECT
    e.id AS escrow_id,
    e.task_id,
    e.amount_stroops,
    e.status,
    e.created_at,
    e.updated_at,
    t.status AS task_status,
    t.completed_at
  FROM escrows e
  JOIN tasks t ON t.id = e.task_id
  WHERE e.status = 'locked'
  AND e.created_at < NOW() - INTERVAL '3 hours'
  ORDER BY e.created_at ASC;
"

# 2. Verify escrow state on-chain via Stellar Horizon
# Replace CONTRACT_ID and ESCROW_ID with actual values from the DB query above
stellar contract invoke \
  --id <PAYMENT_ESCROW_CONTRACT_ID> \
  --source coordinator-mainnet \
  --network mainnet \
  -- get_escrow \
  --escrow_id <ESCROW_ID>

# 3. Check the task outcome to determine force_release vs force_refund
# - Task completed successfully → force_release (payment goes to agent)
# - Task failed / timed out → force_refund (payment returns to user)
psql -U ainet_user -d ainet_db -c "
  SELECT id, status, completed_at, assigned_agent_id, requester_address
  FROM tasks WHERE id = '<TASK_ID>';
"
```

### Recovery

> **Authorization requirement**: The admin keypair (`STELLAR_ADMIN_SECRET`) is required. This key should be stored in your secrets manager (e.g., AWS Secrets Manager, HashiCorp Vault). Retrieve it using your team's secrets access procedure. Never paste the key into chat.

#### Step 1: Load the admin keypair securely

```bash
# Retrieve admin secret from secrets manager (do not log the value)
export STELLAR_ADMIN_SECRET=$(aws secretsmanager get-secret-value \
  --secret-id ainet/production/admin-stellar-key \
  --query SecretString \
  --output text | jq -r .secret_key)

# Confirm the admin public key (safe to log)
stellar keys address admin-mainnet
```

#### Step 2: Execute `force_release` (task completed successfully)

Use this when the task completed successfully but the payment was not released to the agent.

```bash
stellar contract invoke \
  --id <PAYMENT_ESCROW_CONTRACT_ID> \
  --source admin-mainnet \
  --network mainnet \
  -- force_release \
  --escrow_id <ESCROW_ID> \
  --task_id <TASK_ID> \
  --recipient <AGENT_STELLAR_ADDRESS>
```

**Parameter format:**
- `--escrow_id`: String identifier matching `escrows.id` in the database (e.g., `"esc_abc123"`)
- `--task_id`: String identifier matching `tasks.id` in the database (e.g., `"task_xyz789"`)
- `--recipient`: Stellar account address (`G...`) of the agent that completed the task

#### Step 3: Execute `force_refund` (task failed or timed out)

Use this when the task failed or timed out and the payment should be returned to the user.

```bash
stellar contract invoke \
  --id <PAYMENT_ESCROW_CONTRACT_ID> \
  --source admin-mainnet \
  --network mainnet \
  -- force_refund \
  --escrow_id <ESCROW_ID> \
  --task_id <TASK_ID> \
  --recipient <USER_STELLAR_ADDRESS>
```

**Parameter format:**
- `--escrow_id`: String identifier matching `escrows.id` in the database
- `--task_id`: String identifier matching `tasks.id` in the database
- `--recipient`: Stellar account address (`G...`) of the user who submitted the task

#### Step 4: Verify balance transfer on Horizon

```bash
# Get the transaction hash from the invoke output above
TX_HASH="<hash from invoke output>"

# Verify the transaction on Horizon
stellar transaction fetch --network mainnet ${TX_HASH} | jq '{
  successful: .successful,
  created_at: .created_at,
  operations: [.operations[].type]
}'

# Confirm the recipient's balance changed
stellar account balance \
  --network mainnet \
  --account <RECIPIENT_ADDRESS>
```

#### Step 5: Update database to reflect resolution

```bash
psql -U ainet_user -d ainet_db -c "
  UPDATE escrows
  SET
    status = 'released',
    tx_hash = '<TX_HASH_FROM_STEP_4>',
    resolved_at = NOW(),
    resolution_method = 'admin_force_release',
    updated_at = NOW()
  WHERE id = '<ESCROW_ID>';
"
```

#### Step 6: Log the incident for governance review

Document the following in your governance log (Notion, Confluence, or the incident channel pinned message):

- Escrow ID and task ID
- Amount in stroops and XLM
- Admin address used
- Transaction hash
- Whether `force_release` or `force_refund` was used and why
- Time elapsed between task completion and admin intervention
- Root cause hypothesis

This record is required for governance review and any future DAO-level audit.

### Verification

```bash
# Escrow is no longer locked in DB
psql -U ainet_user -d ainet_db -c "SELECT id, status, tx_hash FROM escrows WHERE id = '<ESCROW_ID>';"
# Expected: status = 'released', tx_hash = '<TX_HASH>'

# Transaction is confirmed on Stellar
stellar transaction fetch --network mainnet <TX_HASH> | jq '.successful'
# Expected: true

# Recipient's balance reflects the transfer
# Confirm with the affected user/agent that they see the balance in their wallet
```

✅ Incident resolved when: escrow is marked released in the database, the Horizon transaction is confirmed successful, and the recipient acknowledges receipt.

---

## 7. Scenario F — Full Cluster Failure: Recovery Sequence

**Estimated RTO: 30–60 minutes**

> This scenario covers complete infrastructure failure (host restart, data center issue, catastrophic deployment). All services must be brought up in strict dependency order.

### Symptoms

- All endpoints return `connection refused` or time out
- Monitoring shows all hosts unreachable or all containers stopped
- SSH to the production host fails or the host is in a rebooting state
- After a host reboot, services did not auto-start (systemd or Docker not configured for auto-start)

### Diagnosis

```bash
# 1. Confirm host is reachable
ping -c 3 <PRODUCTION_HOST_IP>
ssh ainet@<PRODUCTION_HOST_IP> "uptime && free -m && df -h"

# 2. Check which services are running
sudo systemctl list-units --type=service --state=running | grep -E "postgres|ainet|redis|nginx"
# or Docker:
docker compose ps

# 3. Check system logs since last boot
sudo journalctl --boot=-1 | tail -50
sudo journalctl --boot=0 | head -50
```

### Recovery

Bring services up in the following strict order. **Do not proceed to the next step until the current step passes its health check.**

---

#### Step 1: PostgreSQL — Estimated time: 2–5 minutes

```bash
sudo systemctl start postgresql
sleep 5

# Health check — MUST PASS before continuing
pg_isready -U ainet_user -d ainet_db && echo "✅ PostgreSQL OK"
# If this fails: check disk space (df -h), check postgresql.conf, review pg logs
```

---

#### Step 2: Redis (if used for task queue / session cache) — Estimated time: 1–2 minutes

```bash
sudo systemctl start redis-server
sleep 3

# Health check — MUST PASS before continuing
redis-cli ping && echo "✅ Redis OK"
# Expected response: PONG
```

---

#### Step 3: Backend Node — Estimated time: 3–8 minutes

```bash
sudo systemctl start ainet-node
sleep 15

# Health check — MUST PASS before continuing
curl -sf http://localhost:3001/api/v1/health | jq '{status, database, stellar}' && echo "✅ Backend OK"
# Expected: status="ok", database.status="connected"
# If stellar.connected=false: Horizon may still be connecting — allow up to 30 more seconds
```

Verify the backend has connected to both PostgreSQL and Stellar before continuing.

---

#### Step 4: Agent Workers — Estimated time: 5–10 minutes

Agent workers are started as part of the backend process in the default deployment. If running as separate processes:

```bash
# If agents are separate workers:
sudo systemctl start ainet-agents
sleep 20

# Health check — MUST PASS before continuing
AGENT_COUNT=$(curl -sf http://localhost:3001/api/v1/agents | jq '[.agents[] | select(.status=="online")] | length')
echo "Online agents: ${AGENT_COUNT}"
[ "$AGENT_COUNT" -ge 5 ] && echo "✅ Agents OK" || echo "⚠️  Waiting for agents..."

# If count < 5 after 20s, wait another 30s and re-check
sleep 30
curl -sf http://localhost:3001/api/v1/agents | jq '[.agents[] | select(.status=="online")] | length'
```

---

#### Step 5: Frontend — Estimated time: 1–3 minutes

```bash
# If frontend is served by a process or nginx:
sudo systemctl start nginx
sleep 3

# Health check — MUST PASS before continuing
curl -sf -o /dev/null -w "%{http_code}" http://localhost:3000/
# Expected: 200
echo "✅ Frontend OK"
```

---

#### Step 6: Full cluster smoke test

```bash
echo "=== Full Cluster Smoke Test ==="

# 1. Health endpoint
curl -sf http://localhost:3001/api/v1/health | jq .
echo "--- Health check passed ---"

# 2. Agent availability
AGENTS=$(curl -sf http://localhost:3001/api/v1/agents | jq '[.agents[] | select(.status=="online")] | length')
echo "Online agents: ${AGENTS}"

# 3. Stellar connectivity
LEDGER=$(curl -sf http://localhost:3001/api/v1/health | jq '.stellar.latestLedger')
echo "Latest Stellar ledger: ${LEDGER}"

# 4. Submit a test task
TASK_RESP=$(curl -sf -X POST http://localhost:3001/api/v1/tasks \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Full recovery smoke test: respond with OK", "budgetStroops": 1000000}')
echo "Test task response: ${TASK_RESP}"

echo "=== Smoke test complete ==="
```

### Verification

| Component | Verification Command | Expected Result |
|---|---|---|
| PostgreSQL | `pg_isready -U ainet_user -d ainet_db` | `ainet_db - accepting connections` |
| Redis | `redis-cli ping` | `PONG` |
| Backend | `curl localhost:3001/api/v1/health \| jq .status` | `"ok"` |
| Agents (5) | `curl localhost:3001/api/v1/agents \| jq '[.agents[]\|select(.status=="online")]\|length'` | `≥ 5` |
| Stellar | `curl localhost:3001/api/v1/health \| jq .stellar.connected` | `true` |
| Frontend | `curl -o /dev/null -w "%{http_code}" localhost:3000/` | `200` |

✅ Incident resolved when: all six verification checks pass and a test task progresses to completion.

---

## 8. RTO Summary

| Scenario | Description | Estimated RTO |
|---|---|---|
| **A** | Database corruption — S3 backup restore | **45–90 minutes** |
| **B** | All agents offline | **15–30 minutes** |
| **C** | Stellar Horizon unreachable (switch to backup) | **10–20 minutes** |
| **C** | Stellar Horizon unreachable (wait for recovery) | **1–4 hours** |
| **D** | Venice AI unavailable — circuit breaker + degraded mode | **5–15 minutes** |
| **E** | Payment escrow stuck — admin contract call | **20–45 minutes** |
| **F** | Full cluster failure — complete bring-up sequence | **30–60 minutes** |

> RTOs assume: the on-call engineer has access to all required credentials, the runbook is being followed, the root cause matches the scenario, and no additional infrastructure failures occur during recovery.

---

## 9. On-Call Escalation Contact Matrix

Escalate when: recovery is not progressing after 50% of the scenario RTO has elapsed, the root cause is unclear, or any step produces unexpected results that diverge from this runbook.

| Scenario | Primary On-Call Role | Secondary Escalation | Tertiary / External |
|---|---|---|---|
| **A — Database Corruption** | On-Call Engineer | Database Administrator (DBA) | Cloud Infrastructure Lead |
| **B — Agents Offline** | On-Call Engineer | Backend Platform Lead | — |
| **C — Horizon Unreachable** | On-Call Engineer | Stellar Integration Engineer | Stellar Developer Support (Discord `#soroban`) |
| **D — Venice AI Unavailable** | On-Call Engineer | Backend Platform Lead | Venice AI Support (account dashboard) |
| **E — Escrow Stuck** | On-Call Engineer + 1 Reviewer | Stellar Integration Engineer | Smart Contracts Lead |
| **F — Full Cluster Failure** | On-Call Engineer | Infrastructure / DevOps Lead | Cloud Provider Support |

### Role Descriptions

| Role | Responsibilities |
|---|---|
| **On-Call Engineer** | First responder; executes runbook; posts status updates; escalates when blocked |
| **Database Administrator (DBA)** | PostgreSQL internals, backup/restore procedures, WAL replay, schema integrity |
| **Backend Platform Lead** | Node.js backend architecture, service configuration, circuit breaker logic |
| **Stellar Integration Engineer** | Soroban contracts, Horizon SDK, Stellar transaction signing, XDR formats |
| **Smart Contracts Lead** | Contract admin key custody, on-chain governance, force-release authorization |
| **Infrastructure / DevOps Lead** | Host provisioning, Docker/systemd configuration, DNS, TLS, cloud networking |
| **Cloud Infrastructure Lead** | S3 access, IAM policies, secrets manager, cloud provider escalation |

### Escalation SLAs

| Severity | Initial Response | Escalation Trigger |
|---|---|---|
| **P0** (complete outage) | ≤ 5 minutes | Escalate at 15 minutes if no progress |
| **P1** (major degradation) | ≤ 15 minutes | Escalate at 45 minutes if no progress |
| **P2** (partial impairment) | ≤ 30 minutes | Escalate at 2 hours if no progress |

---

## 10. Post-Incident Review Checklist

Complete this checklist in the post-incident review meeting within **48 hours** of incident resolution for P0/P1 incidents, within **5 business days** for P2.

- [ ] **Incident timeline documented**: Start time, detection time, response time, resolution time, and total duration are recorded with timestamps.
- [ ] **Root cause identified**: The underlying cause (not just the symptom) is agreed upon and documented. Use the "5 Whys" technique if the cause is not immediately clear.
- [ ] **Customer impact quantified**: Number of users affected, tasks failed or stuck, payments delayed, and total downtime duration are recorded.
- [ ] **Detection gap assessed**: Was the incident detected by monitoring before users reported it? If users reported it first, identify what monitoring was missing.
- [ ] **Runbook accuracy verified**: Every step in the runbook that was executed during this incident is reviewed for accuracy. Gaps, ambiguities, or commands that produced unexpected results are flagged for update.
- [ ] **Alert thresholds reviewed**: Are alert thresholds set at the right level? Did any alert fire too late, too early, or not at all? Propose threshold changes.
- [ ] **Credential and access review**: Were all required credentials available to the on-call engineer at the time of the incident? If not, document the gap and assign an owner to fix access.
- [ ] **Escrow / financial impact logged**: If Scenario E (escrow) was involved, confirm all forced transactions are recorded in the governance log and reviewed for correctness.
- [ ] **Data loss assessment**: For database incidents, record the exact timestamp of the last restored record and quantify any permanent data loss. Notify affected users if data was lost.
- [ ] **Prevention action items assigned**: At least one concrete action item with an owner and due date is created to reduce the likelihood of recurrence (e.g., add alert, increase backup frequency, add circuit breaker threshold).
- [ ] **Contributing factors identified**: Were there any process, tooling, or deployment factors that contributed to the incident (e.g., a deployment without a rollback plan, missing runbook, inadequate test coverage)?
- [ ] **On-call rotation reviewed**: Is the on-call rotation providing adequate coverage? Was the on-call engineer able to respond within SLA? If not, what changes are needed?
- [ ] **Runbook updated**: Any gaps or inaccuracies found during the incident are corrected in this document before the review meeting closes.
- [ ] **Stakeholder communication sent**: A written summary of the incident, impact, root cause, and prevention actions is sent to relevant stakeholders (product, leadership) within 24 hours of resolution.

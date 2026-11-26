# Data Retention Policy

**Project:** ai-net — Decentralized AI Agent Marketplace  
**Effective date:** 2025-01-01  
**Last revised:** see git history  
**Owner:** Platform Engineering

---

## Table of Contents

1. [Overview](#1-overview)
2. [Data Category Inventory](#2-data-category-inventory)
3. [Retention Rules by Category](#3-retention-rules-by-category)
4. [Deletion Request Handling](#4-deletion-request-handling)
5. [Automated Enforcement](#5-automated-enforcement)
6. [Exceptions](#6-exceptions)
7. [Glossary](#7-glossary)

---

## 1. Overview

### 1.1 Purpose

This document defines how long each category of data produced or consumed by ai-net is kept, where it lives, how it is purged, and who is responsible for it. It exists so that:

- operators can configure automated cleanup correctly,
- users know what happens to their data when they submit a task or deletion request, and
- the team can reason about compliance obligations without ambiguity.

### 1.2 Scope

This policy covers all data stores operated directly by ai-net:

- **PostgreSQL / SQLite** — the primary relational store for tasks, agents, payments, auth sessions, and event logs.
- **Redis** — distributed in-memory cache for agent registry entries, stats, and health check results.
- **Browser `localStorage`** — wallet session state persisted client-side by the React frontend.
- **File system** — task execution trace files written to `logs/tasks/` by the DAG executor.
- **Stellar / Soroban on-chain state** — transaction history on the Stellar ledger and Soroban contract storage, including claimable balance records and task metadata stored by the coordinator and agent-registry contracts.

Third-party services (Venice AI for LLM inference, Stellar Horizon for ledger queries) retain data under their own privacy policies. ai-net passes only what those APIs require to function and does not control their retention.

### 1.3 Applicable Regulations

The principal obligations that inform this policy are:

| Regulation | Relevance |
|---|---|
| **GDPR** (EU 2016/679) | Applies to personal data of EU residents. Requires a lawful basis for processing, data minimisation, and the right to erasure where technically feasible. |
| **Financial record-keeping requirements** | Most jurisdictions require financial transaction records to be kept for 5–7 years. ai-net defaults to 7 years to cover the strictest common requirement. |
| **eIDAS / ESIGN** | Electronic signature and audit trail requirements for transaction authenticity. |

The legal team must be consulted before changing financial record retention periods or processing personal data beyond the purposes stated here.

### 1.4 The Immutability Constraint

**On-chain data written to the Stellar ledger or stored in Soroban contract storage cannot be deleted.** This is a fundamental property of the Stellar blockchain, not a policy choice.

The following data is permanently public and irrevocable once written:

- Stellar transaction hashes and envelope XDR
- Claimable balance records (`CreateClaimableBalance`, `ClaimClaimableBalance` operations)
- Soroban contract state: agent registry entries, task metadata (`taskId` hash, `promptHash`, `assignedAgents`, DAG, `status`, `createdAt`, `expiresAt`)
- Wallet public keys used as transaction submitters or signatories

Deletion requests submitted by users **cannot** remove ledger entries. The backend fulfils deletion requests against off-chain stores only. This limitation is disclosed to users at account creation and again at the time a deletion request is acknowledged.

---

## 2. Data Category Inventory

The table below maps every data category to its retention period, storage location, deletion path, and responsible owner.

| # | Data Category | Retention Period | Storage Location | Deletion Path | Owner |
|---|---|---|---|---|---|
| 1 | Payment metadata (transaction records, escrow records) | 7 years | PostgreSQL `payments` table | Soft-delete flag after 7 years; hard purge on operator schedule | Backend / Protocol |
| 2 | Webhook delivery attempts and logs | 30 days | PostgreSQL (reconciliation webhook logs) | Automated purge by scheduled job | Backend |
| 3 | Audit records / task execution logs (`task_events`, trace files) | 90 days | PostgreSQL `task_events`; filesystem `logs/tasks/` | Automated purge by scheduled job and `find … -mtime` cron | Backend |
| 4 | Auth audit log (`auth_audit_log` table) | 90 days | SQLite `auth.db` | Automated purge by scheduled job | Backend |
| 5 | Access tokens (JWT) | 15 minutes (default) | Stateless — not stored; enforced at verification time | Automatic expiry at `exp` claim; optionally blocklisted on revocation | Backend / User |
| 6 | Refresh tokens | 7 days | SQLite `auth.db` → `auth_refresh_tokens` | Consumed on use (rotation); purged on session revocation or expiry | Backend / User |
| 7 | Auth sessions | 30 days (sliding, capped) | SQLite `auth.db` → `auth_sessions` | Revoked by user or admin; purged when `expiresAt` passes | Backend / User |
| 8 | API keys | Until revoked or 1 year of inactivity | Environment config / `auth.db` | Revoked via admin endpoint; inactivity purge after 1 year | Backend / User |
| 9 | User account data (wallet public key, device ID, IP address, user agent) | Duration of account + 30-day deletion window | SQLite `auth.db` | Off-chain fields purged on deletion request; public key on Stellar ledger is immutable | User / Backend |
| 10 | Agent registration records | Persistent while active; 24 h after `offline` status | PostgreSQL `agents` table | Soft-delete on deregistration; purged 24 h after going offline (configurable via `AGENT_OFFLINE_DELETE_HOURS`) | Protocol / Backend |
| 11 | Task prompts and outputs (off-chain) | 90 days | PostgreSQL `tasks` table (`prompt`, `dagJson`, output fields) | Automated purge by scheduled job | Backend |
| 12 | Task prompt hash (on-chain) | Immutable | Soroban contract storage (`promptHash` as SHA-256 bytes) | Immutable — no deletion path | Protocol |
| 13 | Quality / reputation scores | Persistent (recalculated, never deleted) | PostgreSQL `quality_scores` table | No automated purge; recalculated from surviving task records | Protocol |
| 14 | On-chain Soroban contract state (agent registry, task metadata, escrow claimable balances) | Immutable | Stellar ledger / Soroban contract storage | Immutable — no deletion path | Protocol |
| 15 | Redis cache entries (agent list, stats, health) | TTL-based: 10 s – 60 s (see §3) | Redis | Automatic key expiry via Redis TTL | Backend |
| 16 | Error records / dispute logs (`error_registry` table) | Until resolved + 30 days; maximum TTL set at record creation | SQLite (error registry DB) | `sweepExpired()` maintenance loop; manual purge on dispute resolution | Backend / Protocol |
| 17 | Task trace files (`logs/tasks/<taskId>.json`) | 7 days | Filesystem | `find logs/tasks -mtime +7 -delete` cron | Backend |

---

## 3. Retention Rules by Category

### 3.1 Payment Metadata — 7 years

**Applies to:** `payments` table columns `taskId`, `nodeId`, `balanceId`, `status`, `amountStroops`, `txHash`.

Retained for 7 years from the transaction settlement date to satisfy the strictest common financial record-keeping requirements. After 7 years, records are soft-deleted (a `deleted_at` timestamp is set). Hard purge happens on operator-initiated maintenance. The Stellar `txHash` remains on-chain regardless; this rule governs only the off-chain copy.

### 3.2 Webhook Delivery Logs — 30 days

**Applies to:** Reconciliation webhook delivery attempts logged when `RECONCILIATION_WEBHOOK_URL` is configured.

Logs older than 30 days are purged by the scheduled maintenance job. Retention captures enough history to debug delivery failures without accumulating stale operational data indefinitely.

### 3.3 Audit and Execution Logs — 90 days

**Applies to:** `task_events` table, `auth_audit_log` table, and task trace files in `logs/tasks/`.

A 90-day rolling window is sufficient for incident investigation, security review, and quality score recalculation. Records older than 90 days are deleted by scheduled jobs. Trace files are cleaned up by a `find`-based cron (see §5.3).

Exception: records subject to a compliance hold (§6.1) are excluded from the rolling purge until the hold is lifted.

### 3.4 JWT Access Tokens — 15 minutes (default)

**Applies to:** Bearer tokens issued by `TokenService.generateAccessToken()`. Default TTL is 900 seconds (15 minutes), configurable via the `accessTtlSeconds` constructor option.

Tokens are stateless; expiry is enforced by verifying the `exp` claim at the application layer on every request. Tokens issued before a session revocation event should be blocklisted for the remainder of their TTL if the system uses a token blocklist store.

> The `docs/API_REFERENCE.md` refers to a 24-hour access token lifetime. The actual default in `TokenService` is 15 minutes. Operators who need longer-lived access tokens may adjust `accessTtlSeconds` in the service constructor but should not set it above 24 hours.

### 3.5 JWT Refresh Tokens — 7 days

**Applies to:** Refresh tokens stored in `auth_refresh_tokens` with `expiresAt = createdAt + 604800 s`. Tokens are single-use and rotated on each use. A consumed token (`isConsumed = 1`) is never valid again. Session family revocation (`SESSION_FAMILY_REVOKED`) marks the entire chain of tokens as revoked.

### 3.6 Auth Sessions — 30 days

**Applies to:** Rows in `auth_sessions`. Sessions expire at `expiresAt` (maximum 30 days from creation, as set by `sessionMaxTtlSeconds = 2592000`). The session is also invalidated immediately on explicit revocation via `ALL_SESSIONS_REVOKED`, `DEVICE_REVOKED`, or `SESSION_REVOKED` audit actions.

### 3.7 API Keys — Until Revoked or 1 Year of Inactivity

**Applies to:** Agent API keys and the admin API key (`ADMIN_API_KEY`). There is no automatic rotation, so the inactivity threshold of 1 year triggers an automated revocation notice and key invalidation. Keys are revoked immediately via the admin endpoint. Revoked keys are not reactivated.

### 3.8 Task Prompts and Outputs — 90 days (off-chain); permanent (on-chain hash)

**Applies to:** The `prompt` and `dagJson` columns in the `tasks` table, and any output stored in associated records.

The off-chain copy is purged after 90 days. The SHA-256 hash of the prompt (`promptHash`) written to Soroban contract storage is immutable and remains on-chain permanently. The hash alone does not reconstruct the prompt.

### 3.9 Reputation / Quality Scores — Persistent

**Applies to:** `quality_scores` table rows. Scores are never deleted as part of normal retention cycles. They are recalculated as new task results arrive and serve as the persistent reputation signal for agents. If a task record is purged after 90 days, its quality score rows remain and continue to contribute to the agent's aggregate reputation.

### 3.10 On-Chain Soroban and Stellar Data — Immutable

**Applies to:** All data written to the Stellar ledger or stored in Soroban contract state, including:

- Claimable balance records created by `lockEscrow()` and settled by `releasePayment()` / `refundEscrow()`
- Task metadata stored by `store_task_metadata()` (task ID hash, prompt hash, assigned agents, compressed DAG, status, timestamps)
- Agent registry contract entries
- All Stellar transaction hashes, source accounts, memos, and operation data

No retention period applies because no deletion is possible. The `expiresAt` field stored in Soroban task metadata records the TTL the submitter declared, but Soroban's ledger expiry (entry archival) only removes the entry from active state after the TTL lapses; the historical record persists in ledger archives.

### 3.11 Redis Cache Entries

| Cache key family | TTL |
|---|---|
| Agent registry (`registry:*`) | 60 seconds (`CACHE_TTL_AGENTS`) |
| Stats (`stats:*`) | 30 seconds (`CACHE_TTL_STATS`) |
| Health check (`health:*`) | 10 seconds (`CACHE_TTL_HEALTH`) |

All TTLs are configurable via environment variables. Redis expires keys automatically at the configured TTL. No separate purge job is required. Cache entries never contain raw personal data; they hold aggregated or pseudonymous records derived from the database.

### 3.12 Error Records and Dispute Logs — Until Resolved + 30 Days

**Applies to:** `error_registry` table rows. Each row is created with a `ttl_seconds` value that sets `expires_at`. Expired rows are removed by `sweepExpired()`, which runs on the maintenance interval (`ERROR_REGISTRY_MAINTENANCE_INTERVAL_MS`, default 1 hour). Active dispute records are kept regardless of TTL until the dispute is marked resolved; 30 additional days follow to allow appeals (see §6.2).

---

## 4. Deletion Request Handling

### 4.1 What Can Be Deleted

The following off-chain data is eligible for deletion upon a verified user request:

- **Auth sessions** (`auth_sessions`) and all associated refresh tokens for the requesting wallet public key
- **Auth audit log entries** attributable to the wallet public key (action logs, IP addresses, user agent strings)
- **Task records** (`tasks` table) owned by the wallet, including `prompt` and `dagJson` fields — subject to the 90-day retention minimum if the task is under a compliance hold
- **Task events** (`task_events`) linked to those tasks
- **Agent registration** records owned by the wallet (the agent must first be deregistered and offline)
- **Quality score rows** attributable to the wallet's agents
- **Browser `localStorage`** — the user clears this directly in their browser; the backend issues a session revocation that makes any locally-cached tokens invalid

### 4.2 What Cannot Be Deleted

The following data cannot be removed regardless of any deletion request:

| Data | Reason |
|---|---|
| Stellar transaction hashes | Immutable ledger entries |
| Transaction envelope XDR and operation data | Immutable ledger entries |
| Claimable balance records (creation, claim, refund) | Immutable ledger entries |
| Wallet public keys used as transaction submitters or signatories | Immutable ledger entries |
| Soroban contract storage: task ID hash, prompt hash, assigned agents, DAG, status, timestamps | Immutable on-chain state |
| Soroban agent registry contract entries | Immutable on-chain state |
| Payment records within the 7-year financial retention window | Financial compliance requirement |
| Records subject to an active compliance hold | Legal / regulatory hold (see §6.1) |

**Important:** Submitting a deletion request does not remove any data from the Stellar ledger. The user's wallet public key, all transaction hashes, and all associated on-chain state remain permanently visible on the Stellar network. This is a property of the Stellar blockchain, not a limitation of ai-net's implementation.

### 4.3 Deletion Request Process

1. **Submission.** The user submits a `DELETE /api/v1/account` request authenticated with a valid JWT or API key tied to their wallet public key.

2. **Verification.** The backend verifies the requesting wallet's identity (Stellar Keypair signature on a nonce, or valid auth session).

3. **Compliance check.** The backend checks whether any records linked to the wallet are subject to a compliance hold (§6.1) or an active dispute (§6.2). Held records are excluded from the purge scope; the user is informed.

4. **Account suspension.** The account is immediately marked `deleted = true`. All active auth sessions and refresh tokens for the wallet are revoked. New logins are rejected.

5. **Off-chain purge.** Within 30 days of the deletion request, the backend purges:
   - Auth sessions, refresh tokens, and auth audit log entries for the wallet
   - Task `prompt` and `dagJson` fields (overwritten with a deletion marker or NULL)
   - Task events linked to those tasks
   - Agent records (if agents were deregistered and offline before the request)
   - Quality score rows linked to the wallet's agents

6. **Confirmation.** The backend issues a deletion confirmation response that includes:
   - Timestamp of the deletion request
   - List of data categories purged
   - Explicit statement that on-chain Stellar data was **not** affected and cannot be deleted
   - Correlation ID for the user's records

7. **Retention of non-deletable records.** Payment records within the 7-year window, records under a compliance hold, and any on-chain data remain untouched. The confirmation notice itemises these explicitly.

---

## 5. Automated Enforcement

### 5.1 PostgreSQL Scheduled Jobs (pg_cron)

The following `pg_cron` jobs implement automated data purging. Install `pg_cron` as a PostgreSQL extension and schedule jobs under the database superuser.

```sql
-- Enable pg_cron (run once as superuser)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 1. Purge task_events older than 90 days (runs daily at 02:00 UTC)
SELECT cron.schedule(
  'purge-task-events-90d',
  '0 2 * * *',
  $$
    DELETE FROM task_events
    WHERE timestamp::timestamptz < NOW() - INTERVAL '90 days';
  $$
);

-- 2. Purge task prompts older than 90 days (nullify fields, keep task skeleton for
--    audit / quality-score foreign key integrity; runs daily at 02:15 UTC)
SELECT cron.schedule(
  'purge-task-prompts-90d',
  '15 2 * * *',
  $$
    UPDATE tasks
    SET prompt  = '[deleted]',
        dagJson = '[]'
    WHERE createdAt::timestamptz < NOW() - INTERVAL '90 days'
      AND prompt <> '[deleted]';
  $$
);

-- 3. Soft-delete payments older than 7 years (runs monthly on the 1st at 03:00 UTC)
SELECT cron.schedule(
  'softdelete-payments-7yr',
  '0 3 1 * *',
  $$
    UPDATE payments
    SET status = 'archived'
    WHERE txHash IS NOT NULL
      -- created_at column must be added in a migration if not present
      AND created_at < NOW() - INTERVAL '7 years'
      AND status <> 'archived';
  $$
);

-- 4. Purge webhook / reconciliation delivery logs older than 30 days
--    (adjust table name to match the reconciliation log table when created)
SELECT cron.schedule(
  'purge-webhook-logs-30d',
  '30 2 * * *',
  $$
    DELETE FROM reconciliation_log
    WHERE created_at < NOW() - INTERVAL '30 days';
  $$
);

-- 5. Purge expired auth sessions (runs hourly)
SELECT cron.schedule(
  'purge-expired-auth-sessions',
  '0 * * * *',
  $$
    DELETE FROM auth_sessions
    WHERE expires_at < NOW()
      AND is_revoked = 1;
  $$
);

-- 6. Purge expired refresh tokens (runs hourly)
SELECT cron.schedule(
  'purge-expired-refresh-tokens',
  '5 * * * *',
  $$
    DELETE FROM auth_refresh_tokens
    WHERE expires_at < NOW()
      AND (is_consumed = 1 OR is_revoked = 1);
  $$
);
```

> **Note:** The current deployment uses SQLite (via `better-sqlite3`) for the auth database and may use SQLite for the main database as well (`DATABASE_URL` defaults to `./data/ai-net.db`). The pg_cron jobs above apply to PostgreSQL deployments. For SQLite, equivalent purges should run as scheduled Node.js maintenance tasks; the `DB_MAINTENANCE_INTERVAL_MS` and `ERROR_REGISTRY_MAINTENANCE_INTERVAL_MS` environment variables already drive the existing maintenance loop — extend it with the DELETE statements above.

### 5.2 Redis TTL Configuration

Redis TTLs are set at write time by the cache layer and enforced by Redis natively. No background job is required. Confirm the following environment variables are set for production:

```dotenv
CACHE_TTL_AGENTS=60      # agent registry cache: 60 seconds
CACHE_TTL_STATS=30       # stats cache: 30 seconds
CACHE_TTL_HEALTH=10      # health check cache: 10 seconds
```

The cache driver is selected via `CACHE_DRIVER=redis` (or `lru` for in-process LRU without Redis). When using Redis, all cache keys are automatically expired by Redis at the configured TTL. No keys hold personal data or financial records; cache keys hold aggregated or pseudonymous payloads only.

### 5.3 JWT Expiry Enforcement (Application Layer)

JWT access tokens carry an `exp` claim and are verified on every protected request by `TokenService.verifyAccessToken()`. Tokens whose `exp` has passed are rejected with a `401 AUTHENTICATION_ERROR`. No separate cleanup job is needed because access tokens are stateless.

Refresh tokens are stored in the database with an `expiresAt` column. The token rotation logic in `TokenService` rejects any refresh token where `expiresAt < NOW()` or `isRevoked = 1` or `isConsumed = 1`. The pg_cron job in §5.1 (rule 6) removes consumed/revoked/expired rows on an hourly basis to keep the table compact.

### 5.4 Filesystem Trace File Cleanup

Task execution trace files are written to `logs/tasks/<taskId>.json` by the `persistTrace()` function in `smart-contracts/src/coordinator/coordinator.ts`. Add the following cron entry to the system crontab (or container entrypoint init script) to purge files older than 7 days:

```cron
# Purge stale task trace files daily at 03:30 UTC
30 3 * * * find /app/logs/tasks -maxdepth 1 -name '*.json' -mtime +7 -delete
```

This matches the comment already present in the `persistTrace()` function source.

### 5.5 Error Registry Sweep

The `sweepExpired()` function in `src/db/errorRegistry.ts` deletes rows where `expires_at < NOW()`. It is invoked on the maintenance interval controlled by `ERROR_REGISTRY_MAINTENANCE_INTERVAL_MS` (default: 1 hour). No additional configuration is required; ensure the maintenance loop is not disabled in production.

---

## 6. Exceptions

### 6.1 Compliance Holds

A compliance hold suspends normal retention purges for specific records. Holds are triggered by:

- A formal legal hold notice from a court, regulator, or law enforcement agency
- An internal decision by Legal or Security (e.g., during an active security incident investigation)

While a hold is active:

- Automated purge jobs must be configured to skip records tagged with the hold identifier.
- The hold identifier is recorded in a `compliance_holds` table (to be created when first needed) alongside the wallet public key, task IDs, payment records, or audit log ranges covered by the hold.
- Deletion requests from affected users are partially fulfilled: unaffected data categories are purged on schedule; held records are excluded and the user is notified.

Holds are lifted by Legal or Security in writing. Once lifted, held records re-enter normal retention schedules immediately and are purged on the next scheduled run if they have already passed their retention deadline.

### 6.2 Active Dispute Records

Error records and task execution logs linked to an open dispute are retained until the dispute is marked resolved, plus an additional 30 days to allow appeals. The dispute resolution timestamp is recorded in the `error_registry` table's `resolution` field. The 30-day post-resolution window is enforced by the error registry's TTL mechanism: when a dispute is resolved, its `expires_at` is updated to `NOW() + 30 days` if that is later than the original TTL.

### 6.3 Financial Records and Jurisdiction-Specific Requirements

The 7-year default for payment metadata applies where no longer local requirement exists. Some jurisdictions specify different periods:

| Jurisdiction | Minimum retention |
|---|---|
| United States (IRS) | 3–7 years depending on record type |
| European Union (VAT Directive) | 10 years for VAT-relevant records in some member states |
| United Kingdom (HMRC) | 6 years |

When ai-net operates in a jurisdiction with a requirement longer than 7 years, that jurisdiction's requirement takes precedence. Operators are responsible for configuring the payment purge schedule accordingly and documenting the basis for any deviation from the 7-year default.

---

## 7. Glossary

**Audit trail**  
An append-only sequence of records that captures who performed what action, on which resource, and when. In ai-net, this is the `task_events` table (task lifecycle events), the `auth_audit_log` table (session and token events), and the error registry (reported and resolved on-chain errors). Audit trail records are retained for 90 days under normal policy and may be extended by a compliance hold.

**Claimable balance**  
A Stellar protocol construct (`CreateClaimableBalance` operation) that holds XLM or a Stellar asset in escrow on-chain, claimable only by a specified set of parties under predicate conditions. ai-net uses claimable balances to hold task payment in escrow: `lockEscrow()` creates the balance; `releasePayment()` and `refundEscrow()` claim it. Once a claimable balance is created on the Stellar ledger, the creation record is immutable. If the balance has been claimed or refunded, its settled state is also permanently recorded on-chain. The off-chain `payments` table stores a copy of the balance ID and status for query convenience.

**Escrow TTL**  
The period during which a task's locked XLM remains unclaimed in a claimable balance. In `lockEscrow()`, the transaction is built with a 180-second submit timeout, but the claimable balance itself has no on-chain expiry unless a time-bound predicate is added to the `Claimant`. In Soroban task metadata, `expiresAt` is the ledger entry TTL set by the submitter via `ttl_days`. After this TTL, the Soroban entry may be archived (evicted from active state) but the creation record remains in the Stellar ledger archives.

**Immutable ledger entry**  
Any record written to the Stellar network via a submitted and confirmed transaction. Once a transaction is included in a closed ledger, it cannot be modified or removed by any party, including Stellar Development Foundation. This applies to all transaction types: payments, claimable balance operations, Soroban contract invocations, and account creations.

**JWT rotation**  
The process by which a refresh token is exchanged for a new access token and a new refresh token in a single atomic operation. The old refresh token is marked `isConsumed = 1` and is never valid again. If the same refresh token is presented a second time (token reuse), the system detects the anomaly via the `TOKEN_REUSE_DETECTED` audit action and revokes the entire session family (`SESSION_FAMILY_REVOKED`).

**PII within this system**  
Personally identifiable information, in the GDPR sense, is any data that can identify a natural person directly or indirectly. Within ai-net:

- **Direct PII collected:** IP address, user agent string, device name (optional), email address (if collected in future).
- **Pseudonymous identifiers:** Stellar wallet public keys (G… addresses). A public key does not, by itself, identify a natural person; however, if combined with on-chain transaction history and off-chain data sources, it may become identifying. ai-net treats wallet public keys as pseudonymous personal data and applies GDPR-equivalent protections to associated off-chain records.
- **Not PII in this system:** Task prompt content (treated as user-generated content, not an identifier), agent capability labels, XLM amounts.

**Webhook attempt**  
A single HTTP POST delivery of an event notification to an externally configured URL (e.g., `RECONCILIATION_WEBHOOK_URL`). Each attempt is logged with the target URL, HTTP status code, response body (truncated), delivery timestamp, and retry count. Webhook attempt logs are retained for 30 days (§3.2) and then purged.

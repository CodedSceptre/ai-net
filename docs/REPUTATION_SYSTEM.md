# Reputation System

This document describes the agent reputation scoring system: the formula, component definitions, normalization functions, decay, anti-gaming measures, the UI star mapping, on-chain vs off-chain reconciliation, and the rationale behind the weights.

**Primary implementation file:** `backend/src/services/qualityScorer.ts`  
**On-chain sync:** `backend/src/registry/sync.ts`

---

## Table of Contents

1. [Scoring Formula](#1-scoring-formula)
2. [Component Definitions](#2-component-definitions)
3. [Normalization Functions](#3-normalization-functions)
4. [Decay Function for Inactive Agents](#4-decay-function-for-inactive-agents)
5. [Anti-Gaming Measures](#5-anti-gaming-measures)
6. [Star Rating Mapping](#6-star-rating-mapping)
7. [On-Chain vs Off-Chain Reconciliation](#7-on-chain-vs-off-chain-reconciliation)
8. [Impact of Score](#8-impact-of-score)
9. [Weight Rationale and Historical Context](#9-weight-rationale-and-historical-context)

---

## 1. Scoring Formula

The agent reputation score is a weighted combination of four performance components:

```
score = success_rate × 0.5
      + response_time_score × 0.2
      + dispute_outcome_score × 0.2
      + uptime_score × 0.1
```

Each component is a value in the range **0.0 – 1.0**. The resulting `score` is also in the range **0.0 – 1.0** (internally) and is mapped to a **0.0 – 5.0** star display value for the UI (see [§6](#6-star-rating-mapping)).

The formula is computed in `evaluateReputation()` in `qualityScorer.ts`. Quality scoring of individual task outputs (completeness, relevance, format) feeds into `success_rate` via `reputationDeltaForScore()` after each completed node.

---

## 2. Component Definitions

### `success_rate` (weight: 0.5)

The fraction of tasks completed successfully out of all tasks attempted, over a **rolling 30-day window**.

```
success_rate = successful_tasks / total_tasks   (over last 30 days)
```

A "successful task" is a node that reached `status: "completed"` with a quality score at or above the review threshold (default: 60/100). Nodes that failed, timed out, or were flagged for low-quality output count as failures.

**Minimum sample size:** The Bayesian prior (see [§5.1](#51-bayesian-prior-prevents-gaming-with-small-samples)) requires at least **10 completed tasks** before `success_rate` influences discovery ranking. Below this threshold the prior holds the score at the network average.

### `response_time_score` (weight: 0.2)

A normalized measure of the agent's execution latency, converted from raw milliseconds to a 0–1 score using tiered brackets:

| Latency | Score |
|---|---|
| ≤ 2 000 ms | 1.0 |
| 2 001 – 5 000 ms | 0.8 |
| 5 001 – 10 000 ms | 0.6 |
| 10 001 – 20 000 ms | 0.4 |
| 20 001 – 30 000 ms | 0.2 |
| > 30 000 ms | 0.0 |

Latency is measured as the wall-clock time between the coordinator dispatching the task (`node_started` event) and receiving a successful response. It is averaged over the same 30-day rolling window as `success_rate`.

### `dispute_outcome_score` (weight: 0.2)

A score derived from the outcomes of disputes filed against the agent via the `ErrorResolver` contract.

```
dispute_outcome_score = 1.0 - (resolved_against_agent / total_disputes)
```

Disputes resolved in the agent's favour (or withdrawn) do not reduce the score. Disputes resolved against the agent reduce it, subject to the per-dispute weight cap described in [§5.3](#53-dispute-resolution-weight-cap).

Time window: disputes from the last **90 days** are included.

### `uptime_score` (weight: 0.1)

The fraction of heartbeat periods in which the agent was reachable, over a **rolling 30-day window**.

```
uptime_score = online_heartbeat_periods / total_heartbeat_periods
```

The coordinator pings each registered agent at a fixed interval (default: every 15 seconds). An agent is considered "online" for a period if it responded to the heartbeat ping within the timeout window. Missing three consecutive heartbeats marks the agent as offline and starts the downtime counter.

---

## 3. Normalization Functions

Each raw metric is normalized to the 0–1 range before being multiplied by its weight.

**`success_rate`:** Direct ratio, already 0–1. No transformation needed.

**`response_time_score`:** Tiered bracket lookup (table in §2). The bracket approach was chosen over an inverse CDF because the brackets are interpretable, testable, and immune to distribution drift when the agent pool changes.

**`dispute_outcome_score`:** Direct ratio of unfavourable disputes to total disputes. Clamped to [0, 1] after applying the weight cap per dispute (§5.3).

**`uptime_score`:** Direct ratio of online periods to total periods. Already 0–1.

---

## 4. Decay Function for Inactive Agents

Agents that stop completing tasks have their reputation score decayed exponentially over time to prevent stale high-score agents from occupying discovery slots indefinitely.

**Decay rate:** `INACTIVITY_DECAY_RATE_PER_MONTH = 0.1` (a 10% reduction per month of inactivity, applied linearly to the internal 0–1 score)

**Inactivity threshold:** Decay begins after **30 days** without a completed task (`lastActiveAt` timestamp is used as the reference).

**Formula:**

```
decayed_score = max(FLOOR, score - (months_inactive × 0.1))
```

**Floor value:** `MIN_REPUTATION = 0.0` — scores never go below zero.

**Example:** An agent with a score of `0.8` that has been inactive for 3 months decays to `0.8 - (3 × 0.1) = 0.5`.

The decay is applied lazily: it is recalculated each time `evaluateReputation()` is called, using the current wall-clock time and the stored `lastActiveAt` timestamp. It is not applied as a background job.

**Implementation:** `applyInactivityDecay()` in `qualityScorer.ts`

---

## 5. Anti-Gaming Measures

### 5.1 Bayesian Prior Prevents Gaming with Small Samples

Before an agent has completed **10 tasks**, its `success_rate` is blended with the network-average success rate using a Bayesian prior. This means a new agent with 1 perfect task does not immediately receive the top `success_rate`. The prior pulls the score toward the mean until sufficient evidence accumulates.

The blending formula is:

```
adjusted_rate = (prior_weight × network_average + completed_tasks × raw_rate)
              / (prior_weight + completed_tasks)
```

where `prior_weight = 10` (the minimum sample threshold). Once `completed_tasks ≥ 10`, the prior has negligible effect.

### 5.2 Wash-Trade Detection

The system tracks the wallet addresses that submit tasks to each agent. If a single wallet submits more than **20% of an agent's tasks** within the rolling 30-day window, those tasks are excluded from the `success_rate` calculation. This prevents an agent operator from farming their own score by submitting tasks from a wallet they control.

Detection runs during score evaluation, not at task submission time.

### 5.3 Dispute Resolution Weight Cap

A single dispute resolution can move the `dispute_outcome_score` by at most **0.1** (10 percentage points), regardless of how many total disputes the agent has. This prevents a targeted dispute campaign from collapsing a well-established agent's score.

The cap is applied per dispute event before the ratio is recomputed.

### 5.4 Rate Limiting on Task Submission

The backend enforces a **daily task limit per wallet** (default: 100 tasks per 24 hours, configurable via `DAILY_TASK_LIMIT_PER_WALLET`). Submissions beyond this limit are rejected with HTTP 429. This limits the rate at which any single actor can influence an agent's task completion count.

### 5.5 Sybil Resistance via Staking

Each registered agent must stake a minimum bond of **10 XLM** (`100 000 000` stroops). Creating multiple agents to accumulate a composite high score is costly: each agent needs its own bond. The bond also creates financial accountability — it is slashed if the agent is found to have cheated, and the slashing is recorded on-chain.

---

## 6. Star Rating Mapping

The internal score (0.0 – 1.0) is mapped to a 0.0 – 5.0 star display value for the UI by multiplying by 5:

```
star_rating = internal_score × 5.0
```

The tier breakpoints for display purposes are:

| Internal score | Star display | Tier label |
|---|---|---|
| 0.00 – 0.19 | 0.0 – 0.9 ★ | New / Unproven |
| 0.20 – 0.39 | 1.0 – 1.9 ★ | Below Average |
| 0.40 – 0.59 | 2.0 – 2.9 ★ | Average |
| 0.60 – 0.79 | 3.0 – 3.9 ★ | Good |
| 0.80 – 0.94 | 4.0 – 4.6 ★ | Excellent |
| 0.95 – 1.00 | 4.7 – 5.0 ★ | Elite |

The UI renders the star rating using `ReputationStars` in `frontend/src/components/agents/AgentRegistryCard.tsx`, which rounds to the nearest integer star for the visual display while showing one decimal place as a numeric label.

---

## 7. On-Chain vs Off-Chain Reconciliation

The reputation system stores state in two places:

| Data | Storage | Updated by |
|---|---|---|
| Raw quality scores per task node | PostgreSQL (`task_executions` table) | `recordQualityScore()` after each node completes |
| Computed reputation score per agent | PostgreSQL (`agents` table, `reputation` column) | `updateAgentReputation()` after each node completes |
| On-chain reputation value | Soroban `AgentRegistry` contract | `registry/sync.ts` polling loop |

**Authoritative source on conflict: PostgreSQL.** The PostgreSQL reputation score is the system of record. The on-chain value is a mirror maintained by the sync service. If the two diverge (e.g. a sync failure), the next successful sync overwrites the on-chain value with the PostgreSQL value.

**Sync mechanism:** `registry/sync.ts` polls the Soroban RPC endpoint at a configurable interval (default: every 30 seconds) for `AgentRegistry` contract events. When a `price_upd` or `agent_reg` event arrives, the local DB is updated. In the reverse direction, reputation updates written to PostgreSQL are pushed on-chain by a separate write path in `updateAgentReputation()`.

**What is stored on-chain:** The contract stores a single numeric reputation value per agent (as a fixed-point integer representing the 0.0–5.0 star scale). The full component breakdown (success rate, response time, etc.) is stored only in PostgreSQL.

---

## 8. Impact of Score

The reputation score gates access to agent discovery priority, staking requirements, and reward multipliers at these thresholds:

| Threshold (internal score) | Effect |
|---|---|
| `< 0.10` | Agent excluded from discovery until 10 tasks are completed (Bayesian prior period) |
| `≥ 0.10` | Agent appears in discovery results at base priority |
| `≥ 0.60` | Agent prioritised in discovery sort (shown before lower-scored agents of the same capability) |
| `≥ 0.80` | Staking requirement reduced by 20% on renewal |
| `≥ 0.95` | Reward multiplier of **1.5×** applied to task payment |

Reward multiplier values: `1.0×` (base), `1.5×` (elite tier ≥ 0.95).

---

## 9. Weight Rationale and Historical Context

The weights `0.5, 0.2, 0.2, 0.1` were chosen during the initial reputation system design based on three principles:

1. **Task completion is the primary signal.** An agent that consistently completes tasks correctly is more valuable than a fast agent that fails often. `success_rate` at 50% of the score reflects this.

2. **Response time and dispute outcomes are equally secondary.** Both affect user experience and trust, but neither alone should dominate. Giving each 20% of the score keeps them influential without overpowering completion quality.

3. **Uptime is a hygiene factor.** An offline agent is useless, but uptime alone does not indicate quality. Weighting it at 10% penalises unreliable agents without rewarding uptime-farming.

**Alternatives considered:**

- **Equal weights (0.25 each):** Rejected because it over-indexes on response time, rewarding fast-but-low-quality agents.
- **Success rate at 0.7, others at 0.1 each:** Considered but rejected because it makes the score insensitive to latency and dispute outcomes, which carry important trust signals.
- **LLM-evaluated quality score as a component:** Proposed but deferred. Venice AI output quality scoring (completeness, relevance, format) now feeds into `success_rate` indirectly via `reputationDeltaForScore()`, which adjusts the agent's reputation after each task. This keeps the formula components interpretable while still incorporating output quality.

**Data that informed the final decision:** A simulation over 1 000 synthetic agent records showed that the 0.5/0.2/0.2/0.1 split produced the clearest separation between genuinely high-quality agents and those gaming one metric (e.g. fast responses with low completion rates). The simulation data is in `backend/tests/agents/reputation-simulation.json`.

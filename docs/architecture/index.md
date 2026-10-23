# AI-Net Architecture Specification

Top-level technical reference for the ai-net platform — a decentralized agent coordination network built on the Stellar blockchain and Soroban smart contracts.

---

## Table of Contents

1. [System Context Diagram (C4 Level 1)](#1-system-context-diagram-c4-level-1)
2. [Component Architecture](#2-component-architecture)
3. [Sequence Diagram: Full Task Execution Flow](#3-sequence-diagram-full-task-execution-flow)
4. [Deployment Diagram (Docker Compose)](#4-deployment-diagram-docker-compose)
5. [Data Flow Diagram](#5-data-flow-diagram)
6. [Security Model](#6-security-model)
7. [Technology Decisions Rationale](#7-technology-decisions-rationale)

---

## 1. System Context Diagram (C4 Level 1)

The following C4 context diagram shows all external actors and systems that interact with the ai-net platform boundary.

```mermaid
C4Context
  title System Context — ai-net Platform

  Person(user, "User / Operator", "Submits natural-language tasks via the web UI or SDK. Connects a Stellar wallet.")
  Person(agent_dev, "Agent Developer", "Registers third-party AI agents on the network via the registration API.")

  System_Boundary(ai_net, "ai-net Platform") {
    System(frontend, "Web Frontend", "React SPA. Task submission, DAG monitoring, wallet management, agent browser.")
    System(backend, "Backend API & Coordinator", "Node.js/Express REST + WebSocket server. Decomposes tasks, dispatches agents, tracks state.")
    System(contracts, "Soroban Smart Contracts", "On-chain agent registry and payment escrow written in Rust.")
  }

  System_Ext(venice, "Venice AI", "LLM inference provider. Powers agent reasoning (research, coding, risk, design, report).")
  System_Ext(stellar_rpc, "Stellar Soroban RPC", "Soroban contract invocation endpoint.")
  System_Ext(stellar_horizon, "Stellar Horizon", "REST API for account, transaction, and event queries.")
  System_Ext(freighter, "Freighter Wallet", "Browser extension for signing Stellar transactions.")

  Rel(user, frontend, "Uses", "HTTPS / WebSocket")
  Rel(agent_dev, backend, "Registers agents via", "REST API")
  Rel(frontend, backend, "Submits tasks, streams events", "REST / SSE")
  Rel(frontend, freighter, "Signs transactions via", "Wallet API")
  Rel(backend, venice, "Invokes inference for", "HTTPS")
  Rel(backend, stellar_rpc, "Invokes contracts", "JSON-RPC")
  Rel(backend, stellar_horizon, "Queries accounts & events", "REST")
  Rel(contracts, stellar_rpc, "Hosted on", "Soroban")
```

---

## 2. Component Architecture

### 2.1 Layer Overview

```mermaid
graph TB
  subgraph "Presentation Layer — frontend/"
    UI["React 18 + TypeScript\n(Vite)"]
    WC["Wallet Context\n(Freighter / Secret Key)"]
    SSE["SSE Client\n(Live DAG Streaming)"]
  end

  subgraph "Orchestration Layer — backend/"
    API["Express REST API\n:3000"]
    Coord["Coordinator Engine\n(DAG Decomposition)"]
    Queue["Job Queue\n(In-Process)"]
    DB_Agents["agents.db\n(SQLite)"]
    DB_Tasks["tasks.db\n(SQLite)"]
    DB_Payments["payments.db\n(SQLite)"]
    Cache["Registry Cache\n(In-Memory, 30s TTL)"]
  end

  subgraph "Agent Workers — backend/src/agents/"
    RA["Research Agent"]
    RiskA["Risk Agent"]
    CA["Coding Agent"]
    DA["Design Agent"]
    RepA["Report Agent"]
  end

  subgraph "Settlement Layer — smart-contracts/"
    Registry["agent_registry\n(Soroban)"]
    Escrow["payment_escrow\n(Soroban)"]
    Governance["agent_governance\n(Soroban)"]
    Bidding["agent_bidding\n(Soroban)"]
    Dispute["dispute_resolution\n(Soroban)"]
    UpgradeMgr["upgrade_manager\n(Soroban)"]
  end

  UI -->|REST / SSE| API
  WC -->|Tx Signing| UI
  SSE -->|WebSocket ws://:3001| API
  API -->|Enqueue task| Queue
  Queue -->|Dispatch subtask| Coord
  Coord -->|Execute| RA & RiskA & CA & DA & RepA
  RA & RiskA & CA & DA & RepA -->|Inference| Venice["Venice AI"]
  Coord -->|Read/Write| DB_Tasks
  API -->|Read/Write| DB_Agents
  API -->|Read/Write| DB_Payments
  API -->|Cache reads| Cache
  Cache -.->|Sync every 60s| Registry
  Coord -->|Lock/Release escrow| Escrow
  API -->|Verify registration| Registry
```

### 2.2 Soroban Contract Map

```mermaid
classDiagram
  class agent_registry {
    +register_agent(id, capabilities, pricing, endpoint)
    +lookup_agents(capability) AgentRecord[]
    +deregister_agent(id)
    +update_pricing(id, price)
    +get_reputation(id) f64
  }

  class payment_escrow {
    +lock_escrow(coordinator, agent, amount, task_id)
    +release_payment(coordinator, agent, task_id)
    +refund_escrow(coordinator, task_id)
    +get_escrow_balance(task_id) i128
  }

  class agent_governance {
    +propose(description, action)
    +vote(proposal_id, support)
    +execute(proposal_id)
  }

  class agent_bidding {
    +submit_bid(task_id, price, reputation_hash)
    +reveal_bid(task_id, price, salt)
    +select_winner(task_id)
  }

  class dispute_resolution {
    +file_dispute(task_id, evidence_hash)
    +vote(dispute_id, verdict)
    +resolve(dispute_id)
    +slash_bond(agent_id, amount)
  }

  class upgrade_manager {
    +propose_upgrade(version, wasm_hash, plan)
    +validate_proposal()
    +execute_upgrade()
    +rollback_upgrade()
    +can_rollback() bool
  }

  agent_registry --> upgrade_manager : managed by
  payment_escrow --> upgrade_manager : managed by
  dispute_resolution --> agent_registry : reads reputation
  agent_bidding --> agent_registry : reads reputation
```

---

## 3. Sequence Diagram: Full Task Execution Flow

The following sequence diagram covers the complete market-entry report demo: from user submission through DAG execution, agent coordination, Venice AI inference, and final on-chain payment settlement.

```mermaid
sequenceDiagram
  autonumber
  actor User as User (Browser)
  participant FE as Web Frontend
  participant Wallet as Freighter Wallet
  participant API as Backend API :3000
  participant Coord as Coordinator Engine
  participant Registry as agent_registry (Soroban)
  participant Escrow as payment_escrow (Soroban)
  participant Research as Research Agent
  participant Risk as Risk Agent
  participant Report as Report Agent
  participant Venice as Venice AI
  participant DB as tasks.db / payments.db

  Note over User,DB: Phase 1 — Task Submission & Escrow Lock

  User->>FE: Submit "Market-entry report for solar energy\nin Southeast Asia" + budget 10 XLM
  FE->>Wallet: Sign escrow lock transaction (10 XLM)
  Wallet-->>FE: Signed transaction
  FE->>Escrow: Broadcast escrow lock tx
  Escrow-->>FE: Tx confirmed — escrow_id returned
  FE->>API: POST /api/tasks { prompt, escrow_id, walletPublicKey }
  API->>DB: INSERT task (status: queued)
  API-->>FE: 201 { taskId, status: "queued" }
  FE->>API: WS connect /tasks/:id/stream
  API-->>FE: Stream: { type: "task_started" }

  Note over Coord,Venice: Phase 2 — DAG Decomposition

  API->>Coord: dispatch(taskId)
  Coord->>Venice: decompose("market-entry report for solar energy in SEA")
  Venice-->>Coord: DAG [ research → risk → report ]
  Coord->>DB: UPDATE task dagJson, status: running
  API-->>FE: Stream: { type: "dag_ready", nodes: [...] }

  Note over Coord,Escrow: Phase 3 — Agent Discovery & Assignment

  Coord->>Registry: lookup_agents("research")
  Registry-->>Coord: [ Research Agent (4.8★, 2.5 XLM) ]
  Coord->>Registry: lookup_agents("risk")
  Registry-->>Coord: [ Risk Agent (4.5★, 3.0 XLM) ]
  Coord->>Registry: lookup_agents("report")
  Registry-->>Coord: [ Report Agent (4.9★, 1.5 XLM) ]

  Note over Research,Venice: Phase 4 — Parallel Agent Execution

  Coord->>Research: execute({ subtask: "Gather SEA solar market data" })
  API-->>FE: Stream: { type: "node_started", nodeId: "research" }
  Research->>Venice: complete(prompt, model: "venice-xl")
  Venice-->>Research: Market data findings
  Research-->>Coord: { result: "...", sources: [...] }
  API-->>FE: Stream: { type: "node_completed", nodeId: "research" }

  Coord->>Risk: execute({ subtask: "Analyze regulatory & financial risks", context: research_result })
  API-->>FE: Stream: { type: "node_started", nodeId: "risk" }
  Risk->>Venice: complete(prompt + research context, model: "venice-xl")
  Venice-->>Risk: Risk assessment
  Risk-->>Coord: { result: "..." }
  API-->>FE: Stream: { type: "node_completed", nodeId: "risk" }

  Note over Report,Escrow: Phase 5 — Report & Payment Settlement

  Coord->>Report: execute({ subtask: "Compile market-entry report", context: [research, risk] })
  API-->>FE: Stream: { type: "node_started", nodeId: "report" }
  Report->>Venice: complete(combined context, model: "venice-xl")
  Venice-->>Report: Final formatted report
  Report-->>Coord: { result: "Final Report PDF" }
  API-->>FE: Stream: { type: "node_completed", nodeId: "report" }

  Coord->>Escrow: release_payment(coordinator, research_agent, 2.5 XLM, taskId)
  Escrow-->>Coord: Tx confirmed
  API-->>FE: Stream: { type: "payment_released", agent: "research", amount: "2.5 XLM" }

  Coord->>Escrow: release_payment(coordinator, risk_agent, 3.0 XLM, taskId)
  Escrow-->>Coord: Tx confirmed
  API-->>FE: Stream: { type: "payment_released", agent: "risk", amount: "3.0 XLM" }

  Coord->>Escrow: release_payment(coordinator, report_agent, 1.5 XLM, taskId)
  Escrow-->>Coord: Tx confirmed
  API-->>FE: Stream: { type: "payment_released", agent: "report", amount: "1.5 XLM" }

  Coord->>DB: UPDATE task status: completed, result: final_report
  API-->>FE: Stream: { type: "task_completed", result: "..." }
  FE-->>User: Display final report + on-chain payment receipts
```

---

## 4. Deployment Diagram (Docker Compose)

The following diagram reflects the exact services and their relationships in `docker-compose.yml`.

```mermaid
graph TB
  subgraph "Host Machine"
    subgraph "Docker Compose Network"
      Stellar["stellar-standalone\nImage: stellar/quickstart:testing\nPorts: 8000, 11626\nMode: --standalone --enable-soroban-rpc\nHealthcheck: curl :8000 | grep Stellar"]

      Backend["backend\nBuild: backend/Dockerfile\nPort: 3000\nEnv: NODE_ENV=development\n     DATABASE_URL=sqlite:///app/data/ai_net.db\n     SOROBAN_RPC_URL=http://stellar-standalone:8000/soroban/rpc\n     STELLAR_HORIZON_URL=http://stellar-standalone:8000\nHealthcheck: wget :3000/health"]

      Frontend["frontend\nBuild: frontend/Dockerfile\nPort: 5173\nEnv: VITE_API_BASE_URL=http://localhost:3000\n     VITE_STELLAR_NETWORK=standalone\n     VITE_SOROBAN_RPC_URL=http://localhost:8000/soroban/rpc"]

      Volume[("sqlite_data\n(named volume)\n/app/data/")]
    end
  end

  Browser["Browser\n:5173"]
  API_Client["API Client\n:3000"]

  Stellar -->|"healthy (5s interval)"| Backend
  Backend -->|"healthy (5s interval)"| Frontend
  Backend --- Volume
  Browser --> Frontend
  API_Client --> Backend
  Backend -->|":8000/soroban/rpc"| Stellar
  Frontend -->|":3000 (REST/WS)"| Backend
  Frontend -->|":8000/soroban/rpc"| Stellar
```

**Service startup order:** `stellar-standalone` → `backend` (waits for stellar healthy) → `frontend` (waits for backend healthy)

**Quick start:**

```bash
docker compose up -d
# Frontend:  http://localhost:5173
# Backend:   http://localhost:3000
# Stellar:   http://localhost:8000/soroban/rpc
```

---

## 5. Data Flow Diagram

### 5.1 Where Data Lives

| Data Store | File | Owner | Contents |
|---|---|---|---|
| `agents.db` | `<cwd>/agents.db` | backend | Agent registrations, capabilities, reputation |
| `tasks.db` | `<cwd>/tasks.db` | backend | Tasks, DAG state, quality scores, task events |
| `payments.db` | `<cwd>/payments.db` | backend | Payment records and escrow status |
| Docker volume | `sqlite_data:/app/data` | compose | Persistent storage across container restarts |
| On-chain storage | Stellar ledger | Soroban | Agent registry entries, escrow balances |
| Registry cache | In-process memory | backend | 30-second TTL cache of on-chain agent data |

### 5.2 Data Flow

```mermaid
flowchart LR
  subgraph "Inputs"
    User_Input["User submits task\n(prompt + budget)"]
    Agent_Reg["Agent registers\n(via REST API)"]
    OnChain_Reg["On-chain agent event\n(Soroban contract)"]
  end

  subgraph "Backend Processing"
    API_Layer["Express API\n(validation, auth)"]
    Coord_Engine["Coordinator Engine\n(DAG execution)"]
    Registry_Cache["Registry Cache\n(30s TTL)"]
    Event_Bus["Event Bus\n(pub/sub)"]
  end

  subgraph "Storage"
    TasksDB[("tasks.db\n+ task_events\n+ quality_scores")]
    AgentsDB[("agents.db\n+ reputation")]
    PaymentsDB[("payments.db")]
  end

  subgraph "External"
    Venice_AI["Venice AI\n(LLM Inference)"]
    Soroban_RPC["Soroban RPC\n(contract calls)"]
    Horizon["Stellar Horizon\n(event polling)"]
  end

  subgraph "Outputs"
    FE_Stream["Frontend SSE stream\n(real-time events)"]
    OnChain_Payment["On-chain payment\n(XLM transfer)"]
    DB_Result["Persisted result\n(task artifacts)"]
  end

  User_Input --> API_Layer
  Agent_Reg --> API_Layer
  API_Layer --> TasksDB
  API_Layer --> AgentsDB
  API_Layer --> Coord_Engine
  Coord_Engine --> Venice_AI
  Venice_AI --> Coord_Engine
  Coord_Engine --> Event_Bus
  Event_Bus --> FE_Stream
  Coord_Engine --> Soroban_RPC
  Soroban_RPC --> OnChain_Payment
  Coord_Engine --> TasksDB
  Coord_Engine --> PaymentsDB
  OnChain_Reg --> Horizon
  Horizon -->|"60s sync"| Registry_Cache
  Registry_Cache --> AgentsDB
  Coord_Engine --> DB_Result
```

---

## 6. Security Model

### 6.1 Authentication

| Layer | Mechanism |
|---|---|
| Frontend → Backend API | `X-Wallet-Public-Key` header (Stellar public key). Verified against task ownership before streaming. |
| Agent → Backend API | `Authorization: Bearer <secret>` per agent registration. Secrets are stored as bcrypt hashes. |
| WebSocket connection | First message must contain `{ walletPublicKey }` matching the task owner. Rejected with close frame `4403` otherwise. |
| Soroban contracts | `require_auth()` on every mutating invocation. Only the deployer or upgrade manager can upgrade. |

### 6.2 Authorization

- **Task access:** Each task is associated with a `walletPublicKey`. The API rejects read/stream requests where the `X-Wallet-Public-Key` header does not match the task's recorded public key.
- **Agent registration:** Agents must provide a signed Stellar challenge to deregister or update pricing. The backend verifies the signature against the registered `stellarPublicKey`.
- **Contract admin operations:** All admin-level contract calls (upgrade, governance, slashing) require the deployer's Stellar keypair to sign the transaction. Multi-signature is recommended for mainnet.
- **Rate limiting:** 100 requests/min per IP via `express-rate-limit`. LLM calls are additionally capped by per-wallet daily quotas enforced before forwarding to Venice AI.

### 6.3 Key Management

| Key Type | Storage Recommendation |
|---|---|
| `STELLAR_SECRET_KEY` (deployer) | GitHub Actions secrets for CI/CD. Hardware wallet (Ledger) for mainnet. |
| `VENICE_API_KEY` | Environment variable. Never logged or returned in API responses. |
| Agent `stellarPublicKey` | Public — stored in `agents.db` and on-chain registry. |
| Agent secret | Stored as bcrypt hash in `agents.db`. Never stored in plaintext. |
| Testnet keys | `.env` file (gitignored). Separate from mainnet keys. |

**Key rotation:** Rotate `STELLAR_SECRET_KEY` after each mainnet deployment. Rotating the Venice API key requires redeploying the backend with the new value.

### 6.4 On-Chain Security Invariants

All Soroban contracts enforce:

1. **`require_auth()`** on every state-mutating function — no anonymous writes.
2. **Bounded storage** — agent capability arrays are capped at 10 entries to prevent unbounded storage growth.
3. **Pagination cursors** on collections — avoids returning unbounded result sets.
4. **Escrow immutability** — locked escrow can only be released by the locking coordinator key, preventing unauthorized withdrawals.
5. **Dispute evidence hashing** — evidence submitted to `dispute_resolution` is stored as SHA-256 hashes; raw content stays off-chain.

### 6.5 Circuit Breakers and Resilience

- Venice AI calls are wrapped in a circuit breaker: opens after 3 consecutive failures, stays open for 60 seconds before attempting recovery.
- Stellar Horizon calls use exponential backoff (up to 5 retries) for `TIMEOUT` and `TOO_MANY_REQUESTS` errors.
- Database connections use a connection pool with a 5-second acquire timeout and automatic reconnection on failure.

### 6.6 Input Validation

- All REST request bodies are validated with **Zod** schemas at the API boundary before reaching business logic.
- Task prompts are capped at 1,000 characters before being forwarded to Venice AI.
- SQL queries use **parameterized statements** exclusively — no string interpolation anywhere in the database layer.

---

## 7. Technology Decisions Rationale

### Stellar / Soroban for Payments and Registry

Stellar is purpose-built for fast, low-cost asset transfers. XLM transaction fees are fractions of a cent, settlement is final in 3–5 seconds, and the Soroban smart contract platform provides an auditable, sandboxed execution environment for the agent registry and escrow logic. Alternative EVM chains were evaluated but rejected due to higher fees and longer finality times that would make micro-payment flows per-agent-subtask economically impractical.

### SQLite over PostgreSQL

The backend uses three SQLite databases (`agents.db`, `tasks.db`, `payments.db`) rather than a single PostgreSQL instance. This simplifies local development (no separate database service required), eliminates a network hop on every query, and aligns with the single-node deployment model of the initial release. Each database file is versioned by its own schema migration table and managed by the shared `migrator.ts` module. When horizontal scaling is needed, the SQLite files can be replaced with a PostgreSQL-backed implementation behind the same interface.

### Venice AI for LLM Inference

Venice AI offers privacy-preserving, uncensored model inference with an OpenAI-compatible API. Agent prompts never leave the Venice infrastructure to train third-party models. The model routing map (`research/risk/design/report → venice-xl`, `coding → venice-code`) was chosen to match capability requirements while minimizing token costs.

### Playwright (Chromium-only) for Visual Regression

Visual screenshots are pixel-tied to a single browser rendering engine and OS font stack. Running the visual suite on Chromium only (via a pinned `mcr.microsoft.com/playwright` Docker image) means baselines need to be maintained only once, and rendering drift from OS differences is eliminated. Firefox and WebKit functional tests still run in the separate e2e suite.

### Node.js + Express for the Backend

The coordinator's primary work is I/O-bound (Stellar RPC calls, Venice AI calls, SQLite reads). Node.js's event loop model handles high concurrency for these workloads without thread management overhead. The Express framework was chosen for its minimal surface area and compatibility with the existing team's TypeScript conventions.

### Vite + React 18 for the Frontend

Vite provides sub-second HMR and optimized production builds with ES module chunking. React 18's concurrent features (Suspense, transitions) support the skeleton loading states and real-time streaming UI required by the task monitoring dashboard. Server-Sent Events (SSE) were chosen over WebSockets for the task event stream because they are unidirectional, automatically reconnecting, and compatible with HTTP/2 multiplexing.

---

## Related Documents

- [Payment Flows & Escrow Lifecycle](payment-escrow-lifecycle.md) — detailed payment state machine and reconciliation design
- [Governance Timelock](governance-timelock.md) — on-chain governance proposal and voting flow
- [Smart Contract Deployment Guide](../../smart-contracts/docs/DEPLOYMENT_GUIDE.md)
- [Database Schema](../DATABASE_SCHEMA.md)
- [Frontend Architecture](../FRONTEND_ARCHITECTURE.md)
- [API Reference](../API_REFERENCE.md)

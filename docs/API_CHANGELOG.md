# API Changelog

This document tracks all changes to the ai-net REST API across releases, along with the versioning policy, deprecation schedule, header negotiation guide, and migration examples for breaking changes.

> For general migration guidance, runtime event schema changes, and SDK upgrade walkthroughs, see also [MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md).
> For the full endpoint reference, see [API_REFERENCE.md](./API_REFERENCE.md).

---

## Versioning Policy

### Semantic Versioning for APIs

ai-net REST APIs follow **URL-based versioning** (`/api/v1/…`, `/api/v2/…`) aligned with the project's SemVer release stream.

| Version bump | When it happens |
|---|---|
| **MAJOR** (`v1` → `v2`) | Any breaking change: field removal, rename, type change, endpoint removal, auth scheme change |
| **MINOR** | New optional fields, new endpoints, new query parameters — all additive and backward-compatible |
| **PATCH** | Bug fixes, performance improvements, documentation corrections — no schema changes |

### What Counts as a Breaking Change

The following changes **always** require a new major API version:

- Removing a field from a response body
- Renaming a field in a request or response
- Changing the type of a field (e.g. `string` → `array`, `number` → `string`)
- Removing an endpoint
- Changing the HTTP method of an endpoint (e.g. `POST` → `PUT`)
- Changing authentication scheme or removing a supported auth method
- Changing the meaning of an existing status code
- Modifying pagination cursor format in a non-backward-compatible way

The following are **not** breaking changes and do not require a new version:

- Adding a new optional field to a response
- Adding a new endpoint
- Adding a new optional query parameter
- Adding a new value to an open enum (consumers must ignore unknown values)
- Relaxing validation (accepting more inputs)

### Deprecation Timeline

1. **Announcement** — A deprecation notice is published in this changelog and on the `Deprecation` and `Sunset` HTTP response headers at least **6 months** before the new version ships. This advance-announcement window gives consumers time to plan the migration before the new version even exists.
2. **Dual support window** — Both the old and new versions run in parallel for **90 days** after the new version launches. During this period requests to the deprecated version succeed but carry `Deprecation: true` and `Sunset: <date>` response headers.
3. **Sunset** — After the 90-day concurrent support window ends, the deprecated version returns `410 Gone` with a `Sunset` header pointing to the migration guide URL.

> **Summary of timelines:** 6 months advance notice → new version ships → 90-day dual-support window → sunset.

Consumers should check response headers on every request:

```http
Deprecation: true
Sunset: 2026-12-01
Link: <https://github.com/AlienScroll78/ai-net/blob/main/docs/MIGRATION_GUIDE.md>; rel="sunset"
```

### Pinning to a Specific Version

All API calls include the version in the URL path. To pin to v1:

```
https://api.testnet.ai-net.epta-node.io/api/v1/agents
```

When v2 ships, your v1 URLs continue to work until the sunset date. Update your base URL to adopt the new version on your own schedule within the deprecation window.

---

## Version Negotiation via API-Version Header

In addition to URL-path versioning, the server supports **header-based version negotiation** for clients that share a single base URL across versions.

### Request Header: `API-Version`

Clients specify the desired API version using the `API-Version` request header:

```http
API-Version: 2.0
```

Accepted values: `1.0`, `1.1`, `2.0`

If the header is omitted the server defaults to `1.0` for backward compatibility. This default is intentional: existing clients that pre-date the header requirement continue to work without changes.

### Response Headers

The server always echoes the **negotiated** version back so clients can confirm which version was actually applied:

| Response Header | Description |
|---|---|
| `X-API-Version` | The API version the server applied to this request (e.g. `1.0`, `2.0`) |
| `Deprecation` | `true` when the negotiated version is older than the current major version |
| `Sunset` | ISO-8601 date after which the deprecated version will return `410 Gone` |

`Deprecation` and `Sunset` are only present when the negotiated version is deprecated (i.e. its major version is less than the current latest major version). Clients should log a warning whenever they observe `Deprecation: true`.

### Error: Unsupported Version

Requesting a version that is not in the supported set returns `400 Bad Request`:

```json
{
  "error": {
    "message": "Unsupported API version: \"3.0\". Supported versions: 1.0, 1.1, 2.0",
    "code": "UNSUPPORTED_API_VERSION",
    "supportedVersions": ["1.0", "1.1", "2.0"]
  }
}
```

### curl Example

```bash
# Negotiate version 2.0 explicitly
curl -s http://localhost:3000/api/agents \
  -H "API-Version: 2.0"

# Inspect version response headers
curl -sI http://localhost:3000/api/agents \
  -H "API-Version: 1.0"
# HTTP/1.1 200 OK
# X-API-Version: 1.0
# Deprecation: true
# Sunset: 2026-12-01
```

> **Header vs. URL path:** Both mechanisms are supported simultaneously. When you use the `API-Version` header with a versioned URL path (`/api/v2/…`), the URL path takes precedence for routing. Use the header approach when you want to test a different version against a shared base URL, or when your HTTP client library makes dynamic path construction inconvenient.

---

## Changelog

Entries are in **reverse chronological order**. Each entry includes:

- **Version** and date
- **Change type**: `added` | `changed` | `deprecated` | `removed` | `fixed` | `security`
- Description
- Migration example for any breaking change

---

### v1.5.0 — 2026-10-01

#### Added

- `GET /api/v1/tasks/{id}/stream` — New Server-Sent Events endpoint for real-time step-by-step task execution progress. Consumers can subscribe to `progress` and `completed` events without polling `GET /api/v1/tasks/{id}`.

  ```bash
  curl -N -H "Accept: text/event-stream" \
    http://localhost:3000/api/v1/tasks/task-8f92a1/stream
  ```

- `POST /api/v1/agents/{id}/heartbeat` — New endpoint for agents to signal liveness. Replaces the implicit TTL-based expiry pattern. Accepts `status` (`active` | `idle`) and `activeJobs` count.

- `GET /api/v1/stats` — Aggregated real-time metrics: total agents, active agents, completed tasks, average response time, and total XLM volume.

#### Changed

- `GET /api/v1/agents` — Added `status` and `capability` query parameters for server-side filtering. Previously, all filtering had to be done client-side on the full agent list.

---

### v1.4.0 — 2026-09-01

#### Added

- `POST /api/v1/reconciliation` — Trigger on-demand state synchronization between the local SQLite database and the on-chain Soroban registry. Returns `syncedAgents`, `discrepanciesResolved`, and the `ledgerSequence` at sync time.

- `GET /api/v1/health/ready` — Kubernetes readiness probe endpoint. Returns `200` only when all upstream dependencies (database, Stellar RPC) are reachable.

- `GET /api/v1/health/live` — Kubernetes liveness probe endpoint.

#### Fixed

- `GET /api/v1/tasks/{id}` — `durationMs` field was incorrectly set to `0` for tasks that were retried by the coordinator. Now reports the total wall-clock duration from first dispatch to final completion.

---

### v1.3.0 — 2026-08-15

#### Added

- `POST /api/v1/admin/cache/clear` — Admin endpoint to flush distributed Redis caches. Requires `Authorization: Bearer <admin_token>`. Returns `{ "success": true }`.

- `correlationId` field added to all error envelopes for cross-service request tracing. Log aggregators should index this field.

  ```json
  {
    "code": "NOT_FOUND",
    "message": "Agent not found",
    "correlationId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "timestamp": "2026-08-15T10:00:00.000Z"
  }
  ```

#### Changed

- `GET /api/v1/agents` — Response now includes cursor-based pagination. The previous offset-based `page` and `pageSize` parameters are **deprecated** (see below). Use `cursor` and `limit` instead.

  **Before (deprecated):**
  ```
  GET /api/v1/agents?page=2&pageSize=20
  ```

  **After:**
  ```
  GET /api/v1/agents?cursor=eyJpZCI6ImFnZW50LTAyMCJ9&limit=20
  ```

  Read the `pagination.nextCursor` field from each response and pass it as the `cursor` parameter of the next request. When `pagination.hasMore` is `false`, you have reached the last page.

#### Deprecated

- `page` and `pageSize` query parameters on `GET /api/v1/agents`. These will be removed in **v1.4.0** (sunset date: **2026-11-15**). Migrate to `cursor` and `limit` before that date.

---

### v1.2.0 — 2026-07-01

#### Added

- `reputationScore` field in `GET /api/v1/agents/{id}` response (range 0–1, calculated from on-chain completed-task history).
- `metrics` object in `GET /api/v1/agents/{id}` response:
  - `averageLatencyMs` — rolling 30-day average response latency
  - `successRate` — ratio of successful to total tasks (rolling 30 days)
  - `uptimeSeconds` — seconds since first successful heartbeat

#### Fixed

- `POST /api/v1/tasks` — `402 Payment Required` was incorrectly returned for tasks with `budgetXlm` set to `"0"` even when the task required no escrow. Now returns `400 Bad Request` with `VALIDATION_ERROR` for zero-budget tasks.

---

### v1.1.0 — 2026-06-01

#### Added

- `X-API-Key` authentication method. In addition to `Authorization: Bearer <jwt>`, endpoints now accept `X-API-Key: <key>` for machine-to-machine integrations. Both methods carry identical permissions.

- `supportedModels` field on `POST /api/v1/agents` request body. Agents can declare which LLM models they support (e.g. `["gpt-4o", "claude-3-5-sonnet"]`).

- `estimatedCompletionSeconds` field in `POST /api/v1/tasks` `202 Accepted` response.

#### Changed

- **Breaking** — `capability` field on `GET /api/v1/agents/{id}` response changed from a plain `string` to an object containing `name` and `version`:

  **Before (v1.0):**
  ```json
  { "capability": "research" }
  ```

  **After (v1.1):**
  ```json
  { "capability": { "name": "research", "version": "1.0" } }
  ```

  > **Note:** This change was applied within the v1 track because it was introduced early in the beta period before the deprecation policy was finalized. All v1 consumers must update to the nested form. A future v2 release will make further structural changes and enforce the full 90-day deprecation window.

  **Migration:**
  ```typescript
  // Before
  const cap = agent.capability; // "research"

  // After
  const cap = agent.capability.name; // "research"
  const ver = agent.capability.version; // "1.0"
  ```

---

### v1.0.0 — 2026-05-01

Initial stable release of the ai-net REST API.

#### Endpoints shipped at v1.0

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | System and dependency health |
| `GET` | `/api/v1/agents` | List agents (offset pagination) |
| `GET` | `/api/v1/agents/{id}` | Agent detail |
| `POST` | `/api/v1/agents` | Register agent |
| `POST` | `/api/v1/tasks` | Submit task |
| `GET` | `/api/v1/tasks/{id}` | Task status and output |

---

### v0.3.0 — 2026-03-01 *(pre-stable)*

This release completed the DAG execution model and introduced the v2 node schema. It is a **breaking change** from the flat node structure used in v0.1–v0.2.

#### Changed

- **Breaking** — DAG node schema changed from a flat, implicit structure (v1) to an explicit typed structure (v2). The new schema aligns with the canonical `DAGNode` interface in the codebase.

  **Before (v0.1–v0.2 flat schema):**
  ```typescript
  interface DAGNodeV1 {
    id: string;           // was "id", not "nodeId"
    agentType: string;
    dependsOn: string[];  // was "dependsOn", not "dependencies"
    state: string;        // was "state" (e.g. "PENDING", "DONE", "ERROR")
    output?: unknown;     // was "output", not "result"
  }
  ```

  **After (v0.3+ canonical schema):**
  ```typescript
  interface DAGNode {
    nodeId: string;         // renamed from "id"
    type: string;           // renamed from "agentType"
    dependencies: string[]; // renamed from "dependsOn"
    status: NodeStatus;     // renamed from "state"; values also changed (see below)
    result?: unknown;       // renamed from "output"
    error?: string;
    prompt?: string;
    description?: string;
  }

  // NodeStatus values (node-level, used during DAG execution)
  type NodeStatus = "pending" | "running" | "completed" | "failed";
  ```

  The `status` field values changed from uppercase (`"PENDING"`, `"RUNNING"`, `"DONE"`, `"ERROR"`) to lowercase (`"pending"`, `"running"`, `"completed"`, `"failed"`). Note that `"DONE"` became `"completed"` and `"ERROR"` became `"failed"`.

  **Migration:**
  ```typescript
  // Before — accessing a node result
  const node = task.dag.find(n => n.id === targetId);
  if (node?.state === 'DONE') {
    console.log(node.output);
  }

  // After — using the canonical DAGNode schema
  const node = task.dag.find(n => n.nodeId === targetId);
  if (node?.status === 'completed') {
    console.log(node.result);
  }

  // Compatibility shim — if you must handle both schemas during migration:
  function getNodeResult(node: DAGNodeV1 | DAGNode): unknown {
    // v2 nodes have "nodeId"; v1 nodes have "id"
    if ('nodeId' in node) {
      return (node as DAGNode).result;
    }
    return (node as DAGNodeV1).output;
  }

  function isNodeComplete(node: DAGNodeV1 | DAGNode): boolean {
    if ('nodeId' in node) {
      return (node as DAGNode).status === 'completed';
    }
    // v1 used uppercase "DONE"
    return (node as DAGNodeV1).state === 'DONE';
  }
  ```

  Consumers reading the `dagJson` field from `GET /api/v1/tasks` or inspecting the `dag` array from `GET /api/v1/tasks/{id}` must update their field references and status comparisons before upgrading.

---

### v0.2.0 — 2026-02-01 *(pre-stable)*

#### Changed

- **Breaking** — Task status enum values renamed. The old uppercase status names used by the queue system were replaced with lowercase string literals to align with the canonical `TaskStatus` type.

  **Old values (v0.1):** `"QUEUED"`, `"RUNNING"`, `"DONE"`, `"CANCELLED"`, `"ERROR"`

  **New values (v0.2+):**

  | Old | New |
  |---|---|
  | `"QUEUED"` | `"queued"` |
  | `"RUNNING"` | `"running"` |
  | `"DONE"` | `"completed"` |
  | `"CANCELLED"` | `"cancelled"` |
  | `"ERROR"` | `"failed"` |

  The canonical `TaskStatus` type is: `"queued" | "running" | "completed" | "cancelled" | "failed"`.

  This change affects every field named `status` on task objects returned by `GET /api/v1/tasks` and `GET /api/v1/tasks/{id}`, and every SSE event payload from `GET /api/v1/tasks/{id}/stream`.

  **Before (v0.1):**
  ```typescript
  // Old TaskStatus type
  type TaskStatus = "QUEUED" | "RUNNING" | "DONE" | "CANCELLED" | "ERROR";

  function isTerminal(status: TaskStatus): boolean {
    return status === "DONE" || status === "CANCELLED" || status === "ERROR";
  }
  ```

  **After (v0.2+):**
  ```typescript
  // Current TaskStatus type
  type TaskStatus = "queued" | "running" | "completed" | "cancelled" | "failed";

  function isTerminal(status: TaskStatus): boolean {
    return status === "completed" || status === "cancelled" || status === "failed";
  }
  ```

  **Compatibility shim** — if you are consuming both old and new task records during the transition period, normalize before comparing:

  ```typescript
  const STATUS_MAP: Record<string, TaskStatus> = {
    QUEUED: "queued",
    RUNNING: "running",
    DONE: "completed",
    CANCELLED: "cancelled",
    ERROR: "failed",
  };

  function normalizeStatus(raw: string): TaskStatus {
    return (STATUS_MAP[raw] ?? raw) as TaskStatus;
  }
  ```

---

### v0.1.0 — 2026-01-01 *(initial beta)*

#### Added

- Initial beta release of the ai-net REST API.
- `GET /health` — basic process liveness.
- `GET /api/v1/agents` — flat agent listing (no pagination).
- `POST /api/v1/agents` — agent registration.
- `POST /api/v1/tasks` — task submission.
- `GET /api/v1/tasks/{id}` — task status polling.

#### Security

- **Breaking** — Authentication scheme migrated from a custom `X-Wallet-Key` request header to the standard `Authorization: Bearer <token>` scheme. The custom header was removed entirely; requests using it now return `401 Unauthorized`.

  This change was necessary to align with industry-standard JWT handling, enable proxy-level authentication, and support the token refresh flow introduced in this release.

  **Before (original beta — custom header):**
  ```bash
  curl -s http://localhost:3000/api/v1/tasks \
    -H "X-Wallet-Key: GBZXN7PIRZGNMHGA728XZVOG2GUFIDLAZ6AF2I2MD2OCYTAF2K1K4AAA"
  ```

  ```typescript
  // Before — attaching auth in a TypeScript HTTP client
  const response = await fetch('/api/v1/tasks', {
    headers: {
      'X-Wallet-Key': walletPublicKey,
    },
  });
  ```

  **After (v0.1.0+ — standard Bearer token):**
  ```bash
  # Step 1: obtain a token
  curl -s -X POST http://localhost:3000/api/auth/token \
    -H "Content-Type: application/json" \
    -d '{
      "walletPublicKey": "GBZXN7PIRZGNMHGA728XZVOG2GUFIDLAZ6AF2I2MD2OCYTAF2K1K4AAA",
      "deviceId": "device-uuid-1234"
    }'

  # Step 2: use the returned accessToken
  curl -s http://localhost:3000/api/v1/tasks \
    -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  ```

  ```typescript
  // After — TypeScript client using Bearer token
  async function getToken(walletPublicKey: string, deviceId: string): Promise<string> {
    const res = await fetch('/api/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletPublicKey, deviceId }),
    });
    const { accessToken } = await res.json();
    return accessToken;
  }

  const token = await getToken(walletPublicKey, deviceId);
  const response = await fetch('/api/v1/tasks', {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });
  ```

  Tokens expire after 15 minutes. Use `POST /api/auth/refresh` to rotate them without re-authenticating.

---

## Deprecation Calendar

| Feature | Deprecated in | Sunset date | Replacement |
|---|---|---|---|
| `page` / `pageSize` params on `GET /api/v1/agents` | v1.3.0 | 2026-11-15 | `cursor` / `limit` params |

---

## Migration Examples

### Migrate from offset pagination to cursor pagination (`GET /api/v1/agents`)

**Old code (offset-based, deprecated):**

```typescript
async function getAllAgents(): Promise<Agent[]> {
  const agents: Agent[] = [];
  let page = 1;
  const pageSize = 20;

  while (true) {
    const res = await fetch(
      `/api/v1/agents?page=${page}&pageSize=${pageSize}`,
      { headers: { 'Accept': 'application/json' } }
    );
    const data = await res.json();
    agents.push(...data.agents);
    if (data.agents.length < pageSize) break;
    page++;
  }
  return agents;
}
```

**New code (cursor-based):**

```typescript
async function getAllAgents(): Promise<Agent[]> {
  const agents: Agent[] = [];
  let cursor: string | undefined;

  do {
    const url = cursor
      ? `/api/v1/agents?cursor=${cursor}&limit=20`
      : `/api/v1/agents?limit=20`;

    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    const data = await res.json();
    agents.push(...data.agents);
    cursor = data.pagination.hasMore ? data.pagination.nextCursor : undefined;
  } while (cursor);

  return agents;
}
```

### Migrate `capability` field to nested object (`GET /api/v1/agents/{id}`)

**Old code (v1.0 flat string):**

```typescript
interface Agent {
  id: string;
  capability: string;
}

function isResearchAgent(agent: Agent): boolean {
  return agent.capability === 'research';
}
```

**New code (v1.1+ nested object):**

```typescript
interface AgentCapability {
  name: string;
  version: string;
}

interface Agent {
  id: string;
  capability: AgentCapability;
}

function isResearchAgent(agent: Agent): boolean {
  return agent.capability.name === 'research';
}
```

---

## Sunset Policy

When a version reaches its sunset date:

1. The version returns `410 Gone` for all paths under that version prefix.
2. The response body includes a `migration_guide` URL.
3. The version prefix is removed from the routing table.

Consumers that hit a `410 Gone` must update their base URL and adapt their client code to the new version. There is no grace period beyond the announced sunset date.

---

## Related Documentation

- [REST API Reference](./API_REFERENCE.md) — Full endpoint schemas, error codes, and curl examples
- [Migration Guide](./MIGRATION_GUIDE.md) — SDK migration walkthroughs and event schema evolution
- [Node Operators Guide](./NODE_OPERATORS_GUIDE.md) — Deployment, configuration, and health monitoring

# Task Store Contract — Event Schema

This document defines the Soroban event schema for **all** events emitted by the
`task_store` contract, including task lifecycle transitions, coordinator/oracle
configuration changes, and contract upgrades.

## Event Categories

The contract emits two categories of events, each with its own independent
schema version:

| Category | Version Constant | Current Version | Events |
|---|---|---|---|
| **Lifecycle** | `TASK_LIFECYCLE_EVENT_VERSION` | 1 | `TaskCreatedEvent`, `TaskUpdatedEvent`, `TaskFinalizedEvent` |
| **Configuration** | `TASK_CONFIG_EVENT_VERSION` | 1 | `CoordinatorSetEvent`, `OracleManagerSetEvent`, `ContractUpgradedEvent` |

## Event Topics

### Lifecycle events

Emitted under topics `(task_meta, <transition>)`:

| Topic 2 | Transition | Struct |
|---|---|---|
| `created` | Task stored | `TaskCreatedEvent` |
| `updated` | Non-terminal status change (e.g. Pending → Running) | `TaskUpdatedEvent` |
| `finalized` | Terminal status change (→ Completed or → Failed) | `TaskFinalizedEvent` |

### Configuration events

Emitted under topics `(task_str, <action>)`:

| Topic 2 | Action | Struct |
|---|---|---|
| `coord_set` | Coordinator set or rotated | `CoordinatorSetEvent` |
| `ora_set` | OracleManager set or cleared | `OracleManagerSetEvent` |
| `upgraded` | Contract WASM upgraded | `ContractUpgradedEvent` |

---

## Versioning Policy

### Schema version field

Every event payload includes a `version: u32` field as its first member. This
allows off-chain consumers to detect schema changes and decode payloads
accordingly.

### Version bump rules

| Change type | Version bump | Example |
|---|---|---|
| **Additive** (new optional field appended) | Minor (e.g. v1 → v2) | Adding `price_pair` to `TaskCreatedEvent` |
| **Breaking** (field renamed, removed, or semantics changed) | Major (e.g. v2 → v3) | Renaming `task_id` to `task_hash` |

### Backward compatibility

- Old event schemas are supported for **2 version cycles** before removal.
- Consumers should check `version` before decoding and fall back to the
  appropriate schema decoder.
- Additive changes keep the same version number until a breaking change
  requires a bump — consumers reading additive fields must treat them as
  optional.

---

## v1 Event Schemas (current)

### 1. TaskCreatedEvent

Emitted once when `store_task_metadata` succeeds.

- **Topic 1**: `symbol_short!("task_meta")`
- **Topic 2**: `symbol_short!("created")`

```rust
pub struct TaskCreatedEvent {
    pub version: u32,               // = TASK_LIFECYCLE_EVENT_VERSION (1)
    pub task_id: BytesN<32>,
    pub prompt_hash: BytesN<32>,
    pub assigned_agents: Vec<Address>,
    pub created_at: u64,
    pub expires_at: u64,
    pub quoted_price_stroops: Option<i128>,
}
```

### 2. TaskUpdatedEvent

Emitted for a successful non-terminal status transition (currently only
`Pending → Running`).

- **Topic 1**: `symbol_short!("task_meta")`
- **Topic 2**: `symbol_short!("updated")`

```rust
pub struct TaskUpdatedEvent {
    pub version: u32,               // = TASK_LIFECYCLE_EVENT_VERSION (1)
    pub task_id: BytesN<32>,
    pub agent: Address,
    pub old_status: TaskStatus,
    pub new_status: TaskStatus,
    pub updated_at: u64,
}
```

### 3. TaskFinalizedEvent

Emitted for a successful transition into a terminal status (`Completed` or
`Failed`). `final_status` is always one of those two values.

- **Topic 1**: `symbol_short!("task_meta")`
- **Topic 2**: `symbol_short!("finalized")`

```rust
pub struct TaskFinalizedEvent {
    pub version: u32,               // = TASK_LIFECYCLE_EVENT_VERSION (1)
    pub task_id: BytesN<32>,
    pub agent: Address,
    pub old_status: TaskStatus,
    pub final_status: TaskStatus,
    pub finalized_at: u64,
}
```

### 4. CoordinatorSetEvent

Emitted when the admin sets or rotates the coordinator address.

- **Topic 1**: `symbol_short!("task_str")`
- **Topic 2**: `symbol_short!("coord_set")`

```rust
pub struct CoordinatorSetEvent {
    pub version: u32,               // = TASK_CONFIG_EVENT_VERSION (1)
    pub coordinator: Address,
}
```

### 5. OracleManagerSetEvent

Emitted when the admin sets or clears the OracleManager address.

- **Topic 1**: `symbol_short!("task_str")`
- **Topic 2**: `symbol_short!("ora_set")`

```rust
pub struct OracleManagerSetEvent {
    pub version: u32,               // = TASK_CONFIG_EVENT_VERSION (1)
    pub oracle_manager: Option<Address>,
}
```

### 6. ContractUpgradedEvent

Emitted when the contract is upgraded via `upgrade()`.

- **Topic 1**: `symbol_short!("task_str")`
- **Topic 2**: `symbol_short!("upgraded")`

```rust
pub struct ContractUpgradedEvent {
    pub version: u32,               // = TASK_CONFIG_EVENT_VERSION (1)
    pub old_version: String,
    pub new_version: String,
    pub new_wasm_hash: BytesN<32>,
    pub admin: Address,
    pub ledger_sequence: u32,
}
```

---

## Status transition → event map

| Transition | Event |
|---|---|
| `store_task_metadata` | `TaskCreatedEvent` |
| `Pending` → `Running` | `TaskUpdatedEvent` |
| `Running` → `Completed` | `TaskFinalizedEvent` |
| `Running` → `Failed` | `TaskFinalizedEvent` |
| `Pending` → `Failed` | `TaskFinalizedEvent` |
| Any invalid transition | *(no event)* |

**Lifecycle invariant**: Each successful state transition emits exactly one
event, and rejected calls emit no event at all.

---

## Migration Path to v2

When the next breaking schema change is needed, follow these steps:

1. **Define new structs** (e.g. `TaskCreatedEventV2`) with the updated fields.
2. **Bump the version constant** (`TASK_LIFECYCLE_EVENT_VERSION = 2`).
3. **Emit v2 events** from all entrypoints.
4. **Off-chain consumers** update their decoders to check `version` and handle
   both v1 and v2 payloads.
5. **v1 support window**: The old v1 schema remains documented for 2 version
   cycles. During this window, consumers reading historical events may
   encounter v1 payloads and must decode accordingly.
6. **After 2 cycles**: v1-specific decoder code can be removed.

### Example: additive field (minor bump)

```rust
// v2: add optional `payment_locked` to TaskCreatedEvent
pub struct TaskCreatedEvent {
    pub version: u32,               // now 2
    pub task_id: BytesN<32>,
    pub prompt_hash: BytesN<32>,
    pub assigned_agents: Vec<Address>,
    pub created_at: u64,
    pub expires_at: u64,
    pub quoted_price_stroops: Option<i128>,
    pub payment_locked: Option<bool>,  // NEW in v2
}
```

Off-chain consumers reading v1 events should default `payment_locked` to `None`.

### Example: breaking change (major bump)

```rust
// v3: rename task_id to task_hash (breaking)
pub struct TaskCreatedEvent {
    pub version: u32,               // now 3
    pub task_hash: BytesN<32>,       // renamed from task_id
    // ...
}
```

Consumers must branch on `version >= 3` to use the new field name.

---

## Reading events with the JS/TS SDK

Consumers should filter by the topic pair before decoding a payload:

```ts
import type {
  TaskCreatedEvent,
  TaskUpdatedEvent,
  TaskFinalizedEvent,
  CoordinatorSetEvent,
  OracleManagerSetEvent,
  ContractUpgradedEvent,
} from './taskStoreEvents';

// Lifecycle events
if (topics[0] === 'task_meta' && topics[1] === 'created') {
  const event = scValToNative(data) as TaskCreatedEvent;
  console.log(event.version, event.task_id);
}

// Configuration events
if (topics[0] === 'task_str' && topics[1] === 'coord_set') {
  const event = scValToNative(data) as CoordinatorSetEvent;
  console.log(event.version, event.coordinator);
}
```

See `smart-contracts/src/types/taskStoreEvents.ts` for the full TypeScript type
definitions.

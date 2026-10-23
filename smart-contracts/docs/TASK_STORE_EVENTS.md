# Task Store Contract — Lifecycle Events

This document defines the Soroban event schema for the high-level task lifecycle
API exposed by `task_store`.

## Event Topics

Every lifecycle event is emitted under the first topic `task_store`. The second
topic identifies the transition:

- `task_created`
- `task_assigned`
- `task_completed`
- `task_failed`

## Versioning & Compatibility

Every payload includes a `version: u32` field. The event schema is append-only:

- New fields may be added without bumping the version.
- Renaming, removing, or changing the meaning of an existing field requires a
  version bump.
- The topic pair for each lifecycle stage is stable.

## Lifecycle invariant

Each successful state transition emits exactly one event, and rejected calls emit
no event at all.

---

### 1. Task Created

Emitted once when `create_task` succeeds.

- **Topic 1**: `Symbol::new(env, "task_store")`
- **Topic 2**: `Symbol::new(env, "task_created")`
- **Data (Structure)**: `TaskStoreCreatedEvent`

```rust
pub struct TaskStoreCreatedEvent {
    pub version: u32,
    pub task_id: u64,
    pub submitter: Address,
    pub description_hash: BytesN<32>,
    pub budget_xlm: i128,
    pub created_at: u64,
}
```

### 2. Task Assigned

Emitted when `assign_task` succeeds.

- **Topic 1**: `Symbol::new(env, "task_store")`
- **Topic 2**: `Symbol::new(env, "task_assigned")`
- **Data (Structure)**: `TaskStoreAssignedEvent`

```rust
pub struct TaskStoreAssignedEvent {
    pub version: u32,
    pub task_id: u64,
    pub agent_id: Address,
    pub assigned_at: u64,
}
```

### 3. Task Completed

Emitted when `complete_task` succeeds.

- **Topic 1**: `Symbol::new(env, "task_store")`
- **Topic 2**: `Symbol::new(env, "task_completed")`
- **Data (Structure)**: `TaskStoreCompletedEvent`

```rust
pub struct TaskStoreCompletedEvent {
    pub version: u32,
    pub task_id: u64,
    pub agent_id: Address,
    pub result_hash: BytesN<32>,
    pub completed_at: u64,
}
```

### 4. Task Failed

Emitted when `fail_task` succeeds.

- **Topic 1**: `Symbol::new(env, "task_store")`
- **Topic 2**: `Symbol::new(env, "task_failed")`
- **Data (Structure)**: `TaskStoreFailedEvent`

```rust
pub struct TaskStoreFailedEvent {
    pub version: u32,
    pub task_id: u64,
    pub actor: Address,
    pub reason: String,
    pub failed_at: u64,
}
```

## Status transition → event map

| Transition | Event |
|---|---|
| `Created` → `Assigned` | `task_assigned` |
| `Assigned` → `Completed` | `task_completed` |
| `Assigned` → `Failed` | `task_failed` |
| `Created` → `Failed` | `task_failed` |
| Any invalid transition | *(no event)* |

## Reading events with the JS/TS SDK

Consumers should filter by the topic pair before decoding a payload:

```ts
if (topics[0] === "task_store" && topics[1] === "task_completed") {
  const event = scValToNative(data) as TaskStoreCompletedEvent;
  // event.version, event.task_id, event.result_hash, ...
}
```

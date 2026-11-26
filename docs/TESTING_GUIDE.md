# ai-net Testing Guide

This is the authoritative testing reference for all ai-net contributors. It covers every layer of the testing pyramid, the patterns expected in PRs, mock strategies, and the exact commands used in CI.

---

## Table of Contents

1. [Testing Pyramid Overview](#1-testing-pyramid-overview)
2. [Smart Contracts (Soroban/Rust)](#2-smart-contracts-sorobanrust)
3. [Backend (Node.js/TypeScript with Jest)](#3-backend-nodejstypescript-with-jest)
4. [Frontend (React/TypeScript with Vitest)](#4-frontend-reacttypescript-with-vitest)
5. [E2E (Playwright)](#5-e2e-playwright)
6. [CI Commands Summary](#6-ci-commands-summary)

---

## 1. Testing Pyramid Overview

ai-net has four test layers. Write tests at the layer closest to the code under test; use higher layers only for integration concerns that cannot be verified in isolation.

```
              ┌─────────────────┐
              │    E2E Tests    │  ← fewest, slowest, highest fidelity
              ├─────────────────┤
              │  Frontend Tests │
              ├─────────────────┤
              │  Backend Tests  │
              ├─────────────────┤
              │ Smart Contract  │  ← most, fastest, lowest fidelity
              │     Tests       │
              └─────────────────┘
```

### Speed vs. fidelity

| Layer | Runner | Approx. speed | Fidelity | Isolation |
|---|---|---|---|---|
| Smart Contracts | `cargo test` | < 5 s | Soroban VM in-process | Full: in-memory ledger |
| Backend | Jest + ts-jest | 15–60 s | Node.js, SQLite in-memory | Mocked DB + HTTP clients |
| Frontend | Vitest + jsdom | 10–30 s | Browser-like, no real network | MSW intercepts HTTP |
| E2E | Jest + Supertest | 60–180 s | Real backend, real DB, local Stellar node | Docker Compose |

### Coverage thresholds

| Layer | Tool | Threshold |
|---|---|---|
| Smart Contracts | `cargo test` / `cargo tarpaulin` | No numeric threshold enforced. All tests must pass; every public entry point must have at least one test. |
| Backend | Jest (jest.config.js) | Statements **75%**, branches **70%**, functions **75%**, lines **75%** |
| Frontend | Vitest | No global threshold enforced by CI, but aim for **70%+** on custom hooks. |
| E2E | — | Smoke coverage for all critical user flows (agent registration, task submission, task completion). |

Coverage is collected only from non-index source files. Files excluded from backend coverage are listed in `jest.config.js` under `collectCoverageFrom`.

---

## 2. Smart Contracts (Soroban/Rust)

Tests live in `smart-contracts/contracts/<contract>/src/test.rs` and are compiled only when the `testutils` Cargo feature is enabled. The standard `cargo test` invocation enables this automatically.

### Module structure

```rust
//! Unit tests for AgentRegistryContract

extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events as _, Ledger as _},
    Address, Env, Map, String, Symbol,
};

#[cfg(test)]
mod tests {
    use super::*;
    // test functions go here
}
```

In practice the codebase places tests in a flat `test.rs` file guarded by `extern crate std;` rather than a nested `#[cfg(test)]` module — both styles are acceptable, but be consistent within a contract.

### The `setup()` helper

Every contract test file defines a `setup()` function that returns a fresh environment and a typed client. Never share an `Env` across tests.

```rust
fn setup() -> (Env, AgentRegistryContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(AgentRegistryContract, ());
    let client = AgentRegistryContractClient::new(&env, &id);
    (env, client)
}

fn setup_with_admin() -> (Env, AgentRegistryContractClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(AgentRegistryContract, ());
    let client = AgentRegistryContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    (env, client, admin)
}
```

`env.mock_all_auths()` lets every `require_auth()` call succeed without real signature verification. Use it for positive-path tests. Remove it (or replace it with `env.set_auths(&[])`) for authorization-failure tests.

### Fixture factories

Avoid constructing `AgentRecord` inline in every test. Use a factory function so that each test only specifies what it cares about:

```rust
fn make_record(env: &Env, id: &str, capability: &str, owner: Address) -> AgentRecord {
    AgentRecord {
        id: Symbol::new(env, id),
        capability: Symbol::new(env, capability),
        price_stroops: 1_000,
        endpoint: String::from_str(env, "https://agent.example.com"),
        owner,
        metadata: Map::new(env),
        bond_amount: DEFAULT_MIN_BOND_STROOPS,
    }
}
```

### MockAuth pattern — asserting required authorization

`env.mock_all_auths()` verifies that _some_ auth was checked, but it cannot assert _which_ address must authorize. Use `env.mock_auths()` with `MockAuth` and `MockAuthInvoke` to assert that a specific address is required:

```rust
use soroban_sdk::testutils::{AuthorizedFunction, MockAuth, MockAuthInvoke};
use soroban_sdk::IntoVal;

#[test]
fn test_register_requires_owner_auth() {
    let (env, client) = setup(); // mock_all_auths NOT called
    let owner = Address::generate(&env);
    let record = make_record(&env, "agent1", "research", owner.clone());

    // Allow the call to proceed only if owner authorizes it.
    // If the contract calls require_auth() on a different address (or not at
    // all), the SDK panics and the test fails.
    env.mock_auths(&[MockAuth {
        address: &owner,
        invoke: &MockAuthInvoke {
            contract: &client.address,
            fn_name: "register_agent",
            args: (record.clone(),).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.register_agent(&record); // passes only when owner auth is enforced
}
```

For negative-path testing (expecting a panic), annotate the test with `#[should_panic]`:

```rust
#[test]
#[should_panic]
fn test_register_fails_without_auth() {
    let env = Env::default();
    // No mock_all_auths — real auth check will fail
    let id = env.register(AgentRegistryContract, ());
    let client = AgentRegistryContractClient::new(&env, &id);
    let owner = Address::generate(&env);
    let record = make_record(&env, "agent1", "research", owner);
    client.register_agent(&record); // panics: auth not satisfied
}
```

### Testing time-dependent logic

Use `env.ledger().with_mut()` to advance the ledger timestamp and sequence number before exercising TTL-sensitive code:

```rust
#[test]
fn test_ttl_extension() {
    let (env, client, admin) = setup_with_admin();
    let owner = Address::generate(&env);
    let record = make_record(&env, "agent1", "research", owner.clone());
    client.register_agent(&record);

    // Advance ledger to simulate time passing
    env.ledger().with_mut(|li| {
        li.timestamp = 1_700_000_000;
        li.sequence_number = 100;
    });

    // Now test TTL-sensitive logic, e.g. TTL extension on heartbeat
    client.heartbeat(&record.id);
    // assert the record is still live, storage TTL was extended, etc.
}
```

### Asserting emitted events

```rust
fn assert_event_topics(env: &Env, idx: u32, topic0: Symbol, topic1: Symbol) {
    let events = env.events().all();
    let (_, topics, _) = events.get(idx).unwrap();
    let t0 = Symbol::from_val(env, &topics.get(0).unwrap());
    let t1 = Symbol::from_val(env, &topics.get(1).unwrap());
    assert_eq!(t0, topic0);
    assert_eq!(t1, topic1);
}

#[test]
fn test_registration_emits_event() {
    let (env, client) = setup();
    let owner = Address::generate(&env);
    let record = make_record(&env, "agent1", "research", owner);
    client.register_agent(&record);
    assert_event_topics(
        &env, 0,
        Symbol::new(&env, "agent_registry"),
        Symbol::new(&env, "registered"),
    );
}
```

### Running smart contract tests

```bash
# Run all tests (enables testutils feature automatically)
cd smart-contracts
cargo test

# Show stdout from tests (useful for debugging)
cargo test -- --nocapture

# Run a single test by name
cargo test test_register_requires_owner_auth

# Format check (required before PR)
cargo fmt --check

# Lint (required before PR)
cargo clippy --all-targets -- -D warnings

# HTML coverage report (requires cargo-tarpaulin)
cargo tarpaulin --out Html
```

---

## 3. Backend (Node.js/TypeScript with Jest)

Configuration: `backend/jest.config.js`. Test environment: `node`. Setup file: `backend/tests/jestSetup.ts`. The module name mapper in `jest.config.js` automatically redirects `@stellar/stellar-sdk` and `better-sqlite3` to the manual mocks in `backend/__mocks__/`.

### API route tests with Supertest

Instantiate the Express app with `createApp()` and make real HTTP requests against it without binding a port:

```typescript
import request from 'supertest';
import { createApp } from '../../src/api/app';
import type { Express } from 'express';

describe('POST /api/tasks', () => {
  let app: Express;

  beforeAll(() => {
    app = createApp();
  });

  it('returns 201 with taskId on a valid payload', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', 'Bearer GTEST...')
      .send({
        prompt: 'Analyze risk',
        maxBudgetXLM: 5,
        agentPreferences: ['risk'],
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('taskId');
  });

  it('returns 400 when prompt is missing', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', 'Bearer GTEST...')
      .send({ maxBudgetXLM: 5 });

    expect(res.status).toBe(400);
  });
});
```

### Mocking Venice AI with MSW

The backend uses Venice AI for LLM interactions. Mock it with MSW so tests never reach the real API:

```typescript
import { rest } from 'msw';
import { setupServer } from 'msw/node';

const server = setupServer(
  rest.post('https://api.venice.ai/api/v1/chat/completions', (req, res, ctx) => {
    return res(
      ctx.json({
        choices: [{ message: { content: 'mocked LLM response' } }],
      })
    );
  })
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

it('processes LLM response and stores result', async () => {
  // The request to Venice AI will be intercepted by MSW
  const result = await runAgentTask({ prompt: 'Explain Soroban', agentType: 'research' });
  expect(result.output).toBe('mocked LLM response');
});
```

Use `server.use(rest.post(...))` inside a test to override the default handler with an error or slow response for resilience testing.

### SQLite in-memory database

The `better-sqlite3` mock in `backend/__mocks__/better-sqlite3.js` provides a `MockDatabase` and `MockStatement` that satisfy the `better-sqlite3` API surface without touching the filesystem. Jest's `moduleNameMapper` in `jest.config.js` wires the alias automatically, so no import changes are needed in source code.

```typescript
// Tests that need real query behavior can create an actual in-memory DB:
import Database from 'better-sqlite3'; // resolves to the mock in test runs
import { runMigrations } from '../../src/db/migrator';

let db: ReturnType<typeof Database>;

beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
});

afterEach(() => {
  db.close();
});
```

For tests that only verify call structure (not SQL correctness), the mock's `MockStatement.rows` array can be pre-seeded:

```typescript
const stmt = db.prepare('SELECT * FROM tasks WHERE id = ?') as any;
stmt.rows = [makeTask({ id: 'task-001', status: 'running' })];
const row = stmt.get('task-001');
expect(row.status).toBe('running');
```

### Fixture factories

Never construct data objects inline when multiple tests need the same shape. Use factories with `Partial<T>` overrides:

```typescript
import type { TaskRow } from '../../src/db/tasks';

export function makeTask(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 'task-test-001',
    prompt: 'Test prompt',
    status: 'queued',
    walletPublicKey: 'GTEST...',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

export function makeAgent(overrides: Partial<AgentRow> = {}): AgentRow {
  return {
    id: 'agent-test-001',
    capability: 'research',
    endpoint: 'https://agent.test',
    priceStroops: 1_000,
    ownerAddress: 'GTEST...',
    status: 'active',
    ...overrides,
  };
}
```

Place factories in `backend/tests/factories.ts` and import them across test files.

### Running backend tests

```bash
cd backend

# Run all tests
npm run test

# Watch mode
npm run test -- --watch

# Generate coverage report (must meet the thresholds below)
npm run test:coverage
```

**Coverage thresholds** (from `jest.config.js`, enforced in CI):
- Statements: **75%**
- Branches: **70%**
- Functions: **75%**
- Lines: **75%**

Excluded from coverage: `index.ts` files, `src/api/routes/stream.ts`, `src/registry/sync.ts`, `src/checkSpec.ts`, type definitions, and test files themselves.

---

## 4. Frontend (React/TypeScript with Vitest)

Configuration: `frontend/vite.config.ts` (`test` block). Environment: `jsdom`. Setup file: `frontend/vitest.setup.ts`, which registers `@testing-library/jest-dom` matchers, stubs `ResizeObserver`, `IntersectionObserver`, and `matchMedia`, and initializes i18next with English translations so component queries match literal English copy.

### React Testing Library patterns

```typescript
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskSubmissionForm } from '../TaskSubmissionForm';

it('submits form with valid data', async () => {
  const user = userEvent.setup();
  render(<TaskSubmissionForm />);

  await user.type(screen.getByRole('textbox', { name: /prompt/i }), 'Analyze risk');
  await user.click(screen.getByRole('button', { name: /submit/i }));

  await waitFor(() =>
    expect(screen.getByText(/queued/i)).toBeInTheDocument()
  );
});

it('shows validation error when prompt is empty', async () => {
  const user = userEvent.setup();
  render(<TaskSubmissionForm />);

  await user.click(screen.getByRole('button', { name: /submit/i }));

  expect(screen.getByRole('alert')).toHaveTextContent(/prompt is required/i);
});
```

Prefer `getByRole` over `getByTestId`. Query by accessible name or visible text; test behavior, not DOM structure.

### MSW in Vitest

The frontend MSW setup lives in `frontend/src/mocks/`:

- `handlers.ts` — route handlers for `/api/agents`, `/api/tasks`, `/api/tasks/:id`, `/api/stats`, and `/api/wallets/:address/tasks`
- `browser.ts` — `setupWorker` export used in development (Service Worker)

For tests, create a `server.ts` that uses `setupServer` (Node adapter):

```typescript
// src/mocks/server.ts
import { setupServer } from 'msw/node';
import { handlers } from './handlers';

export const server = setupServer(...handlers);
```

Wire the server in each test file (or in `vitest.setup.ts` globally):

```typescript
import { server } from '../mocks/server';
import { http, HttpResponse } from 'msw';

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

it('shows agent list from API', async () => {
  render(<AgentDirectory />);
  await screen.findByText('Research Specialist');
});

it('shows error state when API fails', async () => {
  server.use(
    http.get('/api/agents', () => HttpResponse.error())
  );
  render(<AgentDirectory />);
  await screen.findByRole('alert');
});
```

The handlers in `handlers.ts` use `msw` v2 syntax (`http`, `HttpResponse`). Do not mix v1 (`rest`) and v2 imports.

### WebSocket hook testing

The actual pattern used in `useTaskWebSocket.test.ts`:

```typescript
import { renderHook, act } from '@testing-library/react';
import { vi } from 'vitest';
import { useTaskWebSocket } from './useTaskWebSocket';

// Stateful mock that exposes test helpers
class MockWebSocket {
  static instance: MockWebSocket | null = null;

  onopen:    ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose:   ((e: CloseEvent) => void) | null = null;
  onerror:   ((e: Event) => void) | null = null;
  readyState = WebSocket.CONNECTING;

  constructor(public url: string) {
    MockWebSocket.instance = this;
  }

  close() {
    this.readyState = WebSocket.CLOSED;
    this.onclose?.(new CloseEvent('close'));
  }

  send(_data: string) {}

  // Test helpers — call these inside act() to simulate server events
  simulateOpen()  { this.readyState = WebSocket.OPEN;   this.onopen?.(new Event('open')); }
  simulateClose() { this.readyState = WebSocket.CLOSED; this.onclose?.(new CloseEvent('close')); }
  simulateError() { this.onerror?.(new Event('error')); }
  simulateMessage(data: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }));
  }
}

(global as any).WebSocket = MockWebSocket;

describe('useTaskWebSocket', () => {
  beforeEach(() => {
    MockWebSocket.instance = null;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('initializes with connecting status', () => {
    const { result } = renderHook(() =>
      useTaskWebSocket({ taskId: 'task-1', onMessage: vi.fn() })
    );
    expect(result.current.status).toBe('connecting');
    expect(MockWebSocket.instance!.url).toBe('ws://localhost:3001/tasks/task-1/stream');
  });

  it('calls onMessage with parsed event data', () => {
    const onMessage = vi.fn();
    renderHook(() => useTaskWebSocket({ taskId: 'task-1', onMessage }));

    act(() => {
      MockWebSocket.instance!.simulateMessage({ type: 'node_started', nodeId: 'n1' });
    });

    expect(onMessage).toHaveBeenCalledWith({ type: 'node_started', nodeId: 'n1' });
  });

  it('implements exponential backoff on disconnect', () => {
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    renderHook(() => useTaskWebSocket({ taskId: 'task-1', onMessage: vi.fn() }));

    act(() => { MockWebSocket.instance!.simulateClose(); });
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1000);

    act(() => { vi.advanceTimersByTime(1000); MockWebSocket.instance!.simulateClose(); });
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 2000);

    setTimeoutSpy.mockRestore();
  });
});
```

Always use `vi.useFakeTimers()` when testing reconnection logic so timers are deterministic.

### Accessibility testing with jest-axe

```typescript
import { render } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';

expect.extend(toHaveNoViolations);

it('has no accessibility violations', async () => {
  const { container } = render(<AgentTable agents={mockAgents} />);
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});
```

Run axe tests on rendered output, not on snapshot strings. Add accessibility tests to any new component that renders interactive elements (buttons, forms, tables, dialogs).

### Snapshot policy

Use snapshots only for purely static display components where the full rendered output is the specification (e.g. a badge or a static card). For interactive components, assert observable behavior with Testing Library queries. Stale snapshots that are updated without review mask regressions, so keep the snapshot surface small.

### Running frontend tests

```bash
cd frontend

# Run all tests
npm run test

# Watch mode (Vitest UI)
npm run test -- --ui

# Generate coverage report
npm run test:coverage

# Type-check without building
npm run typecheck
```

No global numeric coverage threshold is enforced by CI, but all hooks in `src/hooks/` should maintain **70%+** coverage. The Vitest config is in the `test` block of `vite.config.ts`; E2E tests under `tests/e2e/` are excluded.

---

## 5. E2E (Playwright)

E2E tests live in `tests/e2e/` and are run against a real backend and a local Stellar node provisioned via Docker Compose.

### Infrastructure

`tests/e2e/docker-compose.test.yml` starts:
- **`stellar-standalone`** — Stellar quickstart image with Soroban RPC enabled
- **`ai-net-backend`** — backend container in test mode, connected to the local node

### Test structure

```
tests/e2e/
├── helpers.ts                   # SorobanContractEmulator, DB helpers, Supertest app factory
├── setup.ts                     # beforeAll: initialize contracts, reset DB
├── teardown.ts                  # afterAll: close DB connections
├── agent-lifecycle.test.ts      # register → heartbeat → deregister
├── scenario-a-registration.test.ts
├── scenario-b-task-lifecycle.test.ts
├── scenario-c-agent-removal.test.ts
└── full-pipeline.test.ts        # end-to-end: submit task → DAG → completion
```

### Test isolation

Each test file gets a fresh database state via `resetTestDatabase()` from `helpers.ts`. The `SorobanContractEmulator` in `helpers.ts` provides a fully in-memory contract state so E2E tests do not require a live Stellar testnet.

```typescript
import { onChainContracts, resetTestDatabase } from './helpers';

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.SKIP_STELLAR_ACCOUNT_VERIFY = 'true';
  onChainContracts.initialize();
  resetTestDatabase();
});
```

### Critical flows covered

- Agent registration and on-chain record verification
- Task submission, DAG decomposition, and agent assignment
- Task completion and XLM settlement
- Agent deregistration and cleanup

For the full E2E reference — Docker Compose details, coverage generation, and CI configuration — see [`docs/e2e-testing.md`](./e2e-testing.md).

---

## 6. CI Commands Summary

These are the exact commands run in GitHub Actions (`.github/workflows/ci.yml`). Run them locally before opening a PR.

| Layer | Command | What it checks |
|---|---|---|
| Smart Contracts — format | `cd smart-contracts && cargo fmt --check` | Rust formatting |
| Smart Contracts — lint | `cd smart-contracts && cargo clippy --all-targets -- -D warnings` | Clippy lints, warnings as errors |
| Smart Contracts — tests | `cd smart-contracts && cargo test` | All Soroban unit tests |
| Backend — lint | `cd backend && npm run lint` | ESLint |
| Backend — typecheck | `cd backend && npm run typecheck` | TypeScript strict mode |
| Backend — coverage | `cd backend && npm run test:coverage` | Jest + coverage thresholds |
| Frontend — lint | `cd frontend && npm run lint` | ESLint |
| Frontend — typecheck | `cd frontend && npm run typecheck` | TypeScript strict mode |
| Frontend — coverage | `cd frontend && npm run test:coverage` | Vitest |
| Frontend — build | `cd frontend && npm run build` | Vite production build |
| E2E | `npm run test:e2e` | Full-pipeline integration tests |
| Full gate (all layers) | `npm run gate` | All of the above in one command |

Run `npm run gate` from the repository root to execute every check at once. CI treats any non-zero exit as a failure.

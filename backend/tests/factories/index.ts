/**
 * Test data factories for ai-net backend domain models.
 *
 * Each factory function accepts a `Partial<T>` override bag so callers can
 * customise only the fields they care about while receiving valid defaults for
 * the rest. A shared counter ensures every call produces a unique ID, avoiding
 * collisions when multiple objects are created in the same test suite.
 *
 * IMPORTANT: All values produced here are synthetic placeholders.
 * No real Stellar keys, credentials, or API tokens are ever used.
 *
 * @module factories
 */

import type { AgentRecord } from "../../src/db/agents";
import type { PaymentRecord, PaymentStatus } from "../../src/db/index";
import type { Task, DAGNode, TaskStatus, NodeStatus } from "../../src/types/task";

// ─────────────────────────────────────────────────────────────────────────────
//  Internal counter — monotonically increasing, reset between test files if
//  you need isolated sequences (call `resetFactoryCounter()`).
// ─────────────────────────────────────────────────────────────────────────────

let _counter = 0;

/** Returns the next unique counter value. */
function nextId(): number {
  return ++_counter;
}

/**
 * Resets the internal factory counter to zero.
 *
 * Call this in a `beforeEach` / `beforeAll` hook when you need predictable,
 * repeatable IDs within a test suite.
 */
export function resetFactoryCounter(): void {
  _counter = 0;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Wallet factory
// ─────────────────────────────────────────────────────────────────────────────

/** A synthetic Stellar-style wallet pair used exclusively in tests. */
export interface WalletPair {
  /** 56-character test placeholder that starts with 'G' (never a real key). */
  publicKey: string;
  /** 56-character test placeholder that starts with 'S' (never a real key). */
  secretKey: string;
}

/**
 * Produces a synthetic Stellar-style wallet key pair for test purposes.
 *
 * The keys are deterministic placeholders that start with 'G' and 'S'
 * respectively and are exactly 56 alphanumeric characters long, matching the
 * visual shape of real Stellar keys without ever being valid on-chain.
 *
 * @param n - optional numeric suffix; defaults to the next factory counter value.
 * @returns A `WalletPair` with `publicKey` and `secretKey`.
 *
 * @example
 * const wallet = makeWallet();
 * // { publicKey: 'GTESTWALLETKEY000000000000000000000000000000000000000001',
 * //   secretKey: 'STESTWALLETKEY000000000000000000000000000000000000000001' }
 */
export function makeWallet(n?: number): WalletPair {
  const seq = n ?? nextId();
  // Pad with zeros so the result is always exactly 56 chars.
  const suffix = String(seq).padStart(49, "0");
  return {
    publicKey: `GTESTWALLETKEY${suffix}`,
    secretKey: `STESTWALLETKEY${suffix}`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  AgentRecord factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a valid {@link AgentRecord} populated with sensible defaults.
 *
 * Every call increments the internal counter so that `id` and
 * `stellarPublicKey` are unique across the test run.
 *
 * @param overrides - Any subset of `AgentRecord` fields to override.
 * @returns A complete `AgentRecord` ready for use in tests.
 *
 * @example
 * const agent = makeAgentRecord({ status: 'offline', pricingXLM: 5 });
 */
export function makeAgentRecord(overrides: Partial<AgentRecord> = {}): AgentRecord {
  const seq = nextId();
  const wallet = makeWallet(seq);
  const now = new Date().toISOString();

  return {
    id: `agent-${seq}`,
    capabilities: ["research"],
    pricingXLM: 1.0,
    endpoint: `http://localhost:${3000 + seq}/health`,
    stellarPublicKey: wallet.publicKey,
    reputationScore: 2.5,
    lastSeenAt: now,
    status: "online",
    bondAmountXLM: 0,
    tasksCompleted: 0,
    tasksFailed: 0,
    lastActiveAt: now,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  PaymentRecord factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a valid {@link PaymentRecord} populated with sensible defaults.
 *
 * @param overrides - Any subset of `PaymentRecord` fields to override.
 * @returns A complete `PaymentRecord` ready for use in tests.
 *
 * @example
 * const payment = makePaymentRecord({ status: 'released', amountStroops: 5_000_000n });
 */
export function makePaymentRecord(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  const seq = nextId();

  return {
    taskId: `task-${seq}`,
    nodeId: `node-${seq}`,
    balanceId: `balance-${seq}`,
    status: "locked" as PaymentStatus,
    amountStroops: BigInt(1_000_000),
    txHash: null,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  DAGNode factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a valid {@link DAGNode} with sensible defaults.
 *
 * @param overrides - Any subset of `DAGNode` fields to override.
 * @returns A complete `DAGNode` ready for use in tests.
 *
 * @example
 * const node = makeDAGNode({ type: 'research', status: 'completed' });
 */
export function makeDAGNode(overrides: Partial<DAGNode> = {}): DAGNode {
  const seq = nextId();

  return {
    nodeId: `node-${seq}`,
    type: "research",
    dependencies: [],
    status: "pending" as NodeStatus,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Task factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a valid {@link Task} populated with sensible defaults.
 *
 * @param overrides - Any subset of `Task` fields to override.
 * @returns A complete `Task` ready for use in tests.
 *
 * @example
 * const task = makeTask({ status: 'running', prompt: 'Analyse solar market.' });
 */
export function makeTask(overrides: Partial<Task> = {}): Task {
  const seq = nextId();
  const wallet = makeWallet(seq);
  const now = new Date().toISOString();

  return {
    id: `task-${seq}`,
    prompt: `Test task prompt ${seq}`,
    walletPublicKey: wallet.publicKey,
    status: "queued" as TaskStatus,
    dag: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Pipeline DAG factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds a sequential pipeline DAG with `n` nodes where each node depends on
 * the previous one. The result can be used as the `dag` field of a `Task`.
 *
 * ```
 * node-1 ──► node-2 ──► node-3 ──► … ──► node-n
 * ```
 *
 * @param n - Number of nodes (must be >= 1).
 * @param nodeOverrides - Optional partial overrides applied to every node.
 * @returns An array of `DAGNode` objects with sequential dependencies.
 *
 * @example
 * const dag = makePipelineDAG(3);
 * // dag[0].dependencies === []
 * // dag[1].dependencies === [dag[0].nodeId]
 * // dag[2].dependencies === [dag[1].nodeId]
 *
 * const task = makeTask({ dag: makePipelineDAG(4) });
 */
export function makePipelineDAG(n: number, nodeOverrides: Partial<DAGNode> = {}): DAGNode[] {
  if (n < 1) {
    throw new RangeError(`makePipelineDAG: n must be >= 1, got ${n}`);
  }

  const nodes: DAGNode[] = [];
  const nodeTypes = ["research", "risk", "coding", "design", "report"];

  for (let i = 0; i < n; i++) {
    const seq = nextId();
    const type = nodeTypes[i % nodeTypes.length];
    const dependencies = i === 0 ? [] : [nodes[i - 1].nodeId];

    nodes.push({
      nodeId: `pipeline-node-${seq}`,
      type,
      dependencies,
      status: "pending" as NodeStatus,
      prompt: `Step ${i + 1} of ${n}: ${type}`,
      description: `Pipeline step ${i + 1}`,
      ...nodeOverrides,
    });
  }

  return nodes;
}

/**
 * Creates a {@link Task} whose `dag` is a sequential pipeline of `n` nodes.
 *
 * Shorthand for `makeTask({ dag: makePipelineDAG(n) })`.
 *
 * @param n - Number of DAG nodes.
 * @param taskOverrides - Optional partial overrides for the wrapping `Task`.
 * @returns A complete `Task` with a sequential DAG.
 *
 * @example
 * const task = makePipelineTask(3, { status: 'running' });
 */
export function makePipelineTask(n: number, taskOverrides: Partial<Task> = {}): Task {
  const dag = makePipelineDAG(n);
  return makeTask({ dag, ...taskOverrides });
}

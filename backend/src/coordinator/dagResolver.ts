/**
 * DAG resolution engine for the coordinator.
 *
 * Validates task DAGs for cycles, produces a layered topological ordering
 * suitable for concurrent execution, and resolves the input context for a
 * node from its completed upstream dependencies.
 *
 * Design notes:
 *  - Cycle detection uses Kahn's algorithm (BFS-based topological sort).
 *    If the number of processed nodes is less than the total number of
 *    nodes, at least one cycle exists; the remaining unprocessed nodes are
 *    reported as the cycle members.
 *  - `topologicalSort` returns layers: nodes within the same layer have no
 *    dependency on each other and can execute concurrently.
 *  - Disconnected nodes (no incoming or outgoing edges) land in layer 0.
 */

import type { DAGNode } from '../types/task';

// ─── Public types ────────────────────────────────────────────────────────────

/** A node identifier in the task DAG. */
export type NodeId = string;

/** An edge representing a data dependency: `from` must finish before `to`. */
export interface Edge {
  from: NodeId;
  to: NodeId;
}

/** The raw DAG structure as submitted by task decomposition. */
export interface DAG {
  nodes: Node[];
  edges: Edge[];
}

/** A DAG node: either a plain id string or a full DAGNode payload. */
export type Node = NodeId | DAGNode;

/** The result of a DAG validation run. */
export interface ValidationResult {
  /** True when the DAG is acyclic and all edge references resolve to nodes. */
  valid: boolean;
  /** Each detected cycle, as a list of node IDs forming it. */
  cycles: NodeId[][];
  /** Human-readable explanation when `valid` is false. */
  message?: string;
}

/**
 * One layer of concurrent execution: every node in the layer can run at the
 * same time because none depends on another node in the same layer.
 */
export type ExecutionLayer = NodeId[];

/** Result of dispatching an agent for a node. */
export interface AgentResult {
  nodeId: NodeId;
  output: unknown;
}

/**
 * Thrown by `topologicalSort` when called on a cyclic DAG.
 * The `cyclePath` property holds the node IDs forming the detected cycle.
 */
export class DAGCycleError extends Error {
  public readonly cyclePath: NodeId[];

  constructor(cyclePath: NodeId[]) {
    super(
      `Cannot topologically sort a cyclic DAG. Cycle: ${cyclePath.join(' -> ')}`,
    );
    this.name = 'DAGCycleError';
    this.cyclePath = cyclePath;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Extract the nodeId from either a plain string or a DAGNode object. */
function nodeId(node: Node): NodeId {
  return typeof node === 'string' ? node : node.nodeId;
}

/** Extract all node ids present in the DAG. */
function nodeIds(dag: DAG): NodeId[] {
  return dag.nodes.map(nodeId);
}

/**
 * Build an index of every edge that references a node ID which is not
 * present in the node list. Returns an array of offending edge pairs.
 */
function findUnknownNodeRefs(dag: DAG, ids: Set<NodeId>): Edge[] {
  const bad: Edge[] = [];
  for (const edge of dag.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) {
      bad.push(edge);
    }
  }
  return bad;
}

/**
 * Build the adjacency list and in-degree map for Kahn's algorithm.
 * Assumes all edge endpoints have already been validated to exist.
 */
function buildGraph(dag: DAG, ids: NodeId[]): {
  adjacency: Map<NodeId, NodeId[]>;
  inDegree: Map<NodeId, number>;
} {
  const adjacency = new Map<NodeId, NodeId[]>(ids.map(id => [id, []]));
  const inDegree = new Map<NodeId, number>(ids.map(id => [id, 0]));

  for (const { from, to } of dag.edges) {
    adjacency.get(from)?.push(to);
    const current = inDegree.get(to) ?? 0;
    inDegree.set(to, current + 1);
  }

  return { adjacency, inDegree };
}

/**
 * Extract the actual cycles (as node ID lists) from the set of nodes that
 * remained unprocessed after Kahn's algorithm terminated.
 */
function extractCycles(
  unprocessed: Set<NodeId>,
  adjacency: Map<NodeId, NodeId[]>,
): NodeId[][] {
  const cycles: NodeId[][] = [];
  const visitedCycles = new Set<string>();

  for (const start of unprocessed) {
    // Skip nodes already reported as part of an earlier cycle.
    if (!unprocessed.has(start)) continue;

    // Walk the sub-graph of unprocessed nodes from `start`.
    const path: NodeId[] = [];
    const onPath = new Set<NodeId>();
    let current: NodeId | undefined = start;
    let found = false;

    while (current !== undefined) {
      if (onPath.has(current)) {
        // Cycle detected: slice the path from the first occurrence of `current`.
        const startIdx = path.indexOf(current);
        const cycle = path.slice(startIdx);
        const key = [...cycle].sort().join('|');
        if (!visitedCycles.has(key)) {
          visitedCycles.add(key);
          cycles.push(cycle);
        }
        found = true;
        break;
      }
      onPath.add(current);
      path.push(current);

      // Move to the next unprocessed successor.
      const successors: NodeId[] = (adjacency.get(current) ?? []).filter(
        (s: NodeId) => unprocessed.has(s),
      );
      if (successors.length === 0) {
        break;
      }
      current = successors[0];
    }

    if (found) {
      // Mark every node in the cycle as reported so we don't emit duplicates.
      const cycle = cycles[cycles.length - 1];
      for (const node of cycle) {
        unprocessed.delete(node);
      }
    } else {
      // This branch should not happen for nodes inside a cycle, but remove
      // the node to avoid an infinite loop over already-processed members.
      unprocessed.delete(start);
    }
  }

  return cycles;
}

// ─── DAGResolver class ───────────────────────────────────────────────────────

/**
 * Resolves task DAGs: validation, layered topological sort, and context
 * merging for dispatch.
 */
export class DAGResolver {
  /**
   * Validate the DAG.
   *
   * Checks that:
   *  1. Every edge endpoint references an existing node ID.
   *  2. The graph is acyclic (Kahn's algorithm).
   *
   * Returns `{ valid, cycles, message }`. When `valid === false`, `cycles`
   * contains every detected cycle (list of node IDs) and `message` is a
   * human-readable explanation.
   */
  validate(dag: DAG): ValidationResult {
    const ids = nodeIds(dag);
    const idSet = new Set(ids);

    // 1. Unknown node references.
    const badEdges = findUnknownNodeRefs(dag, idSet);
    if (badEdges.length > 0) {
      const described = badEdges
        .map(e => `${e.from} -> ${e.to}`)
        .join(', ');
      return {
        valid: false,
        cycles: [],
        message: `Edges reference non-existent node IDs: ${described}`,
      };
    }

    // 2. Cycle detection via Kahn's algorithm.
    const { adjacency, inDegree } = buildGraph(dag, ids);
    const queue: NodeId[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }

    let processed = 0;
    const seen = new Set<NodeId>(queue);
    while (queue.length > 0) {
      const current = queue.shift() as NodeId;
      processed++;
      for (const next of adjacency.get(current) ?? []) {
        const deg = (inDegree.get(next) ?? 0) - 1;
        inDegree.set(next, deg);
        if (deg === 0 && !seen.has(next)) {
          queue.push(next);
          seen.add(next);
        }
      }
    }

    if (processed < ids.length) {
      const unprocessed = new Set<NodeId>(
        ids.filter(id => (inDegree.get(id) ?? 0) > 0),
      );
      const cycles = extractCycles(unprocessed, adjacency);
      return {
        valid: false,
        cycles,
        message: `DAG contains ${cycles.length} cycle(s): ${cycles
          .map(c => c.join(' -> '))
          .join(' | ')}`,
      };
    }

    return { valid: true, cycles: [] };
  }

  /**
   * Produce a layered topological sort.
   *
   * Layer 0 contains all nodes with no incoming edges (including nodes that
   * have no edges at all). Each subsequent layer contains nodes whose every
   * predecessor is in an earlier layer. Nodes in the same layer can execute
   * concurrently.
   *
   * @throws {DAGCycleError} when the DAG is invalid (cyclic). The error's
   * `cyclePath` contains the detected cycle's node IDs.
   */
  topologicalSort(dag: DAG): ExecutionLayer[] {
    const validation = this.validate(dag);
    if (!validation.valid) {
      if (validation.cycles.length > 0) {
        throw new DAGCycleError(validation.cycles[0]);
      }
      // Structural error (unknown node reference).
      throw new Error(validation.message ?? 'Invalid DAG');
    }

    const ids = nodeIds(dag);
    const { adjacency, inDegree } = buildGraph(dag, ids);
    const inDeg = new Map(inDegree);

    const layers: ExecutionLayer[] = [];
    let currentLayer: NodeId[] = [];
    for (const [id, deg] of inDeg) {
      if (deg === 0) currentLayer.push(id);
    }

    const placed = new Set<NodeId>();
    while (currentLayer.length > 0) {
      layers.push(currentLayer);
      for (const id of currentLayer) placed.add(id);

      const next: NodeId[] = [];
      for (const id of currentLayer) {
        for (const succ of adjacency.get(id) ?? []) {
          if (placed.has(succ)) continue;
          const deg = (inDeg.get(succ) ?? 0) - 1;
          inDeg.set(succ, deg);
          if (deg === 0) next.push(succ);
        }
      }
      currentLayer = next;
    }

    return layers;
  }

  /**
   * Resolve the execution context for `node` from completed upstream results.
   *
   * Merges every upstream node's output into the node's input context object
   * keyed by upstream node ID, ready for dispatch to the agent.
   *
   * @param node            - The target DAG node.
   * @param completedResults - Map of nodeId -> AgentResult for every upstream
   *                          node that has completed. Extra entries for
   *                          non-upstream nodes are ignored.
   * @returns The enriched context: `{ ...node.prompt-derived context,
   *          [upstreamNodeId]: output }`.
   */
  resolveContext(
    node: DAGNode,
    completedResults: ReadonlyMap<NodeId, AgentResult>,
  ): Record<string, unknown> {
    const context: Record<string, unknown> = {};

    // Base context from the node itself, if present.
    if (node.prompt !== undefined) context.prompt = node.prompt;
    if (node.description !== undefined) context.description = node.description;
    context.nodeId = node.nodeId;
    context.type = node.type;

    // Merge upstream outputs, keyed by upstream node ID.
    for (const dep of node.dependencies) {
      const result = completedResults.get(dep);
      if (result !== undefined) {
        context[dep] = result.output;
      }
    }

    return context;
  }
}

export default DAGResolver;

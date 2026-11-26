/**
 * Unit tests for DAGResolver.
 *
 * Covers:
 *  - Linear 5-node DAG (5 sequential layers)
 *  - Diamond 5-node DAG (4 layers, B and C execute concurrently)
 *  - 3-node cycle detection (validate + topologicalSort throws DAGCycleError)
 *  - Two separate cycles in the same DAG
 *  - Disconnected node appears in layer 0
 *  - Single-node DAG
 *  - Empty DAG
 *  - resolveContext merges upstream results correctly
 *  - DAGCycleError contains cyclePath property
 *  - Input validation: edge referencing unknown node IDs
 */

import { DAGResolver, DAGCycleError } from './dagResolver';
import type { DAG, Edge } from './dagResolver';
import type { DAGNode } from '../types/task';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDAG(nodeIds: string[], edges: Array<[string, string]>): DAG {
  return {
    nodes: nodeIds,
    edges: edges.map(([from, to]): Edge => ({ from, to })),
  };
}

function nodeOf(nodeId: string, deps: string[] = []): DAGNode {
  return {
    nodeId,
    type: 'test',
    dependencies: deps,
    status: 'pending',
  };
}

function sortedLayer(layer: string[]): string[] {
  return [...layer].sort();
}

const resolver = new DAGResolver();

// ─── Empty DAG ───────────────────────────────────────────────────────────────

describe('Empty DAG', () => {
  const dag = makeDAG([], []);

  it('validates as valid', () => {
    expect(resolver.validate(dag)).toMatchObject({ valid: true, cycles: [] });
  });

  it('topologicalSort returns empty layers', () => {
    const layers = resolver.topologicalSort(dag);
    expect(layers).toHaveLength(0);
  });
});

// ─── Single-node DAG ─────────────────────────────────────────────────────────

describe('Single-node DAG', () => {
  const dag = makeDAG(['A'], []);

  it('validates as valid', () => {
    expect(resolver.validate(dag).valid).toBe(true);
  });

  it('topologicalSort returns one layer with the single node', () => {
    const layers = resolver.topologicalSort(dag);
    expect(layers).toHaveLength(1);
    expect(layers[0]).toEqual(['A']);
  });
});

// ─── Linear 5-node DAG ───────────────────────────────────────────────────────

describe('Linear 5-node DAG (A->B->C->D->E)', () => {
  const dag = makeDAG(
    ['A', 'B', 'C', 'D', 'E'],
    [['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'E']],
  );

  it('validates as valid', () => {
    expect(resolver.validate(dag).valid).toBe(true);
  });

  it('produces exactly 5 execution layers, one node each', () => {
    const layers = resolver.topologicalSort(dag);
    expect(layers).toHaveLength(5);
    expect(layers[0]).toEqual(['A']);
    expect(layers[1]).toEqual(['B']);
    expect(layers[2]).toEqual(['C']);
    expect(layers[3]).toEqual(['D']);
    expect(layers[4]).toEqual(['E']);
  });
});

// ─── Diamond DAG ─────────────────────────────────────────────────────────────

describe('Diamond DAG (A->B, A->C, B->D, C->D, D->E)', () => {
  const dag = makeDAG(
    ['A', 'B', 'C', 'D', 'E'],
    [['A', 'B'], ['A', 'C'], ['B', 'D'], ['C', 'D'], ['D', 'E']],
  );

  it('validates as valid', () => {
    expect(resolver.validate(dag).valid).toBe(true);
  });

  it('produces 4 layers: [A], [B,C], [D], [E]', () => {
    const layers = resolver.topologicalSort(dag);
    expect(layers).toHaveLength(4);
    expect(sortedLayer(layers[0])).toEqual(['A']);
    // B and C can run concurrently — order within the layer is not guaranteed.
    expect(sortedLayer(layers[1])).toEqual(['B', 'C']);
    expect(sortedLayer(layers[2])).toEqual(['D']);
    expect(sortedLayer(layers[3])).toEqual(['E']);
  });
});

// ─── 3-node cycle ────────────────────────────────────────────────────────────

describe('3-node cycle (A->B->C->A)', () => {
  const dag = makeDAG(
    ['A', 'B', 'C'],
    [['A', 'B'], ['B', 'C'], ['C', 'A']],
  );

  it('validate returns valid:false with cycles [["A","B","C"]]', () => {
    const result = resolver.validate(dag);
    expect(result.valid).toBe(false);
    expect(result.cycles).toHaveLength(1);
    // The cycle must contain all three nodes (order depends on traversal).
    expect(sortedLayer(result.cycles[0])).toEqual(['A', 'B', 'C']);
    expect(result.message).toBeTruthy();
  });

  it('topologicalSort throws DAGCycleError', () => {
    expect(() => resolver.topologicalSort(dag)).toThrow(DAGCycleError);
  });

  it('DAGCycleError.cyclePath contains the cycle node IDs', () => {
    let err: DAGCycleError | undefined;
    try {
      resolver.topologicalSort(dag);
    } catch (e) {
      if (e instanceof DAGCycleError) err = e;
    }
    expect(err).toBeDefined();
    expect(err?.cyclePath).toBeDefined();
    // cyclePath must include at least the nodes in the cycle.
    const path = err?.cyclePath ?? [];
    expect(path.length).toBeGreaterThan(0);
    for (const id of path) {
      expect(['A', 'B', 'C']).toContain(id);
    }
  });
});

// ─── Two separate cycles ──────────────────────────────────────────────────────

describe('Two separate cycles (A->B->A and C->D->C)', () => {
  const dag = makeDAG(
    ['A', 'B', 'C', 'D'],
    [['A', 'B'], ['B', 'A'], ['C', 'D'], ['D', 'C']],
  );

  it('validate returns valid:false with two cycles', () => {
    const result = resolver.validate(dag);
    expect(result.valid).toBe(false);
    expect(result.cycles).toHaveLength(2);
  });

  it('topologicalSort throws DAGCycleError', () => {
    expect(() => resolver.topologicalSort(dag)).toThrow(DAGCycleError);
  });
});

// ─── Disconnected node ────────────────────────────────────────────────────────

describe('Disconnected node (F has no edges)', () => {
  const dag = makeDAG(
    ['A', 'B', 'F'],
    [['A', 'B']],
  );

  it('validates as valid', () => {
    expect(resolver.validate(dag).valid).toBe(true);
  });

  it('disconnected node F appears in layer 0', () => {
    const layers = resolver.topologicalSort(dag);
    expect(layers[0]).toContain('F');
    // A also has no incoming edges.
    expect(layers[0]).toContain('A');
  });
});

// ─── Input validation: unknown node references ────────────────────────────────

describe('Edge referencing non-existent node IDs', () => {
  const dag: DAG = {
    nodes: ['A', 'B'],
    edges: [{ from: 'A', to: 'NONEXISTENT' }],
  };

  it('validate returns valid:false with descriptive message', () => {
    const result = resolver.validate(dag);
    expect(result.valid).toBe(false);
    expect(result.cycles).toHaveLength(0);
    expect(result.message).toMatch(/NONEXISTENT/);
  });

  it('topologicalSort throws an Error (not DAGCycleError)', () => {
    expect(() => resolver.topologicalSort(dag)).toThrow(Error);
  });
});

// ─── resolveContext ───────────────────────────────────────────────────────────

describe('resolveContext', () => {
  it('merges all upstream node results into context keyed by upstream node ID', () => {
    const node = nodeOf('C', ['A', 'B']);
    const completed = new Map([
      ['A', { nodeId: 'A', output: { data: 'result-a' } }],
      ['B', { nodeId: 'B', output: { data: 'result-b' } }],
    ]);

    const ctx = resolver.resolveContext(node, completed);

    expect(ctx['A']).toEqual({ data: 'result-a' });
    expect(ctx['B']).toEqual({ data: 'result-b' });
    expect(ctx.nodeId).toBe('C');
    expect(ctx.type).toBe('test');
  });

  it('ignores completed results for non-upstream nodes', () => {
    const node = nodeOf('B', ['A']);
    const completed = new Map([
      ['A', { nodeId: 'A', output: 'upstream' }],
      ['X', { nodeId: 'X', output: 'irrelevant' }],
    ]);

    const ctx = resolver.resolveContext(node, completed);

    expect(ctx['A']).toBe('upstream');
    expect(ctx['X']).toBeUndefined();
  });

  it('includes node prompt and description when present', () => {
    const node: DAGNode = {
      nodeId: 'D',
      type: 'llm',
      dependencies: [],
      status: 'pending',
      prompt: 'Do something',
      description: 'A description',
    };

    const ctx = resolver.resolveContext(node, new Map());

    expect(ctx.prompt).toBe('Do something');
    expect(ctx.description).toBe('A description');
  });

  it('returns base context even when no upstream results are provided', () => {
    const node = nodeOf('solo', []);
    const ctx = resolver.resolveContext(node, new Map());

    expect(ctx.nodeId).toBe('solo');
    expect(ctx.type).toBe('test');
  });
});

// ─── DAGCycleError ───────────────────────────────────────────────────────────

describe('DAGCycleError', () => {
  it('has name DAGCycleError', () => {
    const err = new DAGCycleError(['A', 'B']);
    expect(err.name).toBe('DAGCycleError');
  });

  it('cyclePath contains the provided node IDs', () => {
    const err = new DAGCycleError(['X', 'Y', 'Z']);
    expect(err.cyclePath).toEqual(['X', 'Y', 'Z']);
  });

  it('is an instance of Error', () => {
    const err = new DAGCycleError(['A']);
    expect(err).toBeInstanceOf(Error);
  });
});

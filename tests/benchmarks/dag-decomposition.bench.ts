/**
 * dag-decomposition.bench.ts
 *
 * Benchmarks the DAG decomposition algorithm (detectCycles + orchestrator
 * construction) with 100 iterations over a fixed 50-node input.
 *
 * Run:
 *   npx ts-node --esm tests/benchmarks/dag-decomposition.bench.ts
 *
 * Output: JSON written to tests/benchmarks/results/dag-decomposition.json
 */

import { detectCycles, type PipelineNode } from '../../backend/src/coordinator/pipelineOrchestrator';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// ─── Fixed 50-node input ──────────────────────────────────────────────────────

function buildFixture(size: number): PipelineNode[] {
  const agentTypes = ['research', 'risk', 'coding', 'design', 'report'];
  const nodes: PipelineNode[] = [];

  for (let i = 0; i < size; i++) {
    // Create a layered DAG: each node depends on 0–2 prior nodes
    const dependsOn: string[] = [];
    if (i >= 2) dependsOn.push(`node_${i - 2}`);
    if (i >= 1 && i % 3 !== 0) dependsOn.push(`node_${i - 1}`);

    nodes.push({
      id: `node_${i}`,
      agentType: agentTypes[i % agentTypes.length],
      inputs: { prompt: `Task step ${i}` },
      dependsOn,
    });
  }

  return nodes;
}

const ITERATIONS = 100;
const FIXTURE_SIZE = 50;
const fixture = buildFixture(FIXTURE_SIZE);

// ─── Benchmark runner ─────────────────────────────────────────────────────────

function runBenchmark(): { name: string; iterations: number; totalMs: number; meanMs: number; p95Ms: number } {
  const samples: number[] = [];

  // Warm-up: 10 iterations not counted
  for (let i = 0; i < 10; i++) {
    detectCycles([...fixture]);
  }

  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    detectCycles([...fixture]);
    samples.push(performance.now() - start);
  }

  samples.sort((a, b) => a - b);
  const totalMs = samples.reduce((s, v) => s + v, 0);
  const meanMs = totalMs / samples.length;
  const p95Ms = samples[Math.floor(samples.length * 0.95)];

  return {
    name: 'dag-decomposition',
    iterations: ITERATIONS,
    totalMs,
    meanMs,
    p95Ms,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const result = runBenchmark();

console.log(`[dag-decomposition] mean: ${result.meanMs.toFixed(3)} ms  p95: ${result.p95Ms.toFixed(3)} ms  (${ITERATIONS} iterations, ${FIXTURE_SIZE} nodes)`);

const outDir = join(__dirname, 'results');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, 'dag-decomposition.json');
writeFileSync(outPath, JSON.stringify({ timestamp: new Date().toISOString(), ...result }, null, 2));
console.log(`Results written to ${outPath}`);

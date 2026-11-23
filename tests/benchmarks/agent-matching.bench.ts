/**
 * agent-matching.bench.ts
 *
 * Benchmarks the agent matching/selection algorithm (selectFallbackAgent)
 * with 1000 iterations over a pool of 100 agents.
 *
 * Run:
 *   npx ts-node --esm tests/benchmarks/agent-matching.bench.ts
 *
 * Output: JSON written to tests/benchmarks/results/agent-matching.json
 */

import { selectFallbackAgent } from '../../backend/src/coordinator/dispatch';
import type { AgentRegistration } from '../../backend/src/types/agent';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// ─── 100-agent pool fixture ───────────────────────────────────────────────────

function buildAgentPool(size: number): AgentRegistration[] {
  const types = ['research', 'risk', 'coding', 'design', 'report'];
  const agents: AgentRegistration[] = [];

  for (let i = 0; i < size; i++) {
    agents.push({
      id: `agent_${i}`,
      type: types[i % types.length],
      endpoint: `http://agent-${i}.local`,
      cost: Math.round((0.1 + (i % 10) * 0.1) * 100) / 100,
      status: i % 10 === 0 ? 'offline' : 'online', // 10 % offline
      reputation: Math.round((3.0 + (i % 20) * 0.1) * 10) / 10,
    });
  }

  return agents;
}

const ITERATIONS = 1000;
const POOL_SIZE = 100;
const pool = buildAgentPool(POOL_SIZE);

// ─── Benchmark runner ─────────────────────────────────────────────────────────

function runBenchmark(): { name: string; iterations: number; totalMs: number; meanMs: number; p95Ms: number } {
  const samples: number[] = [];

  // Warm-up
  for (let i = 0; i < 20; i++) {
    selectFallbackAgent(pool, `agent_${i % POOL_SIZE}`);
  }

  for (let i = 0; i < ITERATIONS; i++) {
    const failedId = `agent_${i % POOL_SIZE}`;
    const start = performance.now();
    selectFallbackAgent(pool, failedId);
    samples.push(performance.now() - start);
  }

  samples.sort((a, b) => a - b);
  const totalMs = samples.reduce((s, v) => s + v, 0);
  const meanMs = totalMs / samples.length;
  const p95Ms = samples[Math.floor(samples.length * 0.95)];

  return {
    name: 'agent-matching',
    iterations: ITERATIONS,
    totalMs,
    meanMs,
    p95Ms,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const result = runBenchmark();

console.log(`[agent-matching] mean: ${result.meanMs.toFixed(3)} ms  p95: ${result.p95Ms.toFixed(3)} ms  (${ITERATIONS} iterations, ${POOL_SIZE} agents)`);

const outDir = join(__dirname, 'results');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, 'agent-matching.json');
writeFileSync(outPath, JSON.stringify({ timestamp: new Date().toISOString(), ...result }, null, 2));
console.log(`Results written to ${outPath}`);

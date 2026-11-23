/**
 * api-agents-endpoint.bench.ts
 *
 * Benchmarks GET /api/agents using an in-memory SQLite database seeded with
 * 1000 agents. Uses autocannon for HTTP-level throughput measurement.
 *
 * Run:
 *   npx ts-node --esm tests/benchmarks/api-agents-endpoint.bench.ts
 *
 * Output: JSON written to tests/benchmarks/results/api-agents-endpoint.json
 *
 * Requirements:
 *   npm install --save-dev autocannon @types/autocannon
 */

import http from 'http';
import Database from 'better-sqlite3';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// ─── In-memory SQLite seed ────────────────────────────────────────────────────

function buildInMemoryDb(agentCount: number): Database.Database {
  const db = new Database(':memory:');

  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      capabilities TEXT NOT NULL DEFAULT '[]',
      pricingXLM REAL NOT NULL DEFAULT 0,
      endpoint TEXT NOT NULL DEFAULT '',
      stellarPublicKey TEXT NOT NULL DEFAULT '',
      reputationScore REAL NOT NULL DEFAULT 0,
      lastSeenAt TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'online'
    )
  `);

  const insert = db.prepare(`
    INSERT INTO agents (id, capabilities, pricingXLM, endpoint, stellarPublicKey, reputationScore, lastSeenAt, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const types = ['research', 'risk', 'coding', 'design', 'report'];
  const insertMany = db.transaction(() => {
    for (let i = 0; i < agentCount; i++) {
      insert.run(
        `agent_${i}`,
        JSON.stringify([types[i % types.length]]),
        Math.round((0.1 + (i % 10) * 0.1) * 100) / 100,
        `http://agent-${i}.local`,
        `GKEY${String(i).padStart(50, '0')}`,
        Math.round((3.0 + (i % 20) * 0.1) * 10) / 10,
        new Date().toISOString(),
        i % 10 === 0 ? 'offline' : 'online',
      );
    }
  });

  insertMany();
  return db;
}

// ─── Minimal Express-compatible HTTP server ───────────────────────────────────

function createBenchServer(db: Database.Database): http.Server {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url?.startsWith('/api/agents')) {
      const url = new URL(req.url, 'http://localhost');
      const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20', 10), 100);
      const cursor = url.searchParams.get('cursor') ?? null;

      let query = `SELECT * FROM agents`;
      const params: (string | number)[] = [];

      if (cursor) {
        query += ` WHERE id > ?`;
        params.push(cursor);
      }

      query += ` ORDER BY id LIMIT ?`;
      params.push(limit);

      const rows = db.prepare(query).all(...params);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: { items: rows, pagination: { limit, nextCursor: rows.length === limit ? (rows[rows.length - 1] as { id: string }).id : null, hasNextPage: rows.length === limit } } }));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  return server;
}

// ─── Benchmark runner ─────────────────────────────────────────────────────────

async function runBenchmark(): Promise<{
  name: string;
  requests: number;
  throughputRps: number;
  latencyMeanMs: number;
  latencyP99Ms: number;
  errors: number;
}> {
  const db = buildInMemoryDb(1000);
  const server = createBenchServer(db);

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const port = address.port;

  console.log(`Bench server on port ${port}, running 10s load test…`);

  // Dynamic import — autocannon is an optional dev dependency
  let autocannon: typeof import('autocannon');
  try {
    autocannon = await import('autocannon');
  } catch {
    console.warn('autocannon not installed, using manual HTTP loop instead');
    // Fallback: simple sequential request loop
    const ITERATIONS = 500;
    const times: number[] = [];

    for (let i = 0; i < ITERATIONS; i++) {
      const start = performance.now();
      await new Promise<void>((resolve, reject) => {
        http.get(`http://127.0.0.1:${port}/api/agents?limit=20`, (res) => {
          res.resume();
          res.on('end', resolve);
        }).on('error', reject);
      });
      times.push(performance.now() - start);
    }

    server.close();
    db.close();

    times.sort((a, b) => a - b);
    const mean = times.reduce((s, v) => s + v, 0) / times.length;
    const p99 = times[Math.floor(times.length * 0.99)];

    return {
      name: 'api-agents-endpoint',
      requests: ITERATIONS,
      throughputRps: Math.round(1000 / mean),
      latencyMeanMs: mean,
      latencyP99Ms: p99,
      errors: 0,
    };
  }

  const result = await autocannon.default({
    url: `http://127.0.0.1:${port}/api/agents?limit=20`,
    connections: 10,
    duration: 10,
  });

  server.close();
  db.close();

  return {
    name: 'api-agents-endpoint',
    requests: result.requests.total,
    throughputRps: result.requests.average,
    latencyMeanMs: result.latency.mean,
    latencyP99Ms: result.latency.p99,
    errors: result.errors,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

runBenchmark().then((result) => {
  console.log(
    `[api-agents-endpoint] ${result.requests} requests  throughput: ${result.throughputRps} req/s  ` +
    `mean: ${result.latencyMeanMs.toFixed(2)} ms  p99: ${result.latencyP99Ms.toFixed(2)} ms  errors: ${result.errors}`,
  );

  const outDir = join(__dirname, 'results');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'api-agents-endpoint.json');
  writeFileSync(outPath, JSON.stringify({ timestamp: new Date().toISOString(), ...result }, null, 2));
  console.log(`Results written to ${outPath}`);
}).catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});

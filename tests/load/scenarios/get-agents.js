import http from "k6/http";
import { check } from "k6";
import { Trend } from "k6/metrics";

const baseUrl = (__ENV.BASE_URL || "").replace(/\/$/, "");
if (!baseUrl) {
  throw new Error(
    "BASE_URL must point to a staging or dedicated load-test backend",
  );
}

const agentsUrl = `${baseUrl}/api/agents`;
const coldCacheDuration = new Trend("cold_cache_duration", true);
const warmCacheDuration = new Trend("warm_cache_duration", true);

const loadStages = [
  { target: 1000, duration: "60s" },
  { target: 1000, duration: "5m" },
  { target: 0, duration: "30s" },
];

export const options = {
  discardResponseBodies: true,
  scenarios: {
    cold_cache: {
      executor: "ramping-arrival-rate",
      exec: "getAgentsCold",
      startRate: 1,
      timeUnit: "1s",
      preAllocatedVUs: 200,
      maxVUs: 2000,
      stages: loadStages,
    },
    warm_cache_prewarm: {
      executor: "shared-iterations",
      exec: "prewarmAgentsCache",
      startTime: "6m30s",
      vus: 1,
      iterations: 1,
      maxDuration: "10s",
    },
    warm_cache: {
      executor: "ramping-arrival-rate",
      exec: "getAgentsWarm",
      startTime: "6m31s",
      startRate: 1,
      timeUnit: "1s",
      preAllocatedVUs: 200,
      maxVUs: 2000,
      stages: loadStages,
    },
  },
  thresholds: {
    cold_cache_duration: ["p(95)<200", "p(99)<500"],
    warm_cache_duration: ["p(95)<200", "p(99)<500"],
    http_req_failed: ["rate<0.001"],
    checks: ["rate>0.999"],
  },
};

function assertAgentList(response) {
  check(response, {
    "GET /api/agents returns 200": (result) => result.status === 200,
  });
}

export function getAgentsCold() {
  const response = http.get(agentsUrl, {
    headers: { "X-Cache-Bypass": "1" },
    tags: { cache_mode: "cold" },
  });
  coldCacheDuration.add(response.timings.duration);
  assertAgentList(response);
  check(response, {
    "cold scenario bypasses cache": (result) =>
      result.headers["X-Cache"] === "BYPASS",
  });
}

export function prewarmAgentsCache() {
  const response = http.get(agentsUrl, { tags: { cache_mode: "warmup" } });
  check(response, {
    "warm-cache priming request returns 200": (result) => result.status === 200,
  });
}

export function getAgentsWarm() {
  const response = http.get(agentsUrl, {
    tags: { cache_mode: "warm" },
  });
  warmCacheDuration.add(response.timings.duration);
  assertAgentList(response);
}

function metricValue(data, name, percentile) {
  return data.metrics[name]?.values?.[percentile] ?? null;
}

export function handleSummary(data) {
  const summary = {
    coldCacheP95Ms: metricValue(data, "cold_cache_duration", "p(95)"),
    coldCacheP99Ms: metricValue(data, "cold_cache_duration", "p(99)"),
    warmCacheP95Ms: metricValue(data, "warm_cache_duration", "p(95)"),
    warmCacheP99Ms: metricValue(data, "warm_cache_duration", "p(99)"),
    errorRate: data.metrics.http_req_failed?.values?.rate ?? null,
    checkRate: data.metrics.checks?.values?.rate ?? null,
  };
  const cells = Object.entries(summary)
    .map(
      ([name, value]) =>
        `<tr><th>${name}</th><td>${value === null ? "n/a" : value}</td></tr>`,
    )
    .join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Agent discovery load test</title><style>body{font:16px sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#1b2933}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px;border-bottom:1px solid #ccd5dc}th{font-weight:600}</style></head><body><h1>Agent discovery load test</h1><p>1000 RPS target; cold-cache bypass and prewarmed-cache scenarios.</p><table>${cells}</table></body></html>`;

  return {
    "tests/load/results/get-agents-summary.json": JSON.stringify(
      summary,
      null,
      2,
    ),
    "tests/load/results/get-agents-report.html": html,
  };
}

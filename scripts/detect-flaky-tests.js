#!/usr/bin/env node
/**
 * detect-flaky-tests.js
 *
 * Scans Jest JSON test result files for tests that PASSED ON RETRY (i.e. the
 * test had at least one failed attempt before succeeding) and generates a
 * flaky-tests report. Also tracks flaky rate over a rolling 7-day window and
 * alerts if it exceeds 5%.
 *
 * Usage:
 *   node scripts/detect-flaky-tests.js [--results-dir <dir>] [--output <file>] [--window-days 7]
 *
 * Inputs:
 *   - Jest --json output files matching `test-results-*.json` in --results-dir
 *
 * Outputs:
 *   - <output> (default: flaky-tests-report.json) — current run flaky tests
 *   - flaky-tests-history.json — rolling 7-day history (appended to)
 *   - Console summary + exit code (0 = no flakes, 1 = flakes found, 2 = alert threshold exceeded)
 *
 * Integration:
 *   This script is designed to run AFTER test suites in CI, consuming the
 *   `test-results-*.json` artifacts uploaded by each test job. It should be
 *   called in a final "flake analysis" step that runs after all test jobs.
 *
 * Example (GitHub Actions):
 *   - name: Detect flaky tests
 *     run: node scripts/detect-flaky-tests.js --results-dir ./test-results --output flaky-tests-report.json
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// ── CLI argument parsing ────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { resultsDir: "./test-results", output: "flaky-tests-report.json", windowDays: 7 };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--results-dir" && argv[i + 1]) {
      args.resultsDir = argv[++i];
    } else if (arg === "--output" && argv[i + 1]) {
      args.output = argv[++i];
    } else if (arg === "--window-days" && argv[i + 1]) {
      args.windowDays = parseInt(argv[++i], 10);
    } else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/detect-flaky-tests.js [--results-dir <dir>] [--output <file>] [--window-days N]");
      process.exit(0);
    }
  }
  return args;
}

// ── Jest result types ──────────────────────────────────────────────────────

/**
 * Jest --json output structure (relevant fields):
 *   {
 *     numTotalTests: number,
 *     numPassedTests: number,
 *     numFailedTests: number,
 *     testResults: [{
 *       name: string,             // test file path
 *       status: "passed"|"failed",
 *       assertionResults: [{
 *         fullName: string,        // describe > test name
 *         status: "passed"|"failed",
 *         // Jest 29+ does not expose retry count per assertion directly,
 *         // but a test that appears in testResults with status "passed" after
 *         // a prior run with "failed" for the same fullName is flaky.
 *       }]
 *     }]
 *   }
 *
 * Flaky detection strategy:
 *   Jest's --json output for a single run does not expose per-test retry
 *   counts. However, when using `jest-retry-tests` or GitHub Actions
 *   `nick-fields/retry`, a flaky test shows up as:
 *     - A FAILED result in one run attempt's JSON
 *     - A PASSED result for the same test in a subsequent attempt's JSON
 *
 *   This script cross-references multiple JSON result files (one per
 *   attempt/job) and flags tests that have BOTH a failed and a passed
 *   result as flaky.
 */

// ── File discovery ─────────────────────────────────────────────────────────

function findResultFiles(resultsDir) {
  if (!fs.existsSync(resultsDir)) {
    console.warn(`Results directory not found: ${resultsDir}`);
    return [];
  }
  return fs
    .readdirSync(resultsDir)
    .filter((f) => f.endsWith(".json") && (f.startsWith("test-results") || f.startsWith("jest-results")))
    .map((f) => path.join(resultsDir, f))
    .filter((f) => {
      try {
        const data = JSON.parse(fs.readFileSync(f, "utf8"));
        return data && typeof data.numTotalTests === "number";
      } catch {
        return false;
      }
    });
}

// ── Flaky test detection ───────────────────────────────────────────────────

/**
 * Collects pass/fail status for every test across all result files.
 * Returns a Map keyed by test fullName, with arrays of statuses.
 */
function collectTestResults(resultFiles) {
  const testMap = new Map(); // fullName -> { file, statuses: string[] }

  for (const file of resultFiles) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      continue;
    }

    if (!data.testResults) continue;

    for (const suite of data.testResults) {
      if (!suite.assertionResults) continue;
      for (const assertion of suite.assertionResults) {
        const key = `${suite.name}::${assertion.fullName}`;
        if (!testMap.has(key)) {
          testMap.set(key, { file: suite.name, fullName: assertion.fullName, statuses: [] });
        }
        testMap.get(key).statuses.push(assertion.status);
      }
    }
  }

  return testMap;
}

/**
 * A test is "flaky" if it has at least one "failed" AND one "passed" status
 * across the result files (meaning it failed on one attempt but passed on another).
 */
function detectFlakyTests(testMap) {
  const flaky = [];
  for (const [key, entry] of testMap) {
    const hasFailed = entry.statuses.includes("failed");
    const hasPassed = entry.statuses.includes("passed");
    if (hasFailed && hasPassed) {
      flaky.push({
        test: entry.fullName,
        file: entry.file,
        attempts: entry.statuses.length,
        statuses: entry.statuses,
      });
    }
  }
  return flaky;
}

// ── Rolling window history ──────────────────────────────────────────────────

const HISTORY_FILE = path.join(process.cwd(), "flaky-tests-history.json");
const ALERT_THRESHOLD_PERCENT = 5;

function loadHistory() {
  if (!fs.existsSync(HISTORY_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveHistory(history) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

function pruneHistory(history, windowDays) {
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  return history.filter((entry) => new Date(entry.timestamp).getTime() >= cutoff);
}

/**
 * Computes the flaky rate over the rolling window.
 * flaky rate = (number of flaky test instances in window / total test instances in window) * 100
 */
function computeFlakyRate(history) {
  let totalTests = 0;
  let flakyTests = 0;
  for (const entry of history) {
    totalTests += entry.totalTests || 0;
    flakyTests += entry.flakyCount || 0;
  }
  if (totalTests === 0) return 0;
  return (flakyTests / totalTests) * 100;
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv);

  console.log("═".repeat(60));
  console.log("  Flaky Test Detection");
  console.log("═".repeat(60));
  console.log(`Results dir: ${args.resultsDir}`);
  console.log(`Output:      ${args.output}`);
  console.log(`Window:      ${args.windowDays} days\n`);

  // ── Collect result files ──
  const resultFiles = findResultFiles(args.resultsDir);
  console.log(`Found ${resultFiles.length} test result file(s).`);

  if (resultFiles.length === 0) {
    console.log("No test result files found — nothing to analyze.");
    // Write an empty report
    const emptyReport = {
      timestamp: new Date().toISOString(),
      resultFiles: [],
      flakyTests: [],
      flakyCount: 0,
      totalTests: 0,
      flakyRate: 0,
    };
    fs.writeFileSync(args.output, JSON.stringify(emptyReport, null, 2));
    process.exit(0);
  }

  // ── Detect flaky tests ──
  const testMap = collectTestResults(resultFiles);
  const flakyTests = detectFlakyTests(testMap);
  const totalTests = testMap.size;

  console.log(`Total unique tests: ${totalTests}`);
  console.log(`Flaky tests found:   ${flakyTests.length}`);

  if (flakyTests.length > 0) {
    console.log("\nFlaky tests:");
    for (const t of flakyTests) {
      console.log(`  ⚠️  ${t.file} > ${t.test} (attempts: ${t.statuses.join(" → ")})`);
    }
  }

  // ── Build current run report ──
  const report = {
    timestamp: new Date().toISOString(),
    resultFiles: resultFiles.map((f) => path.basename(f)),
    flakyTests,
    flakyCount: flakyTests.length,
    totalTests,
    flakyRate: totalTests > 0 ? (flakyTests.length / totalTests) * 100 : 0,
  };

  fs.writeFileSync(args.output, JSON.stringify(report, null, 2));
  console.log(`\nReport written to: ${args.output}`);

  // ── Update rolling history & check alert threshold ──
  let history = loadHistory();
  history.push({
    timestamp: report.timestamp,
    flakyCount: report.flakyCount,
    totalTests: report.totalTests,
    flakyTests: report.flakyTests.map((t) => ({ test: t.test, file: t.file })),
  });
  history = pruneHistory(history, args.windowDays);
  saveHistory(history);

  const flakyRate = computeFlakyRate(history);
  console.log(`\nRolling ${args.windowDays}-day flaky rate: ${flakyRate.toFixed(2)}%`);
  console.log(`Alert threshold: ${ALERT_THRESHOLD_PERCENT}%`);

  if (flakyRate > ALERT_THRESHOLD_PERCENT) {
    console.error(
      `\n🚨 ALERT: Flaky rate (${flakyRate.toFixed(2)}%) exceeds ${ALERT_THRESHOLD_PERCENT}% threshold!\n` +
      `Review the flaky-tests-history.json file and consider quarantining the most flaky tests.`,
    );
    process.exit(2);
  }

  if (flakyTests.length > 0) {
    console.log(`\n⚠️  ${flakyTests.length} flaky test(s) detected this run.`);
    process.exit(1);
  }

  console.log("\n✅ No flaky tests detected.");
  process.exit(0);
}

main();

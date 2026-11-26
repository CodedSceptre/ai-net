import type { Server } from "node:http";
import { beginShutdown, getDrainCounts, waitForDrain } from "./api/middleware/shutdownMiddleware";
import { interruptRunningNodes } from "./coordinator";
/**
 * ai-net backend server entry point.
 *
 * Initializes all agents and starts the HTTP/WebSocket server.
 */

// OpenTelemetry SDK must be initialized before any other imports so that
// auto-instrumentation patches Express, HTTP, and fs before they are loaded.
import "./utils/tracing";

import { createApp } from "./api/app";
import { initializeAgents, globalAgentRegistry } from "./agents";
import { startAgentSync, stopAgentSync } from "./registry/sync";
import { loadConfig } from "./config";
import { AgentCleanupService } from "./services/agentCleanup";
import { createAgentDb, getAgentDb, closeAgentDb } from "./db/agents";
import { closeDb } from "./db/index";
import { closeAuthDb } from "./db/auth";
import { closeJobDb } from "./queue";
import { eventBus } from "./coordinator/eventBus";
import { createDefaultReconciliationService } from "./services/reconciliation";
import { createLogger } from "./utils/logger";
import { redactedConfigSnapshot } from "./config";
import { createTaskDb, getTaskDb, closeTaskDb } from "./db/tasks";
import { TaskResultStorageService } from "./services/taskResultStorage";
import { warmUpResultCache } from "./cache/warmUp";

async function main() {
  const logger = createLogger({ module: "server" });

  try {
    // ── Validate env config at startup ──────────────────────────────────────────
    const config = loadConfig();
    logger.info({ config: redactedConfigSnapshot(config) }, "starting server");

    // Start agent sync
    startAgentSync();

    // Initialize all agents and register them
    logger.info("initializing agents");
    await initializeAgents();

    // Start agent cleanup service
    const cleanupService = new AgentCleanupService();
    cleanupService.start();

    const taskResultStorage = new TaskResultStorageService(createTaskDb(getTaskDb()));
    taskResultStorage.startCleanup();

    // Start daily payment reconciliation
    const reconciliationService = createDefaultReconciliationService();
    reconciliationService.startDaily(config.RECONCILIATION_INTERVAL_MS);

    // Create and start the server
    const { httpServer, close } = createApp({
      jobWorkerStopTimeoutMs: config.GRACEFUL_SHUTDOWN_TIMEOUT * 1000,
    });

    const port = config.PORT;

    httpServer.listen(port, () => {
      logger.info({ port, env: config.NODE_ENV }, "server listening");
      // Best-effort cache warm-up: pre-populate result cache from recent tasks
      warmUpResultCache().catch(() => { /* logged inside warmUpResultCache */ });
    });

    // ── Graceful shutdown ──────────────────────────────────────────────────────
    setupGracefulShutdown(httpServer, close, config, {
      cleanupService,
      taskResultStorage,
      reconciliationService,
      globalAgentRegistry,
    });

  } catch (error) {
    logger.error({ err: error }, "failed to start server");
    process.exit(1);
  }
}

export interface GracefulShutdownExtras {
  cleanupService?: { stop(): void };
  taskResultStorage?: { stopCleanup(): void };
  reconciliationService?: { stop(): void };
  globalAgentRegistry?: { shutdown(): void };
}

/** Stop intake, drain active work, then checkpoint and close persistent stores. */
export function setupGracefulShutdown(
  httpServer: Server,
  closeApp: (callback?: () => void) => void,
  config: { GRACEFUL_SHUTDOWN_TIMEOUT?: number },
  extras: GracefulShutdownExtras = {},
) {
  const logger = createLogger({ module: "shutdown" });
  let isShuttingDown = false;

  // Support SHUTDOWN_TIMEOUT_MS env var as override (in milliseconds)
  const timeoutMs =
    process.env.SHUTDOWN_TIMEOUT_MS !== undefined
      ? parseInt(process.env.SHUTDOWN_TIMEOUT_MS, 10)
      : (config.GRACEFUL_SHUTDOWN_TIMEOUT ?? 30) * 1000;

  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    beginShutdown();
    logger.info({ signal }, "starting graceful shutdown sequence");

    let timer: NodeJS.Timeout | undefined;
    try {
      const httpClosed = new Promise<void>((resolve) => {
        if (httpServer.listening) httpServer.close(() => resolve());
        else resolve();
      });
      const appClosed = new Promise<void>((resolve) => closeApp(resolve));

      stopAgentSync();
      extras.cleanupService?.stop();
      extras.taskResultStorage?.stopCleanup();
      extras.reconciliationService?.stop();

      const timedOut = await Promise.race([
        Promise.all([httpClosed, appClosed, waitForDrain()]).then(() => false),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(true), timeoutMs);
        }),
      ]);
      if (timedOut) {
        logger.warn({ signal, timeoutMs, ...getDrainCounts() }, "shutdown drain timed out");
        httpServer.closeAllConnections?.();
        try {
          interruptRunningNodes();
        } catch (err) {
          logger.error({ err }, "failed to mark running DAG nodes interrupted");
        }
      }
      extras.globalAgentRegistry?.shutdown();

      // Phase 3: mark online agents offline so stale capacity is not advertised
      logger.info("marking online agents offline");
      try {
        const agentDb = createAgentDb(getAgentDb());
        agentDb.markAllOffline();
      } catch (err) {
        logger.error({ err }, "failed to mark agents offline during shutdown");
      }

      // Phase 4: flush event store
      logger.info("flushing event store");
      try {
        eventBus.store.close();
      } catch (err) {
        logger.error({ err }, "failed to close event store during shutdown");
      }

      // Phase 5: close all database connections
      logger.info("closing database connections");
      await Promise.allSettled([closeDb(), closeAgentDb(), closeTaskDb()]).then((results) => {
        for (const result of results) {
          if (result.status === "rejected") logger.error({ err: result.reason }, "failed to close database pool");
        }
      });
      closeJobDb();
      closeAuthDb();

      logger.info({ signal }, "graceful shutdown complete");
      process.exit(timedOut ? 1 : 0);
    } catch (error) {
      logger.error({ err: error }, "error during graceful shutdown");
      process.exit(1);
    } finally {
      clearTimeout(timer);
    }
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  return shutdown;
}

if (require.main === module) {
  main();
}

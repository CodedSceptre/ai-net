import { buildReceiptData } from "../services/receiptService";
import { shutdownMiddleware, isShuttingDown } from "./middleware/shutdownMiddleware";
/**
 * Express application factory.
 *
 * Wires up middleware, routes, the WebSocket task stream, background
 * services (job queue/worker, heartbeat cleanup, metrics), and the global
 * error handler. Called by tests (`opts.disableCompression`, custom
 * dispatch/queue, etc.) and by the server entry-point (`src/index.ts`).
 */

import Redis from "ioredis";
import { AuthService as WalletAuthService } from "../services/authService";
import express, { Request, Response } from "express";
import { createServer, Server as HttpServer } from "http";
import swaggerUi from "swagger-ui-express";

import {
  createTaskJobHandler,
  type DispatchFn,
  type PaymentReleaseFn,
} from "../coordinator/coordinator";
import { httpDispatch } from "../coordinator/dispatch";
import { eventBus } from "../coordinator/eventBus";
import { getTask } from "../coordinator/taskStore";
import { createTaskDb, getTaskDb } from "../db/tasks";
import { createPaymentReleaseFn, type StellarReleasePaymentFn } from "../payment";
import { getGlobalJobQueue, JobWorker, type JobQueue } from "../queue";
import { createHeartbeatService, type HeartbeatServiceOptions } from "../services/heartbeat";
import { metricsMiddleware } from "./middleware/metricsMiddleware";
import { metricsService } from "../services/metrics";
import type { EventStore } from "../events/eventStore";
import { createEventStore } from "../events/eventStore";
import {
  attachTaskStream,
  getStreamConnectionCount,
  type TaskStreamOptions,
} from "./routes/stream";
import { attachAgentStatusStream } from "./routes/agentStatusStream";
import type { DAGNode } from "../types/task";
import type { AgentRegistry } from "../types/agent";
import { agentsRouter } from "./routes/agents";
import { createAgentDb, getAgentDb } from "../db/agents";
import { excludeBannedAgents } from "../services/adminPlatform";
import { createAgentOnboardingRouter, type AgentOnboardingOptions } from "./routes/agentOnboarding";
import { healthRouter } from "./routes/health";
import { metricsRouter } from "./routes/metrics";
import { createStatsRouter } from "./routes/stats";
import { createReconciliationRouter, type ReconciliationRouterOptions } from "./routes/reconciliation";
import { createPaymentsRouter } from "./routes/payments";
import {
  rateLimitMiddleware,
  registerRateLimitMiddleware,
  publicLimiter,
  authedLimiter,
  adminLimiter,
} from "./middleware/rateLimit";
import { ipRateLimitMiddleware } from "./middleware/rateLimiter";
import { internalRouter } from "./routes/internal";
import { createCorsMiddleware } from "./middleware/cors";
import { compressionMiddleware } from "./middleware/compression";
import { errorHandler } from "./middleware/errorHandler";
import { readOnlyMiddleware } from "./middleware/readOnly";
import { requestId } from "./middleware/requestId";
import { requestLogger } from "./middleware/requestLogger";
import { versioningMiddleware } from "./middleware/versioning";
import { getOpenapiJson, getOpenapiYaml, openapiSpec, swaggerUiOptions } from "./docs";
import { createAdminQueueRouter } from "./routes/admin";
import { createAdminManagementRouter } from "./routes/adminManagement";
import { createEventsRouter } from "./routes/events";
import { CostEstimator } from "../coordinator/costEstimator";
import { createTaskEstimateRouter } from "./routes/tasks";
import { createV1TasksRouter } from "./routes/v1/tasks";
import { createV2TasksRouter } from "./routes/v2/tasks";
import { createAuthRouter } from "./routes/auth";
import { createFlagsRouter } from "./routes/flags";
import { createVersionsRouter } from "./routes/versions";
import { queueRouter } from "./routes/queue";
import { createAuditRouter } from "./routes/audit";
import { createAuditMiddleware } from "./middleware/auditMiddleware";
import { getAuditDb } from "../db/auditDb";
import { optionalAuthMiddleware } from "./middleware/auth";
import { walletAuthMiddleware } from "./middleware/auth";
import { createAdminRouter } from "./routes/admin";
import { type AuthService } from "../services/auth";
import { createLogger } from "../utils/logger";
import { AppError } from "../errors";
import { getConfig } from "../config";

import { createWebhooksRouter } from "./routes/webhooks";
import { WebhookService, type WebhookEvent } from "../services/webhookService";
import type { DAGEvent } from "../types/task";

const webhookEventNames: Partial<Record<DAGEvent["type"], WebhookEvent>> = {
  task_completed: "task.completed",
  task_failed: "task.failed",
  payment_released: "payment.released",
};

const dispatchLogger = createLogger({ module: "http-dispatch" });

export interface AppOptions {
  dispatch?: DispatchFn;
  releasePayment?: PaymentReleaseFn;
  eventStore?: EventStore;
  stream?: TaskStreamOptions;
  agentRegistry?: AgentRegistry;
  enableHeartbeatCleanup?: boolean;
  heartbeatOptions?: HeartbeatServiceOptions;
  reconciliation?: ReconciliationRouterOptions;
  disableCompression?: boolean;
  queue?: JobQueue;
  jobWorker?: JobWorker;
  /** Custom auth service instance */
  authService?: AuthService;
  walletAuthService?: WalletAuthService;
  /** Soroban registration hook used by the guided agent onboarding flow. */
  agentOnboarding?: AgentOnboardingOptions;
  /** Enable background queue worker (default: true) */
  enableQueueWorker?: boolean;
  /**
   * How long close() waits for in-flight jobs to finish before closing the
   * HTTP/WS server anyway. Default: 10000 (10s). A job still running when
   * this elapses is left in the queue's "active" state — the next worker
   * start (see JobWorker.start()/recoverIncompleteJobs()) resets it to
   * "pending" and retries it, rather than losing the work.
   */
  jobWorkerStopTimeoutMs?: number;
}

function tryLoadStellarRelease(): StellarReleasePaymentFn | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("../../../smart-contracts/src/payment/payment")
      .releasePayment as StellarReleasePaymentFn;
  } catch {
    return undefined;
  }
}

export function createApp(opts: AppOptions = {}): {
  httpServer: HttpServer;
  close: (callback?: () => void) => void;
} {
  const config = getConfig();
  const logger = createLogger({ module: "api-app" });
  const jwtSecret = process.env.JWT_SECRET;
  const authRedis = !opts.walletAuthService && jwtSecret
    ? new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 })
    : undefined;
  authRedis?.on("error", (error) => logger.error({ err: error }, "wallet auth Redis unavailable"));
  const walletAuth = opts.walletAuthService ??
    (authRedis && jwtSecret ? new WalletAuthService(authRedis, jwtSecret) : undefined);
  const app = express();
  const httpServer = createServer(app);
  const eventStore: EventStore = opts.eventStore ?? eventBus.store ?? createEventStore();

  if (config.NODE_ENV !== "test") {
    void eventBus.connectRedis(config.REDIS_URL);
  }

  app.use(requestId);
  app.use(shutdownMiddleware);
  app.use(express.json());
  app.use((_req, res, next) => {
    if (config.NODE_ENV === "production") {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
    }
    next();
  });
  app.use(createCorsMiddleware());
  app.use(requestLogger);
  app.use(createAuditMiddleware(getAuditDb()));
  app.use(metricsMiddleware);
  app.use(ipRateLimitMiddleware);
  app.use(rateLimitMiddleware);
  app.use(versioningMiddleware);
  app.use(
    readOnlyMiddleware({
      exemptPaths: ["/api/admin", "/api/reconciliation"],
    }),
  );

  if (!opts.disableCompression && config.NODE_ENV !== "test") {
    app.use(...compressionMiddleware());
  }

  const registeredAgents: AgentRegistry = opts.agentRegistry ?? {
    getAgents: (capability) => createAgentDb(getAgentDb())
      .list({ capability, status: "online" })
      .filter((agent) => !agent.bannedAt)
      .map((agent) => ({
        id: agent.id,
        type: capability ?? agent.capabilities[0],
        endpoint: agent.endpoint,
        cost: agent.pricingXLM,
        status: agent.status,
      })),
  };
  const registry: AgentRegistry = {
    getAgents: async (capability) => excludeBannedAgents(await registeredAgents.getAgents(capability)),
  };
  const dispatch: DispatchFn = opts.dispatch ?? makeHttpDispatch(registry);
  const releasePayment: PaymentReleaseFn =
    opts.releasePayment ?? createPaymentReleaseFn(tryLoadStellarRelease());

  const webhooks = new WebhookService(getTaskDb());
  const onWebhookEvent = (event: DAGEvent) => {
    const type = webhookEventNames[event.type];
    if (!type) return;
    try {
      const task = getTask(event.taskId);
      if (!task) return;
      const key = JSON.stringify([event.taskId, type, event.nodeId, event.seq]);
      webhooks.enqueue(task.walletPublicKey, type, {
        taskId: event.taskId,
        nodeId: event.nodeId,
        ...(type === "payment.released" ? { payment: event.payload } : {}),
      }, key);
    } catch (err) {
      logger.error({ err, taskId: event.taskId, type }, "Failed to enqueue webhook");
    }
  };
  const unsubscribeWebhooks = eventBus.subscribeAll(onWebhookEvent);
  if (opts.enableQueueWorker !== false) webhooks.start();

  const jobQueue = opts.queue ?? getGlobalJobQueue();
  const jobWorker =
    opts.jobWorker ??
    new JobWorker({
      jobStore: jobQueue.getStore(),
      handler: createTaskJobHandler(dispatch, releasePayment),
    });
  jobQueue.setWorker(jobWorker);

  if (opts.enableQueueWorker !== false) {
    jobWorker.start();
  }

  const heartbeatService = createHeartbeatService(opts.heartbeatOptions);
  if (
    opts.enableHeartbeatCleanup ||
    (opts.enableHeartbeatCleanup !== false && config.NODE_ENV !== "test")
  ) {
    heartbeatService.start();
  }

  // ── API docs (Swagger UI) ──────────────────────────────────────────────────
  app.get("/docs/swagger.json", (_req: Request, res: Response) => {
    res.json(getOpenapiJson());
  });
  app.get("/docs/swagger.yaml", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "application/yaml");
    res.send(getOpenapiYaml());
  });
  app.use(
    "/docs",
    swaggerUi.serve,
    swaggerUi.setup(openapiSpec, swaggerUiOptions),
  );
  app.get("/openapi.json", (_req: Request, res: Response) => {
    res.json(openapiSpec);
  });
  app.get("/openapi.yaml", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "application/yaml");
    res.send(getOpenapiYaml());
  });

  // ── Health routes ───────────────────────────────────────────────────────────
  app.use("/health", publicLimiter.middleware, healthRouter);

  // ── Metrics routes ────────────────────────────────────────────────────────
  app.use("/metrics", metricsRouter);
  app.use("/api/metrics", metricsRouter);

  // ── Stats routes ───────────────────────────────────────────────────────────
  app.use("/api/stats", publicLimiter.middleware, createStatsRouter(getTaskDb()));

  // ── Auth routes ────────────────────────────────────────────────────────────
  app.use("/api/auth", createAuthRouter(opts.authService));
  app.use("/api/webhooks", optionalAuthMiddleware, authedLimiter.middleware, createWebhooksRouter(webhooks));
  app.use("/api/auth", createAuthRouter(opts.authService, walletAuth));
  app.use(["/api/tasks", "/api/agents", "/api/payments", "/api/webhooks", "/api/audit"],
    walletAuthMiddleware(walletAuth));

  // ── Admin event replay ─────────────────────────────────────────────────────
  app.use("/api/events", adminLimiter.middleware, createEventsRouter(eventStore));

  // ── Agent routes ───────────────────────────────────────────────────────────
  app.use("/api/agents", publicLimiter.middleware);
  app.post("/api/agents/register", registerRateLimitMiddleware);
  app.post("/api/agents/onboarding/start", registerRateLimitMiddleware);
  app.use("/api/agents/onboarding", createAgentOnboardingRouter(opts.agentOnboarding));
  app.use("/api/agents", agentsRouter);

  // ── Task routes ────────────────────────────────────────────────────────────
  app.use("/api/tasks", createTaskEstimateRouter(registry));
  const v1TasksRouter = createV1TasksRouter(dispatch, releasePayment, jobQueue, registry);
  const v2TasksRouter = createV2TasksRouter(dispatch, releasePayment, jobQueue, registry);

  app.get("/api/tasks/:id/payments", authedLimiter.middleware, optionalAuthMiddleware, (req, res, next) => {
    try {
      const db = createTaskDb(getTaskDb());
      const task = db.findById(req.params.id);
      if (!task) {
        res.status(404).json({ error: "Task not found" });
        return;
      }
      if ((req.user?.sub ?? req.get("walletpublickey")) !== task.walletPublicKey) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      const receipt = buildReceiptData(task.id, { taskDb: db });
      res.setHeader("Cache-Control", "private, no-store");
      res.json({
        taskId: receipt.taskId,
        completionTimestamp: task.status === "completed" ? receipt.completionTimestamp : null,
        prompt: receipt.prompt.slice(0, 240),
        payments: receipt.payments.map((payment) => ({
          ...payment,
          capability: task.dag.find((node) => node.nodeId === payment.nodeId)?.type ?? null,
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  app.use("/api/tasks", authedLimiter.middleware, (req, res, next) => {
    const apiVersion = (res.locals.apiVersion as string) || "1.0";
    if (apiVersion.startsWith("1.")) {
      return v1TasksRouter(req, res, next);
    }
    return v2TasksRouter(req, res, next);
  });

  // ── Admin Queue routes ─────────────────────────────────────────────────────
  app.use("/api/admin", createAdminRouter({ queue: jobQueue, reconciliation: opts.reconciliation }));
  app.use("/api/admin/queue", adminLimiter.middleware, createAdminQueueRouter(jobQueue));
  app.use("/api/admin", adminLimiter.middleware, createAdminQueueRouter(jobQueue));

  // ── Feature-flag admin routes (#425) ───────────────────────────────────────
  app.use("/api/admin/flags", createFlagsRouter());

  // ── Admin platform management (#33) ───────────────────────────────────────
  // Mounted after /flags so its catch-all /api/admin mount does not shadow the
  // feature-flag router. All routes enforce the 403 admin-key contract.
  app.use("/api/admin", adminLimiter.middleware, createAdminManagementRouter());

  // ── Versioning lifecycle endpoint (#426) ───────────────────────────────────
  app.use("/api/versions", createVersionsRouter());

  // ── Queue status route (#649) ──────────────────────────────────────────────
  app.use("/api/queue", publicLimiter.middleware, queueRouter);

  // ── Events and payment history ─────────────────────────────────────────────
  app.use("/api/payments", createPaymentsRouter());

  // ── Audit log ──────────────────────────────────────────────────────────────
  app.use('/api/audit', createAuditRouter(getAuditDb()));

  // ── Payment reconciliation routes ──────────────────────────────────────────
  app.use("/api/reconciliation", createReconciliationRouter(opts.reconciliation));

  // ── Internal admin routes ─────────────────────────────────────────────────
  app.use('/internal', internalRouter);

  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      error: { message: "Not found", code: "NOT_FOUND" },
      requestId: res.locals.requestId,
      traceId: res.locals.traceId,
    });
  });

  app.use(errorHandler);

  // ── WebSocket task stream ──────────────────────────────────────────────────
  // ── Agent-status broadcast stream (ws://<host>/ws) ─────────────────────────
  const detachAgentStatusStream = attachAgentStatusStream(httpServer, {
    eventBus,
    heartbeatIntervalMs: config.WS_HEARTBEAT_INTERVAL_MS,
    pongTimeoutMs: config.WS_PONG_TIMEOUT_MS,
    getAgentSnapshot: () => {
      try {
        return createAgentDb(getAgentDb()).list().map((agent) => ({
          id: agent.id,
          capabilities: agent.capabilities,
          status: agent.status,
          lastSeenAt: agent.lastSeenAt,
        }));
      } catch {
        return [];
      }
    },
  });

  const detachStream = attachTaskStream({
    httpServer,
    eventStore,
    eventBus,
    getTask,
    heartbeatIntervalMs: config.WS_HEARTBEAT_INTERVAL_MS,
    pongTimeoutMs: config.WS_PONG_TIMEOUT_MS,
    inactivityTimeoutMs: config.WS_INACTIVITY_TIMEOUT_MS,
    ...opts.stream,
  });

  metricsService.startGcObserver();
  metricsService.setWebSocketProbe(() => ({
    listening: httpServer.listening,
    connections: getStreamConnectionCount(),
  }));

  function close(callback?: () => void): void {
    const stopped = jobWorker.stop(opts.jobWorkerStopTimeoutMs ?? 10_000);
    if (isShuttingDown) jobQueue.getStore().cancelWaiting();
    void stopped.finally(() => {
      if (isShuttingDown) jobQueue.getStore().cancelWaiting();
      heartbeatService.stop();
      unsubscribeWebhooks();
      webhooks.stop();
      eventBus.disconnectRedis();
      authRedis?.disconnect();
      metricsService.setWebSocketProbe(null);
      detachAgentStatusStream();
      detachStream();
      if (httpServer.listening) {
        httpServer.close(callback);
      } else if (callback && (!isShuttingDown || jobWorker.getActiveCount() === 0)) {
        callback();
      }
    });
  }

  const routeCount = (app as unknown as { _router?: { stack?: unknown[] } })._router?.stack?.length;
  logger.debug({ routeCount }, "api app initialized");
  return { httpServer, close };
}

/**
 * Dispatch to an eligible agent and report which agent handled the node.
 */
function makeHttpDispatch(registry: AgentRegistry): DispatchFn {
  const estimator = new CostEstimator();
  return async (_taskId: string, node: DAGNode, context: string): Promise<unknown> => {
    const agent = await estimator.findCheapest(node.type, registry);
    if (!agent) {
      throw new AppError(`No online agent for type: ${node.type}`, 503, "NO_ELIGIBLE_AGENT");
    }
function makeHttpDispatch(registry?: AgentRegistry): DispatchFn {
  return async (_taskId: string, node: DAGNode, context: string, onAgentSelected): Promise<unknown> => {
    const agents = registry
      ? await registry.getAgents(node.type)
      : createAgentDb(getAgentDb()).list({ capability: node.type, status: "online" }).map((agent) => ({
        id: agent.id,
        type: node.type,
        endpoint: agent.endpoint,
        cost: agent.pricingXLM,
        status: agent.status,
        reputation: agent.reputationScore,
      }));
    if (!agents || agents.length === 0) {
      throw new AppError(`No agent registered for type: ${node.type}`, 500, "AGENT_NOT_FOUND");
    }

    // Admin-banned agents are excluded from all new task assignments (#33).
    const eligible = excludeBannedAgents(agents);
    if (eligible.length === 0) {
      throw new AppError(
        `All agents for type ${node.type} are banned`,
        503,
        "NO_ELIGIBLE_AGENT",
      );
    }

    const agent = [...eligible].sort((a, b) => a.cost - b.cost || (b.reputation ?? 0) - (a.reputation ?? 0))[0];
    onAgentSelected?.(agent.id);
    return httpDispatch(agent, node.nodeId, node, context);
  };
}

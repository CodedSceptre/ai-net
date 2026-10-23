import crypto from "crypto";
import { AsyncLocalStorage } from "async_hooks";
import pino from "pino";
import type { DestinationStream, Logger } from "pino";
import { getConfig } from "../config";
import { currentTraceContext } from '../services/traceContext';

const REDACTED = "[REDACTED]";
const REDACTED_ADDRESS = "[REDACTED_ADDRESS]";
const DEFAULT_LOG_CONTEXT = {
  service: "ai-net-backend",
  requestId: "system",
  traceId: "system",
  spanId: "system",
  userId: "system",
  taskId: "none",
  route: "system",
};
const logContextStore = new AsyncLocalStorage<Record<string, unknown>>();

const SECRET_KEY_RE =
  /secret|token|jwt|api[_-]?key|password|authorization|cookie|private[_-]?key|seed/i;
const ADDRESS_KEY_RE =
  /address|public[_-]?key|wallet|owner|claimant|destination|source|account/i;
const STELLAR_ADDRESS_RE = /\b[CGM][A-Z2-7]{55}\b/g;
const STELLAR_SECRET_RE = /\bS[A-Z2-7]{55}\b/g;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const KEY_VALUE_SECRET_RE =
  /\b(api[_-]?key|token|secret|password|authorization)=([^\s"',}]+)/gi;

export interface LoggerFactoryOptions {
  destination?: DestinationStream;
  redactPaths?: string[];
}

function matchesRedactionPath(path: string, paths: readonly string[]): boolean {
  const segments = path.split(".");
  return paths.some((redactionPath) => {
    const pattern = redactionPath.split(".");
    return (
      pattern.length === segments.length &&
      pattern.every((segment, index) => segment === "*" || segment === segments[index])
    );
  });
}

function redactString(value: string): string {
  return value
    .replace(STELLAR_SECRET_RE, REDACTED)
    .replace(BEARER_RE, `Bearer ${REDACTED}`)
    .replace(KEY_VALUE_SECRET_RE, (_match, key) => `${key}=${REDACTED}`)
    .replace(STELLAR_ADDRESS_RE, REDACTED_ADDRESS);
}

function redactByKey(key: string | undefined, value: unknown): unknown {
  if (!key) return value;
  if (SECRET_KEY_RE.test(key)) {
    return value ? REDACTED : value;
  }
  if (ADDRESS_KEY_RE.test(key)) {
    if (typeof value === "string") return redactString(value) === value ? REDACTED_ADDRESS : redactString(value);
    return value ? REDACTED_ADDRESS : value;
  }
  return value;
}

function serializeError(error: Error): Record<string, unknown> {
  const maybeCoded = error as Error & {
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
    details?: unknown;
  };

  return sanitizeLogPayload({
    name: error.name,
    message: error.message,
    stack: error.stack,
    code: maybeCoded.code,
    status: maybeCoded.status,
    statusCode: maybeCoded.statusCode,
    details: maybeCoded.details,
  }) as Record<string, unknown>;
}

export function sanitizeLogPayload(
  value: unknown,
  key?: string,
  seen = new WeakSet<object>(),
  path = "",
  redactPaths: readonly string[] = [],
): unknown {
  if (path && matchesRedactionPath(path, redactPaths)) {
    return value ? REDACTED : value;
  }
  const keyed = redactByKey(key, value);
  if (keyed !== value) return keyed;

  if (typeof value === "string") return redactString(value);
  if (typeof value !== "object" || value === null) return value;
  if (value instanceof Error) return serializeError(value);
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      sanitizeLogPayload(entry, key, seen, path ? `${path}.${index}` : String(index), redactPaths),
    );
  }

  const output: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
    output[childKey] = sanitizeLogPayload(
      childValue,
      childKey,
      seen,
      path ? `${path}.${childKey}` : childKey,
      redactPaths,
    );
  }
  return output;
}

export function hashLogIdentifier(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function normalizeBindings(bindings?: Record<string, unknown>): Record<string, unknown> {
  const sanitized = (sanitizeLogPayload(bindings ?? {}) ?? {}) as Record<string, unknown>;
  const traceId = sanitized.traceId ?? sanitized.correlationId ?? DEFAULT_LOG_CONTEXT.traceId;

  return {
    ...DEFAULT_LOG_CONTEXT,
    ...sanitized,
    traceId,
    requestId: sanitized.requestId ?? DEFAULT_LOG_CONTEXT.requestId,
  };
}

export function runWithLogContext<T>(context: Record<string, unknown>, callback: () => T): T {
  return logContextStore.run(normalizeBindings(context), callback);
}

export function updateLogContext(context: Record<string, unknown>): void {
  const store = logContextStore.getStore();
  if (!store) return;
  Object.assign(store, normalizeBindings({ ...store, ...context }));
}

export function getLogContext(): Record<string, unknown> {
  return logContextStore.getStore() ?? DEFAULT_LOG_CONTEXT;
}

function createBaseLogger(destination?: DestinationStream, redactPaths: readonly string[] = []): Logger {
  let level: pino.LevelWithSilent = "info";
  try {
    level = getConfig().LOG_LEVEL;
  } catch {
    // Startup calls loadConfig() explicitly and reports schema issues.
  }
  const options: pino.LoggerOptions = {
    level,
    enabled: level !== "silent",
    base: DEFAULT_LOG_CONTEXT,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
    msgKey: "message",
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    // Auto-inject traceId / spanId from the active AsyncLocalStorage trace
    // context (Issue #407) so every log line in a traced flow carries the
    // correlation IDs without the caller having to pass them explicitly.
    mixin() {
      const ctx = currentTraceContext();
      if (!ctx) return {};
      const bindings: Record<string, unknown> = { traceId: ctx.traceId, spanId: ctx.spanId };
      if (ctx.taskId) bindings.taskId = ctx.taskId;
      if (ctx.requestId) bindings.requestId = ctx.requestId;
      return bindings;
    },
    hooks: {
      logMethod(inputArgs, method) {
        const currentLogger = this as Logger & {
          bindings?: () => Record<string, unknown>;
        };
        const loggerBindings =
          typeof currentLogger.bindings === "function" ? currentLogger.bindings() : {};
        const activeContext = logContextStore.getStore();
        const context = normalizeBindings(
          activeContext ? { ...loggerBindings, ...activeContext } : loggerBindings,
        );
        const sanitizedArgs = inputArgs.map((arg) =>
          sanitizeLogPayload(arg, undefined, new WeakSet<object>(), "", redactPaths),
        );
        const first = sanitizedArgs[0];
        if (
          first &&
          typeof first === "object" &&
          !Array.isArray(first) &&
          !(first instanceof Error)
        ) {
          const fields = first as Record<string, unknown>;
          sanitizedArgs[0] = {
            ...context,
            ...fields,
            context: { ...context, ...fields },
          };
        } else {
          sanitizedArgs.unshift({ ...context, context });
        }
        return method.apply(this, sanitizedArgs as any);
      },
    },
  };

  return destination ? pino(options, destination) : pino(options);
}

let baseLogger: Logger | null = null;

export function createLogger(
  bindings?: Record<string, unknown>,
  options: LoggerFactoryOptions = {},
): Logger {
  const root = options.destination
    ? createBaseLogger(options.destination, options.redactPaths)
    : baseLogger ?? createBaseLogger(undefined, options.redactPaths);
  if (!options.destination && !baseLogger) {
    baseLogger = root;
  }
  return root.child(normalizeBindings(bindings));
}

const logger = createLogger();

export default logger;

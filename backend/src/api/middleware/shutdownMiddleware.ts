import type { RequestHandler } from "express";

export let isShuttingDown = false;
let inFlight = 0;
let payments = 0;
let onDrained: (() => void) | undefined;

function checkDrained(): void {
  if (inFlight === 0 && payments === 0) onDrained?.();
}

export const shutdownMiddleware: RequestHandler = (_req, res, next) => {
  if (isShuttingDown) {
    res.setHeader("Connection", "close");
    res.status(503).json({ error: "Server is shutting down" });
    return;
  }

  inFlight += 1;
  const done = () => {
    res.off("finish", done);
    res.off("close", done);
    inFlight -= 1;
    checkDrained();
  };
  res.once("finish", done);
  res.once("close", done);
  next();
};

export function beginShutdown(): void {
  isShuttingDown = true;
}

export function getDrainCounts() {
  return { requests: inFlight, payments };
}

export function waitForDrain(): Promise<void> {
  return new Promise((resolve) => {
    onDrained = resolve;
    checkDrained();
  });
}

export function assertStellarTransactionAllowed(): void {
  if (isShuttingDown) throw new Error("Server is shutting down");
}

export async function trackStellarTransaction<T>(operation: () => Promise<T>): Promise<T> {
  assertStellarTransactionAllowed();
  payments += 1;
  try {
    return await operation();
  } finally {
    payments -= 1;
    checkDrained();
  }
}

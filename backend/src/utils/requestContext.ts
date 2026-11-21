import { AsyncLocalStorage } from "node:async_hooks";
import { nanoid } from "nanoid";

export const requestContext = new AsyncLocalStorage<{ requestId: string }>();
export const REQUEST_ID_HEADER = "X-Request-ID";

export function getRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}

export function resolveRequestId(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) || nanoid(12);
}

export function requestIdHeaders(): Record<string, string> {
  const requestId = getRequestId();
  return requestId ? { [REQUEST_ID_HEADER]: requestId } : {};
}

/** Bind callbacks invoked later by shared emitters to the originating request. */
export function bindRequestContext<Args extends unknown[], Result>(
  callback: (...args: Args) => Result,
): (...args: Args) => Result {
  const context = requestContext.getStore();
  return context ? (...args) => requestContext.run(context, callback, ...args) : callback;
}

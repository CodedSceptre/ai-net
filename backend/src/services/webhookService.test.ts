import Database from "better-sqlite3";
import { createHmac, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { migrateToLatest } from "../db/migrator";
import { WebhookService } from "./webhookService";
import { parseWebhookUrl, signWebhookBody } from "./webhookTransport";

describe("WebhookService", () => {
  let db: Database.Database;
  const owner = "wallet-owner";
  const secret = "unit-test-signing-secret";
  const url = "https://example.com/events";

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2025-01-10T00:00:00Z"));
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    migrateToLatest(db, path.join(__dirname, "../db/migrations/tasks"));
  });

  afterEach(() => {
    db.close();
    jest.useRealTimers();
  });

  it("signs the exact request body so a receiver detects tampering", () => {
    const body = JSON.stringify({ event: "task.completed", timestamp: "2025-01-10", data: { taskId: "A" } });
    const signature = signWebhookBody(secret, body);
    const verify = (payload: string) => {
      const expected = createHmac("sha256", secret).update(payload).digest();
      const actual = Buffer.from(signature.slice("sha256=".length), "hex");
      return timingSafeEqual(actual, expected);
    };
    expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/);
    expect(verify(body)).toBe(true);
    expect(verify(body.replace('"A"', '"B"'))).toBe(false);
  });

  it("rejects HTTP and non-public IP literals", () => {
    expect(() => parseWebhookUrl("http://example.com")).toThrow();
    expect(() => parseWebhookUrl("https://127.0.0.1")).toThrow();
    expect(() => parseWebhookUrl("https://[::1]")).toThrow();
  });

  it("records five failed attempts and paginates history by wallet", async () => {
    const send = jest.fn(async () => 500);
    const service = new WebhookService(db, send);
    const { id } = service.register(owner, { url, events: ["task.completed"], secret });
    service.enqueue(owner, "task.completed", { taskId: "A" }, "event-a");
    service.enqueue(owner, "task.completed", { taskId: "A" }, "event-a");

    await service.processPending();
    for (const delay of [1_000, 2_000, 4_000, 8_000]) {
      jest.setSystemTime(Date.now() + delay - 1);
      const calls = send.mock.calls.length;
      await service.processPending();
      expect(send).toHaveBeenCalledTimes(calls);
      jest.setSystemTime(Date.now() + 1);
      await service.processPending();
    }
    jest.setSystemTime(Date.now() + 16_000);
    await service.processPending();

    expect(send).toHaveBeenCalledTimes(5);
    const page = service.history(owner, id, 2, Number.MAX_SAFE_INTEGER)!;
    expect(page.items).toMatchObject([
      { attemptCount: 5, statusCode: 500, success: false, lastAttemptAt: expect.any(Number) },
      { attemptCount: 4, statusCode: 500, success: false },
    ]);
    expect(service.history(owner, id, 3, page.nextCursor!)?.items).toHaveLength(3);
    expect(service.history("another-wallet", id, 5, Number.MAX_SAFE_INTEGER)).toBeUndefined();
  });

  it("disables a week-long failure streak and skips history for a test request", async () => {
    const send = jest.fn(async () => 500);
    const service = new WebhookService(db, send);
    const { id } = service.register(owner, { url, events: ["task.completed"], secret });
    await expect(service.test(owner, id)).resolves.toEqual({ statusCode: 500, success: false });
    expect(service.history(owner, id, 5, Number.MAX_SAFE_INTEGER)?.items).toEqual([]);

    service.deliver(id, "task.completed", {});
    await service.processPending();
    jest.setSystemTime(Date.now() + 7 * 86_400_000);
    await service.processPending();
    service.disableFailing();
    expect(service.list(owner)).toMatchObject([{ id, status: "disabled", disabledAt: Date.now() }]);
  });
});

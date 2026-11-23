import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { createLogger } from "../utils/logger";
import { parseWebhookUrl, postWebhook } from "./webhookTransport";

export const webhookEvents = ["task.completed", "task.failed", "payment.released"] as const;
export type WebhookEvent = typeof webhookEvents[number];
const retryDelays = [1_000, 2_000, 4_000, 8_000, 16_000];
const day = 86_400_000;
const lease = 60_000;

interface Registration {
  url: string;
  events: WebhookEvent[];
  secret: string;
}

interface Job {
  id: number;
  webhookId: string;
  eventType: WebhookEvent;
  payload: string;
  attemptCount: number;
  nextAttemptAt: number;
  url: string;
  secret: string;
}

export class WebhookService {
  private readonly logger = createLogger({ module: "webhooks" });
  private timer?: ReturnType<typeof setInterval>;
  private active = false;
  private nextHealthCheck = 0;

  constructor(
    private readonly db: Database.Database,
    private readonly send = postWebhook,
  ) {}

  register(wallet: string, registration: Registration) {
    const url = parseWebhookUrl(registration.url).href;
    const { events, secret } = registration;
    const id = randomUUID();
    const createdAt = Date.now();
    this.db.prepare(`
      INSERT INTO webhooks (id, walletPublicKey, url, events, secret, createdAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, wallet, url, JSON.stringify(events), secret, createdAt);
    return { id, url, events, status: "active", createdAt, disabledAt: null };
  }

  list(wallet: string) {
    const rows = this.db.prepare(`
      SELECT id, url, events, status, createdAt, disabledAt
      FROM webhooks WHERE walletPublicKey = ? ORDER BY createdAt DESC, id
    `).all(wallet) as Array<{ events: string }>;
    return rows.map(row => ({ ...row, events: JSON.parse(row.events) as WebhookEvent[] }));
  }

  remove(wallet: string, id: string): boolean {
    return this.db.prepare("DELETE FROM webhooks WHERE walletPublicKey = ? AND id = ?")
      .run(wallet, id).changes > 0;
  }

  history(wallet: string, id: string, limit: number, before: number) {
    if (!this.db.prepare("SELECT id FROM webhooks WHERE id = ? AND walletPublicKey = ?")
      .get(id, wallet)) return undefined;

    const rows = this.db.prepare(`
      SELECT id, eventType, payload, statusCode, attemptCount, lastAttemptAt, success
      FROM webhook_deliveries WHERE webhookId = ? AND id < ? ORDER BY id DESC LIMIT ?
    `).all(id, before, limit + 1) as Array<{ id: number; success: number; payload: string }>;
    const items = rows.slice(0, limit).map(row => ({
      ...row, success: Boolean(row.success), payload: JSON.parse(row.payload) as unknown,
    }));
    return { items, nextCursor: rows.length > limit ? items[items.length - 1].id : null };
  }

  async test(wallet: string, id: string) {
    const hook = this.db.prepare("SELECT url, secret FROM webhooks WHERE id = ? AND walletPublicKey = ?")
      .get(id, wallet) as { url: string; secret: string } | undefined;
    if (!hook) return undefined;
    const statusCode = await this.send(hook.url, hook.secret, this.body("webhook.test", { webhookId: id }))
      .catch(() => null);
    return { statusCode, success: statusCode !== null && statusCode >= 200 && statusCode < 300 };
  }

  deliver(webhookId: string, eventType: WebhookEvent, payload: unknown): void {
    this.db.prepare(`
      INSERT INTO webhook_jobs (webhookId, eventType, payload, nextAttemptAt)
      SELECT id, ?, ?, ? FROM webhooks WHERE id = ? AND status = 'active'
    `).run(eventType, this.body(eventType, payload), Date.now(), webhookId);
  }

  enqueue(wallet: string, eventType: WebhookEvent, payload: unknown, eventKey: string): void {
    this.db.prepare(`
      INSERT INTO webhook_jobs (webhookId, eventKey, eventType, payload, nextAttemptAt)
      SELECT id, ?, ?, ?, ? FROM webhooks
      WHERE walletPublicKey = ? AND status = 'active'
        AND EXISTS (SELECT 1 FROM json_each(events) WHERE value = ?)
      ON CONFLICT(webhookId, eventKey) DO NOTHING
    `).run(eventKey, eventType, this.body(eventType, payload), Date.now(), wallet, eventType);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.processPending(), 250);
    this.timer.unref();
    void this.processPending();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  disableFailing(now = Date.now()): void {
    const cutoff = now - 7 * day;
    this.db.prepare(`
      UPDATE webhooks SET status = 'disabled', disabledAt = ?
      WHERE status = 'active' AND createdAt <= ?
        AND EXISTS (
          SELECT 1 FROM webhook_deliveries d
          WHERE d.webhookId = webhooks.id AND d.lastAttemptAt >= ? AND d.success = 0
        )
        AND EXISTS (
          SELECT 1 FROM webhook_deliveries d
          WHERE d.webhookId = webhooks.id AND d.lastAttemptAt <= ? AND d.success = 0
            AND NOT EXISTS (
              SELECT 1 FROM webhook_deliveries s
              WHERE s.webhookId = d.webhookId AND s.success = 1 AND s.lastAttemptAt >= d.lastAttemptAt
            )
        )
    `).run(now, cutoff, cutoff, cutoff);
  }

  async processPending(): Promise<void> {
    if (this.active) return;
    this.active = true;
    try {
      const now = Date.now();
      if (now >= this.nextHealthCheck) {
        this.disableFailing(now);
        this.nextHealthCheck = now + day;
      }
      const jobs = this.db.transaction(() => {
        const pending = this.db.prepare(`
          SELECT j.*, w.url, w.secret FROM webhook_jobs j JOIN webhooks w ON w.id = j.webhookId
          WHERE j.nextAttemptAt <= ? AND w.status = 'active' ORDER BY j.nextAttemptAt, j.id LIMIT 16
        `).all(now) as Job[];
        const claim = this.db.prepare("UPDATE webhook_jobs SET nextAttemptAt = ? WHERE id = ?");
        for (const job of pending) claim.run(now + lease, job.id);
        return pending;
      }).immediate();
      await Promise.allSettled(jobs.map(job => this.attempt(job, now + lease))).then(results => {
        for (const result of results) {
          if (result.status === "rejected") this.logger.error({ err: result.reason }, "Webhook history write failed");
        }
      });
    } catch (err) {
      this.logger.error({ err }, "Webhook worker failed");
    } finally {
      this.active = false;
    }
  }

  private async attempt(job: Job, claimedUntil: number): Promise<void> {
    const statusCode = await this.send(job.url, job.secret, job.payload).catch(() => null);
    const success = statusCode !== null && statusCode >= 200 && statusCode < 300;
    const count = job.attemptCount + 1;
    const now = Date.now();
    const delay = retryDelays[count - 1];
    const nextAttemptAt = success || count >= retryDelays.length ? null : now + delay;
    this.db.transaction(() => {
      const updated = this.db.prepare(`
        UPDATE webhook_jobs SET attemptCount = ?, nextAttemptAt = ? WHERE id = ? AND nextAttemptAt = ?
      `).run(count, nextAttemptAt, job.id, claimedUntil);
      if (!updated.changes) return;
      this.db.prepare(`
        INSERT INTO webhook_deliveries (webhookId, jobId, eventType, payload, statusCode, attemptCount, lastAttemptAt, success)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(job.webhookId, job.id, job.eventType, job.payload, statusCode, count, now, Number(success));
    }).immediate();
  }

  private body(event: string, data: unknown): string {
    return JSON.stringify({ event, timestamp: new Date().toISOString(), data });
  }
}

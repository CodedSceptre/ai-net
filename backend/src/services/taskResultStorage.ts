import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";
import type { TaskDb } from "../db/tasks";
import { createLogger } from "../utils/logger";

const MAX_INLINE_BYTES = 1024 * 1024;
const RESULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DOWNLOAD_TTL_SECONDS = 5 * 60;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const logger = createLogger({ component: "task-results" });

export class TaskResultStorageService {
  private cleanupTimer: NodeJS.Timeout | null = null;
  private readonly directory: string;
  private readonly signingSecret: string;

  constructor(
    private readonly db: TaskDb,
    options: { directory?: string; signingSecret?: string } = {},
  ) {
    this.directory = options.directory ?? process.env.TASK_RESULT_DIRECTORY ?? path.join(process.cwd(), "data", "task-results");
    this.signingSecret = options.signingSecret ?? process.env.TASK_RESULT_SIGNING_SECRET ?? process.env.AUTH_JWT_SECRET ?? "ai-net-task-result-local-key";
  }

  async persist(taskId: string, result: unknown): Promise<void> {
    const serialized = JSON.stringify(result) ?? "null";
    const expiresAt = new Date(Date.now() + RESULT_TTL_MS).toISOString();

    if (Buffer.byteLength(serialized, "utf8") <= MAX_INLINE_BYTES) {
      this.db.saveResult(taskId, serialized, null, expiresAt);
      return;
    }

    await mkdir(this.directory, { recursive: true });
    const filePath = path.join(this.directory, `${randomUUID()}.json`);
    await writeFile(filePath, serialized, { encoding: "utf8", flag: "wx" });
    try {
      this.db.saveResult(
        taskId,
        JSON.stringify({ storedAs: "file", sizeBytes: Buffer.byteLength(serialized, "utf8") }),
        filePath,
        expiresAt,
      );
    } catch (error) {
      await rm(filePath, { force: true });
      throw error;
    }
  }

  createDownloadUrl(taskId: string): { url: string; expiresAt: string } | undefined {
    const result = this.db.getResult(taskId);
    if (!result?.resultFile || !result.resultExpiresAt) return undefined;

    const expires = Math.min(
      Math.floor(Date.now() / 1000) + DOWNLOAD_TTL_SECONDS,
      Math.floor(Date.parse(result.resultExpiresAt) / 1000),
    );
    const signature = this.sign(taskId, expires);
    return {
      url: `/api/tasks/${encodeURIComponent(taskId)}/result/download?expires=${expires}&signature=${signature}`,
      expiresAt: new Date(expires * 1000).toISOString(),
    };
  }

  async readSignedFile(taskId: string, expires: number, signature: string): Promise<Buffer | undefined> {
    if (!Number.isSafeInteger(expires) || expires < Math.floor(Date.now() / 1000)) return undefined;
    const expected = Buffer.from(this.sign(taskId, expires), "hex");
    let received: Buffer;
    try {
      received = Buffer.from(signature, "hex");
    } catch {
      return undefined;
    }
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return undefined;

    const result = this.db.getResult(taskId);
    if (!result?.resultFile || !result.resultExpiresAt || Date.parse(result.resultExpiresAt) <= Date.now()) {
      return undefined;
    }
    return readFile(result.resultFile);
  }

  async cleanupExpired(now = new Date()): Promise<number> {
    const expired = this.db.listExpiredResults(now.toISOString());
    let removed = 0;
    for (const result of expired) {
      try {
        if (result.resultFile) await rm(result.resultFile, { force: true });
        this.db.clearResult(result.id);
        removed += 1;
      } catch (error) {
        logger.warn({ taskId: result.id, error }, "failed to clean expired task result");
      }
    }
    return removed;
  }

  startCleanup(intervalMs = CLEANUP_INTERVAL_MS): void {
    if (this.cleanupTimer) return;
    void this.cleanupExpired().catch((error) => logger.error({ error }, "task result cleanup failed"));
    this.cleanupTimer = setInterval(() => {
      void this.cleanupExpired().catch((error) => logger.error({ error }, "task result cleanup failed"));
    }, intervalMs);
    this.cleanupTimer.unref?.();
  }

  stopCleanup(): void {
    if (!this.cleanupTimer) return;
    clearInterval(this.cleanupTimer);
    this.cleanupTimer = null;
  }

  private sign(taskId: string, expires: number): string {
    return createHmac("sha256", this.signingSecret)
      .update(`${taskId}:${expires}`)
      .digest("hex");
  }
}

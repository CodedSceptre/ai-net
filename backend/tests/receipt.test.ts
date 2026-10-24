import request from "supertest";
import Database from "better-sqlite3";
import { createApp } from "../src/api";
import { createTaskDb } from "../src/db/tasks";
import { createPaymentDb } from "../src/db";
import {
  buildReceiptData,
  generateReceiptPdf,
  getOrGenerateReceiptJson,
  getOrGenerateReceiptPdf,
  RECEIPT_CACHE_TTL_SECONDS,
} from "../src/services/receiptService";
import { initCache, resetCache, type CacheClient } from "../src/cache";
import type { Task } from "../src/types/task";

describe("Payment Receipt Generation & PDF Export (#392)", () => {
  let taskDbRaw: Database.Database;
  let paymentDbRaw: Database.Database;
  let app: ReturnType<typeof createApp>;
  let cacheClient: CacheClient;

  const WALLET = "GBZXN7PIRZGNMHGA728XZVOG2GUFIDLAZ6AF2I2MD2OCYTAF2K1K4AAA";
  const OTHER_WALLET = "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGDG6NXGPTVMLHK4HZ7HHNN";

  beforeAll(() => {
    cacheClient = initCache({ driver: "lru", lruMaxSize: 100, defaultTtlSeconds: 86400 });

    taskDbRaw = new Database(":memory:");
    taskDbRaw.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id              TEXT PRIMARY KEY,
        prompt          TEXT NOT NULL,
        walletPublicKey TEXT NOT NULL DEFAULT '',
        status          TEXT NOT NULL DEFAULT 'queued',
        dagJson         TEXT NOT NULL DEFAULT '[]',
        createdAt       TEXT NOT NULL,
        updatedAt       TEXT NOT NULL
      )
    `);

    paymentDbRaw = new Database(":memory:");
    paymentDbRaw.exec(`
      CREATE TABLE IF NOT EXISTS payments (
        taskId        TEXT NOT NULL,
        nodeId        TEXT NOT NULL,
        balanceId     TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'locked',
        amountStroops TEXT NOT NULL,
        txHash        TEXT,
        createdAt     TEXT,
        PRIMARY KEY (taskId, nodeId)
      )
    `);

    jest.spyOn(require("../src/db/tasks"), "getTaskDb").mockReturnValue(taskDbRaw);
    jest.spyOn(require("../src/db"), "getDb").mockReturnValue(paymentDbRaw);

    app = createApp({
      disableCompression: true,
      enableHeartbeatCleanup: false,
      enableQueueWorker: false,
    });
  });

  afterAll((done) => {
    app.close(() => {
      taskDbRaw.close();
      paymentDbRaw.close();
      resetCache();
      jest.restoreAllMocks();
      done();
    });
  });

  beforeEach(() => {
    taskDbRaw.exec("DELETE FROM tasks");
    paymentDbRaw.exec("DELETE FROM payments");
    cacheClient.flush();
  });

  function seedTask(override?: Partial<Task>): Task {
    const task: Task = {
      id: "task_test_receipt_123",
      prompt: "Analyze Stellar DEX liquidity pools and generate report",
      walletPublicKey: WALLET,
      status: "completed",
      dag: [
        {
          nodeId: "node_research",
          type: "research-agent-v1",
          dependencies: [],
          status: "completed",
        },
        {
          nodeId: "node_report",
          type: "report-agent-v1",
          dependencies: ["node_research"],
          status: "completed",
        },
      ],
      createdAt: "2026-10-24T10:00:00.000Z",
      updatedAt: "2026-10-24T10:05:00.000Z",
      ...override,
    };
    createTaskDb(taskDbRaw).insert(task);
    return task;
  }

  function seedPayments(taskId: string) {
    const payDb = createPaymentDb(paymentDbRaw);
    payDb.insert({
      taskId,
      nodeId: "node_research",
      balanceId: "bal_001",
      status: "released",
      amountStroops: 50_000_000n, // 5.0 XLM
      txHash: "3389e9f0f73b854c73070bdaecd86ba21b8f803b0f4779d1ab0b893f4ec1c788",
      createdAt: "2026-10-24T10:02:00.000Z",
    });
    payDb.insert({
      taskId,
      nodeId: "node_report",
      balanceId: "bal_002",
      status: "released",
      amountStroops: 25_000_000n, // 2.5 XLM
      txHash: "7b4c9e12f34a56b78901cd23ef4567890123456789abcdef0123456789abcdef",
      createdAt: "2026-10-24T10:05:00.000Z",
    });
  }

  describe("Unit: receiptService", () => {
    it("buildReceiptData aggregates payments, DAG node agent names, and total amounts accurately", () => {
      const task = seedTask();
      seedPayments(task.id);

      const receipt = buildReceiptData(task.id, {
        taskDb: createTaskDb(taskDbRaw),
        paymentDb: createPaymentDb(paymentDbRaw),
        horizonUrl: "https://horizon-testnet.stellar.org",
      });

      expect(receipt.taskId).toBe(task.id);
      expect(receipt.requesterAddress).toBe(WALLET);
      expect(receipt.taskStatus).toBe("completed");
      expect(receipt.totalAmountPaid).toBe(7.5);
      expect(receipt.totalAmountPaidStroops).toBe("75000000");
      expect(receipt.payments).toHaveLength(2);

      const researchPayment = receipt.payments.find((p) => p.nodeId === "node_research");
      expect(researchPayment).toBeDefined();
      expect(researchPayment?.agentName).toBe("research-agent-v1");
      expect(researchPayment?.amountXLM).toBe(5);
      expect(researchPayment?.horizonLink).toBe(
        "https://horizon-testnet.stellar.org/transactions/3389e9f0f73b854c73070bdaecd86ba21b8f803b0f4779d1ab0b893f4ec1c788"
      );

      const reportPayment = receipt.payments.find((p) => p.nodeId === "node_report");
      expect(reportPayment).toBeDefined();
      expect(reportPayment?.agentName).toBe("report-agent-v1");
      expect(reportPayment?.amountXLM).toBe(2.5);
    });

    it("generateReceiptPdf produces a valid PDF buffer starting with %PDF-", async () => {
      const task = seedTask();
      seedPayments(task.id);

      const receipt = buildReceiptData(task.id, {
        taskDb: createTaskDb(taskDbRaw),
        paymentDb: createPaymentDb(paymentDbRaw),
      });

      const startTime = Date.now();
      const pdfBuffer = await generateReceiptPdf(receipt);
      const durationMs = Date.now() - startTime;

      expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
      expect(pdfBuffer.length).toBeGreaterThan(500);
      expect(pdfBuffer.slice(0, 5).toString("utf8")).toBe("%PDF-");
      expect(durationMs).toBeLessThan(2000); // Must be under 2 seconds
    });

    it("getOrGenerateReceiptJson uses cache on subsequent calls", async () => {
      const task = seedTask();
      seedPayments(task.id);

      const options = {
        taskDb: createTaskDb(taskDbRaw),
        paymentDb: createPaymentDb(paymentDbRaw),
        cacheClient,
      };

      const receipt1 = await getOrGenerateReceiptJson(task.id, options);
      expect(receipt1.totalAmountPaid).toBe(7.5);

      // Verify cached in client
      const cached = await cacheClient.get(`receipt:json:${task.id}`);
      expect(cached).toBeDefined();

      // Modify payments in db to ensure second call hits cache
      paymentDbRaw.exec("DELETE FROM payments");

      const receipt2 = await getOrGenerateReceiptJson(task.id, options);
      expect(receipt2.totalAmountPaid).toBe(7.5); // Still 7.5 from cache
    });

    it("getOrGenerateReceiptPdf caches base64 PDF and retrieves valid buffer", async () => {
      const task = seedTask();
      seedPayments(task.id);

      const options = {
        taskDb: createTaskDb(taskDbRaw),
        paymentDb: createPaymentDb(paymentDbRaw),
        cacheClient,
      };

      const pdf1 = await getOrGenerateReceiptPdf(task.id, options);
      expect(pdf1.slice(0, 5).toString("utf8")).toBe("%PDF-");

      // Verify cached
      const cachedBase64 = await cacheClient.get(`receipt:pdf:${task.id}`);
      expect(cachedBase64).toBeDefined();

      // Remove payments from db to verify cache hit
      paymentDbRaw.exec("DELETE FROM payments");

      const pdf2 = await getOrGenerateReceiptPdf(task.id, options);
      expect(pdf2.slice(0, 5).toString("utf8")).toBe("%PDF-");
      expect(pdf2.toString("base64")).toBe(pdf1.toString("base64"));
    });
  });

  describe("HTTP Integration: GET /api/tasks/:id/receipt", () => {
    it("returns 404 when task does not exist", async () => {
      const res = await request(app.httpServer)
        .get("/api/tasks/nonexistent_task/receipt")
        .set("walletpublickey", WALLET);

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/Task not found/i);
    });

    it("returns 403 when walletpublickey header is missing", async () => {
      const task = seedTask();
      const res = await request(app.httpServer).get(`/api/tasks/${task.id}/receipt`);

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/Access denied/i);
    });

    it("returns 403 when walletpublickey does not match task requester", async () => {
      const task = seedTask();
      const res = await request(app.httpServer)
        .get(`/api/tasks/${task.id}/receipt`)
        .set("walletpublickey", OTHER_WALLET);

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/Access denied/i);
    });

    it("returns JSON receipt by default (Accept: application/json or omitted)", async () => {
      const task = seedTask();
      seedPayments(task.id);

      const res = await request(app.httpServer)
        .get(`/api/tasks/${task.id}/receipt`)
        .set("walletpublickey", WALLET);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/application\/json/);
      expect(res.headers["cache-control"]).toBe("private, max-age=86400");
      expect(res.body.taskId).toBe(task.id);
      expect(res.body.requesterAddress).toBe(WALLET);
      expect(res.body.taskStatus).toBe("completed");
      expect(res.body.completionTimestamp).toBe(task.updatedAt);
      expect(res.body.totalAmountPaid).toBe(7.5);
      expect(res.body.payments).toHaveLength(2);
      const researchItem = res.body.payments.find((p: any) => p.nodeId === "node_research");
      expect(researchItem).toEqual(
        expect.objectContaining({
          nodeId: "node_research",
          agentName: "research-agent-v1",
          amountXLM: 5,
          status: "released",
          txHash: "3389e9f0f73b854c73070bdaecd86ba21b8f803b0f4779d1ab0b893f4ec1c788",
          horizonLink: expect.stringContaining("/transactions/3389e9f0f73b854c73070bdaecd86ba21b8f803b0f4779d1ab0b893f4ec1c788"),
        })
      );
    });

    it("returns PDF receipt when Accept header is application/pdf within 2 seconds", async () => {
      const task = seedTask();
      seedPayments(task.id);

      const start = Date.now();
      const res = await request(app.httpServer)
        .get(`/api/tasks/${task.id}/receipt`)
        .set("walletpublickey", WALLET)
        .set("Accept", "application/pdf")
        .responseType("blob");

      const durationMs = Date.now() - start;

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe("application/pdf");
      expect(res.headers["content-disposition"]).toBe(`inline; filename="receipt-${task.id}.pdf"`);
      expect(res.headers["cache-control"]).toBe("private, max-age=86400");
      expect(durationMs).toBeLessThan(2000);

      // Verify PDF binary header
      const buffer = Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.body);
      expect(buffer.slice(0, 5).toString("utf8")).toBe("%PDF-");
    });

    it("caches the generated receipt for 24 hours", async () => {
      const task = seedTask();
      seedPayments(task.id);

      // First request: generates receipt and caches it
      const res1 = await request(app.httpServer)
        .get(`/api/tasks/${task.id}/receipt`)
        .set("walletpublickey", WALLET);

      expect(res1.status).toBe(200);

      // Wipe db payments to prove cache serving
      paymentDbRaw.exec("DELETE FROM payments");

      // Second request: served from cache
      const res2 = await request(app.httpServer)
        .get(`/api/tasks/${task.id}/receipt`)
        .set("walletpublickey", WALLET);

      expect(res2.status).toBe(200);
      expect(res2.body.totalAmountPaid).toBe(7.5);
      expect(res2.body.payments).toHaveLength(2);
    });
  });
});

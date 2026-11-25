import PDFDocument from "pdfkit";
import { createTaskDb, getTaskDb, type TaskDb } from "../db/tasks";
import { getDb, createPaymentDb, type PaymentDb, type PaymentStatus } from "../db";
import { getConfig } from "../config";
import { getCacheClient, type CacheClient } from "../cache";
import { NotFoundError } from "../errors";

export interface ReceiptPaymentItem {
  nodeId: string;
  agentName: string;
  amountXLM: number;
  amountStroops: string;
  status: PaymentStatus;
  txHash: string | null;
  horizonLink: string | null;
  createdAt?: string;
}

export interface TaskReceipt {
  taskId: string;
  requesterAddress: string;
  completionTimestamp: string;
  taskStatus: string;
  prompt: string;
  payments: ReceiptPaymentItem[];
  totalAmountPaid: number;
  totalAmountPaidStroops: string;
  generatedAt: string;
}

export interface ReceiptOptions {
  taskDb?: TaskDb;
  paymentDb?: PaymentDb;
  horizonUrl?: string;
  cacheClient?: CacheClient;
}

export const RECEIPT_CACHE_TTL_SECONDS = 86400; // 24 hours

function getSafeCache(): CacheClient | null {
  try {
    return getCacheClient();
  } catch {
    return null;
  }
}

/**
 * Builds structured receipt data for a task from its task and payment records.
 */
export function buildReceiptData(taskId: string, options?: ReceiptOptions): TaskReceipt {
  const taskDb = options?.taskDb ?? createTaskDb(getTaskDb());
  const task = taskDb.findById(taskId);
  if (!task) {
    throw new NotFoundError("Task", taskId);
  }

  const paymentDb = options?.paymentDb ?? createPaymentDb(getDb());
  const paymentRecords = paymentDb.findByTaskId(taskId);

  let horizonBase = options?.horizonUrl ?? getConfig().STELLAR_HORIZON_URL;
  horizonBase = horizonBase.replace(/\/$/, "");

  let totalStroops = 0n;
  const payments: ReceiptPaymentItem[] = paymentRecords.map((p) => {
    totalStroops += p.amountStroops;
    const amountXLM = Number(p.amountStroops) / 10_000_000;
    const matchingNode = task.dag?.find((n) => n.nodeId === p.nodeId);
    const agentName = matchingNode?.type || matchingNode?.description || p.nodeId;
    const horizonLink = p.txHash ? `${horizonBase}/transactions/${p.txHash}` : null;

    return {
      nodeId: p.nodeId,
      agentName,
      amountXLM: Number(amountXLM.toFixed(7)),
      amountStroops: p.amountStroops.toString(),
      status: p.status,
      txHash: p.txHash,
      horizonLink,
      createdAt: p.createdAt,
    };
  });

  const totalAmountPaid = Number((Number(totalStroops) / 10_000_000).toFixed(7));
  const completionTimestamp = task.updatedAt || task.createdAt || new Date().toISOString();

  return {
    taskId: task.id,
    requesterAddress: task.walletPublicKey,
    completionTimestamp,
    taskStatus: task.status,
    prompt: task.prompt,
    payments,
    totalAmountPaid,
    totalAmountPaidStroops: totalStroops.toString(),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Generates a formal, printable PDF receipt buffer for a task.
 */
export async function generateReceiptPdf(receipt: TaskReceipt): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: 50,
        info: {
          Title: `Payment Receipt - ${receipt.taskId}`,
          Author: "AI-NET Decentralized Network",
          Subject: `Task Payment Settlement Receipt`,
          Keywords: "Stellar, Payment, Receipt, AI-NET",
        },
      });

      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", (err: Error) => reject(err));

      // ── Header Section ──────────────────────────────────────────────────
      doc.fontSize(20).fillColor("#111827").font("Helvetica-Bold").text("AI-NET PAYMENT RECEIPT", { align: "center" });
      doc.moveDown(0.3);
      doc.fontSize(9).fillColor("#6B7280").font("Helvetica").text("Decentralized Multi-Agent Task Settlement • Stellar Blockchain", { align: "center" });
      doc.moveDown(1.2);

      // Divider line
      doc.strokeColor("#E5E7EB").lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(1);

      // ── Receipt Metadata Grid ──────────────────────────────────────────
      const metaTop = doc.y;

      // Left Column: Task & Settlement Details
      doc.fontSize(9).fillColor("#4B5563").font("Helvetica-Bold").text("RECEIPT DETAILS", 50, metaTop);
      doc.moveDown(0.3);
      doc.font("Helvetica").fontSize(9).fillColor("#1F2937");
      doc.text(`Task ID: ${receipt.taskId}`);
      doc.text(`Status: ${receipt.taskStatus.toUpperCase()}`);
      doc.text(`Completed: ${receipt.completionTimestamp}`);
      doc.text(`Generated: ${receipt.generatedAt}`);

      // Right Column: Requester & Total Summary
      doc.fontSize(9).fillColor("#4B5563").font("Helvetica-Bold").text("REQUESTER / PAYER", 310, metaTop);
      doc.moveDown(0.3);
      doc.font("Helvetica").fontSize(9).fillColor("#1F2937");
      doc.text(`Wallet: ${receipt.requesterAddress}`, 310, doc.y, { width: 235 });
      doc.moveDown(0.5);
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#047857").text(
        `Total Settled: ${receipt.totalAmountPaid.toFixed(7)} XLM`,
        310,
        doc.y
      );

      // Reset cursor below the metadata grid
      const lowestY = Math.max(doc.y, metaTop + 65);
      doc.y = lowestY + 15;
      doc.x = 50;

      // ── Prompt Summary ─────────────────────────────────────────────────
      if (receipt.prompt) {
        doc.fontSize(9).fillColor("#4B5563").font("Helvetica-Bold").text("TASK PROMPT", 50, doc.y);
        doc.moveDown(0.3);
        doc.font("Helvetica-Oblique").fontSize(8.5).fillColor("#374151").text(`"${receipt.prompt}"`, { width: 495 });
        doc.moveDown(1);
      }

      // Divider line
      doc.strokeColor("#E5E7EB").lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(1);

      // ── Itemized Payments Table ────────────────────────────────────────
      doc.fontSize(10).fillColor("#111827").font("Helvetica-Bold").text("ITEMIZED AGENT PAYMENTS", 50, doc.y);
      doc.moveDown(0.6);

      const tableHeaderY = doc.y;
      // Header background rectangle
      doc.rect(50, tableHeaderY, 495, 18).fill("#F3F4F6");

      doc.fillColor("#374151").fontSize(8).font("Helvetica-Bold");
      doc.text("AGENT / NODE", 55, tableHeaderY + 4, { width: 140 });
      doc.text("STATUS", 200, tableHeaderY + 4, { width: 55 });
      doc.text("AMOUNT (XLM)", 260, tableHeaderY + 4, { width: 85, align: "right" });
      doc.text("STELLAR TX HASH / PROOF", 355, tableHeaderY + 4, { width: 185 });

      let rowY = tableHeaderY + 22;

      if (receipt.payments.length === 0) {
        doc.font("Helvetica").fontSize(8.5).fillColor("#6B7280").text(
          "No itemized agent payments recorded for this task.",
          55,
          rowY
        );
        rowY += 20;
      } else {
        for (const payment of receipt.payments) {
          doc.font("Helvetica").fontSize(8).fillColor("#1F2937");
          doc.text(payment.agentName, 55, rowY, { width: 140, ellipsis: true });
          doc.text(payment.status.toUpperCase(), 200, rowY, { width: 55 });
          doc.text(`${payment.amountXLM.toFixed(7)} XLM`, 260, rowY, { width: 85, align: "right" });

          if (payment.txHash) {
            const shortTx = `${payment.txHash.slice(0, 16)}...`;
            doc.fillColor("#2563EB").text(shortTx, 355, rowY, {
              width: 185,
              underline: true,
              link: payment.horizonLink ?? undefined,
            });
          } else {
            doc.fillColor("#9CA3AF").text("Pending / No Tx", 355, rowY, { width: 185 });
          }

          rowY += 16;
          // Thin separator line
          doc.strokeColor("#F3F4F6").lineWidth(0.5).moveTo(50, rowY - 2).lineTo(545, rowY - 2).stroke();
        }
      }

      // ── Total Summary Row ──────────────────────────────────────────────
      rowY += 4;
      doc.rect(50, rowY, 495, 20).fill("#E5E7EB");
      doc.fillColor("#111827").font("Helvetica-Bold").fontSize(8.5);
      doc.text("TOTAL AMOUNT PAID", 55, rowY + 5);
      doc.text(`${receipt.totalAmountPaid.toFixed(7)} XLM`, 260, rowY + 5, { width: 85, align: "right" });

      // ── Verification & Footer Section ──────────────────────────────────
      doc.fontSize(7.5).fillColor("#9CA3AF").font("Helvetica").text(
        "Official receipt generated server-side by AI-NET • Payments settled on Stellar Network • Horizon cryptographic verification",
        50,
        770,
        { align: "center", width: 495 }
      );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Gets cached receipt JSON or generates and caches it with a 24-hour TTL.
 */
export async function getOrGenerateReceiptJson(
  taskId: string,
  options?: ReceiptOptions
): Promise<TaskReceipt> {
  const cacheKey = `receipt:json:${taskId}`;
  const cache = options?.cacheClient ?? getSafeCache();

  if (cache) {
    try {
      const cached = await cache.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as TaskReceipt;
      }
    } catch {
      // Ignore cache fetch failures and fall through to generator
    }
  }

  const receipt = buildReceiptData(taskId, options);

  if (cache) {
    try {
      await cache.set(cacheKey, JSON.stringify(receipt), RECEIPT_CACHE_TTL_SECONDS);
    } catch {
      // Ignore cache store failures
    }
  }

  return receipt;
}

/**
 * Gets cached receipt PDF buffer or generates and caches it with a 24-hour TTL.
 */
export async function getOrGenerateReceiptPdf(
  taskId: string,
  options?: ReceiptOptions
): Promise<Buffer> {
  const cacheKey = `receipt:pdf:${taskId}`;
  const cache = options?.cacheClient ?? getSafeCache();

  if (cache) {
    try {
      const cached = await cache.get(cacheKey);
      if (cached) {
        return Buffer.from(cached, "base64");
      }
    } catch {
      // Ignore cache fetch failures and fall through to generator
    }
  }

  const receipt = buildReceiptData(taskId, options);
  const pdfBuffer = await generateReceiptPdf(receipt);

  if (cache) {
    try {
      await cache.set(cacheKey, pdfBuffer.toString("base64"), RECEIPT_CACHE_TTL_SECONDS);
    } catch {
      // Ignore cache store failures
    }
  }

  return pdfBuffer;
}

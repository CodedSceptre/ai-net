import Database from "better-sqlite3";
import { mkdtemp, readFile, rm } from "fs/promises";
import os from "os";
import path from "path";
import { createTaskDb } from "../db/tasks";
import { TaskResultStorageService } from "./taskResultStorage";

function createDb() {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      prompt TEXT NOT NULL,
      walletPublicKey TEXT NOT NULL,
      status TEXT NOT NULL,
      dagJson TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      result TEXT,
      resultFile TEXT,
      resultExpiresAt TEXT
    )
  `);
  const db = createTaskDb(database);
  db.insert({
    id: "task-result-test",
    prompt: "test",
    walletPublicKey: "wallet",
    status: "completed",
    dag: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return { database, db };
}

describe("TaskResultStorageService", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "ai-net-task-results-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("stores and reads small results inline", async () => {
    const { database, db } = createDb();
    const storage = new TaskResultStorageService(db, { directory, signingSecret: "test-secret" });
    const result = { answer: "complete" };

    await storage.persist("task-result-test", result);

    expect(JSON.parse(db.getResult("task-result-test")!.result!)).toEqual(result);
    expect(db.getResult("task-result-test")!.resultFile).toBeNull();
    database.close();
  });

  it("stores large results as files and returns a signed download URL", async () => {
    const { database, db } = createDb();
    const storage = new TaskResultStorageService(db, { directory, signingSecret: "test-secret" });
    const result = { content: "x".repeat(1024 * 1024) };

    await storage.persist("task-result-test", result);

    const download = storage.createDownloadUrl("task-result-test")!;
    const url = new URL(download.url, "http://localhost");
    const file = await storage.readSignedFile(
      "task-result-test",
      Number(url.searchParams.get("expires")),
      url.searchParams.get("signature")!,
    );
    expect(JSON.parse(file!.toString("utf8"))).toEqual(result);
    expect(await storage.readSignedFile("task-result-test", Date.now(), "bad")).toBeUndefined();

    const resultFile = db.getResult("task-result-test")!.resultFile!;
    await storage.cleanupExpired(new Date(Date.now() + 31 * 24 * 60 * 60 * 1000));
    await expect(readFile(resultFile)).rejects.toThrow();
    expect(db.getResult("task-result-test")!.result).toBeNull();
    database.close();
  });
});

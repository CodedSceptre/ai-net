import type Database from "better-sqlite3";
import { createLogger } from "../utils/logger";
import { QueryMonitor, queryMetrics } from "./queryMonitor";

jest.mock("../utils/logger", () => {
  const logger = { warn: jest.fn(), debug: jest.fn() };
  return { createLogger: () => logger };
});

function mockDatabase() {
  let totalChanges = 0;
  const run = jest.fn(() => {
    totalChanges++;
    return { changes: 1 };
  });
  const get = jest.fn(() => ({ id: 1 }));
  const all = jest.fn(() => [{ detail: "SCAN agents" }]);
  const db = {
    pragma: jest.fn(),
    exec: jest.fn(),
    prepare: jest.fn((sql: string) => {
      if (sql.startsWith("EXPLAIN")) return { all };
      if (sql.includes("total_changes()")) return { pluck: () => ({ get: () => totalChanges }) };
      return { get, run };
    }),
  };
  return { db: db as unknown as Database.Database, pragma: db.pragma, prepare: db.prepare, get, run };
}

describe("QueryMonitor", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("records a slow statement and logs its SQL and parameters", () => {
    jest.useFakeTimers();
    const { db } = mockDatabase();
    const monitor = new QueryMonitor();
    monitor.attach(db);
    const before = queryMetrics();
    jest.spyOn(performance, "now").mockReturnValueOnce(1).mockReturnValueOnce(152);

    const query = "SELECT * FROM agents WHERE id = ?";
    db.prepare(query).get(1);

    expect(createLogger().warn).toHaveBeenCalledWith({ query, params: [1], durationMs: 151 }, "slow query");
    const after = queryMetrics();
    expect(after.slow).toBe(before.slow + 1);
    expect(after.count).toBe(before.count + 1);
    expect(after.sum).toBeCloseTo(before.sum + 151);
  });

  it("reuses cached reads, expires them, and invalidates writes by table", () => {
    jest.useFakeTimers();
    const { db, get } = mockDatabase();
    new QueryMonitor().attach(db);
    const agents = db.prepare("SELECT * FROM agents WHERE id = ?");
    const tasks = db.prepare("SELECT * FROM tasks WHERE id = ?");
    const before = queryMetrics();

    expect(agents.get(1)).toEqual({ id: 1 });
    agents.get(1);
    tasks.get(1);
    expect(get).toHaveBeenCalledTimes(2);
    expect(queryMetrics().hits).toBe(before.hits + 1);
    expect(queryMetrics().misses).toBe(before.misses + 2);

    db.prepare("UPDATE agents SET name = ? WHERE id = ?").run("updated", 1);
    tasks.get(1);
    agents.get(1);
    expect(get).toHaveBeenCalledTimes(3);

    jest.advanceTimersByTime(5_001);
    agents.get(1);
    expect(get).toHaveBeenCalledTimes(4);
  });

  it("optimizes once per day until stopped", () => {
    jest.useFakeTimers();
    const { db, pragma } = mockDatabase();
    const stop = new QueryMonitor().scheduleOptimize(db);
    const day = 24 * 60 * 60 * 1_000;

    jest.advanceTimersByTime(day - 1);
    expect(pragma).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(pragma).toHaveBeenCalledWith("optimize");
    stop();
    jest.advanceTimersByTime(day);
    expect(pragma).toHaveBeenCalledTimes(1);
  });
});

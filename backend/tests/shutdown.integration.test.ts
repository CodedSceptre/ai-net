import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

it("drains five in-flight HTTP responses after SIGTERM and exits cleanly", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "ai-net-shutdown-"));
  const child = spawn(process.execPath, [
    "-r", require.resolve("ts-node/register/transpile-only"), "-e", `
      const { createServer } = require("node:http");
      const { setupGracefulShutdown } = require(${JSON.stringify(resolve(__dirname, "../src/index.ts"))});
      const { shutdownMiddleware } = require(${JSON.stringify(resolve(__dirname, "../src/api/middleware/shutdownMiddleware.ts"))});
      const waiting = [];
      const server = createServer((req, res) => {
        shutdownMiddleware(req, res, () => {
          waiting.push(res);
          if (waiting.length === 5) {
            console.log("requests-started");
            process.once("SIGTERM", () => {
              for (const response of waiting) response.end("completed");
            });
          }
        });
      });
      setupGracefulShutdown(server, (done) => done(), { GRACEFUL_SHUTDOWN_TIMEOUT: 3 });
      server.listen(0, "127.0.0.1", () => console.log("port:" + server.address().port));
    `,
  ], {
    cwd,
    env: { ...process.env, TS_NODE_PROJECT: resolve(__dirname, "../tsconfig.json"), LOG_LEVEL: "silent" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const exited = once(child, "exit");
  const lines = createInterface({ input: child.stdout });
  const incoming = lines[Symbol.asyncIterator]();
  try {
    const port = await incoming.next();
    expect(port.value).toMatch(/^port:\d+$/);
    const requests = Array.from({ length: 5 }, () => new Promise<string>((resolveResponse, reject) => {
      get(`http://127.0.0.1:${port.value.slice(5)}`, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => resolveResponse(body));
        res.on("error", reject);
      }).on("error", reject);
    }));
    expect((await incoming.next()).value).toBe("requests-started");
    child.kill("SIGTERM");
    await expect(Promise.all(requests)).resolves.toEqual(Array(5).fill("completed"));
    await expect(exited).resolves.toEqual([0, null]);
  } finally {
    lines.close();
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
    await rm(cwd, { recursive: true, force: true });
  }
}, 15_000);

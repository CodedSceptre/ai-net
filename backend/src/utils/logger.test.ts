import type { AxiosAdapter } from "axios";
import { Writable } from "node:stream";
import express from "express";
import supertest from "supertest";
import { Horizon } from "@stellar/stellar-sdk";
import { requestId } from "../api/middleware/requestId";
import { createHorizonServer } from "../services/horizonClient";
import { VeniceClient } from "../services/venice/client";
import { getLogger } from "./logger";
import { getRequestId, requestContext } from "./requestContext";

function captureLogs() {
  const entries: Record<string, unknown>[] = [];
  const destination = new Writable({
    write(chunk, _encoding, next) {
      entries.push(JSON.parse(chunk.toString()));
      next();
    },
  });
  return { entries, destination };
}

describe("request correlation", () => {
  it("adds the active request ID alongside child bindings and omits it outside a request", () => {
    const { entries, destination } = captureLogs();
    const log = getLogger({ agentId: "agent-1", taskId: "task-1" }, { destination });
    log.info("startup");
    requestContext.run({ requestId: "request-1" }, () => {
      log.info({ requestId: "stale" }, "handling request");
    });
    expect(entries[0]).not.toHaveProperty("requestId");
    expect(entries[1]).toMatchObject({
      requestId: "request-1", agentId: "agent-1", taskId: "task-1",
    });
  });

  it("isolates log entries and response headers for 50 concurrent requests", async () => {
    const { entries, destination } = captureLogs();
    const log = getLogger({}, { destination });
    const app = express();
    app.use(requestId);
    app.get("/:index", async (req, res) => {
      await new Promise<void>((resolve) => setImmediate(resolve));
      log.info({ index: req.params.index }, "request handled");
      res.json({ requestId: getRequestId() });
    });

    const responses = await Promise.all(Array.from({ length: 50 }, (_, index) => {
      const request = supertest(app).get(`/${index}`);
      return index % 2 === 0 ? request.set("X-Request-ID", `trace-${index}`) : request;
    }));
    expect(entries).toHaveLength(50);
    expect(new Set(responses.map((response) => response.body.requestId)).size).toBe(50);
    responses.forEach((response, index) => {
      const id = response.headers["x-request-id"];
      expect(id).toBe(response.body.requestId);
      expect(id).toMatch(index % 2 === 0 ? new RegExp(`^trace-${index}$`) : /^[A-Za-z0-9_-]{12}$/);
      expect(entries.find((entry) => entry.index === String(index))?.requestId).toBe(id);
    });
    expect(getRequestId()).toBeUndefined();
  });

  it("forwards the request ID to Venice", async () => {
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: "answer" } }] })),
    );
    try {
      const client = new VeniceClient({ apiKey: "test-key" });
      await requestContext.run({ requestId: "venice-request" }, () =>
        client.complete("correlation test", "research"),
      );
      expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
        headers: expect.objectContaining({ "X-Request-ID": "venice-request" }),
      }));
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("sets the Horizon SDK HTTP header for the active request", async () => {
    createHorizonServer("https://horizon-testnet.stellar.org");
    const adapter: AxiosAdapter = async (config) => ({
      config, status: 200, statusText: "OK", headers: {},
      data: config.headers.get("X-Request-ID"),
    });
    const response = await requestContext.run({ requestId: "horizon-request" }, () =>
      Horizon.AxiosClient.get("https://horizon-testnet.stellar.org", { adapter }),
    );
    const background = await Horizon.AxiosClient.get("https://horizon-testnet.stellar.org", { adapter });
    expect(response.data).toBe("horizon-request");
    expect(background.data).toBeUndefined();
  });
});

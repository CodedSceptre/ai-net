import { createElement, type PropsWithChildren } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTaskPayments } from "./useTaskPayments";

function setup(response: unknown, status = 200) {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify(response), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient();
  const wrapper = ({ children }: PropsWithChildren) =>
    createElement(QueryClientProvider, { client }, children);
  return {
    ...renderHook(() => useTaskPayments("task-1", "wallet"), { wrapper }),
    fetchMock,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("useTaskPayments", () => {
  it("loads multiple payments and totals released funds", async () => {
    const payments = [
      { nodeId: "one", status: "released", amountXLM: 0.5 },
      { nodeId: "two", status: "locked", amountXLM: 0.2 },
      { nodeId: "three", status: "released", amountXLM: 1 },
    ];
    const { result, fetchMock } = setup({ payments });
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.payments).toEqual(payments));
    expect(result.current.totalXLM).toBe(1.5);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/tasks\/task-1\/payments$/),
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("returns an empty list and zero total", async () => {
    const { result } = setup({ payments: [] });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.payments).toEqual([]);
    expect(result.current.totalXLM).toBe(0);
  });

  it("exposes request failure", async () => {
    const { result } = setup({ message: "Unavailable" }, 500);
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.payments).toEqual([]);
  });
});

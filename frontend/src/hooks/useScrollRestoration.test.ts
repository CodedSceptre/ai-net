import { renderHook } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useLocation, useNavigationType } from "react-router-dom";
import {
  useScrollRestoration,
  resetScrollPositions,
  scrollPositions,
} from "./useScrollRestoration";

vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof import("react-router-dom")>(
      "react-router-dom",
    );
  return {
    ...actual,
    useLocation: vi.fn(),
    useNavigationType: vi.fn(),
  };
});

describe("useScrollRestoration", () => {
  let mockLocation: { pathname: string; search: string };
  let mockNavigationType: "POP" | "PUSH" | "REPLACE";

  beforeEach(() => {
    sessionStorage.clear();
    resetScrollPositions();
    mockLocation = { pathname: "/agents", search: "" };
    mockNavigationType = "PUSH";
    vi.mocked(useLocation).mockImplementation(() => mockLocation as any);
    vi.mocked(useNavigationType).mockImplementation(
      () => mockNavigationType as any,
    );

    // Provide scrollable element
    document.body.innerHTML = `
      <div class="main-content" style="height: 500px; overflow-y: auto;">
        <div style="height: 2000px;">Content</div>
      </div>
    `;

    const mainContent = document.querySelector(".main-content") as HTMLElement;
    Object.defineProperty(mainContent, "scrollHeight", {
      configurable: true,
      value: 2000,
    });
    Object.defineProperty(mainContent, "clientHeight", {
      configurable: true,
      value: 500,
    });
    mainContent.scrollTop = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sets history.scrollRestoration to manual when supported", () => {
    Object.defineProperty(window.history, "scrollRestoration", {
      writable: true,
      value: "auto",
      configurable: true,
    });
    renderHook(() => useScrollRestoration());
    expect(window.history.scrollRestoration).toBe("manual");
  });

  it("stores scroll positions in a Map keyed by route path", () => {
    mockNavigationType = "PUSH";
    mockLocation = { pathname: "/agents", search: "" };
    const { rerender } = renderHook(() => useScrollRestoration());

    const mainContent = document.querySelector(".main-content") as HTMLElement;
    mainContent.scrollTop = 250;

    // Navigate to /tasks/123 - this unmounts the previous route effect and persists scroll
    mockLocation = { pathname: "/tasks/123", search: "" };
    rerender();

    expect(scrollPositions.get("/agents")).toBe(250);
  });

  it("restores scroll position on POP navigation within tolerance", () => {
    // 1. Initial visit to /agents with PUSH
    mockNavigationType = "PUSH";
    mockLocation = { pathname: "/agents", search: "" };
    const { rerender } = renderHook(() => useScrollRestoration());

    const mainContent = document.querySelector(".main-content") as HTMLElement;
    mainContent.scrollTop = 350;

    // 2. Navigate away to /tasks/123
    mockNavigationType = "PUSH";
    mockLocation = { pathname: "/tasks/123", search: "" };
    rerender();

    // 3. Navigate back to /agents via POP (back button)
    mockNavigationType = "POP";
    mockLocation = { pathname: "/agents", search: "" };
    rerender();

    expect(Math.abs(mainContent.scrollTop - 350)).toBeLessThanOrEqual(10);
  });

  it("works for specific required pages: AgentsPage, TaskDetailPage, PaymentHistoryPage", () => {
    const mainContent = document.querySelector(".main-content") as HTMLElement;

    // 1. Visit AgentsPage (/agents)
    mockNavigationType = "PUSH";
    mockLocation = { pathname: "/agents", search: "" };
    const { rerender } = renderHook(() => useScrollRestoration());
    mainContent.scrollTop = 120;

    // 2. Visit TaskDetailPage (/tasks/42)
    mockNavigationType = "PUSH";
    mockLocation = { pathname: "/tasks/42", search: "" };
    rerender();
    expect(mainContent.scrollTop).toBe(0);
    mainContent.scrollTop = 300;

    // 3. Visit PaymentHistoryPage (/payments)
    mockNavigationType = "PUSH";
    mockLocation = { pathname: "/payments", search: "" };
    rerender();
    expect(mainContent.scrollTop).toBe(0);
    mainContent.scrollTop = 450;

    // 4. Back to TaskDetailPage (/tasks/42)
    mockNavigationType = "POP";
    mockLocation = { pathname: "/tasks/42", search: "" };
    rerender();
    expect(Math.abs(mainContent.scrollTop - 300)).toBeLessThanOrEqual(10);

    // 5. Back to AgentsPage (/agents)
    mockNavigationType = "POP";
    mockLocation = { pathname: "/agents", search: "" };
    rerender();
    expect(Math.abs(mainContent.scrollTop - 120)).toBeLessThanOrEqual(10);
  });

  it("resets scroll to 0 on PUSH navigation to a new route", () => {
    mockNavigationType = "PUSH";
    mockLocation = { pathname: "/agents", search: "" };
    const { rerender } = renderHook(() => useScrollRestoration());

    const mainContent = document.querySelector(".main-content") as HTMLElement;
    mainContent.scrollTop = 400;

    // Navigate forward to /payments
    mockLocation = { pathname: "/payments", search: "" };
    rerender();

    expect(mainContent.scrollTop).toBe(0);
  });
});

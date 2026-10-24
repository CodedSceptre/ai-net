import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useLocation } from "react-router-dom";
import { useRouteProgress } from "./useRouteProgress";
import * as RouteProgressContextModule from "../context/RouteProgressContext";

vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof import("react-router-dom")>(
      "react-router-dom",
    );
  return {
    ...actual,
    useLocation: vi.fn(),
  };
});

describe("useRouteProgress", () => {
  let mockLocation: { pathname: string; search: string };
  const mockStart = vi.fn();
  const mockDone = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    mockLocation = { pathname: "/agents", search: "" };
    vi.mocked(useLocation).mockImplementation(() => mockLocation as any);
    mockStart.mockClear();
    mockDone.mockClear();

    vi.spyOn(
      RouteProgressContextModule,
      "useRouteProgressContext",
    ).mockReturnValue({
      value: -1,
      isError: false,
      start: mockStart,
      done: mockDone,
      error: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not trigger on initial mount", () => {
    renderHook(() => useRouteProgress());
    expect(mockStart).not.toHaveBeenCalled();
    expect(mockDone).not.toHaveBeenCalled();
  });

  it("triggers start and done across route changes", () => {
    const { rerender } = renderHook(() => useRouteProgress());

    mockLocation = { pathname: "/tasks/1", search: "" };
    rerender();

    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(mockDone).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(mockDone).toHaveBeenCalledTimes(1);
  });
});

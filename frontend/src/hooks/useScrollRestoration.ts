import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

const STORAGE_KEY = "scroll_positions";
const MAX_ENTRIES = 50;
const RESTORE_TOLERANCE_PX = 2;
const RESTORE_MAX_ATTEMPTS = 30;

/** Scroll positions keyed by route path (+ search), shared across mounts. */
export const scrollPositions = new Map<string, number>();
let hydrated = false;

export const resetScrollPositions = () => {
  scrollPositions.clear();
  hydrated = false;
};

const hydrate = () => {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      for (const [k, v] of Object.entries(
        JSON.parse(raw) as Record<string, number>,
      )) {
        if (typeof v === "number") scrollPositions.set(k, v);
      }
    }
  } catch {
    // Storage may be unavailable (private mode); in-memory restore still works.
  }
};

const persist = () => {
  try {
    while (scrollPositions.size > MAX_ENTRIES) {
      scrollPositions.delete(scrollPositions.keys().next().value as string);
    }
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(Object.fromEntries(scrollPositions)),
    );
  } catch {
    // Persistence is best-effort.
  }
};

/** The shell scrolls `.main-content` when it overflows, otherwise the window does. */
const getScroller = (): {
  get: () => number;
  set: (y: number) => void;
  max: () => number;
} => {
  const el = document.querySelector<HTMLElement>(".main-content");
  if (el && el.scrollHeight > el.clientHeight) {
    return {
      get: () => el.scrollTop,
      set: (y) => {
        el.scrollTop = y;
      },
      max: () => el.scrollHeight - el.clientHeight,
    };
  }
  const root = document.scrollingElement || document.documentElement;
  return {
    get: () => window.scrollY,
    set: (y) => window.scrollTo(0, y),
    max: () => root.scrollHeight - window.innerHeight,
  };
};

const currentOffset = () => {
  const el = document.querySelector<HTMLElement>(".main-content");
  return Math.max(el?.scrollTop ?? 0, window.scrollY);
};

/**
 * Saves scroll offsets per route and restores them on back/forward (POP)
 * navigation, including after a refresh. New navigations start at the top.
 * Restoration retries across frames so lazily loaded / async content that
 * grows the page is still reached.
 */
export const useScrollRestoration = () => {
  const location = useLocation();
  const navigationType = useNavigationType();
  const key = location.pathname + location.search;
  const keyRef = useRef(key);
  const firstRender = useRef(true);

  useEffect(() => {
    hydrate();
    try {
      if (typeof window !== "undefined" && "history" in window) {
        window.history.scrollRestoration = "manual";
      }
    } catch {
      // Ignore if unsupported in environment
    }
  }, []);

  // Track the live offset for the current route while scrolling or before pagehide.
  useEffect(() => {
    hydrate();
    keyRef.current = key;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        scrollPositions.set(keyRef.current, currentOffset());
      });
    };
    // Capture phase catches scroll on the (non-bubbling) .main-content element.
    document.addEventListener("scroll", onScroll, {
      capture: true,
      passive: true,
    });
    const onHide = () => {
      scrollPositions.set(keyRef.current, currentOffset());
      persist();
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("pagehide", onHide);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [key]);

  // Restore (POP / reload) or reset (PUSH / REPLACE) after the route renders.
  useLayoutEffect(() => {
    hydrate();
    const isReload = firstRender.current;
    firstRender.current = false;
    const target = scrollPositions.get(key);
    const restore =
      (navigationType === "POP" || isReload) && target !== undefined;

    let frame = 0;
    let attempts = 0;
    const apply = () => {
      const scroller = getScroller();
      const wanted = restore ? target : 0;
      scroller.set(Math.min(wanted, Math.max(scroller.max(), 0)));
      const reached = Math.abs(scroller.get() - wanted) <= RESTORE_TOLERANCE_PX;
      if (restore && !reached && ++attempts < RESTORE_MAX_ATTEMPTS) {
        frame = requestAnimationFrame(apply);
      }
    };
    apply();

    return () => {
      // Save scroll position of the outgoing route BEFORE the next route resets it
      scrollPositions.set(key, currentOffset());
      persist();
      if (frame) cancelAnimationFrame(frame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    const main =
      document.querySelector("main") || document.querySelector('[role="main"]');
    if (main instanceof HTMLElement) {
      main.focus({ preventScroll: true });
    }
  }, [location.pathname]);
};

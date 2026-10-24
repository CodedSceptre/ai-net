/**
 * useRouteProgress
 *
 * Listens to React Router location changes and drives the global progress bar.
 * Must be rendered inside both <Router> and <RouteProgressProvider>.
 */
import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useRouteProgressContext } from "../context/RouteProgressContext";

export const useRouteProgress = (): void => {
  const location = useLocation();
  const { start, done } = useRouteProgressContext();
  const prevPathRef = useRef<string | null>(null);

  useEffect(() => {
    // Skip the very first mount — no navigation has occurred yet.
    if (prevPathRef.current === null) {
      prevPathRef.current = location.pathname + location.search;
      return;
    }

    const next = location.pathname + location.search;
    if (next !== prevPathRef.current) {
      prevPathRef.current = next;
      start();
      // Keep the progress bar visible during the route transition (150ms animation)
      const timer = setTimeout(() => {
        done();
      }, 150);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);
};

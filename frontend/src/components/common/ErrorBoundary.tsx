/**
 * ErrorBoundary — catches render errors in the React component tree.
 *
 * Changes in this file (issue #657):
 *  - componentDidCatch now calls Sentry.captureException with the component
 *    stack trace and stores the resulting event ID in state.
 *  - Fallback UI: human-readable message, error ID (Sentry event ID or local
 *    UUID), "Return to Dashboard" and "Try again" buttons.
 *  - Accepts an optional `fallback` prop for custom per-component fallbacks.
 *  - RouteErrorBoundary wraps individual route elements so a crash in one
 *    route does not affect other pages or the navigation shell.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";
import { captureException } from "../../services/sentry";
import styles from "./ErrorBoundary.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  children?: ReactNode;
  /** Optional label shown in the error screen to identify which area failed */
  label?: string;
  /** Optional custom fallback UI; replaces the default when provided. */
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorId: string | null;
}

// ---------------------------------------------------------------------------
// Default fallback UI
// ---------------------------------------------------------------------------

interface FallbackProps {
  errorId: string;
  onRetry: () => void;
}

function DefaultFallback({ errorId, onRetry }: FallbackProps) {
  return (
    <div className={styles.container} role="alert">
      <div className={styles.icon} aria-hidden="true">⚠</div>
      <h2 className={styles.heading}>Something went wrong</h2>
      <p className={styles.body}>
        An unexpected error occurred. The engineering team has been notified.
      </p>
      <p className={styles.errorId}>
        Error ID: <code>{errorId}</code>
      </p>
      <div className={styles.actions}>
        <a href="/" className={styles.primaryButton}>
          Return to Dashboard
        </a>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={onRetry}
        >
          Try again
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ErrorBoundary
// ---------------------------------------------------------------------------

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorId: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorId: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const errorId = captureException(error, {
      componentStack: errorInfo.componentStack ?? undefined,
      label: this.props.label,
    });
    this.setState({ errorId });

    if (import.meta.env.DEV) {
      console.error("ErrorBoundary caught an error:", error, errorInfo);
    }
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false, error: null, errorId: null });
  };

  public render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      const id = this.state.errorId ?? `local-${Math.random().toString(36).slice(2, 10)}`;
      return <DefaultFallback errorId={id} onRetry={this.handleRetry} />;
    }

    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// RouteErrorBoundary — wraps individual route elements
// ---------------------------------------------------------------------------

export interface RouteErrorBoundaryProps {
  label?: string;
  children?: ReactNode;
}

/**
 * Lightweight wrapper — use this around individual route elements so that one
 * broken route does not crash the entire app shell.
 *
 * Usage:
 *   <RouteErrorBoundary label="Dashboard">
 *     <DashboardPage />
 *   </RouteErrorBoundary>
 */
export function RouteErrorBoundary({ children, label }: RouteErrorBoundaryProps) {
  return <ErrorBoundary label={label}>{children}</ErrorBoundary>;
export class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  State
> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error(
        `RouteErrorBoundary [${this.props.label ?? "Route"}] caught an error:`,
        error,
        errorInfo,
      );
    }
  }

  public render() {
    if (this.state.hasError) {
      return (
        <ServerErrorPage
          error={this.state.error}
          onRetry={() => this.setState({ hasError: false, error: null })}
        />
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;

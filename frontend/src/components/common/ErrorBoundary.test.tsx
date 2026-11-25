/**
 * ErrorBoundary unit tests (issue #657)
 *
 * Verifies:
 *  - A render error thrown by a child is caught and shows the fallback UI
 *  - captureException (Sentry) is called with the error and component stack
 *  - The fallback renders a human-readable message, an error ID, and both
 *    recovery buttons
 *  - "Try again" resets the error boundary state and re-renders children
 *  - Custom `fallback` prop is rendered instead of the default UI
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ErrorBoundary, RouteErrorBoundary } from './ErrorBoundary';
import * as sentryModule from '../../services/sentry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('test explosion');
  return <p>All good</p>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ErrorBoundary', () => {
  let captureExceptionSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    captureExceptionSpy = vi
      .spyOn(sentryModule, 'captureException')
      .mockReturnValue('test-error-id-abc123');
    // Suppress React's noisy error boundary console output in tests
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    captureExceptionSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('All good')).toBeInTheDocument();
  });

  it('catches a render error and shows the fallback UI', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('calls captureException with the error and component stack', () => {
    render(
      <ErrorBoundary label="TestArea">
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );

    expect(captureExceptionSpy).toHaveBeenCalledOnce();
    const [error, extra] = captureExceptionSpy.mock.calls[0];
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('test explosion');
    expect(extra).toHaveProperty('componentStack');
    expect(extra).toHaveProperty('label', 'TestArea');
  });

  it('renders an error ID in the fallback UI', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );

    expect(screen.getByText('test-error-id-abc123')).toBeInTheDocument();
  });

  it('renders "Return to Dashboard" link pointing to /', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );

    const link = screen.getByRole('link', { name: 'Return to Dashboard' });
    expect(link).toHaveAttribute('href', '/');
  });

  it('renders a "Try again" button that resets the boundary', () => {
    const { rerender } = render(
      <ErrorBoundary>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();

    // Rerender with a non-throwing child so after reset it shows content
    rerender(
      <ErrorBoundary>
        <Bomb shouldThrow={false} />
      </ErrorBoundary>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('All good')).toBeInTheDocument();
  });

  it('renders a custom fallback when the fallback prop is provided', () => {
    render(
      <ErrorBoundary fallback={<p>Custom fallback UI</p>}>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Custom fallback UI')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });
});

describe('RouteErrorBoundary', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.spyOn(sentryModule, 'captureException').mockReturnValue('route-err-id');
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    consoleErrorSpy.mockRestore();
  });

  it('catches a route-level render error without affecting siblings', () => {
    render(
      <div>
        <RouteErrorBoundary label="AgentsPage">
          <Bomb shouldThrow />
        </RouteErrorBoundary>
        <p>Sibling content still visible</p>
      </div>,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Sibling content still visible')).toBeInTheDocument();
  });
});

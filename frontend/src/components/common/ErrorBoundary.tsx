import { Component, ErrorInfo, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

const GITHUB_ISSUES_URL = 'https://github.com/CodedSceptre/ai-net/issues/new';

interface Props {
  children?: ReactNode;
  /** Optional label shown in the error screen to identify which area failed */
  label?: string;
}

interface State {
  hasError: boolean;
  errorCode: string | null;
  error: Error | null;
}

/**
 * The fallback is a separate function component so the class boundary can use
 * translations through the normal `useTranslation` hook.
 */
function ErrorFallback({
  errorCode,
  error,
  label,
  onRetry,
}: {
  errorCode: string | null;
  error: Error | null;
  label?: string;
  onRetry: () => void;
}) {
  const { t } = useTranslation();

  const issueTitle = encodeURIComponent(`[Bug] Render error${label ? ` in ${label}` : ''}: ${errorCode ?? 'unknown'}`);
  const issueBody = encodeURIComponent(
    `**Error code:** ${errorCode ?? 'unknown'}\n\n**Message:** ${error?.message ?? 'No message'}\n\n**Stack:**\n\`\`\`\n${error?.stack ?? 'No stack trace'}\n\`\`\`\n\n**Steps to reproduce:**\n1. \n`,
  );
  const githubUrl = `${GITHUB_ISSUES_URL}?title=${issueTitle}&body=${issueBody}`;

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '400px',
        padding: '40px',
        textAlign: 'center',
        background: 'var(--panel-bg, var(--surface-panel-translucent))',
        backdropFilter: 'blur(12px)',
        border: '1px solid var(--panel-border, var(--white-alpha-08))',
        borderRadius: '16px',
        margin: '40px auto',
        maxWidth: '600px',
        boxShadow: 'var(--shadow-md)',
      }}
    >
      <h2
        style={{
          color: 'var(--danger, var(--status-danger))',
          marginBottom: '16px',
          fontSize: '1.8rem',
        }}
      >
        {t('error.title')}
      </h2>

      {label && (
        <p
          style={{
            color: 'var(--text-muted)',
            marginBottom: '8px',
            fontSize: '0.9rem',
            fontStyle: 'italic',
          }}
        >
          {label}
        </p>
      )}

      <p style={{ color: 'var(--text-secondary, var(--text-muted))', marginBottom: '24px' }}>
        {t('error.description')}
      </p>

      <div
        style={{
          background: 'var(--surface-black-subtle)',
          padding: '12px 24px',
          borderRadius: '8px',
          fontFamily: 'monospace',
          fontSize: '1.1rem',
          color: 'var(--surface-primary)',
          border: '1px dashed var(--white-alpha-10)',
          marginBottom: '24px',
        }}
      >
        {t('error.code')} <span id="error-code">{errorCode}</span>
      </div>

      <div
        style={{
          display: 'flex',
          gap: '12px',
          flexWrap: 'wrap',
          justifyContent: 'center',
        }}
      >
        <button
          type="button"
          onClick={onRetry}
          style={{
            padding: '10px 20px',
            background: 'var(--primary, var(--accent-secondary))',
            color: 'var(--text-inverse)',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          {t('error.tryAgain')}
        </button>

        <a
          href={githubUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            padding: '10px 20px',
            background: 'transparent',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-muted)',
            borderRadius: '8px',
            cursor: 'pointer',
            fontWeight: 600,
            textDecoration: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          {t('error.reportIssue')}
        </a>
      </div>
    </div>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    errorCode: null,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    // Generate a structured error code based on random hex
    const errorCode = `ERR-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    return { hasError: true, errorCode, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error('ErrorBoundary caught an error:', error, errorInfo);
    }
  }

  private handleRetry = () => {
    this.setState({ hasError: false, errorCode: null, error: null });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <ErrorFallback
          errorCode={this.state.errorCode}
          error={this.state.error}
          label={this.props.label}
          onRetry={this.handleRetry}
        />
      );
    }

    return this.props.children;
  }
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
export function RouteErrorBoundary({
  children,
  label,
}: {
  children: ReactNode;
  label?: string;
}) {
  return <ErrorBoundary label={label}>{children}</ErrorBoundary>;
}

export default ErrorBoundary;

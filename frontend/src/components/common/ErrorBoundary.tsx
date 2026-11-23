import { Component, ErrorInfo, ReactNode } from "react";
import ServerErrorPage from "../../pages/ServerErrorPage";

interface Props {
  children?: ReactNode;
  /** Optional label shown in the error screen to identify which area failed */
  label?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error("ErrorBoundary caught an error:", error, errorInfo);
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

export function RouteErrorBoundary({ children, label }: Props) {
  return <ErrorBoundary label={label}>{children}</ErrorBoundary>;
}

export default ErrorBoundary;

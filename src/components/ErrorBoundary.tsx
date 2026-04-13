import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

type ErrorBoundaryProps = {
  children: ReactNode;
  title?: string;
  description?: string;
  resetKey?: string;
};

type ErrorBoundaryState = {
  error: Error | null;
};

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Route rendering failed.', error, info.componentStack);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <section className="section-card ambient-shadow mx-auto max-w-3xl p-8">
        <div className="flex items-start gap-4">
          <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-red-700">
            <AlertTriangle size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="form-kicker">Workspace Error</p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-on-surface">
              {this.props.title || 'This workspace could not render'}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-secondary">
              {this.props.description ||
                'The route hit an unexpected UI error. Refresh the page after saving your work, or open another workspace from the navigation.'}
            </p>
            <pre className="mt-4 overflow-x-auto rounded-2xl border border-outline-variant/40 bg-surface-container-low px-4 py-3 text-xs text-secondary">
              {this.state.error.message}
            </pre>
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="enterprise-button enterprise-button-primary mt-5"
            >
              <RefreshCw size={16} />
              Try again
            </button>
          </div>
        </div>
      </section>
    );
  }
}

export default ErrorBoundary;

import React from 'react';
import { tGlobal } from '../i18n/translations';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Optional hook for logging/reporting the caught error. */
  onError?: (error: Error, componentStack: string) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
  componentStack: string;
}

/**
 * Global error boundary: converts a render crash into a readable, recoverable
 * panel instead of leaving the whole app as a white screen.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null, componentStack: '' };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    const componentStack = info.componentStack ?? '';
    this.setState({ componentStack });
    this.props.onError?.(error, componentStack);
    console.error('[ErrorBoundary]', error, componentStack);
  }

  private handleRetry = () => {
    this.setState({ error: null, componentStack: '' });
  };

  private handleReload = () => {
    window.location.reload();
  };

  private handleCopyDetails = () => {
    const { error, componentStack } = this.state;
    const details = [error?.message ?? 'unknown error', componentStack]
      .filter(Boolean)
      .join('\n');
    navigator.clipboard?.writeText(details).catch(() => {});
  };

  override render() {
    const { error, componentStack } = this.state;

    if (!error) return this.props.children;

    return (
      <div
        role="alert"
        className="fixed inset-0 z-[9999] flex items-center justify-center p-6 bg-neutral-950/95"
      >
        <div className="w-full max-w-2xl border-2 border-red-500/60 bg-neutral-900 shadow-2xl">
          <div className="flex items-center gap-[var(--space-2)] border-b-2 border-red-500/60 bg-red-600/80 px-[var(--space-4)] py-[var(--space-2)]">
            <span className="text-sm font-bold uppercase tracking-wider text-white">
              {tGlobal('ebTitle')}
            </span>
          </div>

          <div className="space-y-[var(--space-4)] p-[var(--space-4)] font-mono text-sm text-neutral-100">
            <p className="text-red-300">
              {tGlobal('ebMessage')}
            </p>

            <div className="border border-neutral-700 bg-black/40 p-[var(--space-3)]">
              <div className="mb-[var(--space-1)] text-xs uppercase tracking-wide text-neutral-400">
                {tGlobal('ebDetails')}
              </div>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs text-amber-300">
                {error.message}
                {componentStack ? `\n${componentStack}` : ''}
              </pre>
            </div>

            <div className="flex flex-wrap gap-[var(--space-2)]">
              <button
                type="button"
                onClick={this.handleRetry}
                className="border border-neutral-500 bg-neutral-800 px-[var(--space-3)] py-[var(--space-2)] font-mono text-xs uppercase tracking-wide hover:bg-neutral-700"
              >
                {tGlobal('ebRetry')}
              </button>
              <button
                type="button"
                onClick={this.handleReload}
                className="border border-neutral-500 bg-neutral-800 px-[var(--space-3)] py-[var(--space-2)] font-mono text-xs uppercase tracking-wide hover:bg-neutral-700"
              >
                {tGlobal('ebReload')}
              </button>
              <button
                type="button"
                onClick={this.handleCopyDetails}
                className="border border-neutral-500 bg-neutral-800 px-[var(--space-3)] py-[var(--space-2)] font-mono text-xs uppercase tracking-wide hover:bg-neutral-700"
              >
                {tGlobal('ebCopyDetails')}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;

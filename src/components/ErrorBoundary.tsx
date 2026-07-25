import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { AlertOctagon, RotateCcw } from 'lucide-react';
import { normalizeError } from '../errors/normalize';
import { reportError } from '../errors/report';
import { StatusScreen } from './ui/StatusScreen';
import { Button } from './ui/Button';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  userMessage: string;
}

/**
 * Top-level React error boundary. Catches render/lifecycle errors that would
 * otherwise blank the whole app, reports them (dev console today; see
 * errors/report.ts for how a provider would plug in), and offers a real way
 * out — reload — rather than a permanently broken screen.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, userMessage: '' };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    const normalized = normalizeError(error);
    return { hasError: true, userMessage: normalized.userMessage };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    reportError(normalizeError(error), { scope: 'ErrorBoundary', componentStack: info.componentStack ?? undefined });
  }

  render() {
    if (this.state.hasError) {
      return (
        <StatusScreen
          icon={<AlertOctagon size={28} aria-hidden />}
          tone="danger"
          title="Something went wrong"
          description={this.state.userMessage || 'The app hit an unexpected error.'}
          actions={
            <Button variant="primary" size="lg" block onClick={() => window.location.reload()}>
              <RotateCcw size={18} aria-hidden />
              Reload
            </Button>
          }
        />
      );
    }
    return this.props.children;
  }
}

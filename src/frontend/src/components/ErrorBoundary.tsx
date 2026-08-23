import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Panel name shown in the fallback, e.g. "chat" or "sidebar". */
  label?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Per-panel error boundary: a crash in one panel renders a compact retry
 * fallback instead of blanking the whole app.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.label ? `:${this.props.label}` : ''}]`, error, info);
  }

  handleRetry = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
        <div className="space-y-1">
          <p className="text-sm font-mono text-foreground">
            {this.props.label ? `${this.props.label} crashed` : 'something went wrong'}
          </p>
          <p className="text-xs text-muted-foreground font-mono max-w-md break-all">
            {this.state.error.message}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={this.handleRetry} className="font-mono text-xs">
          <RotateCcw className="h-3 w-3 mr-1.5" aria-hidden />
          retry
        </Button>
      </div>
    );
  }
}

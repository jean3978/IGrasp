// Contains a render error to the view that threw it: without it, React unmounts the whole app
// and the window stays blank until a restart. Shows what went wrong and a way to try again; the
// rest of the window (tabs, sidebar, menus) keeps working.

import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Button } from './ui/Button';
import './errorBoundary.css';

interface Props {
  /** What the view is, for the message ("this tab"). */
  label: string;
  children: ReactNode;
  /** Called on "Try again" before the view renders again (reset the store that broke it). */
  onReset?: () => void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(`IGrasp: ${this.props.label} failed to render`, error, info.componentStack);
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="error-boundary" role="alert">
        <h2>Something went wrong in {this.props.label}.</h2>
        <p>The rest of the app still works. Trying again usually helps.</p>
        <pre className="error-boundary-message">{error.message}</pre>
        <Button
          variant="primary"
          onClick={() => {
            this.props.onReset?.();
            this.setState({ error: null });
          }}
        >
          Try again
        </Button>
      </div>
    );
  }
}

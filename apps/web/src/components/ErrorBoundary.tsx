import { Component, type ReactNode } from 'react';
import { logger } from '../logger';
import { reportRenderError } from '../telemetry';
import { Icon } from './Icon';
import styles from './ErrorPanel.module.css';

interface ErrorBoundaryProps {
  /** Tells the two boundaries apart in logs and reports. */
  name: 'app' | 'route';
  /** The boundary tries its children again when this changes (the route boundary passes the path). */
  resetKey?: string;
  children: ReactNode;
}

interface ErrorBoundaryState {
  failed: boolean;
  resetKey: string | undefined;
}

/**
 * Plain markup on purpose: the app boundary sits above the router and the query client, so the fallback may not use
 * either. The links are full page loads, which also clears whatever state caused the failure.
 */
function Fallback() {
  return (
    <div className={styles.panel} role="alert">
      <Icon name="warning" size={28} className={styles.icon} />
      <div className={styles.text}>
        <h2 className={styles.title}>Something went wrong</h2>
        <p className={styles.message}>This page hit an unexpected error. Reloading usually fixes it.</p>
        <div className={styles.actions}>
          <button type="button" className={styles.retry} onClick={() => window.location.reload()}>
            Reload
          </button>
          <a href="/dashboard/health" className={styles.health}>
            Open Health
          </a>
        </div>
      </div>
    </div>
  );
}

/** A render error shows a card with a way out instead of leaving an empty window. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { failed: false, resetKey: this.props.resetKey };

  static getDerivedStateFromError(): Partial<ErrorBoundaryState> {
    return { failed: true };
  }

  static getDerivedStateFromProps(
    props: ErrorBoundaryProps,
    state: ErrorBoundaryState,
  ): Partial<ErrorBoundaryState> | null {
    return props.resetKey === state.resetKey ? null : { failed: false, resetKey: props.resetKey };
  }

  override componentDidCatch(error: unknown): void {
    logger.error('app', 'render error', {
      boundary: this.props.name,
      error: error instanceof Error ? error.name : typeof error,
    });
    reportRenderError(error, this.props.name);
  }

  override render(): ReactNode {
    return this.state.failed ? <Fallback /> : this.props.children;
  }
}

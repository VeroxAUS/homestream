import { failureHint } from './serverLaunch.js';
import type { SupervisorStatus } from './supervisor.js';

/** What the bundled startup page shows. Only fixed words, version, port, an error code and a time go into its URL. */
export interface LoadingView {
  state: 'starting' | 'failed';
  version: string;
  port: number;
  code?: string;
  lastAttemptAt?: number;
  /** Another program holds the port: the page names the port instead of saying the app tried five times. */
  portInUse?: boolean;
}

export function loadingViewFor(status: SupervisorStatus, version: string, port: number): LoadingView {
  if (status.kind === 'failed') {
    return {
      state: 'failed',
      version,
      port,
      code: status.code,
      lastAttemptAt: status.lastAttemptAt,
      portInUse: status.portInUse === true,
    };
  }
  return { state: 'starting', version, port };
}

/** `loading.html` with the view in its query string (the page reads it with `URLSearchParams`). */
export function loadingPageUrl(pageUrl: string, view: LoadingView): string {
  const params = new URLSearchParams({ state: view.state, v: view.version, port: String(view.port) });
  if (view.state === 'failed') {
    if (view.portInUse) params.set('message', `Port ${view.port} is used by another program`);
    if (view.code) {
      params.set('code', view.code);
      params.set('hint', failureHint(view.code, view.port));
    }
    if (view.lastAttemptAt !== undefined) params.set('at', String(Math.round(view.lastAttemptAt)));
  }
  return `${pageUrl}?${params.toString()}`;
}

/** Which kind of page the window shows now; the shell navigates only when this changes. */
export type PageKind = 'none' | 'starting' | 'failed' | 'app';

/**
 * What the window should do after the server state changed: show the app once the server answers, the Failed page when
 * the supervisor gave up, the Starting page again after Retry; otherwise leave the page alone (a crash that is being
 * restarted is shown by the web UI's own banner).
 */
export function nextPage(current: PageKind, status: SupervisorStatus): PageKind {
  if (status.kind === 'failed') return 'failed';
  if (status.kind === 'running' || status.kind === 'attached') return 'app';
  if (current === 'none' || current === 'failed') return 'starting';
  return current;
}

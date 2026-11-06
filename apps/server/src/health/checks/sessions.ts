import type { LogEvent } from '@homestream/shared';
import type { CheckOutcome } from './types.js';

export const RECENT_ERROR_WINDOW_MS = 15 * 60 * 1000;

export interface SessionsCheckDeps {
  active: () => number;
  /** Ids of sessions whose encoder stays below real time while catching up. A session waiting at its read-ahead window never counts. */
  fallingBehind: () => string[];
  recentErrors: () => { count: number; latest: LogEvent[] };
}

export function checkSessions(deps: SessionsCheckDeps): CheckOutcome {
  const active = deps.active();
  const slow = deps.fallingBehind();
  const errors = deps.recentErrors();
  const details = {
    active,
    errorsLast15Min: errors.count,
    recentErrors: errors.latest.map((event) => ({ ts: event.ts, source: event.source, message: event.message, sessionId: event.sessionId ?? null })),
    fallingBehind: slow,
  };
  const activeText = `${active} active session${active === 1 ? '' : 's'}`;

  if (errors.count > 0) {
    return {
      status: 'warn',
      message: `${activeText}; ${errors.count} playback error${errors.count === 1 ? '' : 's'} in the last 15 minutes.`,
      hint: 'See the Logs view for the error text. Most often the TorBox link expired or the GPU was busy; starting playback again usually fixes it.',
      details,
    };
  }
  if (slow.length > 0) {
    return {
      status: 'warn',
      message: `${activeText}; ${slow.length} encoding slower than real time.`,
      hint: 'The PC cannot keep up with encoding. Close other GPU-heavy programs, or stop one of the streams.',
      details,
    };
  }
  return { status: 'ok', message: activeText, details };
}

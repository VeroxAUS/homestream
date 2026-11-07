import type { Download, SessionResponse } from '@homestream/shared';
import { useEffect, useState } from 'react';
import { startSession, stopSession } from './sessionApi';
import type { PlayTarget } from './target';

export type StartState =
  | { status: 'loading' }
  | { status: 'ready'; session: SessionResponse }
  | { status: 'downloading'; download: Download }
  | { status: 'error'; error: unknown };

export interface StartAttempt {
  /** Changes on every Retry. */
  n: number;
  startSec: number | undefined;
}

/**
 * Starts a session for the title (`streamId: "auto"`, no subtitle field) and reports loading, ready, downloading
 * (HTTP 202) or the error. A session that arrives after the player was left is stopped at once.
 */
export function useSessionStart(target: PlayTarget, attempt: StartAttempt): StartState {
  const [state, setState] = useState<StartState>({ status: 'loading' });
  const { mediaType, tmdbId, season, episode } = target;

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    // A microtask, so React's development remount (setup, cleanup, setup) sends one request, not two.
    queueMicrotask(() => {
      if (cancelled) return;
      startSession(
        {
          mediaType,
          tmdbId,
          ...(season !== undefined ? { season } : {}),
          ...(episode !== undefined ? { episode } : {}),
        },
        attempt.startSec,
      ).then(
        (result) => {
          if (cancelled) {
            if (result.kind === 'session') void stopSession(result.session.sessionId);
            return;
          }
          setState(
            result.kind === 'session'
              ? { status: 'ready', session: result.session }
              : { status: 'downloading', download: result.download },
          );
        },
        (error: unknown) => {
          if (!cancelled) setState({ status: 'error', error });
        },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [mediaType, tmdbId, season, episode, attempt.n, attempt.startSec]);

  return state;
}

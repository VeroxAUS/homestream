import type { Handover } from '@homestream/shared';
import { useEffect, useState } from 'react';
import { logger } from '../logger';
import { fetchSession } from '../player/sessionApi';
import type { StartState } from '../player/useSessionStart';
import { desktopBridge, inMiniPlayer } from './bridge';

export interface AttachedSession {
  state: StartState;
  handover: Handover | null;
  /** No hand-over arrived in time (a reloaded page): the caller starts a session the normal way instead. */
  gaveUp: boolean;
}

const HANDOVER_WAIT_MS = 3000;

/**
 * Takes over a session another desktop window is playing: the shell holds the hand-over until this page asks for it,
 * the session is read from the server (same id, no new session) and playback continues at the handed-over position.
 * When the mini window cannot load it, the shell closes that window and shows the main window on the details page.
 */
export function useAttachedSession(enabled: boolean): AttachedSession {
  const [state, setState] = useState<StartState>({ status: 'loading' });
  const [handover, setHandover] = useState<Handover | null>(null);
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    const bridge = desktopBridge();
    if (!enabled || !bridge) return;
    let active = true;
    const timer = window.setTimeout(() => {
      if (!active) return;
      logger.warn('player', 'no hand-over arrived');
      setGaveUp(true);
      if (inMiniPlayer()) void bridge.closeMiniPlayer();
    }, HANDOVER_WAIT_MS);
    const stop = bridge.onHandover((incoming) => {
      window.clearTimeout(timer);
      setHandover(incoming);
      fetchSession(incoming.sessionId).then(
        (session) =>
          active && setState({ status: 'ready', session: { ...session, startPositionSec: incoming.positionSec } }),
        (error: unknown) => {
          if (!active) return;
          const failed = () => setState({ status: 'error', error });
          if (!inMiniPlayer()) {
            failed();
            return;
          }
          // Retry here would start a new session inside the small window: let the shell show the details page instead.
          logger.warn('player', 'hand-over session could not be loaded');
          bridge.closeMiniPlayer().catch(failed);
        },
      );
    });
    return () => {
      active = false;
      window.clearTimeout(timer);
      stop();
    };
  }, [enabled]);

  return { state, handover, gaveUp };
}

import type { Handover } from '@homestream/shared';
import { useCallback, useEffect, useState } from 'react';
import { logger } from '../logger';
import { fetchSession, stopSession } from '../player/sessionApi';
import type { StartState } from '../player/useSessionStart';
import { desktopBridge, inMiniPlayer } from './bridge';

export interface AttachedSession {
  state: StartState;
  handover: Handover | null;
  /** No hand-over arrived in time (a reloaded page): the caller starts a session the normal way instead. */
  gaveUp: boolean;
  /**
   * Retry: stop waiting for or using the handed-over session and let the caller start a new one. A session that could
   * not be loaded here is ended on the server first, since nothing else owns it.
   */
  giveUp: () => void;
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
          // A text subtitle is chosen in the player only, so the server still reports its own default for it.
          active &&
          setState({
            status: 'ready',
            session: { ...session, startPositionSec: incoming.positionSec, selectedSubtitle: incoming.subtitle },
          }),
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

  const giveUp = useCallback(() => {
    if (state.status === 'error' && handover) void stopSession(handover.sessionId);
    setGaveUp(true);
  }, [state.status, handover]);

  return { state, handover, gaveUp, giveUp };
}

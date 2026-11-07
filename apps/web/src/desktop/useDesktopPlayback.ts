import { HandoverSchema, type Handover } from '@homestream/shared';
import { useCallback, useEffect, useState, type RefObject } from 'react';
import { logger } from '../logger';
import { getPlayerSnapshot } from '../player/snapshot';
import { desktopBridge, inMiniPlayer } from './bridge';
import { useReportPlaying } from './useReportPlaying';

interface DesktopPlaybackArgs {
  videoRef: RefObject<HTMLVideoElement | null>;
  /** While true, closing this page must not end the session (it is being handed to the other window). */
  released: RefObject<boolean>;
  /** Final progress ping and DELETE of the session. */
  end: () => Promise<void>;
  handover: Handover | null;
  onLeave: () => void;
  /** The main window has given the session to the mini player. */
  onHandedOver: () => void;
}

export interface DesktopPlayback {
  mini: boolean;
  /** Back, Esc and the media key Stop. In the mini player it ends playback and closes the window. */
  leave: () => void;
  /** Main window: hand the session to the mini player. `null` outside the desktop app. */
  popOut: (() => void) | null;
  /** Mini player: give the session back to the main window. */
  expand: () => void;
  pinned: boolean;
  togglePin: () => void;
}

/** Continues a handed-over session at its position, state and volume. */
function useApplyHandover(videoRef: RefObject<HTMLVideoElement | null>, handover: Handover | null): void {
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !handover) return;
    video.volume = handover.volume;
    video.muted = handover.muted;
    if (!handover.paused) return;
    // The stream starts playing by itself once it is loaded; a session that was paused stays paused.
    const hold = () => video.pause();
    video.addEventListener('playing', hold, { once: true });
    return () => video.removeEventListener('playing', hold);
  }, [videoRef, handover]);
}

function snapshotHandover(): Handover | null {
  const parsed = HandoverSchema.safeParse(getPlayerSnapshot());
  return parsed.success ? parsed.data : null;
}

/** Everything the desktop app adds to the player: mini player hand-over, awake reporting and the mini player's close. */
export function useDesktopPlayback(args: DesktopPlaybackArgs): DesktopPlayback {
  const { videoRef, released, end, handover, onLeave, onHandedOver } = args;
  const bridge = desktopBridge();
  const mini = inMiniPlayer();
  const [pinned, setPinned] = useState(true);
  useReportPlaying(videoRef);
  useApplyHandover(videoRef, handover);

  const hand = useCallback(
    async (send: (value: Handover) => Promise<boolean | void>): Promise<boolean> => {
      const value = snapshotHandover();
      const video = videoRef.current;
      if (!value || !video) return false;
      released.current = true;
      video.pause();
      try {
        if ((await send(value)) !== false) return true;
      } catch {
        logger.warn('player', 'the hand-over was refused');
      }
      released.current = false;
      if (!value.paused) void video.play().catch(() => undefined);
      return false;
    },
    [videoRef, released],
  );

  const popOut = useCallback(() => {
    if (!bridge) return;
    void hand((value) => bridge.openMiniPlayer(value)).then((done) => done && onHandedOver());
  }, [bridge, hand, onHandedOver]);
  const expand = useCallback(() => {
    if (bridge) void hand((value) => bridge.returnToMain(value));
  }, [bridge, hand]);
  const closeMini = useCallback(() => {
    void end().then(() => bridge?.closeMiniPlayer());
  }, [end, bridge]);
  const togglePin = useCallback(() => {
    void bridge?.setMiniAlwaysOnTop(!pinned).then(setPinned);
  }, [bridge, pinned]);

  return {
    mini,
    leave: mini ? closeMini : onLeave,
    popOut: bridge && !mini ? popOut : null,
    expand,
    pinned,
    togglePin,
  };
}

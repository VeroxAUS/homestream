import type { Handover, SessionResponse } from '@homestream/shared';
import { useCallback, useRef, useState, type RefObject } from 'react';
import { useDesktopPlayback } from '../desktop/useDesktopPlayback';
import { audioMenuItems, subtitleMenuItems } from './menuItems';
import type { MenuName } from './ControlBar';
import type { PlayTarget } from './target';
import { useIdleChrome } from './useIdleChrome';
import { useHls, type PlaybackFailure } from './useHls';
import { useMediaSession } from './useMediaSession';
import { usePlayerActions } from './usePlayerActions';
import { usePlayerSnapshot } from './usePlayerSnapshot';
import { useProgressPings, useSessionEnd } from './useSessionLifetime';
import { useShortcuts } from './useShortcuts';
import { useTrackSwitching } from './useTrackSwitching';
import type { TitleMeta } from './useTitleMeta';
import { useVideoState } from './useVideoState';

interface PlaybackModelArgs {
  session: SessionResponse;
  target: PlayTarget;
  meta: TitleMeta;
  /** The line under the title, also published to the Media Session. */
  line: string;
  stageRef: RefObject<HTMLElement | null>;
  onLeave: () => void;
  /** Desktop app: the session was handed over by the other window. */
  handover?: Handover | null;
  /** Desktop app: the main window gave the session to the mini player. */
  onHandedOver: () => void;
}

/** All the state and behaviour of one playing session; `Playback` only draws it. */
export function usePlaybackModel(args: PlaybackModelArgs) {
  const { session, target, meta, line, stageRef, handover = null, onHandedOver } = args;
  const videoRef = useRef<HTMLVideoElement>(null);
  const selectionRef = useRef(session.selectedSubtitle);
  const released = useRef(false);
  const [fatal, setFatal] = useState<PlaybackFailure | null>(null);
  const [menu, setMenu] = useState<MenuName | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  const { hlsRef, reloading, reload } = useHls({
    videoRef,
    playlistUrl: session.playlistUrl,
    startSec: session.startPositionSec,
    selectionRef,
    onFatal: setFatal,
  });
  const tracks = useTrackSwitching({ session, videoRef, hlsRef, selectionRef, reload });
  const last = useProgressPings(session.sessionId, videoRef);
  const end = useSessionEnd(session.sessionId, last, released);
  const desktop = useDesktopPlayback({ videoRef, released, end, handover, onLeave: args.onLeave, onHandedOver });
  const { leave } = desktop;

  const video = useVideoState(videoRef);
  const actions = usePlayerActions(videoRef, stageRef, session.durationSec);
  const toggleInfo = useCallback(() => setInfoOpen((open) => !open), []);
  const escape = () => {
    if (menu) setMenu(null);
    else if (infoOpen) setInfoOpen(false);
    else if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else leave();
  };
  useShortcuts({
    actions,
    toggleSubtitles: () => void tracks.toggleSubtitles(),
    toggleInfo,
    miniPlayer: desktop.mini ? desktop.expand : desktop.popOut,
    escape,
  });
  useIdleChrome(
    stageRef,
    video.paused || video.buffering || fatal !== null || menu !== null || infoOpen || tracks.busy,
  );
  useMediaSession({ title: meta.title, artist: line, artworkUrl: meta.posterUrl, videoRef, actions, onStop: leave });
  usePlayerSnapshot({
    session,
    target,
    title: meta.title ?? handover?.title ?? '',
    videoRef,
    audioIndex: tracks.current.selectedAudioIndex,
    subtitle: tracks.subtitle,
  });

  const source = {
    session,
    selectedAudioIndex: tracks.current.selectedAudioIndex,
    subtitle: tracks.subtitle,
    selectAudio: tracks.selectAudio,
    selectSubtitle: tracks.selectSubtitle,
  };
  return {
    videoRef,
    fatal,
    video,
    actions,
    tracks,
    menu,
    setMenu,
    infoOpen,
    toggleInfo,
    desktop,
    waiting: video.buffering || reloading || tracks.busy,
    audioItems: audioMenuItems(source),
    subtitleItems: subtitleMenuItems(source),
  };
}

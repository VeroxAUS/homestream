import type { SessionResponse } from '@homestream/shared';
import { useCallback, useRef, useState, type RefObject } from 'react';
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
}

/** All the state and behaviour of one playing session; `Playback` only draws it. */
export function usePlaybackModel({ session, target, meta, line, stageRef, onLeave }: PlaybackModelArgs) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const selectionRef = useRef(session.selectedSubtitle);
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
  useSessionEnd(session.sessionId, last);

  const video = useVideoState(videoRef);
  const actions = usePlayerActions(videoRef, stageRef, session.durationSec);
  const toggleInfo = useCallback(() => setInfoOpen((open) => !open), []);
  const escape = () => {
    if (menu) setMenu(null);
    else if (infoOpen) setInfoOpen(false);
    else if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else onLeave();
  };
  useShortcuts({ actions, toggleSubtitles: () => void tracks.toggleSubtitles(), toggleInfo, escape });
  useIdleChrome(
    stageRef,
    video.paused || video.buffering || fatal !== null || menu !== null || infoOpen || tracks.busy,
  );
  useMediaSession({ title: meta.title, artist: line, artworkUrl: meta.posterUrl, videoRef, actions, onStop: onLeave });
  usePlayerSnapshot({
    session,
    target,
    title: meta.title ?? '',
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
    waiting: video.buffering || reloading || tracks.busy,
    audioItems: audioMenuItems(source),
    subtitleItems: subtitleMenuItems(source),
  };
}

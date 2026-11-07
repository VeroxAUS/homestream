import type { SessionResponse } from '@homestream/shared';
import type { RefObject } from 'react';
import { ControlBar } from './ControlBar';
import { InfoPanel } from './InfoPanel';
import { CenterPlay, PlayerBusy, PlayerError } from './PlayerOverlays';
import type { PlayTarget } from './target';
import type { TitleMeta } from './useTitleMeta';
import { usePlaybackModel } from './usePlaybackModel';
import styles from './Player.module.css';

interface PlaybackProps {
  session: SessionResponse;
  target: PlayTarget;
  meta: TitleMeta;
  line: string;
  stageRef: RefObject<HTMLElement | null>;
  fullscreen: boolean;
  onLeave: () => void;
  /** Starts a new session at this position after a stream failure. */
  onRetry: (positionSec: number) => void;
}

/** The playing session: video, scrims, controls, menus, info panel and the failure card. */
export function Playback(props: PlaybackProps) {
  const { session, fullscreen, onLeave, onRetry } = props;
  const model = usePlaybackModel(props);
  const { videoRef, fatal, video, actions, tracks, menu, infoOpen } = model;
  return (
    <>
      <video
        ref={videoRef}
        className={styles.video}
        playsInline
        data-testid="player-video"
        onClick={actions.togglePlay}
        onDoubleClick={actions.toggleFullscreen}
      />
      <div className={styles.scrims} />
      {fatal ? (
        <PlayerError
          title="Playback failed"
          message={fatal.message}
          hint={fatal.hint}
          retryLabel="Try again"
          onRetry={() => onRetry(videoRef.current?.currentTime ?? 0)}
          onBack={onLeave}
        />
      ) : null}
      {!fatal && model.waiting ? <PlayerBusy headline="Buffering..." detail="Playback resumes automatically." /> : null}
      {!fatal && !model.waiting && video.paused ? <CenterPlay onPlay={actions.togglePlay} /> : null}
      {infoOpen ? <InfoPanel session={tracks.current} subtitle={tracks.subtitle} /> : null}
      <ControlBar
        videoRef={videoRef}
        durationSec={session.durationSec}
        video={video}
        actions={actions}
        fullscreen={fullscreen}
        menu={menu}
        onMenu={model.setMenu}
        infoOpen={infoOpen}
        onInfo={model.toggleInfo}
        audioItems={model.audioItems}
        subtitleItems={model.subtitleItems}
      />
    </>
  );
}

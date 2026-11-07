import type { Handover, SessionResponse } from '@homestream/shared';
import { useState, type RefObject } from 'react';
import { MiniControls } from '../desktop/MiniControls';
import { ControlBar } from './ControlBar';
import { InfoPanel } from './InfoPanel';
import { CenterPlay, PlayerBusy, PlayerError } from './PlayerOverlays';
import { waitForStop } from './sessionApi';
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
  /** Desktop app: set when this page took the session over from the other window. */
  handover?: Handover | null;
  onHandedOver: () => void;
}

/** The playing session: video, scrims, controls, menus, info panel and the failure card. */
export function Playback(props: PlaybackProps) {
  const { session, fullscreen, onRetry } = props;
  const model = usePlaybackModel(props);
  const { videoRef, fatal, video, actions, tracks, menu, infoOpen, desktop, end } = model;
  const [retrying, setRetrying] = useState(false);
  // The failed session ends before its replacement is requested, otherwise the replacement can meet a full server.
  const retry = () => {
    if (retrying) return;
    setRetrying(true);
    const positionSec = videoRef.current?.currentTime ?? 0;
    void waitForStop(end()).then(() => onRetry(positionSec));
  };
  return (
    <>
      <video
        ref={videoRef}
        className={styles.video}
        playsInline
        data-testid="player-video"
        onClick={actions.togglePlay}
        onDoubleClick={desktop.mini ? undefined : actions.toggleFullscreen}
      />
      <div className={styles.scrims} />
      {fatal && !retrying ? (
        <PlayerError
          title="Playback failed"
          message={fatal.message}
          hint={fatal.hint}
          retryLabel="Try again"
          onRetry={retry}
          onBack={desktop.leave}
        />
      ) : null}
      {retrying ? <PlayerBusy headline="Starting playback..." detail="The server is preparing the video." /> : null}
      {!fatal && model.waiting ? <PlayerBusy headline="Buffering..." detail="Playback resumes automatically." /> : null}
      {!fatal && !model.waiting && video.paused && !desktop.mini ? <CenterPlay onPlay={actions.togglePlay} /> : null}
      {infoOpen ? <InfoPanel session={tracks.current} subtitle={tracks.subtitle} /> : null}
      {desktop.mini ? (
        <MiniControls
          title={props.meta.title ?? props.handover?.title ?? ''}
          videoRef={videoRef}
          durationSec={session.durationSec}
          video={video}
          actions={actions}
          pinned={desktop.pinned}
          onPin={desktop.togglePin}
          onExpand={desktop.expand}
          onClose={desktop.leave}
        />
      ) : (
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
          onPopOut={desktop.popOut}
          audioItems={model.audioItems}
          subtitleItems={model.subtitleItems}
        />
      )}
    </>
  );
}

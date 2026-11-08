import { Icon } from '../components/Icon';
import type { PlayerActions } from '../player/usePlayerActions';
import type { VideoState } from '../player/useVideoState';
import styles from './MiniControls.module.css';

/** Mute button and volume range at the end of the mini player's bottom row. */
export function MiniVolume({ video, actions }: { video: VideoState; actions: PlayerActions }) {
  const silent = video.muted || video.volume === 0;
  const label = silent ? 'Unmute' : 'Mute';
  return (
    <>
      <button type="button" className={styles.round} aria-label={label} title={label} onClick={actions.toggleMute}>
        <Icon name={silent ? 'mute' : 'volume'} size={16} />
      </button>
      <input
        type="range"
        className={styles.volume}
        aria-label="Volume"
        min={0}
        max={1}
        step={0.01}
        value={video.muted ? 0 : video.volume}
        onChange={(event) => actions.setVolume(Number(event.currentTarget.value))}
      />
    </>
  );
}

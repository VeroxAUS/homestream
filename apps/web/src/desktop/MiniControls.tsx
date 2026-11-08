import { useCallback, useRef, type RefObject } from 'react';
import { Icon } from '../components/Icon';
import { formatClock } from '../lib/format';
import { SeekBar } from '../player/SeekBar';
import { BAR_ATTRIBUTE } from '../player/useIdleChrome';
import { SKIP_BACK_SEC, SKIP_FORWARD_SEC, type PlayerActions } from '../player/usePlayerActions';
import { useVideoClock, type VideoState } from '../player/useVideoState';
import styles from './MiniControls.module.css';
import { MiniVolume } from './MiniVolume';

interface MiniControlsProps {
  title: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  durationSec: number;
  video: VideoState;
  actions: PlayerActions;
  pinned: boolean;
  onPin: () => void;
  onExpand: () => void;
  onClose: () => void;
}

function Elapsed({ videoRef }: { videoRef: RefObject<HTMLVideoElement | null> }) {
  const label = useRef<HTMLSpanElement>(null);
  const update = useCallback((video: HTMLVideoElement) => {
    if (label.current) label.current.textContent = formatClock(video.currentTime);
  }, []);
  useVideoClock(videoRef, update);
  return (
    <span ref={label} className={`${styles.time} tabular`} data-testid="mini-elapsed">
      0:00
    </span>
  );
}

function RoundButton(props: {
  label: string;
  icon: 'pin' | 'expand' | 'close';
  pressed?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`${styles.round} ${props.pressed ? styles.on : ''}`}
      aria-label={props.label}
      title={props.label}
      aria-pressed={props.pressed}
      onClick={props.onClick}
    >
      <Icon name={props.icon} size={16} />
    </button>
  );
}

/** The mini player's overlay: title row on top, transport in the middle, time and seek bar below. */
export function MiniControls(props: MiniControlsProps) {
  const { video, actions } = props;
  return (
    <div className={`${styles.overlay} chrome`} {...{ [BAR_ATTRIBUTE]: '' }}>
      <div className={styles.top}>
        <span className={styles.title}>{props.title}</span>
        <RoundButton label="Always on top" icon="pin" pressed={props.pinned} onClick={props.onPin} />
        <RoundButton label="Back to the full window" icon="expand" onClick={props.onExpand} />
        <RoundButton label="Close" icon="close" onClick={props.onClose} />
      </div>
      <div className={styles.centre}>
        <button
          type="button"
          className={styles.skip}
          aria-label={`Back ${SKIP_BACK_SEC} seconds`}
          onClick={() => actions.skip(-SKIP_BACK_SEC)}
        >
          -{SKIP_BACK_SEC}
        </button>
        <button
          type="button"
          className={styles.play}
          aria-label={video.paused ? 'Play' : 'Pause'}
          onClick={actions.togglePlay}
        >
          <Icon name={video.paused ? 'play' : 'pause'} size={22} />
        </button>
        <button
          type="button"
          className={styles.skip}
          aria-label={`Forward ${SKIP_FORWARD_SEC} seconds`}
          onClick={() => actions.skip(SKIP_FORWARD_SEC)}
        >
          +{SKIP_FORWARD_SEC}
        </button>
      </div>
      <div className={styles.bottom}>
        <Elapsed videoRef={props.videoRef} />
        <div className={styles.seek}>
          <SeekBar videoRef={props.videoRef} durationSec={props.durationSec} onSeek={actions.seekTo} />
        </div>
        <span className={`${styles.time} tabular`}>{formatClock(props.durationSec)}</span>
        <MiniVolume video={video} actions={actions} />
      </div>
    </div>
  );
}

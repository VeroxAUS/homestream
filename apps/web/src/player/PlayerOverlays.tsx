import { Link } from 'react-router';
import { Icon } from '../components/Icon';
import styles from './PlayerOverlays.module.css';

interface PlayerErrorProps {
  title: string;
  message: string;
  hint?: string;
  retryLabel: string;
  onRetry: () => void;
  onBack: () => void;
}

/** A failed start or a failed stream: what happened, what to do, and ways to retry, check health or leave. */
export function PlayerError({ title, message, hint, retryLabel, onRetry, onBack }: PlayerErrorProps) {
  return (
    <div className={styles.overlay}>
      <div className={`${styles.box} ${styles.errorBox}`} role="alert" data-testid="player-error">
        <Icon name="warning" size={34} className={styles.warning} />
        <h2 className={styles.errorTitle}>{title}</h2>
        <p className={styles.errorMessage}>{message}</p>
        {hint ? <p className={styles.hint}>Hint: {hint}</p> : null}
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={onRetry} autoFocus>
            {retryLabel}
          </button>
          <button type="button" className={styles.secondary} onClick={onBack}>
            Back to details
          </button>
          <Link to="/dashboard/health" className={styles.secondary}>
            Open Health dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}

interface PlayerBusyProps {
  headline: string;
  detail?: string;
}

/** The spinner shown while a session starts and while the stream catches up. */
export function PlayerBusy({ headline, detail }: PlayerBusyProps) {
  return (
    <div className={styles.overlay}>
      <div className={styles.box} role="status" data-testid="player-busy">
        <div className={styles.spinner} aria-hidden="true" />
        <b className={styles.busyTitle}>{headline}</b>
        {detail ? <span className={styles.busyDetail}>{detail}</span> : null}
      </div>
    </div>
  );
}

/** The big centre button, shown while the video is paused. */
export function CenterPlay({ onPlay }: { onPlay: () => void }) {
  return (
    <div className={styles.center}>
      <button type="button" className={styles.bigPlay} aria-label="Play" onClick={onPlay}>
        <Icon name="play" size={34} />
      </button>
    </div>
  );
}

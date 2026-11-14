import { UNCONFIRMED_CAPTION, UNCONFIRMED_LABEL } from '../lib/downloadWording';
import { Icon } from './Icon';
import styles from './DownloadBadge.module.css';

interface DownloadBadgeProps {
  progress: number | undefined;
  /** False while TorBox has not confirmed the start: the badge must not claim a download is running. */
  confirmed: boolean;
}

/** Takes the place of the Play button while TorBox caches the title; it is a status, not a control. */
export function DownloadBadge({ progress, confirmed }: DownloadBadgeProps) {
  if (!confirmed) {
    return (
      <div className={`${styles.badge} ${styles.unconfirmed}`} role="status" aria-disabled="true">
        <Icon name="hourglass" size={20} className={styles.icon} />
        <span className={styles.text}>
          <span>{UNCONFIRMED_LABEL}</span>
          <span className={styles.caption}>{UNCONFIRMED_CAPTION}</span>
        </span>
      </div>
    );
  }
  const fraction = Math.min(1, progress ?? 0);
  return (
    <div className={styles.badge} role="status" aria-disabled="true">
      <Icon name="hourglass" size={20} className={styles.icon} />
      <span className="tabular">{fraction > 0 ? `Downloading ${Math.round(fraction * 100)}%` : 'Downloading'}</span>
      {fraction > 0 ? <span className={styles.bar} style={{ transform: `scaleX(${fraction})` }} /> : null}
    </div>
  );
}

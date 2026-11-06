import { Icon } from './Icon';
import styles from './DownloadBadge.module.css';

/** Takes the place of the Play button while TorBox caches the title; it is a status, not a control. */
export function DownloadBadge({ progress }: { progress: number | undefined }) {
  const fraction = Math.min(1, progress ?? 0);
  return (
    <div className={styles.badge} role="status" aria-disabled="true">
      <Icon name="hourglass" size={20} className={styles.icon} />
      <span className="tabular">{fraction > 0 ? `Downloading ${Math.round(fraction * 100)}%` : 'Downloading'}</span>
      {fraction > 0 ? <span className={styles.bar} style={{ transform: `scaleX(${fraction})` }} /> : null}
    </div>
  );
}

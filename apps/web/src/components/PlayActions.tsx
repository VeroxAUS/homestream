import type { ProgressResponse } from '@homestream/shared';
import { Link } from 'react-router';
import type { PendingDownload } from '../events/usePendingDownload';
import { formatClock, formatRemaining, formatRuntime, watchedFraction } from '../lib/format';
import { Badge } from './Badge';
import { DownloadBadge } from './DownloadBadge';
import { Icon } from './Icon';
import { ProgressBar } from './ProgressBar';
import styles from './PlayActions.module.css';

interface PlayActionsProps {
  /** The player route of this title, e.g. `/play/movie/278`. */
  playPath: string;
  /** `undefined` while the saved progress is loading, `null` when nothing is saved. */
  progress: ProgressResponse | null | undefined;
  download: PendingDownload | null;
  /** Names the resume bar for screen readers. */
  subject: string;
  wide?: boolean;
}

/** Play or Resume plus Start over, or the download badge while the title is being cached. */
export function PlayActions({ playPath, progress, download, subject, wide = false }: PlayActionsProps) {
  const layout = wide ? styles.wide : '';
  if (download) {
    return (
      <div className={layout}>
        <DownloadBadge progress={download.progress} />
      </div>
    );
  }
  if (progress === undefined) return <div className={`${styles.placeholder} pulse ${layout}`} aria-hidden="true" />;

  if (!progress?.resumable) {
    return (
      <div className={`${styles.actions} ${layout}`}>
        <Link to={playPath} className={styles.primary}>
          <Icon name="play" size={18} />
          Play
        </Link>
        {progress?.completed ? <Badge tone="ok">Watched</Badge> : null}
      </div>
    );
  }

  const start = Math.floor(progress.positionSec);
  return (
    <div className={layout}>
      <div className={styles.actions}>
        <Link to={`${playPath}?start=${start}`} className={styles.primary}>
          <Icon name="play" size={18} />
          Resume from {formatClock(progress.positionSec)}
        </Link>
        <Link to={`${playPath}?start=0`} className={styles.outline}>
          Start over
        </Link>
      </div>
      <div className={styles.resume}>
        <ProgressBar
          fraction={watchedFraction(progress.positionSec, progress.durationSec)}
          label={`${subject} progress`}
          className={styles.resumeBar}
        />
        <p className={`${styles.caption} tabular`}>
          {formatClock(progress.positionSec)} of {formatRuntime(progress.durationSec / 60)} ·{' '}
          {formatRemaining(progress.positionSec, progress.durationSec)}
        </p>
      </div>
    </div>
  );
}

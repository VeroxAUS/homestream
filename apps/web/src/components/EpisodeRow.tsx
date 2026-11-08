import type { Episode, EpisodeProgress } from '@homestream/shared';
import { memo, useState } from 'react';
import { Link } from 'react-router';
import { formatEpisodeRuntime, watchedFraction } from '../lib/format';
import { tmdbImage } from '../lib/images';
import { isEpisodeHidden, SPOILER_TEXT, useHideSpoilers } from '../lib/spoilers';
import { Badge } from './Badge';
import { Icon } from './Icon';
import { ProgressBar } from './ProgressBar';
import styles from './EpisodeRow.module.css';

interface EpisodeRowProps {
  tmdbId: number;
  season: number;
  episode: Episode;
  /** The show's backdrop, shown dimmed for an episode TMDB has no still for. */
  fallbackStill: string | null;
  progress: EpisodeProgress | undefined;
  selected: boolean;
  onSelect: (episodeNumber: number) => void;
}

export const EpisodeRow = memo(function EpisodeRow({
  tmdbId,
  season,
  episode,
  fallbackStill,
  progress,
  selected,
  onSelect,
}: EpisodeRowProps) {
  const [broken, setBroken] = useState(false);
  const hasStill = episode.stillUrl !== null;
  const withheld = isEpisodeHidden(useHideSpoilers(), progress);
  const still = broken ? null : tmdbImage(episode.stillUrl ?? fallbackStill, withheld && hasStill ? 'w92' : 'w300');
  const inProgress = progress?.resumable === true;
  const percent = progress ? Math.round(watchedFraction(progress.positionSec, progress.durationSec) * 100) : 0;
  return (
    <li className={`${styles.row} ${selected ? styles.selected : ''}`} data-episode={episode.episodeNumber}>
      <button
        type="button"
        className={styles.main}
        aria-pressed={selected}
        onClick={() => onSelect(episode.episodeNumber)}
      >
        <span className={`${styles.number} tabular`}>{episode.episodeNumber}</span>
        <span className={styles.still}>
          {still ? (
            <img
              src={still}
              alt=""
              width={232}
              height={130}
              loading="lazy"
              decoding="async"
              onError={() => setBroken(true)}
            />
          ) : null}
          {hasStill ? null : <span className={styles.dim} aria-hidden="true" />}
          {inProgress && progress ? (
            <ProgressBar
              fraction={watchedFraction(progress.positionSec, progress.durationSec)}
              label={`Episode ${episode.episodeNumber} progress`}
              className={styles.bar}
            />
          ) : null}
        </span>
        <span className={styles.text}>
          <span className={styles.head}>
            <span className={styles.name}>{episode.name}</span>
            {progress?.completed ? <Badge tone="ok">Watched</Badge> : null}
            {inProgress ? <Badge tone="accent">{percent}%</Badge> : null}
          </span>
          {withheld ? <span className={`${styles.overview} ${styles.withheld}`}>{SPOILER_TEXT}</span> : null}
          {!withheld && episode.overview ? <span className={styles.overview}>{episode.overview}</span> : null}
        </span>
        <span className={`${styles.runtime} tabular`}>
          {episode.runtime ? formatEpisodeRuntime(episode.runtime) : ''}
        </span>
      </button>
      <Link
        to={`/play/tv/${tmdbId}/${season}/${episode.episodeNumber}`}
        className={styles.play}
        aria-label={`Play episode ${episode.episodeNumber}: ${episode.name}`}
      >
        <Icon name="play" size={18} />
      </Link>
    </li>
  );
});

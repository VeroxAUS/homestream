import type { Download, Episode, EpisodeProgress } from '@homestream/shared';
import { downloadKey } from '../events/downloadProgress';
import { usePendingDownload } from '../events/usePendingDownload';
import { formatEpisodeRuntime } from '../lib/format';
import { tmdbImage } from '../lib/images';
import { PlayActions } from './PlayActions';
import styles from './EpisodePanel.module.css';

interface EpisodePanelProps {
  tmdbId: number;
  season: number;
  episode: Episode;
  fallbackStill: string | null;
  /** `undefined` while saved progress is loading, `null` when this episode has none. */
  progress: EpisodeProgress | null | undefined;
  download: Download | undefined;
}

/** The selected episode: a bigger still, its facts, and Play or Resume. */
export function EpisodePanel({ tmdbId, season, episode, fallbackStill, progress, download }: EpisodePanelProps) {
  const pending = usePendingDownload(downloadKey('tv', tmdbId, season, episode.episodeNumber), download);
  const still = tmdbImage(episode.stillUrl ?? fallbackStill, 'w300');
  return (
    <aside className={styles.panel} aria-label="Selected episode">
      <div className={styles.still}>
        {still ? <img src={still} alt="" width={300} height={169} decoding="async" /> : null}
        {episode.stillUrl ? null : <span className={styles.dim} aria-hidden="true" />}
      </div>
      <div className={styles.body}>
        <p className={styles.kicker}>
          Season {season} · Episode {episode.episodeNumber}
        </p>
        <h2 className={styles.name}>{episode.name}</h2>
        <p className={`${styles.meta} tabular`}>
          {[episode.airDate, episode.runtime ? formatEpisodeRuntime(episode.runtime) : null]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {episode.overview ? <p className={styles.overview}>{episode.overview}</p> : null}
        <div className={styles.actions}>
          <PlayActions
            playPath={`/play/tv/${tmdbId}/${season}/${episode.episodeNumber}`}
            progress={progress}
            download={pending}
            subject={episode.name}
            wide
          />
        </div>
      </div>
    </aside>
  );
}

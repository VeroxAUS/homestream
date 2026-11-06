import type { MediaSummary } from '@homestream/shared';
import { memo, useState } from 'react';
import { Link } from 'react-router';
import { tmdbImage } from '../lib/images';
import { Icon } from './Icon';
import styles from './PosterCard.module.css';

interface PosterCardProps {
  item: MediaSummary;
  /** Search results say whether a card is a movie or a show. */
  showType?: boolean;
}

function detailsPath(type: MediaSummary['type'], tmdbId: number): string {
  return type === 'movie' ? `/movie/${tmdbId}` : `/tv/${tmdbId}`;
}

/** A 176 x 264 poster with its title and "year · rating" caption; the image loads lazily at TMDB's w342 size. */
export const PosterCard = memo(function PosterCard({ item, showType = false }: PosterCardProps) {
  const [broken, setBroken] = useState(false);
  const poster = broken ? null : tmdbImage(item.posterUrl, 'w342');
  return (
    <Link to={detailsPath(item.type, item.tmdbId)} className={styles.card}>
      <span className={styles.art}>
        {poster ? (
          <img
            src={poster}
            alt=""
            width={176}
            height={264}
            loading="lazy"
            decoding="async"
            onError={() => setBroken(true)}
          />
        ) : (
          <span className={styles.placeholder} aria-hidden="true">
            {item.title.trim().charAt(0).toUpperCase()}
          </span>
        )}
        <span className={styles.ring} aria-hidden="true" />
      </span>
      <span className={styles.title}>{item.title}</span>
      <span className={styles.meta}>
        {showType ? <span className={styles.type}>{item.type === 'movie' ? 'Movie' : 'Show'}</span> : null}
        {item.year ? <span>{item.year}</span> : null}
        {item.rating > 0 ? (
          <span className={styles.rating}>
            <Icon name="star" size={12} className={styles.star} />
            {item.rating.toFixed(1)}
          </span>
        ) : null}
      </span>
    </Link>
  );
});

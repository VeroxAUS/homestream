import { ContinueWatchingRemoveResponseSchema, type ContinueWatchingItem, type HomeResponse } from '@homestream/shared';
import { useQueryClient } from '@tanstack/react-query';
import { memo, useCallback, useState } from 'react';
import { Link } from 'react-router';
import { apiFetch } from '../api/client';
import { formatEpisodeCode, formatRemaining, watchedFraction } from '../lib/format';
import { tmdbImage } from '../lib/images';
import { useHideSpoilers } from '../lib/spoilers';
import { Badge } from './Badge';
import { Icon } from './Icon';
import { ProgressBar } from './ProgressBar';
import styles from './ContinueWatchingRow.module.css';

const EAGER_CARDS = 2;

function detailsLink(item: ContinueWatchingItem): string {
  if (item.type === 'movie') return `/movie/${item.tmdbId}`;
  const base = `/tv/${item.tmdbId}`;
  return item.season !== undefined && item.episode !== undefined
    ? `${base}?season=${item.season}&episode=${item.episode}`
    : base;
}

function subLine(item: ContinueWatchingItem): string {
  if (item.type === 'movie') return 'Movie';
  const code =
    item.season !== undefined && item.episode !== undefined ? formatEpisodeCode(item.season, item.episode) : '';
  return [item.upNext ? 'Up next' : '', code, item.episodeTitle ?? ''].filter(Boolean).join(' · ');
}

/**
 * Episode stills are already w300; anything else (a movie or show backdrop) is fetched at w780. A card is never for a
 * finished episode, so while spoilers are hidden an episode still is fetched at w92 and the browser scales it up.
 */
function cardImage(url: string | null, hideSpoilers: boolean): string | null {
  if (!url?.includes('/w300/')) return tmdbImage(url, 'w780');
  return tmdbImage(url, hideSpoilers ? 'w92' : 'w300');
}

interface WideCardProps {
  item: ContinueWatchingItem;
  eager: boolean;
  onRemove: (mediaKey: string) => void;
}

const WideCard = memo(function WideCard({ item, eager, onRemove }: WideCardProps) {
  const [broken, setBroken] = useState(false);
  const hideSpoilers = useHideSpoilers();
  const image = broken ? null : cardImage(item.backdropUrl, hideSpoilers && item.type === 'tv');
  const fraction = watchedFraction(item.positionSec, item.durationSec);
  return (
    <div className={styles.card}>
      <Link to={detailsLink(item)} className={styles.link}>
        <span className={styles.art}>
          {image ? (
            <img
              src={image}
              alt=""
              width={340}
              height={191}
              loading={eager ? 'eager' : 'lazy'}
              decoding="async"
              onError={() => setBroken(true)}
            />
          ) : null}
          <span className={styles.shade} aria-hidden="true" />
        </span>
        <span className={styles.playBadge} aria-hidden="true">
          <Icon name="play" size={16} />
        </span>
        <span className={styles.info}>
          <span className={styles.title}>{item.title}</span>
          <span className={styles.sub}>{subLine(item)}</span>
          {item.upNext ? (
            <span className={styles.upNext}>
              <Badge tone="accent">Up next</Badge>
            </span>
          ) : (
            <>
              <ProgressBar fraction={fraction} label={`${item.title} progress`} />
              <span className={`${styles.remaining} tabular`}>
                <span>{Math.round(fraction * 100)}% watched</span>
                <span>{formatRemaining(item.positionSec, item.durationSec)}</span>
              </span>
            </>
          )}
        </span>
      </Link>
      <button
        type="button"
        className={styles.remove}
        aria-label="Remove from Continue Watching"
        onClick={() => onRemove(item.mediaKey)}
      >
        <Icon name="close" size={16} />
      </button>
    </div>
  );
});

export function ContinueWatchingRow({ items }: { items: readonly ContinueWatchingItem[] }) {
  const queryClient = useQueryClient();
  const remove = useCallback(
    (mediaKey: string) => {
      queryClient.setQueryData<HomeResponse>(['home'], (home) =>
        home
          ? { ...home, continueWatching: home.continueWatching.filter((entry) => entry.mediaKey !== mediaKey) }
          : home,
      );
      void apiFetch(`/api/continue-watching/${encodeURIComponent(mediaKey)}`, { method: 'DELETE' })
        .then((response) => response.json())
        .then((body) => ContinueWatchingRemoveResponseSchema.parse(body))
        .catch(() => queryClient.invalidateQueries({ queryKey: ['home'] }));
    },
    [queryClient],
  );

  return (
    <section className={styles.row} aria-labelledby="continue-watching-heading">
      <div className={styles.header}>
        <h2 id="continue-watching-heading" className={styles.heading}>
          Continue Watching
        </h2>
        <span className={styles.count}>{items.length === 1 ? '1 title' : `${items.length} titles`}</span>
      </div>
      <ul className={styles.scroller}>
        {items.map((item, index) => (
          <li key={item.mediaKey} className={styles.item}>
            <WideCard item={item} eager={index < EAGER_CARDS} onRemove={remove} />
          </li>
        ))}
      </ul>
    </section>
  );
}

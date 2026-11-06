import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { tmdbImage } from '../lib/images';
import { Icon } from './Icon';
import styles from './DetailsHero.module.css';

interface DetailsHeroProps {
  title: string;
  backdropUrl: string | null;
  posterUrl: string | null;
  children: ReactNode;
}

function BackLink() {
  const navigate = useNavigate();
  const { key } = useLocation();
  // A page opened directly has no earlier page in this app to go back to.
  const back = () => void (key === 'default' ? navigate('/') : navigate(-1));
  return (
    <button type="button" className={styles.back} onClick={back}>
      <Icon name="chevronLeft" size={16} />
      Back
    </button>
  );
}

export function DetailsHero({ title, backdropUrl, posterUrl, children }: DetailsHeroProps) {
  const backdrop = tmdbImage(backdropUrl, 'w1280');
  const poster = tmdbImage(posterUrl, 'w500');
  return (
    <header className={styles.hero}>
      {backdrop ? (
        <img className={styles.backdrop} src={backdrop} alt="" width={1280} height={720} fetchPriority="high" />
      ) : null}
      <div className={styles.shade} aria-hidden="true" />
      <div className={styles.content}>
        {poster ? (
          <img className={styles.poster} src={poster} alt={`${title} poster`} width={280} height={420} />
        ) : (
          <div className={`${styles.poster} ${styles.noPoster}`} aria-hidden="true">
            {title.trim().charAt(0).toUpperCase()}
          </div>
        )}
        <div className={styles.text}>
          <BackLink />
          <h1 className={styles.title}>{title}</h1>
          {children}
        </div>
      </div>
    </header>
  );
}

interface MetaLineProps {
  rating: number;
  year: number | null;
  extra?: string | null;
}

/** "★ 8.7 · 1994 · 2h 22m": the facts under the title. */
export function MetaLine({ rating, year, extra }: MetaLineProps) {
  const parts = [year ? String(year) : null, extra ?? null].filter((part): part is string => part !== null);
  return (
    <p className={`${styles.meta} tabular`}>
      {rating > 0 ? (
        <span className={styles.rating}>
          <Icon name="star" size={14} className={styles.star} />
          {rating.toFixed(1)}
        </span>
      ) : null}
      {parts.map((part) => (
        <span key={part}>{part}</span>
      ))}
    </p>
  );
}

export function GenreChips({ genres }: { genres: readonly string[] }) {
  if (genres.length === 0) return null;
  return (
    <ul className={styles.genres} aria-label="Genres">
      {genres.map((genre) => (
        <li key={genre} className={styles.genre}>
          {genre}
        </li>
      ))}
    </ul>
  );
}

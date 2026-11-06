import type { MediaSummary } from '@homestream/shared';
import { useId } from 'react';
import { PosterCard } from './PosterCard';
import styles from './PosterRow.module.css';

interface PosterRowProps {
  title: string;
  items: readonly MediaSummary[];
  /** Rows below the first screen skip rendering (and so their image requests) until they are near the viewport. */
  belowFold?: boolean;
}

export function PosterRow({ title, items, belowFold = false }: PosterRowProps) {
  const headingId = useId();
  return (
    <section className={`${styles.row} ${belowFold ? styles.belowFold : ''}`} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}>
        {title}
      </h2>
      <ul className={styles.scroller}>
        {items.map((item) => (
          <li key={`${item.type}:${item.tmdbId}`} className={styles.item}>
            <PosterCard item={item} />
          </li>
        ))}
      </ul>
    </section>
  );
}

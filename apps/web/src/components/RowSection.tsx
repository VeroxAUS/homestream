import { useId, type ReactNode } from 'react';
import styles from './RowSection.module.css';

interface RowSectionProps {
  title: string;
  /** Lists below the first screen skip rendering (and so their image requests) until they are near the viewport. */
  belowFold?: boolean;
  /** A shorter row than a poster row, which sets the height reserved while its list is skipped. */
  compact?: boolean;
  children: ReactNode;
}

/** An h2 over a horizontally scrolling list; the children are `RowItem`s. */
export function RowSection({ title, belowFold = false, compact = false, children }: RowSectionProps) {
  const headingId = useId();
  const skipped = compact ? styles.belowFoldCompact : styles.belowFold;
  return (
    <section className={styles.row} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}>
        {title}
      </h2>
      <ul className={`${styles.scroller} ${belowFold ? skipped : ''}`}>{children}</ul>
    </section>
  );
}

export function RowItem({ children }: { children: ReactNode }) {
  return <li className={styles.item}>{children}</li>;
}

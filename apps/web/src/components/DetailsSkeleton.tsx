import styles from './DetailsSkeleton.module.css';

/** What a details page shows in the moment before its data arrives. */
export function DetailsSkeleton() {
  return (
    <div className={`${styles.hero} pulse`} role="status" aria-label="Loading details">
      <div className={styles.poster} />
      <div className={styles.lines}>
        <div className={styles.title} />
        <div className={styles.line} />
        <div className={styles.line} />
      </div>
    </div>
  );
}

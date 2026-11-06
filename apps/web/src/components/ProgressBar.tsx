import styles from './ProgressBar.module.css';

interface ProgressBarProps {
  /** Share of the title watched, 0..1. */
  fraction: number;
  label: string;
  className?: string;
}

/** A thin bar; its fill width is set once and never animated. */
export function ProgressBar({ fraction, label, className }: ProgressBarProps) {
  const percent = Math.round(fraction * 100);
  return (
    <div
      className={`${styles.track} ${className ?? ''}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <div className={styles.fill} style={{ width: `${fraction * 100}%` }} />
    </div>
  );
}

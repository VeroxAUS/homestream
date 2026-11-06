import { Link } from 'react-router';
import { describeError } from '../lib/errors';
import { Icon } from './Icon';
import styles from './ErrorPanel.module.css';

interface ErrorPanelProps {
  error: unknown;
  title?: string;
  onRetry?: () => void;
}

/** Every failed load ends here: what went wrong, what to do, and a way to retry or open the health dashboard. */
export function ErrorPanel({ error, title, onRetry }: ErrorPanelProps) {
  const { message, hint, unreachable } = describeError(error);
  return (
    <div className={styles.panel} role="alert">
      <Icon name="warning" size={28} className={styles.icon} />
      <div className={styles.text}>
        <h2 className={styles.title}>{title ?? (unreachable ? 'Server unreachable' : 'Something went wrong')}</h2>
        <p className={styles.message}>{message}</p>
        {hint ? <p className={styles.hint}>{hint}</p> : null}
        <div className={styles.actions}>
          {onRetry ? (
            <button type="button" className={styles.retry} onClick={onRetry}>
              Retry
            </button>
          ) : null}
          <Link to="/dashboard/health" className={styles.health}>
            Open Health
          </Link>
        </div>
      </div>
    </div>
  );
}

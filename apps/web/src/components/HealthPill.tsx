import type { HealthResponse } from '@homestream/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { healthQuery } from '../api/queries';
import styles from './HealthPill.module.css';

type HealthTone = 'ok' | 'warn' | 'err' | 'unknown';

export interface HealthLabel {
  tone: HealthTone;
  text: string;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The pill's colour and words for a health answer: warnings count the warn checks, problems the error checks. */
export function describeHealth(health: HealthResponse): HealthLabel {
  if (health.overall === 'ok') return { tone: 'ok', text: 'All systems healthy' };
  const matching = health.checks.filter((check) => check.status === health.overall).length;
  const count = matching || health.checks.filter((check) => check.status !== 'ok').length || 1;
  return health.overall === 'warn'
    ? { tone: 'warn', text: plural(count, 'warning', 'warnings') }
    : { tone: 'err', text: plural(count, 'problem', 'problems') };
}

/**
 * The nav's health indicator: a dot and a few words, linking to the health dashboard. compact (the desktop app) hides
 * the words below 1200 px instead of below 900 px; the full text stays as the accessible name and tooltip.
 */
export function HealthPill({ compact = false }: { compact?: boolean }) {
  const { data, isError } = useQuery(healthQuery());
  let label: HealthLabel = { tone: 'unknown', text: 'Checking...' };
  if (isError) label = { tone: 'err', text: 'Server unreachable' };
  else if (data) label = describeHealth(data);

  return (
    <Link
      to="/dashboard/health"
      className={`${styles.pill} ${styles[label.tone]} ${compact ? styles.compact : ''}`}
      aria-label={label.text}
      title={label.text}
      data-health={label.tone}
    >
      <span className={styles.dot} aria-hidden="true" />
      <span className={styles.text}>{label.text}</span>
    </Link>
  );
}

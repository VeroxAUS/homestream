import type { ReactNode } from 'react';
import styles from './Badge.module.css';

interface BadgeProps {
  tone?: 'default' | 'ok' | 'warn' | 'err' | 'accent';
  children: ReactNode;
}

export function Badge({ tone = 'default', children }: BadgeProps) {
  return <span className={`${styles.badge} ${styles[tone] ?? ''}`}>{children}</span>;
}

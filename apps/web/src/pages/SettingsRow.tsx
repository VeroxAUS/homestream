import type { ReactNode } from 'react';
import styles from './SettingsPage.module.css';

export function Row({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <div className={styles.label}>
        <span>{label}</span>
        {help ? <span className={styles.help}>{help}</span> : null}
      </div>
      <div className={styles.value}>{children}</div>
    </div>
  );
}

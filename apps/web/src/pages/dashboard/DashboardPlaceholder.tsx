import { DASHBOARD_TABS, type DashboardTab } from './tabs';
import styles from './Dashboard.module.css';

/** Stands in for a dashboard until its page is built. */
export default function DashboardPlaceholder({ section }: { section: DashboardTab }) {
  const label = DASHBOARD_TABS.find((entry) => entry.path === section)?.label ?? 'Dashboard';
  return (
    <section className={styles.card} aria-labelledby="dashboard-section-heading">
      <h2 id="dashboard-section-heading" className={styles.cardTitle}>
        {label}
      </h2>
      <p className={styles.muted}>This dashboard is not available yet.</p>
    </section>
  );
}

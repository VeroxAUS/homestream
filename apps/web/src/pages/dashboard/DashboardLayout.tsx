import { NavLink, Outlet } from 'react-router';
import { DASHBOARD_TABS } from './tabs';
import styles from './Dashboard.module.css';

export default function DashboardLayout() {
  return (
    <main className={styles.page}>
      <h1 className={styles.title}>Dashboards</h1>
      <nav className={styles.tabs} aria-label="Dashboard sections">
        {DASHBOARD_TABS.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            className={({ isActive }) => `${styles.tab} ${isActive ? styles.tabActive : ''}`}
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </main>
  );
}

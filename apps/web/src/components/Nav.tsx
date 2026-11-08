import { Link, NavLink, useLocation } from 'react-router';
import { deviceKind } from '../device/identity';
import { HealthPill } from './HealthPill';
import { Icon } from './Icon';
import { NavSearch } from './NavSearch';
import styles from './Nav.module.css';

const linkClass = ({ isActive }: { isActive: boolean }): string => `${styles.link} ${isActive ? styles.active : ''}`;

/** Opens the Health dashboard and stays active on every dashboard page (their tabs sit inside the page). */
function DashboardLink() {
  const { pathname } = useLocation();
  const active = pathname === '/dashboard' || pathname.startsWith('/dashboard/');
  return (
    <Link
      to="/dashboard/health"
      className={`${styles.link} ${active ? styles.active : ''}`}
      aria-current={active ? 'page' : undefined}
    >
      Dashboard
    </Link>
  );
}

export function Nav() {
  const desktop = deviceKind() === 'desktop';
  return (
    <header className={`${styles.bar} ${desktop ? styles.desktop : ''}`} data-desktop={desktop || undefined}>
      <Link to="/" className={styles.logo} aria-label="HomeStream home">
        <span className={styles.mark} aria-hidden="true">
          <Icon name="play" size={14} />
        </span>
        HomeStream
      </Link>
      <nav className={styles.links} aria-label="Main">
        <NavLink to="/" end className={linkClass}>
          Home
        </NavLink>
        <DashboardLink />
        <NavLink to="/settings" className={linkClass}>
          Settings
        </NavLink>
      </nav>
      <NavSearch />
      <div className={styles.right}>
        <HealthPill compact={desktop} />
      </div>
    </header>
  );
}

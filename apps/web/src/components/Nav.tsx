import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { deviceKind } from '../device/identity';
import { DASHBOARD_TABS } from '../pages/dashboard/tabs';
import { HealthPill } from './HealthPill';
import { Icon } from './Icon';
import styles from './Nav.module.css';

const linkClass = ({ isActive }: { isActive: boolean }): string => `${styles.link} ${isActive ? styles.active : ''}`;

function DashboardsMenu() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const active = pathname.startsWith('/dashboard');

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={root} className={styles.menuRoot}>
      <button
        type="button"
        className={`${styles.link} ${styles.menuButton} ${active ? styles.active : ''}`}
        aria-expanded={open}
        aria-haspopup="true"
        aria-current={active ? 'page' : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        Dashboards
        <Icon name="chevronDown" size={14} />
      </button>
      {open ? (
        <ul className={styles.menu} aria-label="Dashboards">
          {DASHBOARD_TABS.map((tab) => (
            <li key={tab.path}>
              <NavLink to={`/dashboard/${tab.path}`} className={linkClass} onClick={() => setOpen(false)}>
                {tab.label}
              </NavLink>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
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
        <NavLink to="/search" className={linkClass}>
          Search
        </NavLink>
        <DashboardsMenu />
        <NavLink to="/settings" className={linkClass}>
          Settings
        </NavLink>
      </nav>
      <div className={styles.right}>
        <HealthPill compact={desktop} />
        <Link to="/search" className={styles.searchButton} aria-label="Search titles">
          <Icon name="search" size={20} />
        </Link>
      </div>
    </header>
  );
}
